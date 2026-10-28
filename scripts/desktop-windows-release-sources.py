"""Bind Windows release artifacts to committed sources and verified shared archives."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.parse
import urllib.request

import yaml


spec = importlib.util.spec_from_file_location('release_sources', Path(__file__).with_name('desktop-release-sources.py'))
release_sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_sources)
media_inputs = release_sources.media_inputs
git = release_sources.git

MAC_SOURCE_URL = 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent/releases/1.0.0/DESKTOP-SOURCES.json'
MAC_SOURCE_SHA256 = '559962d9d7ce2b52f96468f406e32e3373cf12dd1fc15ed76ec36661f62518be'
SOURCE_PATH = 'apps/desktop/mantur-cut/source.win32-x64.json'
INSTALLER = 'Mantur-Agent-Windows-x64.exe'
MEDIA_ARCHIVE = 'Mantur-Media-Windows-corresponding-source.tar.gz'
SHARED_FIELDS = (
    'repository', 'version', 'upstreamCommit', 'upstreamTree', 'patches',
    'whisperRepository', 'whisperVersion', 'whisperCommit', 'whisperTree',
    'remotionVersion', 'remotionRendererIntegrity', 'electronVersion', 'embeddedNodeVersion',
)


def file_record(path):
    """Record an ordinary nonempty artifact without loading it into memory."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
        raise ValueError('Missing or nonordinary release artifact: ' + path.name)
    return {'name': path.name, 'size': path.stat().st_size, 'sha256': media_inputs.sha256(path)}


def read_mac_index(local_path=None):
    """Read only the fixed approved source index; never acquire shared archives."""
    if local_path is not None:
        if local_path.is_symlink() or not local_path.is_file() or local_path.stat().st_size > 1024 * 1024:
            raise ValueError('Invalid local Mac source index')
        content = local_path.read_bytes()
    else:
        with urllib.request.urlopen(MAC_SOURCE_URL, timeout=60) as response:
            if urllib.parse.urlsplit(response.url).scheme != 'https':
                raise ValueError('Mac source index redirected away from HTTPS')
            content = response.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024 or hashlib.sha256(content).hexdigest() != MAC_SOURCE_SHA256:
        raise ValueError('Approved Mac source index SHA256 mismatch')
    return json.loads(content)


def shared_sources(source, mac, baseline, version):
    """Reuse approved trees only when all shared source pins remain identical."""
    if mac.get('formatVersion') != 1 or mac.get('harnessCommit') != baseline or mac.get('desktopVersion') != version:
        raise ValueError('Mac source index does not bind the requested baseline and version')
    approved = mac['cutSource']
    for field in SHARED_FIELDS:
        if source[field] != approved[field]:
            raise ValueError('Shared source pin differs from the approved baseline: ' + field)
    if source['targets']['win32-x64']['chromeVersion'] != approved['targets']['win32-x64']['chromeVersion']:
        raise ValueError('Shared Chromium source version differs from the approved baseline')
    expected = {
        'OpenChatCut-upstream-source.tar.gz': (source['upstreamCommit'], source['upstreamTree'], 'OpenChatCut upstream'),
        'Mantur-Cut-patched-source.tar.gz': (source['patches'][-1]['resultTree'], source['patches'][-1]['resultTree'], 'Patched OpenChatCut'),
        'whisper-cpp-source.tar.gz': (source['whisperCommit'], source['whisperTree'], 'Whisper source'),
        'Mantur-Media-corresponding-source.tar.gz': (None, None, 'Shared Remotion, Electron and Chromium FFmpeg sources only'),
    }
    references = []
    for name, (revision, tree, scope) in expected.items():
        rows = [row for row in mac['files'] if row['name'] == name]
        if len(rows) != 1:
            raise ValueError('Approved shared archive is missing or duplicated: ' + name)
        row = rows[0]
        media_inputs.digest_value(row['sha256'])
        if type(row['size']) is not int or row['size'] <= 0:
            raise ValueError('Approved shared archive requires a positive byte count')
        if revision is not None and (row.get('gitObject') != revision or row.get('tree') != tree):
            raise ValueError('Approved shared archive Git identity mismatch: ' + name)
        if revision is None:
            original = approved['nativeMedia']['correspondingSource']
            if row['sha256'] != original['sha256'] or row['size'] != original['bytes']:
                raise ValueError('Approved shared media source identity mismatch')
        references.append({**row, 'url': MAC_SOURCE_URL.rsplit('/', 1)[0] + '/' + name, 'scope': scope})
    return references


def verify_media(root, source, archive):
    """Use the existing complete media inspection with an explicit local archive."""
    record = source['nativeMedia']['correspondingSource']
    filename = urllib.parse.unquote(urllib.parse.urlsplit(record['url']).path.rsplit('/', 1)[-1])
    if archive.name != filename:
        raise ValueError('Local media source archive filename differs from the pinned URL')
    media_inputs.verify_archive_file(archive, record)
    previous = os.environ.get('MANTUR_MEDIA_INPUT_DIR')
    os.environ['MANTUR_MEDIA_INPUT_DIR'] = str(archive.parent.resolve())
    try:
        _, verified = media_inputs.corresponding_source(root, archive.parent, source)
    finally:
        if previous is None:
            os.environ.pop('MANTUR_MEDIA_INPUT_DIR', None)
        else:
            os.environ['MANTUR_MEDIA_INPUT_DIR'] = previous
    revision = release_sources.object_id(verified['recipeCommit'])
    git(root, 'merge-base', '--is-ancestor', revision, 'HEAD')
    for item in [source['nativeMedia']['sourceLock'], *source['nativeMedia']['recipes']]:
        if hashlib.sha256(git(root, 'show', revision + ':' + item['file'])).hexdigest() != item['sha256']:
            raise ValueError('Media recipe commit does not contain the pinned recipe')
    return {**verified, 'name': MEDIA_ARCHIVE, 'scope': 'Windows compiled media libraries, dependencies and build recipes'}


def verify_release(output, version, smoke_report):
    """Bind update metadata and the native unsigned smoke to the exact installer."""
    files = [file_record(output / name) for name in (INSTALLER, INSTALLER + '.blockmap', 'latest.yml')]
    info = yaml.safe_load((output / 'latest.yml').read_text(encoding='utf-8'))
    with (output / INSTALLER).open('rb') as stream:
        digest = hashlib.sha512()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    sha512 = base64.b64encode(digest.digest()).decode()
    if (info.get('version') != version or info.get('path') != INSTALLER or
            len(info.get('files', [])) != 1 or info['files'][0].get('url') != INSTALLER or
            info['files'][0].get('size') != files[0]['size'] or info['files'][0].get('sha512') != sha512 or
            ('sha512' in info and info['sha512'] != sha512)):
        raise ValueError('Windows update metadata does not match the release installer')
    smoke_identity = file_record(smoke_report)
    report = json.loads(smoke_report.read_text(encoding='utf-8-sig'))
    installer = report.get('installer', {})
    application = report.get('installedApplication', {})
    if (report.get('status') != 'PASS' or report.get('expectedVersion') != version or
            report.get('installedPackageVersion') != version or
            installer.get('sha256') != files[0]['sha256'] or installer.get('bytes') != files[0]['size'] or
            installer.get('authenticodeStatus') != 'NotSigned' or
            application.get('authenticodeStatus') != 'NotSigned' or application.get('peMachine') != '0x8664'):
        raise ValueError('Native smoke does not prove this unsigned Windows installer')
    return files, {'mode': 'unsigned', 'installerAuthenticodeStatus': 'NotSigned',
                   'installedApplicationAuthenticodeStatus': 'NotSigned', 'smokeReport': smoke_identity,
                   'scope': 'Native CI installation and startup; not human About or old-version upgrade acceptance'}


def archive_release(root, output, baseline, run_id, media_archive, smoke_report, mac_index=None):
    """Stage Windows-only source delivery without changing existing artifacts."""
    root = root.resolve()
    output = output.resolve()
    baseline = release_sources.object_id(baseline)
    if not re.fullmatch(r'[1-9][0-9]*', run_id):
        raise ValueError('A numeric GitHub workflow run ID is required')
    git(root, 'diff', '--quiet', 'HEAD', '--')
    git(root, 'merge-base', '--is-ancestor', baseline, 'HEAD')
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    tree = git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    source_bytes = git(root, 'show', head + ':' + SOURCE_PATH)
    if (root / SOURCE_PATH).is_symlink() or (root / SOURCE_PATH).read_bytes() != source_bytes:
        raise ValueError('Working Windows source manifest differs from the release commit')
    source = json.loads(source_bytes)
    if source.get('formatVersion') != 3 or len(source.get('patches', [])) != 3 or source['nativeMedia']['target'] != 'win32-x64':
        raise ValueError('Windows sources require the three-layer version 3 win32-x64 manifest')
    media = media_inputs.media_config(root, source)
    for record in [media['inventory'], media['sourceLock'], *media['recipes']]:
        if hashlib.sha256(git(root, 'show', head + ':' + record['file'])).hexdigest() != record['sha256']:
            raise ValueError('Committed Windows media input differs from its source pin')
    for patch in source['patches']:
        if not re.fullmatch(r'[A-Za-z0-9_.-]+\.patch', patch['file']):
            raise ValueError('Unsafe Cut patch filename')
        content = git(root, 'show', head + ':packages/client/ui-mantur-editing/adapters/' + patch['file'])
        if hashlib.sha256(content).hexdigest() != patch['sha256']:
            raise ValueError('Committed Cut patch differs from its source pin')
    version = json.loads(git(root, 'show', head + ':apps/desktop/package.json'))['version']
    if version != '1.0.0':
        raise ValueError('This source delivery requires desktop version 1.0.0')
    mac = read_mac_index(mac_index)
    references = shared_sources(source, mac, baseline, version)
    artifacts, signing = verify_release(output, version, smoke_report)
    media_record = verify_media(root, source, media_archive)
    distribution = hashlib.sha256(source_bytes).hexdigest()
    names = ['Mantur-Agent-Windows-source-' + version + '.tar.gz', MEDIA_ARCHIVE,
             'DESKTOP-SOURCES-Windows.json', 'DESKTOP-SOURCE-BUILD-Windows.txt']
    for name in names:
        if (output / name).exists() or (output / name).is_symlink():
            raise FileExistsError('Refusing to replace Windows source artifact: ' + name)
    with tempfile.TemporaryDirectory(prefix='desktop-windows-sources-') as temporary:
        staged = Path(temporary)
        files = [release_sources.archive_tree(root, head, tree, staged / names[0]), media_record]
        with media_archive.open('rb') as incoming, (staged / MEDIA_ARCHIVE).open('xb') as outgoing:
            shutil.copyfileobj(incoming, outgoing)
        media_inputs.verify_archive_file(staged / MEDIA_ARCHIVE, source['nativeMedia']['correspondingSource'])
        index = {
            'formatVersion': 1, 'platform': 'win32-x64', 'desktopVersion': version,
            'harnessCommit': head, 'harnessTree': tree, 'baselineCommit': baseline,
            'workflowRunId': run_id, 'workflowRunUrl': 'https://github.com/mantur-ai/mantur-agent/actions/runs/' + run_id,
            'distributionId': distribution, 'sourceConfigPath': SOURCE_PATH, 'cutSource': source,
            'signing': signing, 'releaseArtifacts': artifacts, 'files': files,
            'sharedSourceIndex': {'url': MAC_SOURCE_URL, 'sha256': MAC_SOURCE_SHA256, 'harnessCommit': baseline},
            'sharedSources': references,
        }
        (staged / names[2]).write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
        (staged / names[3]).write_text(
            f'ManTur Agent {version} Windows x64 source delivery\n\n'
            f'Harness commit: {head}\nHarness tree: {tree}\nMac baseline: {baseline}\n'
            f'Workflow run: {run_id}\nWindows source configuration SHA256: {distribution}\n'
            'This Windows release is unsigned. The exact installer passed the native CI smoke with '
            'installer and installed application Authenticode status NotSigned; its report digest is in '
            'DESKTOP-SOURCES-Windows.json. This is not human GUI or old-version upgrade acceptance.\n\n'
            'The Windows Harness archive contains the committed source.win32-x64.json, Cut patches, '
            'dependency locks and application build scripts. The Windows media archive contains the '
            'compiled media libraries\' corresponding sources and Windows build recipes. Its complete '
            'inventory and recipe commit have been checked against the source pins. The index binds '
            'the installer, blockmap and latest.yml to their SHA256 and byte counts.\n\n'
            'Unchanged OpenChatCut upstream, patched Cut and Whisper Git trees are referenced by the '
            'approved immutable Mac source index and their exact archive URLs, SHA256 and sizes. '
            'The referenced Mac media source archive supplies shared Remotion, Electron and Chromium '
            'FFmpeg sources only; its Mac build recipe does not describe the Windows media build. '
            'Windows-specific compiled libraries and recipes are supplied in the new Windows media archive.\n\n'
            'Build on native Windows x64 with Node 24, the pnpm version from package.json and the '
            'build tools documented in apps/desktop/README.md:\n'
            'git clone https://github.com/mantur-ai/mantur-agent.git\ncd mantur-agent\n'
            f'git checkout --detach {head}\n'
            'pnpm install --frozen-lockfile\npnpm run build:mantur\npnpm run desktop:dist:win:x64\n\n'
            'The target source configuration pins the Windows media candidate and corresponding sources. '
            'Set MANTUR_MEDIA_INPUT_DIR to their exact local archive directory for offline media reuse. '
            'Read the Windows media recipe and retained license notices for its source rebuild steps. '
            'An archive-only build creates a new Git identity; it cannot claim the published commit. '
            'SHA256SUMS-Windows.txt is generated after these files to avoid a circular index digest.\n', encoding='utf-8')
        for name in names:
            with (staged / name).open('rb') as incoming, (output / name).open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--media-source-archive', type=Path, required=True)
    parser.add_argument('--smoke-report', type=Path, required=True)
    parser.add_argument('--mac-source-index', type=Path, help='Reuse the exact approved index without downloading it')
    arguments = parser.parse_args()
    archive_release(Path(__file__).resolve().parent.parent, arguments.output, arguments.baseline,
                    arguments.run_id, arguments.media_source_archive, arguments.smoke_report, arguments.mac_source_index)
