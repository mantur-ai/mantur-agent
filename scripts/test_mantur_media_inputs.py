"""Exercise pinned media archive acquisition and complete inventory rejection."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('media', Path(__file__).with_name('mantur-media-inputs.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


def encoded(value):
    return (json.dumps(value, sort_keys=True) + '\n').encode()


def write_archive(directory, name, prefix, files, extra=None):
    path = directory / name
    with tarfile.open(path, 'w:gz') as archive:
        for relative, content in files.items():
            member = tarfile.TarInfo(prefix + '/' + relative)
            member.size = len(content)
            member.mode = 0o755 if relative.startswith('bin/') else 0o644
            archive.addfile(member, io.BytesIO(content))
        if extra is not None:
            archive.addfile(extra)
    return {'url': 'https://example.invalid/media-input/' + name, 'sha256': media.sha256(path),
            'bytes': path.stat().st_size, 'prefix': prefix}


def install_media_fixture(root, inputs):
    """Create small self-contained media archives and repository pins for tests."""
    recipes = {'scripts/mantur-media-build.py': b'print("build")\n',
               'scripts/mantur-media-build.lock.json': b'{"source":"fixed"}\n'}
    records = []
    for relative, content in recipes.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        records.append({'file': relative, 'sha256': hashlib.sha256(content).hexdigest()})
    candidate = {'bin/ffmpeg': b'fixed executable\n', 'lib/libavutil.58.dylib': b'fixed library\n',
                 'SOURCE-LOCK.json': recipes['scripts/mantur-media-build.lock.json']}
    inventory = encoded({name: hashlib.sha256(content).hexdigest() for name, content in candidate.items()})
    inventory_path = 'apps/desktop/mantur-cut/media-inventory.json'
    (root / inventory_path).parent.mkdir(parents=True, exist_ok=True)
    (root / inventory_path).write_bytes(inventory)
    source_archive = b'upstream complete fixture\n'
    source = {'recipe/' + Path(name).name: content for name, content in recipes.items()}
    source.update({'CANDIDATE-SHA256.json': inventory, 'archives/source.tar.gz': source_archive,
                   'SOURCE-INDEX.json': encoded({'recipeCommit': '1' * 40, 'archives': [
                       {'file': 'archives/source.tar.gz', 'sha256': hashlib.sha256(source_archive).hexdigest(),
                        'bytes': len(source_archive)}]})})
    source['FILES-SHA256.json'] = encoded({name: hashlib.sha256(content).hexdigest() for name, content in source.items()})
    return {'target': 'darwin-arm64', 'recipes': records,
            'sourceLock': records[1], 'inventory': {'file': inventory_path, 'sha256': hashlib.sha256(inventory).hexdigest()},
            'candidate': write_archive(inputs, 'candidate.tar.gz', 'candidate', candidate),
            'correspondingSource': write_archive(inputs, 'source.tar.gz', 'source', source)}, candidate, source


class MediaInputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='media-input-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'root'
        self.root.mkdir()
        self.inputs = Path(temporary.name) / 'inputs'
        self.inputs.mkdir()
        native, self.candidate, self.source_files = install_media_fixture(self.root, self.inputs)
        self.source = {'formatVersion': 3, 'nativeMedia': native}
        self.cache = Path(temporary.name) / 'cache'
        environment = patch.dict(os.environ, {'MANTUR_MEDIA_INPUT_DIR': str(self.inputs)})
        environment.start()
        self.addCleanup(environment.stop)

    def test_local_candidate_and_complete_source_inventory_are_verified(self):
        destination = media.prepare_candidate(self.root, self.cache, self.source)
        self.assertEqual((destination / 'bin/ffmpeg').read_bytes(), self.candidate['bin/ffmpeg'])
        self.assertTrue((destination / 'bin/ffmpeg').stat().st_mode & 0o111)
        self.assertEqual(media.prepare_candidate(self.root, self.cache, self.source), destination)
        archive, record = media.corresponding_source(self.root, self.cache, self.source)
        self.assertEqual(archive, self.inputs / 'source.tar.gz')
        self.assertEqual(record['sourceArchives'], 1)
        self.assertEqual(record['fileCount'], len(self.source_files))

    def test_missing_and_corrupt_local_archive_never_download_substitutes(self):
        archive = self.inputs / 'candidate.tar.gz'
        original = archive.read_bytes()
        with patch.object(media.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
            archive.unlink()
            with self.assertRaisesRegex(ValueError, 'byte count'):
                media.prepare_candidate(self.root, self.cache, self.source)
            archive.write_bytes(bytes([original[0] ^ 1]) + original[1:])
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                media.prepare_candidate(self.root, self.cache, self.source)
        self.assertFalse(self.cache.exists())

    def test_download_bytes_are_verified_and_cached_without_repeated_network(self):
        content = (self.inputs / 'candidate.tar.gz').read_bytes()
        response = io.BytesIO(content)
        response.url = self.source['nativeMedia']['candidate']['url']
        with patch.dict(os.environ, {}, clear=True), patch.object(media.urllib.request, 'urlopen', return_value=response) as fetch:
            first = media.obtain_archive(self.source['nativeMedia']['candidate'], self.cache)
            second = media.obtain_archive(self.source['nativeMedia']['candidate'], self.cache)
        self.assertEqual(first, second)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(first.read_bytes(), content)

    def test_oversized_download_cannot_be_promoted_to_the_cache(self):
        content = (self.inputs / 'candidate.tar.gz').read_bytes() + b'excess'
        response = io.BytesIO(content)
        response.url = self.source['nativeMedia']['candidate']['url']
        with patch.dict(os.environ, {}, clear=True), patch.object(media.urllib.request, 'urlopen', return_value=response):
            with self.assertRaisesRegex(ValueError, 'exceeds'):
                media.obtain_archive(self.source['nativeMedia']['candidate'], self.cache)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_recipe_and_lock_mismatch_are_rejected_before_materializing(self):
        for key in ('recipes', 'sourceLock'):
            record = self.source['nativeMedia'][key][0] if key == 'recipes' else self.source['nativeMedia'][key]
            path = self.root / record['file']
            original = path.read_bytes()
            path.write_bytes(original + b'changed')
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                media.prepare_candidate(self.root, self.cache, self.source)
            path.write_bytes(original)
        self.assertFalse(self.cache.exists())

    def test_cache_changes_and_symlinks_are_rejected(self):
        destination = media.prepare_candidate(self.root, self.cache, self.source)
        binary = destination / 'bin/ffmpeg'
        binary.write_bytes(b'modified')
        with self.assertRaisesRegex(ValueError, 'inventory mismatch'):
            media.prepare_candidate(self.root, self.cache, self.source)
        binary.unlink()
        binary.symlink_to(self.inputs / 'candidate.tar.gz')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            media.prepare_candidate(self.root, self.cache, self.source)

    def test_unlisted_missing_and_escaping_members_are_rejected(self):
        bad_members = [dict(self.candidate, unexpected=b'extra'), {'bin/ffmpeg': self.candidate['bin/ffmpeg']},
                       dict(self.candidate, **{'../escape': b'outside'})]
        for files in bad_members:
            self.source['nativeMedia']['candidate'] = write_archive(self.inputs, 'candidate.tar.gz', 'candidate', files)
            with self.subTest(files=list(files)), self.assertRaises(ValueError):
                media.prepare_candidate(self.root, self.cache, self.source)
        self.assertFalse((self.cache / 'escape').exists())

    def test_symlink_archive_members_are_rejected_before_extraction(self):
        link = tarfile.TarInfo('candidate/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '../outside'
        self.source['nativeMedia']['candidate'] = write_archive(
            self.inputs, 'candidate.tar.gz', 'candidate', self.candidate, link)
        with self.assertRaisesRegex(ValueError, 'ordinary files'):
            media.prepare_candidate(self.root, self.cache, self.source)

    def test_source_inventory_missing_archives_and_recipe_mismatch_are_rejected(self):
        for filename in ('archives/source.tar.gz', 'recipe/mantur-media-build.py'):
            files = dict(self.source_files)
            del files[filename]
            files['FILES-SHA256.json'] = encoded({name: hashlib.sha256(content).hexdigest()
                                                 for name, content in files.items() if name != 'FILES-SHA256.json'})
            self.source['nativeMedia']['correspondingSource'] = write_archive(self.inputs, 'source.tar.gz', 'source', files)
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, 'mismatch'):
                media.corresponding_source(self.root, self.cache, self.source)

    def test_source_manifest_requires_new_format_and_https_without_credentials(self):
        self.source['formatVersion'] = 2
        with self.assertRaisesRegex(ValueError, 'version 3'):
            media.media_config(self.root, self.source)
        self.source['formatVersion'] = 3
        self.source['nativeMedia']['candidate']['url'] = 'https://secret@example.invalid/candidate.tar.gz'
        with self.assertRaisesRegex(ValueError, 'HTTPS URL'):
            media.media_config(self.root, self.source)

    def test_windows_manifest_requires_the_same_complete_source_pins(self):
        self.source['nativeMedia']['target'] = 'win32-x64'
        self.assertEqual(media.media_config(self.root, self.source)['target'], 'win32-x64')
        self.source['nativeMedia']['target'] = 'linux-x64'
        with self.assertRaisesRegex(ValueError, 'supported native'):
            media.media_config(self.root, self.source)


if __name__ == '__main__':
    unittest.main()
