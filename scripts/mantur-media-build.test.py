#!/usr/bin/env python3
"""Exercise source-integrity and extraction failures without compiling third-party code."""

import hashlib
import importlib.util
import io
import math
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('media_build', Path(__file__).with_name('mantur-media-build.py'))
media_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media_build)

verify_spec = importlib.util.spec_from_file_location('media_verify', Path(__file__).with_name('mantur-media-build.verify.py'))
media_verify = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(media_verify)


class SourceIntegrityTests(unittest.TestCase):
    """Keep invalid source input and caller credentials out of native builds."""

    def test_changed_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'source.tar'
            archive.write_bytes(b'official source')
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            media_build.verify_archive(archive, digest)
            archive.write_bytes(b'changed source')
            with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                media_build.verify_archive(archive, digest)

    def test_archive_traversal_is_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.tar'
            with tarfile.open(archive, 'w') as output:
                item = tarfile.TarInfo('../escaped')
                item.size = 1
                output.addfile(item, io.BytesIO(b'x'))
            destination = root / 'out'
            destination.mkdir()
            with self.assertRaisesRegex(ValueError, 'Unsafe archive path'):
                media_build.extract_archive(archive, destination)
            self.assertFalse((root / 'escaped').exists())

    def test_escaping_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.tar'
            with tarfile.open(archive, 'w') as output:
                item = tarfile.TarInfo('source/link')
                item.type = tarfile.SYMTYPE
                item.linkname = '../../escaped'
                output.addfile(item)
            destination = root / 'out'
            destination.mkdir()
            with self.assertRaisesRegex(ValueError, 'Unsafe archive link'):
                media_build.extract_archive(archive, destination)

    def test_environment_does_not_inherit_credentials_or_injected_flags(self):
        with patch.dict(os.environ, {'API_KEY': 'example', 'TOKEN': 'example', 'CFLAGS': '-include malicious.h',
                                     'DYLD_INSERT_LIBRARIES': '/tmp/untrusted.dylib'}):
            environment = media_build.build_environment(Path('/work'), Path('/prefix'), Path('/tools'), '/sdk')
        self.assertNotIn('API_KEY', environment)
        self.assertNotIn('TOKEN', environment)
        self.assertNotIn('DYLD_INSERT_LIBRARIES', environment)
        self.assertNotIn('malicious', environment['CFLAGS'])
        self.assertEqual(environment['PKG_CONFIG_LIBDIR'], '/prefix/lib/pkgconfig')


class AudioSynchronizationTests(unittest.TestCase):
    """A playable export with a shifted soundtrack must fail the synchronization check."""

    def test_frequency_transition_rejects_one_hundred_millisecond_drift(self):
        for transition, accepted in [(2.0, True), (1.9, False), (2.1, False)]:
            with self.subTest(transition=transition):
                pcm = [math.sin(2 * math.pi * (440 if index / 48000 < transition else 660) * index / 48000)
                       for index in range(5 * 48000)]
                if accepted:
                    media_verify.check_audio_transition(pcm)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'Audio tone differs'):
                        media_verify.check_audio_transition(pcm)


if __name__ == '__main__':
    unittest.main()
