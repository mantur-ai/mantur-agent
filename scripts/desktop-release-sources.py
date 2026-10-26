"""Archive and verify the Git source trees used by a desktop release."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def git(repository, *arguments):
    """Run Git without inherited credentials or interactive authentication."""
    environment = {name: value for name, value in os.environ.items()
                   if not re.search(r'KEY|SECRET|TOKEN|PASSWORD', name, re.I) and not name.startswith('GIT_')}
    environment.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    return subprocess.check_output(['git', '-C', str(repository), *arguments], env=environment)


def object_id(value):
    """Require the complete SHA-1 object IDs recorded by the source manifest."""
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Source manifest requires a full Git object ID')
    return value


def fetch_source(destination, repository, commit, tree):
    """Fetch one pinned commit into a private repository and verify its tree."""
    object_id(commit)
    object_id(tree)
    destination.mkdir()
    git(destination, 'init', '--quiet')
    git(destination, 'fetch', '--quiet', '--depth=1', '--', repository, commit)
    git(destination, 'checkout', '--quiet', '--detach', commit)
    if git(destination, 'rev-parse', 'HEAD^{tree}').decode().strip() != tree:
        raise ValueError('Source repository tree differs from the pinned tree')


def verify_source_links(links):
    """Resolve Git-verified link targets component by component within the source root."""
    for origin, target in links.items():
        if target.startswith('/'):
            raise ValueError('Source archive link escapes its source directory')
        resolved = origin.split('/')[:-1]
        pending = [(part, False) for part in reversed(target.split('/'))]
        active = {origin}
        while pending:
            part, completed = pending.pop()
            if completed:
                active.remove(part)
            elif part in ('', '.'):
                continue
            elif part == '..':
                if not resolved:
                    raise ValueError('Source archive link escapes its source directory')
                resolved.pop()
            else:
                path = '/'.join([*resolved, part])
                if path not in links:
                    resolved.append(part)
                    continue
                if path in active:
                    raise ValueError('Source archive contains a link cycle')
                target = links[path]
                if target.startswith('/'):
                    raise ValueError('Source archive link escapes its source directory')
                active.add(path)
                pending.append((path, True))
                pending.extend((component, False) for component in reversed(target.split('/')))


def archive_tree(repository, revision, tree, destination):
    """Create a deterministic archive and check every file against the Git tree."""
    if git(repository, 'rev-parse', revision + '^{tree}').decode().strip() != tree:
        raise ValueError('Archive tree differs from its source record')
    entries = {}
    for row in git(repository, 'ls-tree', '-rz', '--full-tree', tree).split(b'\0'):
        if not row:
            continue
        metadata, path = row.split(b'\t', 1)
        mode, kind, digest = metadata.decode().split(' ')
        if kind != 'blob' or mode not in ('100644', '100755', '120000'):
            raise ValueError('Source archives require complete blobs; submodules are unsupported')
        entries[path.decode('utf-8', 'surrogateescape')] = (mode, digest)
    prefix = destination.name.removesuffix('.tar.gz') + '/'
    tar_path = destination.with_suffix('')
    git(repository, 'archive', '--format=tar', '--mtime=2000-01-01T00:00:00Z', '--prefix=' + prefix,
        '--output=' + str(tar_path), revision)
    with tar_path.open('rb') as incoming, destination.open('xb') as outgoing:
        with gzip.GzipFile(filename='', mode='wb', fileobj=outgoing, mtime=0) as compressed:
            shutil.copyfileobj(incoming, compressed)
    tar_path.unlink()
    seen = set()
    links = {}
    with tarfile.open(destination, 'r:gz') as archive:
        for member in archive:
            if member.isdir() and member.name == prefix[:-1]:
                continue
            if not member.name.startswith(prefix):
                raise ValueError('Source archive entry escaped its prefix')
            path = member.name[len(prefix):]
            if path.startswith('/') or '..' in path.split('/'):
                raise ValueError('Source archive contains an unsafe path')
            if member.isdir():
                continue
            if path not in entries or path in seen:
                raise ValueError('Source archive contains an unexpected or duplicate file')
            mode, expected = entries[path]
            if member.issym() and mode == '120000':
                content = member.linkname.encode('utf-8', 'surrogateescape')
            elif member.isfile() and mode in ('100644', '100755'):
                if bool(member.mode & 0o111) != (mode == '100755'):
                    raise ValueError('Source archive changed an executable mode')
                content = archive.extractfile(member).read()
            else:
                raise ValueError('Source archive changed a file type')
            actual = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
            if actual != expected:
                raise ValueError('Source archive changed a tracked file')
            if mode == '120000':
                links[path] = member.linkname
            seen.add(path)
    if seen != entries.keys():
        raise ValueError('Source archive omitted tracked files')
    verify_source_links(links)
    return {'name': destination.name, 'gitObject': revision, 'tree': tree,
            'size': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}


def archive_release(root, output):
    """Stage all verified release sources before adding files to the candidate."""
    root = root.resolve()
    output = output.resolve()
    git(root, 'diff', '--quiet', 'HEAD', '--')
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    tree = git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    source_path = 'apps/desktop/mantur-cut/source.json'
    source_bytes = git(root, 'show', head + ':' + source_path)
    if (root / source_path).read_bytes() != source_bytes:
        raise ValueError('Working source manifest differs from the release commit')
    source = json.loads(source_bytes)
    if source['formatVersion'] != 2 or len(source['patches']) != 3:
        raise ValueError('Desktop sources require the three-layer version 2 Cut manifest')
    version = json.loads(git(root, 'show', head + ':apps/desktop/package.json'))['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?', version):
        raise ValueError('Desktop sources require a stable or numbered RC version')
    distribution = hashlib.sha256(source_bytes).hexdigest()
    with tempfile.TemporaryDirectory(prefix='desktop-release-sources-') as temporary:
        work = Path(temporary)
        staged = work / 'artifacts'
        staged.mkdir()
        cut = work / 'cut'
        whisper = work / 'whisper'
        fetch_source(cut, source['repository'], source['upstreamCommit'], source['upstreamTree'])
        fetch_source(whisper, source['whisperRepository'], source['whisperCommit'], source['whisperTree'])
        files = [archive_tree(root, head, tree, staged / ('Mantur-Agent-source-' + version + '.tar.gz')),
                 archive_tree(cut, source['upstreamCommit'], source['upstreamTree'], staged / 'OpenChatCut-upstream-source.tar.gz'),
                 archive_tree(whisper, source['whisperCommit'], source['whisperTree'], staged / 'whisper-cpp-source.tar.gz')]
        for patch in source['patches']:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+\.patch', patch['file']):
                raise ValueError('Source manifest contains an unsafe patch filename')
            relative = 'packages/client/ui-mantur-editing/adapters/' + patch['file']
            content = git(root, 'show', head + ':' + relative)
            if hashlib.sha256(content).hexdigest() != patch['sha256']:
                raise ValueError('Cut patch does not match its pinned SHA256')
            path = work / patch['file']
            path.write_bytes(content)
            git(cut, 'apply', '--index', str(path))
            if git(cut, 'write-tree').decode().strip() != object_id(patch['resultTree']):
                raise ValueError('Cut patch does not produce its pinned tree')
        patched_tree = source['patches'][-1]['resultTree']
        files.append(archive_tree(cut, patched_tree, patched_tree, staged / 'Mantur-Cut-patched-source.tar.gz'))
        (staged / 'DESKTOP-SOURCES.json').write_text(json.dumps({
            'formatVersion': 1, 'desktopVersion': version, 'harnessCommit': head, 'harnessTree': tree,
            'distributionId': distribution, 'cutSource': source, 'files': files,
        }, indent=2) + '\n', encoding='utf-8')
        (staged / 'DESKTOP-SOURCE-BUILD.txt').write_text(
            f'ManTur Agent {version} source delivery\n\n'
            f'Harness commit: {head}\nHarness tree: {tree}\nCut distribution SHA256: {distribution}\n'
            'DESKTOP-SOURCES.json binds every source archive to its Git tree and SHA256. '
            'The Harness archive contains the source configuration, all three Cut patches, '
            'dependency locks, build scripts, bundled CLI/skill inputs and license notices. '
            'The Cut archives contain the complete upstream and final patched Git trees; '
            'the Whisper archive contains its complete pinned Git tree.\n\n'
            'Build on the native target with Node 24 and the pnpm version in package.json. '
            'macOS also requires Xcode Command Line Tools. To retain the published Git identity:\n'
            'git clone https://github.com/mantur-ai/mantur-agent.git\n'
            'cd mantur-agent\n'
            f'git checkout --detach {head}\n'
            'pnpm install --frozen-lockfile\n'
            'pnpm run build:mantur\n'
            'pnpm run desktop:dist:mac:arm64\n\n'
            'The final command verifies and rebuilds the pinned Cut source and dependencies. '
            'Release signing and notarization require the distributor credentials described in apps/desktop/README.md. '
            'For a local build without Developer ID credentials use pnpm run desktop:dist:mac:arm64:local. '
            'For Intel macOS use desktop:dist:mac:x64 on Intel macOS; for Windows use desktop:dist:win:x64 on x64 Windows. '
            'An archive-only rebuild can initialize a new Git repository from the Harness files and commit them before these commands; '
            'its BUILD_INFO identifies that new commit, not the published commit.\n\n'
            'Read the retained licenses and SOURCE_OFFER_REVIEW.txt in the packaged Cut resources. '
            'Source delivery does not replace Remotion eligibility, third-party binary redistribution review or the recorded dependency audit.\n',
            encoding='utf-8')
        output.mkdir(parents=True, exist_ok=True)
        for path in staged.iterdir():
            if (output / path.name).exists():
                raise FileExistsError('Refusing to replace source artifact: ' + path.name)
        for path in staged.iterdir():
            with path.open('rb') as incoming, (output / path.name).open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
    return files


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    arguments = parser.parse_args()
    archive_release(Path(__file__).resolve().parent.parent, arguments.output)
