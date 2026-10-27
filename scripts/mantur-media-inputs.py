"""Fetch and verify the media archives pinned by the desktop source manifest."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.parse
import urllib.request


def sha256(path):
    """Hash a file without retaining its complete contents in memory."""
    with path.open('rb') as stream:
        return stream_sha256(stream)


def stream_sha256(stream):
    """Hash a binary stream from its current position."""
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def relative_path(value):
    """Require one normalized relative POSIX path without parent traversal."""
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Invalid media input path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Unsafe media input path')
    return value


def digest_value(value):
    """Require a complete lowercase SHA256 digest."""
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError('Media input requires a SHA256 digest')
    return value


def pinned_file(root, record):
    """Read a repository-owned input only when its path and digest match."""
    path = root / relative_path(record['file'])
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink() or not path.is_file():
        raise ValueError('Media input file escaped the repository or is missing')
    if sha256(path) != digest_value(record['sha256']):
        raise ValueError('Media input file SHA256 mismatch: ' + record['file'])
    return path


def media_config(root, source=None):
    """Validate the media source identity before downloading or using its archives."""
    if source is None:
        source = json.loads((root / 'apps/desktop/mantur-cut/source.json').read_text())
    if source.get('formatVersion') != 3 or source.get('nativeMedia', {}).get('target') != 'darwin-arm64':
        raise ValueError('Media inputs require a version 3 darwin-arm64 source manifest')
    media = source['nativeMedia']
    for name in ('inventory', 'sourceLock'):
        pinned_file(root, media[name])
    recipes = media['recipes']
    if not recipes or len({row['file'] for row in recipes}) != len(recipes):
        raise ValueError('Media input recipes must be nonempty and unique')
    for record in recipes:
        pinned_file(root, record)
    for name in ('candidate', 'correspondingSource'):
        record = media[name]
        url = urllib.parse.urlsplit(record['url'])
        if url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment:
            raise ValueError('Media archive URL must be an absolute HTTPS URL')
        relative_path(urllib.parse.unquote(url.path.rsplit('/', 1)[-1]))
        if '/' in relative_path(record['prefix']):
            raise ValueError('Media archive prefix must be one directory')
        digest_value(record['sha256'])
        if type(record['bytes']) is not int or record['bytes'] <= 0:
            raise ValueError('Media archive requires a positive byte count')
    return media


def verify_archive_file(path, record):
    """Reject missing, substituted or truncated media archives."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size != record['bytes']:
        raise ValueError('Media archive byte count mismatch: ' + path.name)
    if sha256(path) != record['sha256']:
        raise ValueError('Media archive SHA256 mismatch: ' + path.name)


def obtain_archive(record, cache):
    """Use an explicit local input directory or fetch one verified HTTPS archive."""
    filename = urllib.parse.unquote(urllib.parse.urlsplit(record['url']).path.rsplit('/', 1)[-1])
    local = os.environ.get('MANTUR_MEDIA_INPUT_DIR')
    if local is not None:
        path = Path(local) / filename
        verify_archive_file(path, record)
        return path
    cache.mkdir(parents=True, exist_ok=True)
    destination = cache / (record['sha256'] + '-' + filename)
    if destination.exists():
        verify_archive_file(destination, record)
        return destination
    with tempfile.NamedTemporaryFile(dir=cache, prefix='media-download-', delete=False) as output:
        temporary = Path(output.name)
        try:
            with urllib.request.urlopen(record['url'], timeout=120) as response:
                if urllib.parse.urlsplit(response.url).scheme != 'https':
                    raise ValueError('Media archive download redirected away from HTTPS')
                remaining = record['bytes']
                while chunk := response.read(min(1024 * 1024, remaining + 1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError('Media archive exceeds its pinned byte count')
                    output.write(chunk)
            output.flush()
            verify_archive_file(temporary, record)
            with destination.open('xb') as final:
                with temporary.open('rb') as incoming:
                    shutil.copyfileobj(incoming, final)
        finally:
            temporary.unlink()
    return destination


def inspect_archive(path, prefix, inventory=None, destination=None):
    """Verify every ordinary archive member and optionally extract to a private directory."""
    hashes = {}
    sizes = {}
    metadata = {}
    seen = set()
    with tarfile.open(path, 'r|gz') as archive:
        for member in archive:
            name = member.name.rstrip('/')
            relative_path(name)
            if name in seen:
                raise ValueError('Duplicate media archive member')
            seen.add(name)
            if name == prefix and member.isdir():
                continue
            if not name.startswith(prefix + '/'):
                raise ValueError('Media archive member escaped its prefix')
            relative = relative_path(name[len(prefix) + 1:])
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('Media archive must contain ordinary files and directories')
            incoming = archive.extractfile(member)
            if destination is not None:
                output = destination / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                with output.open('xb') as stream:
                    shutil.copyfileobj(incoming, stream)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
                hashes[relative] = sha256(output)
            elif relative in ('FILES-SHA256.json', 'SOURCE-INDEX.json', 'CANDIDATE-SHA256.json'):
                if member.size > 1024 * 1024:
                    raise ValueError('Media inventory is unexpectedly large')
                data = incoming.read()
                hashes[relative] = hashlib.sha256(data).hexdigest()
                metadata[relative] = json.loads(data)
            else:
                hashes[relative] = stream_sha256(incoming)
            sizes[relative] = member.size
    if inventory is None:
        inventory = metadata.get('FILES-SHA256.json')
        actual = {key: value for key, value in hashes.items() if key != 'FILES-SHA256.json'}
    else:
        actual = hashes
    if not isinstance(inventory, dict) or not inventory or actual != inventory:
        raise ValueError('Media archive file inventory mismatch')
    return hashes, sizes, metadata


def prepare_candidate(root, cache, source=None):
    """Materialize the complete pinned media directory without compiling its inputs."""
    media = media_config(root, source)
    record = media['candidate']
    archive = obtain_archive(record, cache)
    inventory = json.loads(pinned_file(root, media['inventory']).read_text())
    if inventory.get('SOURCE-LOCK.json') != media['sourceLock']['sha256']:
        raise ValueError('Media candidate source lock mismatch')
    parent = cache / record['sha256']
    parent.mkdir(parents=True, exist_ok=True)
    destination = parent / 'candidate'
    if destination.is_symlink():
        raise ValueError('Cached media candidate contains a symlink')
    if destination.exists():
        actual = {}
        for path in destination.rglob('*'):
            if path.is_symlink():
                raise ValueError('Cached media candidate contains a symlink')
            if path.is_file():
                actual[path.relative_to(destination).as_posix()] = sha256(path)
        if actual != inventory:
            raise ValueError('Cached media candidate inventory mismatch')
        return destination.resolve()
    with tempfile.TemporaryDirectory(prefix='media-extract-', dir=parent) as temporary:
        staging = Path(temporary) / 'candidate'
        staging.mkdir()
        inspect_archive(archive, record['prefix'], inventory, staging)
        if sha256(staging / 'SOURCE-LOCK.json') != media['sourceLock']['sha256']:
            raise ValueError('Media candidate source lock mismatch')
        staging.rename(destination)
    return destination.resolve()


def corresponding_source(root, cache, source):
    """Verify complete corresponding sources and bind their recipe to this checkout."""
    media = media_config(root, source)
    record = media['correspondingSource']
    archive = obtain_archive(record, cache)
    hashes, sizes, metadata = inspect_archive(archive, record['prefix'])
    if hashes.get('CANDIDATE-SHA256.json') != media['inventory']['sha256']:
        raise ValueError('Media corresponding source candidate inventory mismatch')
    for item in [media['sourceLock'], *media['recipes']]:
        if hashes.get('recipe/' + Path(item['file']).name) != item['sha256']:
            raise ValueError('Media corresponding source recipe mismatch')
    index = metadata.get('SOURCE-INDEX.json', {})
    inputs = index.get('archives', [])
    if not inputs or len({row['file'] for row in inputs}) != len(inputs):
        raise ValueError('Media corresponding source archive index is missing or duplicated')
    for item in inputs:
        name = relative_path(item['file'])
        if hashes.get(name) != item['sha256'] or sizes.get(name) != item['bytes']:
            raise ValueError('Media corresponding source archive index mismatch')
    return archive, {'name': urllib.parse.urlsplit(record['url']).path.rsplit('/', 1)[-1],
                     'size': record['bytes'], 'sha256': record['sha256'],
                     'sourceArchives': len(inputs), 'fileCount': len(hashes),
                     'recipeCommit': index['recipeCommit'], 'candidateSha256': media['candidate']['sha256']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-candidate', action='store_true', required=True)
    parser.add_argument('--cache-dir', type=Path, required=True)
    arguments = parser.parse_args()
    print(prepare_candidate(Path(__file__).resolve().parent.parent, arguments.cache_dir.resolve()))
