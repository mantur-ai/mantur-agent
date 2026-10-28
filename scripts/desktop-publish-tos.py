"""Publish verified desktop release files before advancing the public TOS channel."""
import argparse
import base64
import hashlib
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import yaml


def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.digest()


def release_channel(version):
    """Accept stable or numbered RC versions and return the isolated channel."""
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?', version):
        raise ValueError('A stable or numbered rc release version is required')
    return 'rc' if '-rc.' in version else 'stable'


def version_key(version):
    """Order admitted versions numerically, with stable after its RCs."""
    release_channel(version)
    core, _, rc = version.partition('-rc.')
    return (*map(int, core.split('.')), int(rc) if rc else float('inf'))


def prepare(directory, version, public_url, require_windows=False, windows_only=False):
    """Reject incomplete releases and unsafe names before any remote mutation."""
    channel = release_channel(version)
    metadata = 'rc' if channel == 'rc' else 'latest'
    windows_installer = 'Mantur-Agent-Windows-x64.exe'
    windows_required = {windows_installer, windows_installer + '.blockmap', metadata + '.yml'}
    windows_names = windows_required | {
        'DESKTOP-SOURCES-Windows.json', 'DESKTOP-SOURCE-BUILD-Windows.txt',
        'Mantur-Agent-Windows-source-' + version + '.tar.gz',
        'Mantur-Cut-Windows-patched-source.tar.gz',
        'Mantur-Media-Windows-corresponding-source.tar.gz',
        'Mantur-Media-Windows-x64.tar.gz',
        'OpenChatCut-Windows-upstream-source.tar.gz', 'whisper-cpp-Windows-source.tar.gz',
    }
    files = {}
    manifests = ('SHA256SUMS-Windows.txt',) if windows_only else ('SHA256SUMS', 'SHA256SUMS-Windows.txt')
    for manifest in manifests:
        path = directory / manifest
        if windows_only and path.is_symlink():
            raise ValueError('Windows release manifest must not be a symlink')
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            expected, name = line.split('  ', 1)
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
                raise ValueError('Unsafe release filename')
            if windows_only and name not in windows_names:
                raise ValueError('Unexpected Windows release filename: ' + name)
            if windows_only and name in files:
                raise ValueError('Duplicate Windows release filename: ' + name)
            artifact = directory / name
            if artifact.is_symlink() or digest(artifact, 'sha256').hex() != expected:
                raise ValueError('Release SHA256 mismatch: ' + name)
            files[name] = artifact
        files[manifest] = path
    if any(name in files for name in (('latest-mac.yml', 'latest.yml') if channel == 'rc' else ('rc-mac.yml', 'rc.yml'))):
        raise ValueError('Update metadata belongs to a different release channel')
    if (require_windows or windows_only) and not windows_required.issubset(files):
        raise ValueError('Required verified Windows release artifacts are missing')
    if windows_only:
        if 'DESKTOP-SOURCES-Windows.json' not in files:
            raise ValueError('Verified Windows source index is required')
        unlisted = sorted(path.name for path in directory.iterdir() if path.name not in files)
        if unlisted:
            raise ValueError('Unlisted Windows release files: ' + ', '.join(unlisted))
    elif metadata + '-mac.yml' not in files:
        raise ValueError('Verified Mac update metadata is required')
    channels = {}
    for name in (metadata + '-mac.yml', metadata + '.yml'):
        if name not in files:
            continue
        info = yaml.safe_load(files[name].read_text())
        if info['version'] != version:
            raise ValueError('Update version mismatch')
        if windows_only and (info.get('path') != windows_installer
                             or not isinstance(info.get('files'), list)
                             or len(info['files']) != 1
                             or not isinstance(info['files'][0], dict)
                             or info['files'][0].get('url') != windows_installer):
            raise ValueError('Windows update metadata must reference only the x64 installer')
        for item in info['files']:
            artifact = files[item['url']]
            if artifact.stat().st_size != item['size'] or base64.b64encode(digest(artifact, 'sha512')).decode() != item['sha512']:
                raise ValueError('Update artifact mismatch')
            if windows_only and 'sha512' in info and info['sha512'] != item['sha512']:
                raise ValueError('Windows update SHA512 fields disagree')
            item['url'] = public_url + '/releases/' + version + '/' + artifact.name
        if info.get('path'):
            info['path'] = public_url + '/releases/' + version + '/' + files[info['path']].name
        channels[name] = yaml.safe_dump(info, sort_keys=False).encode()
    return files, channels


def publish_installers(client, bucket, prefix, base, files, version, check_only=False):
    """Advance no-cache manual downloads without changing immutable update artifacts."""
    channel = release_channel(version)
    installers = [name for name in ('Mantur-Agent-macOS-arm64.dmg', 'Mantur-Agent-Windows-x64.exe') if name in files]
    for name in installers:
        try:
            current = client.head_object(Bucket=bucket, Key=prefix + '/' + channel + '/' + name)
        except ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
                raise
        else:
            previous = current['Metadata']['version']
            if release_channel(previous) != channel or version_key(previous) > version_key(version):
                raise ValueError('Refusing to downgrade a manual installer')
    if check_only:
        return
    for name in installers:
        sha = digest(files[name], 'sha256').hex()
        client.copy_object(Bucket=bucket, Key=prefix + '/' + channel + '/' + name,
                           CopySource={'Bucket': bucket, 'Key': prefix + '/releases/' + version + '/' + name},
                           ACL='public-read', MetadataDirective='REPLACE',
                           Metadata={'version': version, 'sha256': sha}, ContentType='application/octet-stream',
                           ContentDisposition='attachment; filename="' + name + '"',
                           CacheControl='no-cache, max-age=0, must-revalidate')
        with urlopen(Request(base + '/' + channel + '/' + name, headers={'Range': 'bytes=0-0'}), timeout=60) as response:
            if (response.status != 206 or response.headers.get('Content-Range') != 'bytes 0-0/' + str(files[name].stat().st_size)
                    or response.headers.get('x-tos-meta-sha256') != sha):
                raise ValueError('Public manual installer did not refresh: ' + name)
        print('Published manual installer:', name, flush=True)


def publish(directory, version, check_only=False, require_windows=False, windows_only=False):
    channel = release_channel(version)
    for name in ('TOS_PUBLIC_URL', 'TOS_BUCKET', 'TOS_PREFIX', 'TOS_ENDPOINT', 'TOS_REGION', 'TOS_ACCESS_KEY', 'TOS_SECRET_KEY'):
        if not os.environ.get(name):
            raise ValueError('Required publisher configuration is missing: ' + name)
    base = os.environ['TOS_PUBLIC_URL'].rstrip('/')
    if not base.startswith('https://'):
        raise ValueError('Public HTTPS URL required')
    files, channels = prepare(directory, version, base, require_windows, windows_only)
    bucket = os.environ['TOS_BUCKET']
    prefix = os.environ['TOS_PREFIX'].strip('/')
    client = boto3.client('s3', endpoint_url=os.environ['TOS_ENDPOINT'], region_name=os.environ['TOS_REGION'],
                          aws_access_key_id=os.environ['TOS_ACCESS_KEY'], aws_secret_access_key=os.environ['TOS_SECRET_KEY'],
                          config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'},
                                        request_checksum_calculation='when_required', response_checksum_validation='when_required'))
    for name in channels:
        try:
            current = client.get_object(Bucket=bucket, Key=prefix + '/' + channel + '/' + name)
        except ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
                raise
        else:
            with current['Body'] as stream:
                current_version = yaml.safe_load(stream.read())['version']
            if release_channel(current_version) != channel or version_key(current_version) > version_key(version):
                raise ValueError('Refusing to downgrade the public update channel')
    publish_installers(client, bucket, prefix, base, files, version, check_only=True)
    missing = set()
    for name, path in files.items():
        key = prefix + '/releases/' + version + '/' + name
        sha = digest(path, 'sha256').hex()
        try:
            head = client.head_object(Bucket=bucket, Key=key)
        except ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
                raise
            head = None
        if head is not None:
            if head.get('Metadata', {}).get('sha256') != sha or head['ContentLength'] != path.stat().st_size:
                raise ValueError('Refusing to replace existing release: ' + key)
        else:
            missing.add(name)
    if check_only:
        print('Release preflight passed; no remote objects written', flush=True)
        return
    for name, path in files.items():
        key = prefix + '/releases/' + version + '/' + name
        sha = digest(path, 'sha256').hex()
        if name in missing:
            client.upload_file(str(path), bucket, key, ExtraArgs={'ACL': 'public-read', 'Metadata': {'sha256': sha},
                               'ContentType': 'application/octet-stream', 'CacheControl': 'public, max-age=31536000, immutable'})
        with urlopen(Request(base + '/releases/' + version + '/' + name, headers={'Range': 'bytes=0-0'}), timeout=60) as response:
            if response.status != 206 or response.headers.get('Content-Range') != 'bytes 0-0/' + str(path.stat().st_size):
                raise ValueError('Public range download failed: ' + name)
        print('Verified public artifact:', name, flush=True)
    publish_installers(client, bucket, prefix, base, files, version)
    for name, body in channels.items():
        client.put_object(Bucket=bucket, Key=prefix + '/' + channel + '/' + name, Body=body, ACL='public-read',
                          ContentType='text/yaml', CacheControl='no-cache, max-age=0, must-revalidate')
        with urlopen(base + '/' + channel + '/' + name, timeout=60) as response:
            if response.read() != body:
                raise ValueError('Public update channel did not refresh')
        print('Published update channel:', name, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('version')
    parser.add_argument('--check', action='store_true', help='Validate files, configuration and remote state without writing')
    parser.add_argument('--require-windows', action='store_true', help='Require verified Windows installer, blockmap and update metadata')
    parser.add_argument('--windows-only', action='store_true', help='Publish only the Windows manifest, installer, update metadata and separate source files')
    args = parser.parse_args()
    publish(args.directory, args.version, args.check, args.require_windows, args.windows_only)
