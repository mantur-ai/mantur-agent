"""Promote one approved Windows candidate without rebuilding or changing Mac objects."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import urllib.error
import urllib.parse
import urllib.request
import zipfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


publisher = module('windows_publisher', 'desktop-publish-tos.py')
sources = module('windows_sources', 'desktop-windows-release-sources.py')
REPOSITORY = 'mantur-ai/mantur-agent'
BASELINE = 'cd7d91f370a03d60e713c213b5fb9c70b8f78ea0'
PUBLIC_URL = 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent'
RELEASE_FILES = {
    'Mantur-Agent-Windows-x64.exe', 'Mantur-Agent-Windows-x64.exe.blockmap', 'latest.yml',
    'Mantur-Agent-Windows-source-1.0.0.tar.gz', 'Mantur-Media-Windows-x64.tar.gz',
    'Mantur-Media-Windows-corresponding-source.tar.gz', 'DESKTOP-SOURCES-Windows.json',
    'DESKTOP-SOURCE-BUILD-Windows.txt', 'SHA256SUMS-Windows.txt',
}
VERIFICATION_FILES = {'MEDIA-RUN.json', 'MEDIA-INPUTS.json', 'UNSIGNED-IDENTITIES.json',
                      'installed/RESULT.json', 'media/RESULT.json'}


def read_json(path):
    """Read bounded JSON evidence, including PowerShell's optional UTF-8 BOM."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError('Missing or oversized JSON evidence: ' + path.name)
    return json.loads(path.read_text(encoding='utf-8-sig'))


def parse_approval(value, tag, commit):
    """Require every independent approval pin and the dedicated candidate tag."""
    approval = json.loads(value)
    keys = {'commit', 'sourceConfigSha256', 'manifestSha256', 'runId', 'runAttempt', 'artifactId', 'artifactDigest'}
    if not isinstance(approval, dict) or set(approval) != keys:
        raise ValueError('Windows approval must contain exactly the seven documented identity fields')
    for name in ('runId', 'runAttempt', 'artifactId'):
        approval[name] = str(approval[name])
        if not re.fullmatch(r'[1-9][0-9]*', approval[name]):
            raise ValueError('Invalid Windows approval ID: ' + name)
    for name in ('sourceConfigSha256', 'manifestSha256'):
        sources.media_inputs.digest_value(approval[name])
    sources.release_sources.object_id(approval['commit'])
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', approval['artifactDigest']):
        raise ValueError('Windows approval requires the exact artifact SHA256 digest')
    if tag != 'v1.0.0-windows.' + approval['runId'] or commit != approval['commit']:
        raise ValueError('Dedicated Windows tag or checkout differs from the approved candidate')
    return approval


def approval_digest(approval):
    return hashlib.sha256(json.dumps(approval, sort_keys=True).encode()).hexdigest()


def github_json(route):
    """Use the read-only workflow token only on GitHub's fixed API origin."""
    token = os.environ.get('GH_TOKEN')
    if not token:
        raise ValueError('GH_TOKEN is required to read the approved candidate')
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + route, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise ValueError('GitHub candidate metadata exceeds its limit')
    return json.loads(content)


def verify_remote(approval, run, artifact):
    """Reject other workflows, commits, attempts, repositories and artifacts."""
    if (run.get('status') != 'completed' or run.get('conclusion') != 'success' or
            str(run.get('id')) != approval['runId'] or str(run.get('run_attempt')) != approval['runAttempt'] or
            run.get('head_sha') != approval['commit'] or
            run.get('repository', {}).get('full_name') != REPOSITORY or
            run.get('head_repository', {}).get('full_name') != REPOSITORY or
            run.get('path', '').split('@')[0] != '.github/workflows/desktop-windows-release.yml'):
        raise ValueError('Approved Windows candidate workflow run identity or success mismatch')
    if (str(artifact.get('id')) != approval['artifactId'] or artifact.get('expired') is not False or
            artifact.get('name') != 'windows-desktop-candidate-' + approval['runId'] + '-' + approval['runAttempt'] or
            artifact.get('digest') != approval['artifactDigest'] or
            str(artifact.get('workflow_run', {}).get('id')) != approval['runId'] or
            artifact.get('workflow_run', {}).get('head_sha') != approval['commit'] or
            type(artifact.get('size_in_bytes')) is not int or artifact['size_in_bytes'] <= 0):
        raise ValueError('Approved Windows candidate artifact identity mismatch')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep the GitHub bearer token off the artifact storage redirect."""
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def download_artifact(path, approval, artifact):
    """Download exactly the approved ZIP and verify its complete bytes before extraction."""
    request = urllib.request.Request(
        'https://api.github.com/repos/' + REPOSITORY + '/actions/artifacts/' + approval['artifactId'] + '/zip',
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(request, timeout=60)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise
        location = error.headers.get('Location', '')
        error.close()
        parsed = urllib.parse.urlsplit(location)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('Artifact download requires an HTTPS storage redirect')
        # A new request deliberately has no GitHub Authorization header.
        response = urllib.request.urlopen(location, timeout=120)
    with response, path.open('xb') as output:
        remaining = artifact['size_in_bytes']
        digest = hashlib.sha256()
        while chunk := response.read(min(1024 * 1024, remaining + 1)):
            remaining -= len(chunk)
            if remaining < 0:
                raise ValueError('Candidate ZIP exceeds the approved artifact byte count')
            digest.update(chunk)
            output.write(chunk)
    if remaining != 0 or 'sha256:' + digest.hexdigest() != approval['artifactDigest']:
        raise ValueError('Candidate ZIP byte count or approved SHA256 mismatch')


def records(rows, names):
    """Require one positive size and full hash for every expected filename."""
    if not isinstance(rows, list) or len(rows) != len(names):
        raise ValueError('Candidate evidence inventory is incomplete')
    result = {}
    for row in rows:
        if row['name'] not in names or row['name'] in result or type(row['size']) is not int or row['size'] <= 0:
            raise ValueError('Candidate evidence inventory has an unexpected or duplicate entry')
        sources.media_inputs.digest_value(row['sha256'])
        result[row['name']] = row
    return result


def safe_extract(archive, destination):
    """Extract only the fifteen expected ordinary files, with no ZIP path or link escapes."""
    expected = {'release/' + name for name in RELEASE_FILES} | {'evidence/' + name for name in VERIFICATION_FILES} | {'evidence/CANDIDATE.json'}
    directories = {'release/', 'evidence/', 'evidence/installed/', 'evidence/media/'}
    with zipfile.ZipFile(archive) as zipped:
        entries = {}
        seen = set()
        for entry in zipped.infolist():
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if entry.filename in seen or entry.flag_bits & 1 or mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Unsafe duplicate, encrypted or nonordinary ZIP entry')
            seen.add(entry.filename)
            if entry.is_dir():
                if entry.filename not in directories or mode == stat.S_IFREG:
                    raise ValueError('Unexpected ZIP directory')
            elif entry.filename not in expected or mode == stat.S_IFDIR:
                raise ValueError('Unexpected or escaping ZIP file')
            else:
                entries[entry.filename] = entry
        if set(entries) != expected or entries['evidence/CANDIDATE.json'].file_size > 1024 * 1024:
            raise ValueError('Candidate ZIP has missing files or oversized metadata')
        candidate = json.loads(zipped.read(entries['evidence/CANDIDATE.json']))
        bound = {'release/' + name: row for name, row in records(candidate['releaseFiles'], RELEASE_FILES).items()}
        bound.update({'evidence/' + name: row for name, row in records(candidate['verificationFiles'], VERIFICATION_FILES).items()})
        for name, row in bound.items():
            if entries[name].file_size != row['size']:
                raise ValueError('Candidate ZIP entry differs from its bound size: ' + name)
        destination.mkdir(parents=True, exist_ok=False)
        for name, entry in entries.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with zipped.open(entry) as incoming, path.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            if name in bound and sources.media_inputs.sha256(path) != bound[name]['sha256']:
                raise ValueError('Candidate ZIP entry differs from its bound SHA256: ' + name)


def verify_candidate(directory, approval, source_bytes, tree):
    """Bind source, installer, installed-main and media evidence before any TOS call."""
    release = directory / 'release'
    evidence = directory / 'evidence'
    candidate = read_json(evidence / 'CANDIDATE.json')
    if (candidate.get('formatVersion') != 1 or candidate.get('publish') is not False or
            candidate.get('desktopVersion') != '1.0.0' or candidate.get('platform') != 'win32-x64' or
            candidate.get('harnessCommit') != approval['commit'] or candidate.get('harnessTree') != tree or
            str(candidate.get('runId')) != approval['runId'] or str(candidate.get('runAttempt')) != approval['runAttempt']):
        raise ValueError('Candidate report differs from the approved source and run')
    for base, rows, names in ((release, candidate['releaseFiles'], RELEASE_FILES), (evidence, candidate['verificationFiles'], VERIFICATION_FILES)):
        for name, row in records(rows, names).items():
            actual = sources.file_record(base / name)
            if actual['sha256'] != row['sha256'] or actual['size'] != row['size']:
                raise ValueError('Candidate file differs from its evidence: ' + name)
    if sources.media_inputs.sha256(release / 'SHA256SUMS-Windows.txt') != approval['manifestSha256']:
        raise ValueError('Windows release manifest differs from the independent approval')
    publisher.prepare(release, '1.0.0', PUBLIC_URL, windows_only=True)
    index = read_json(release / 'DESKTOP-SOURCES-Windows.json')
    source = json.loads(source_bytes)
    if (hashlib.sha256(source_bytes).hexdigest() != approval['sourceConfigSha256'] or
            index.get('cutSource') != source or index.get('distributionId') != approval['sourceConfigSha256'] or
            index.get('harnessCommit') != approval['commit'] or index.get('harnessTree') != tree or
            index.get('baselineCommit') != BASELINE or index.get('desktopVersion') != '1.0.0' or
            index.get('platform') != 'win32-x64' or index.get('sourceConfigPath') != sources.SOURCE_PATH or
            str(index.get('workflowRunId')) != approval['runId'] or source['nativeMedia']['target'] != 'win32-x64'):
        raise ValueError('Windows source index differs from the approved committed configuration')
    artifacts, signing = sources.verify_release(release, '1.0.0', evidence / 'installed/RESULT.json')
    if index.get('releaseArtifacts') != artifacts or index.get('signing') != signing or candidate.get('signing') != signing:
        raise ValueError('Source index installer hashes or unsigned smoke identity mismatch')
    for row in records(index['files'], {'Mantur-Agent-Windows-source-1.0.0.tar.gz', sources.MEDIA_ARCHIVE}).values():
        actual = sources.file_record(release / row['name'])
        if actual['size'] != row['size'] or actual['sha256'] != row['sha256']:
            raise ValueError('Windows source archive does not match its index')
    for field, name in (('candidate', 'Mantur-Media-Windows-x64.tar.gz'), ('correspondingSource', sources.MEDIA_ARCHIVE)):
        pin = source['nativeMedia'][field]
        if pin['url'] != PUBLIC_URL + '/releases/1.0.0/' + name:
            raise ValueError('Windows media source pin does not name the published versioned object')
        sources.media_inputs.verify_archive_file(release / name, pin)
    media_inputs = read_json(evidence / 'MEDIA-INPUTS.json')
    media_run = read_json(evidence / 'MEDIA-RUN.json')
    if (media_inputs.get('sourceConfigSha256') != approval['sourceConfigSha256'] or
            media_inputs.get('candidate') != source['nativeMedia']['candidate'] or
            media_inputs.get('correspondingSource', {}).get('sha256') != source['nativeMedia']['correspondingSource']['sha256'] or
            media_inputs['correspondingSource']['recipeCommit'] != candidate['mediaCi']['headSha'] or
            media_run.get('pins') != candidate['mediaCi'] or media_run.get('run', {}).get('conclusion') != 'success' or
            media_run['run'].get('head_sha') != candidate['mediaCi']['headSha']):
        raise ValueError('Native media run and source archive binding mismatch')
    installed = read_json(evidence / 'installed/RESULT.json')
    identities = read_json(evidence / 'UNSIGNED-IDENTITIES.json')
    by_path = {row['path']: row for row in identities}
    if len(identities) != 2 or set(by_path) != {'apps/desktop/dist/' + sources.INSTALLER, 'apps/desktop/dist/win-unpacked/ManTur Agent.exe'}:
        raise ValueError('Expected both installer and unpacked unsigned identities')
    for name, identity in (('apps/desktop/dist/' + sources.INSTALLER, installed['installer']),
                           ('apps/desktop/dist/win-unpacked/ManTur Agent.exe', installed['installedApplication'])):
        row = by_path[name]
        if row['sha256'] != identity['sha256'] or row['bytes'] != identity['bytes'] or row['authenticodeStatus'] != 'NotSigned':
            raise ValueError('Installed application does not match the unsigned packaged executable')
    if (installed.get('normalMainExit') is not True or installed.get('cleanupComplete') is not True or
            installed.get('forcedCleanupUsed') is not False or installed.get('mainExitCode') != 0 or
            installed.get('closeMainWindowRequested') is not True or installed.get('failures') != [] or
            installed.get('processesAfterNormalExit') != [] or installed['installation'].get('exitCode') != 0 or
            installed['installation'].get('timedOut') is not False or
            installed['launch'].get('electronRunAsNode') is not False or installed['launch'].get('sandboxDisabled') is not False or
            installed['window'].get('ownerPid') != installed['launch']['pid'] or
            installed['http'].get('exchangeStatus') != 303 or installed['http'].get('pageStatus') != 200 or
            installed['http'].get('bootPayload') is not True):
        raise ValueError('Installed Windows main, Host or normal-exit evidence is incomplete')
    media = read_json(evidence / 'media/RESULT.json')
    if media.get('ok') is not True or media.get('sourceSha256') != approval['sourceConfigSha256'] or media.get('exportStatus') != 200:
        raise ValueError('Packaged Windows media export did not pass for this source configuration')
    commands = {row['label']: row for row in media.get('commands', [])}
    for label in ('synthetic-input', 'output-probe', 'output-decode', 'compositor-probe'):
        if label not in commands or commands[label].get('code') != 0 or commands[label].get('signal') is not None:
            raise ValueError('Packaged Windows media command did not pass: ' + label)
    if commands['compositor-probe']['executable'].replace('\\', '/') != media['app'].replace('\\', '/') + '/ManTur Agent.exe':
        raise ValueError('Media compositor probe is not bound to the packaged Electron executable')
    return {'approvalSha256': approval_digest(approval), 'commit': approval['commit'],
            'runId': approval['runId'], 'runAttempt': approval['runAttempt'], 'artifactId': approval['artifactId'],
            'artifactDigest': approval['artifactDigest'], 'manifestSha256': approval['manifestSha256'],
            'sourceConfigSha256': approval['sourceConfigSha256'], 'releaseFiles': candidate['releaseFiles']}


def promote(directory, approval, source_bytes, tree, check_only):
    """Recheck local bytes and require a matching completed preflight before publication."""
    verified = verify_candidate(directory / 'candidate', approval, source_bytes, tree)
    receipt = read_json(directory / 'REMOTE.json')
    verify_remote(approval, receipt['run'], receipt['artifact'])
    if not check_only and read_json(directory / 'PREFLIGHT.json') != {'status': 'PREFLIGHT_PASS', **verified}:
        raise ValueError('Formal Windows promotion requires a matching successful preflight')
    publisher.publish(directory / 'candidate/release', '1.0.0', check_only=check_only, windows_only=True)
    result = {'status': 'PREFLIGHT_PASS' if check_only else 'PUBLISHED', **verified}
    path = directory / ('PREFLIGHT.json' if check_only else 'PUBLISHED.json')
    path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--check-only', action='store_true')
    mode.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    head = sources.git(root, 'rev-parse', 'HEAD').decode().strip()
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or os.environ.get('GITHUB_REF_TYPE') != 'tag' or os.environ.get('GITHUB_SHA') != head:
        raise ValueError('Windows promotion requires the exact repository tag checkout')
    approval = parse_approval(os.environ.get('MANTUR_WINDOWS_RELEASE_APPROVAL', ''), os.environ.get('GITHUB_REF_NAME', ''), head)
    tree = sources.git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    source_bytes = sources.git(root, 'show', head + ':' + sources.SOURCE_PATH)
    directory = args.directory.resolve()
    if args.prepare:
        directory.mkdir(parents=True, exist_ok=False)
        run = github_json('/actions/runs/' + approval['runId'] + '/attempts/' + approval['runAttempt'])
        artifact = github_json('/actions/artifacts/' + approval['artifactId'])
        verify_remote(approval, run, artifact)
        archive = directory / 'candidate.zip'
        download_artifact(archive, approval, artifact)
        safe_extract(archive, directory / 'candidate')
        verified = verify_candidate(directory / 'candidate', approval, source_bytes, tree)
        (directory / 'REMOTE.json').write_text(json.dumps({'run': run, 'artifact': artifact}, indent=2) + '\n', encoding='utf-8')
        (directory / 'VERIFIED.json').write_text(json.dumps({'status': 'VERIFIED', **verified}, indent=2) + '\n', encoding='utf-8')
        print('Approved Windows artifact downloaded and verified; no publication performed')
    else:
        result = promote(directory, approval, source_bytes, tree, args.check_only)
        print(result['status'])


if __name__ == '__main__':
    main()
