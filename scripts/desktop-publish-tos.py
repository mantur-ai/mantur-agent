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


def prepare(directory, version, public_url):
    """Reject incomplete releases and unsafe names before any remote mutation."""
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('A stable release version is required')
    files = {}
    for manifest in ('SHA256SUMS', 'SHA256SUMS-Windows.txt'):
        path = directory / manifest
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            expected, name = line.split('  ', 1)
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
                raise ValueError('Unsafe release filename')
            artifact = directory / name
            if artifact.is_symlink() or digest(artifact, 'sha256').hex() != expected:
                raise ValueError('Release SHA256 mismatch: ' + name)
            files[name] = artifact
        files[manifest] = path
    if 'latest-mac.yml' not in files:
        raise ValueError('Verified Mac update metadata is required')
    channels = {}
    for name in ('latest-mac.yml', 'latest.yml'):
        if name not in files:
            continue
        info = yaml.safe_load(files[name].read_text())
        if info['version'] != version:
            raise ValueError('Update version mismatch')
        for item in info['files']:
            artifact = files[item['url']]
            if artifact.stat().st_size != item['size'] or base64.b64encode(digest(artifact, 'sha512')).decode() != item['sha512']:
                raise ValueError('Update artifact mismatch')
            item['url'] = public_url + '/releases/' + version + '/' + artifact.name
        if info.get('path'):
            info['path'] = public_url + '/releases/' + version + '/' + files[info['path']].name
        channels[name] = yaml.safe_dump(info, sort_keys=False).encode()
    return files, channels


def publish(directory, version):
    base = os.environ['TOS_PUBLIC_URL'].rstrip('/')
    if not base.startswith('https://'):
        raise ValueError('Public HTTPS URL required')
    files, channels = prepare(directory, version, base)
    bucket = os.environ['TOS_BUCKET']
    prefix = os.environ['TOS_PREFIX'].strip('/')
    client = boto3.client('s3', endpoint_url=os.environ['TOS_ENDPOINT'], region_name=os.environ['TOS_REGION'],
                          aws_access_key_id=os.environ['TOS_ACCESS_KEY'], aws_secret_access_key=os.environ['TOS_SECRET_KEY'],
                          config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'},
                                        request_checksum_calculation='when_required', response_checksum_validation='when_required'))
    for name in channels:
        try:
            current = client.get_object(Bucket=bucket, Key=prefix + '/stable/' + name)
        except ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
                raise
        else:
            with current['Body'] as stream:
                current_version = yaml.safe_load(stream.read())['version']
            if tuple(map(int, current_version.split('.'))) > tuple(map(int, version.split('.'))):
                raise ValueError('Refusing to downgrade the public update channel')
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
            client.upload_file(str(path), bucket, key, ExtraArgs={'ACL': 'public-read', 'Metadata': {'sha256': sha},
                               'ContentType': 'application/octet-stream', 'CacheControl': 'public, max-age=31536000, immutable'})
        with urlopen(Request(base + '/releases/' + version + '/' + name, headers={'Range': 'bytes=0-0'}), timeout=60) as response:
            if response.status != 206 or response.headers.get('Content-Range') != 'bytes 0-0/' + str(path.stat().st_size):
                raise ValueError('Public range download failed: ' + name)
        print('Verified public artifact:', name, flush=True)
    for name, body in channels.items():
        client.put_object(Bucket=bucket, Key=prefix + '/stable/' + name, Body=body, ACL='public-read',
                          ContentType='text/yaml', CacheControl='no-cache, max-age=0, must-revalidate')
        with urlopen(base + '/stable/' + name, timeout=60) as response:
            if response.read() != body:
                raise ValueError('Public update channel did not refresh')
        print('Published update channel:', name, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('version')
    args = parser.parse_args()
    publish(args.directory, args.version)
