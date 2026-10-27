"""Exercise release source archives against isolated local Git repositories."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from test_mantur_media_inputs import install_media_fixture


spec = importlib.util.spec_from_file_location('sources', Path(__file__).with_name('desktop-release-sources.py'))
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class SourceArchiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='desktop-source-test-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.root = self.repository('harness')
        self.cut = self.repository('cut')
        self.whisper = self.repository('whisper')
        self.output = self.directory / 'release'
        (self.cut / 'editor.txt').write_text('original\n')
        (self.cut / 'tool.sh').write_text('#!/bin/sh\nexit 0\n')
        os.chmod(self.cut / 'tool.sh', 0o755)
        self.commit(self.cut)
        (self.whisper / 'whisper.cpp').write_text('int main() { return 0; }\n')
        self.commit(self.whisper)
        self.config = {
            'formatVersion': 3, 'repository': str(self.cut),
            'upstreamCommit': self.capture(self.cut, 'rev-parse', 'HEAD'),
            'upstreamTree': self.capture(self.cut, 'rev-parse', 'HEAD^{tree}'),
            'whisperRepository': str(self.whisper),
            'whisperCommit': self.capture(self.whisper, 'rev-parse', 'HEAD'),
            'whisperTree': self.capture(self.whisper, 'rev-parse', 'HEAD^{tree}'),
            'patches': [],
        }
        patches = self.root / 'packages/client/ui-mantur-editing/adapters'
        patches.mkdir(parents=True)
        for index in range(3):
            (self.cut / 'editor.txt').write_text(f'layer {index}\n')
            content = sources.git(self.cut, 'diff', 'HEAD', '--')
            name = f'layer-{index}.patch'
            (patches / name).write_bytes(content)
            self.commit(self.cut)
            self.config['patches'].append({'file': name, 'sha256': hashlib.sha256(content).hexdigest(),
                                           'resultTree': self.capture(self.cut, 'rev-parse', 'HEAD^{tree}')})
        self.source = self.root / 'apps/desktop/mantur-cut/source.json'
        self.source.parent.mkdir(parents=True)
        (self.root / 'apps/desktop/package.json').write_text('{"version":"0.1.22"}\n')
        self.media_inputs = self.directory / 'media-inputs'
        self.media_inputs.mkdir()
        self.config['nativeMedia'], _, _ = install_media_fixture(self.root, self.media_inputs)
        environment = patch.dict(os.environ, {'MANTUR_MEDIA_INPUT_DIR': str(self.media_inputs)})
        environment.start()
        self.addCleanup(environment.stop)
        self.write_config()

    def repository(self, name):
        directory = self.directory / name
        directory.mkdir()
        sources.git(directory, 'init', '--quiet')
        return directory

    def capture(self, directory, *arguments):
        return sources.git(directory, *arguments).decode().strip()

    def commit(self, directory):
        sources.git(directory, 'add', '--all')
        sources.git(directory, '-c', 'user.name=Source fixture', '-c', 'user.email=fixture@example.invalid',
                    '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture')

    def write_config(self):
        self.source.write_text(json.dumps(self.config) + '\n')
        self.commit(self.root)

    def test_complete_deterministic_archives_match_committed_sources(self):
        files = sources.archive_release(self.root, self.output)
        self.assertEqual(len(files), 5)
        manifest = json.loads((self.output / 'DESKTOP-SOURCES.json').read_text())
        self.assertEqual(manifest['harnessCommit'], self.capture(self.root, 'rev-parse', 'HEAD'))
        self.assertEqual(manifest['distributionId'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        for row in files:
            self.assertEqual(row['sha256'], hashlib.sha256((self.output / row['name']).read_bytes()).hexdigest())
            with tarfile.open(self.output / row['name']) as archive:
                self.assertFalse(any('/.git/' in member.name for member in archive))
        with tarfile.open(self.output / 'Mantur-Cut-patched-source.tar.gz') as archive:
            self.assertEqual(archive.extractfile('Mantur-Cut-patched-source/editor.txt').read(), b'layer 2\n')
            self.assertTrue(archive.getmember('Mantur-Cut-patched-source/tool.sh').mode & 0o111)
        again = sources.archive_release(self.root, self.directory / 'second')
        self.assertEqual(files, again)
        self.assertIn(manifest['harnessCommit'], (self.output / 'DESKTOP-SOURCE-BUILD.txt').read_text())
        media_record = manifest['files'][-1]
        self.assertEqual(media_record['sourceArchives'], 1)
        self.assertEqual(media_record['candidateSha256'], self.config['nativeMedia']['candidate']['sha256'])

    def test_missing_or_modified_media_sources_stop_release_assembly(self):
        archive = self.media_inputs / 'source.tar.gz'
        content = archive.read_bytes()
        archive.unlink()
        with self.assertRaisesRegex(ValueError, 'byte count'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())
        archive.write_bytes(bytes([content[0] ^ 1]) + content[1:])
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_wrong_patch_hash_and_tree_never_produce_a_candidate(self):
        for field, value, message in [('sha256', '0' * 64, 'SHA256'), ('resultTree', '0' * 40, 'pinned tree')]:
            original = self.config['patches'][1][field]
            self.config['patches'][1][field] = value
            self.write_config()
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                sources.archive_release(self.root, self.output)
            self.assertFalse(self.output.exists())
            self.config['patches'][1][field] = original

    def test_wrong_upstream_tree_is_rejected(self):
        self.config['upstreamTree'] = '0' * 40
        self.write_config()
        with self.assertRaisesRegex(ValueError, 'pinned tree'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_dirty_tracked_sources_are_rejected_but_untracked_outputs_are_excluded(self):
        (self.root / 'private-profile').write_text('not release source\n')
        sources.archive_release(self.root, self.output)
        with tarfile.open(self.output / 'Mantur-Agent-source-0.1.22.tar.gz') as archive:
            self.assertFalse(any(member.name.endswith('/private-profile') for member in archive))
        self.source.write_text('{}\n')
        with self.assertRaises(subprocess.CalledProcessError):
            sources.archive_release(self.root, self.directory / 'dirty')
        self.assertFalse((self.directory / 'dirty').exists())

    def test_export_ignored_tracked_sources_cannot_be_silently_omitted(self):
        (self.root / '.gitattributes').write_text('apps/desktop/package.json export-ignore\n')
        self.commit(self.root)
        with self.assertRaisesRegex(ValueError, 'omitted tracked files'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_export_substitution_cannot_change_source_bytes(self):
        (self.root / 'revision.txt').write_text('$Format:%H$\n')
        (self.root / '.gitattributes').write_text('revision.txt export-subst\n')
        self.commit(self.root)
        with self.assertRaisesRegex(ValueError, 'changed a tracked file'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipIf(os.name == 'nt', 'Source assembly runs on Linux; this fixture requires POSIX symlinks')
    def test_escaping_source_links_are_rejected(self):
        (self.root / 'outside').symlink_to('../private-profile')
        self.commit(self.root)
        with self.assertRaisesRegex(ValueError, 'link escapes'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipIf(os.name == 'nt', 'Source assembly runs on Linux; this fixture requires POSIX symlinks')
    def test_intermediate_source_links_cannot_hide_parent_escape(self):
        (self.root / 'alias').symlink_to('.')
        (self.root / 'escape').symlink_to('alias/../private-profile')
        self.commit(self.root)
        self.assertEqual((self.root / 'escape').resolve(), self.directory.resolve() / 'private-profile')
        with self.assertRaisesRegex(ValueError, 'link escapes'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipIf(os.name == 'nt', 'Source assembly runs on Linux; this fixture requires POSIX symlinks')
    def test_cyclic_source_links_are_rejected(self):
        (self.root / 'first').symlink_to('second')
        (self.root / 'second').symlink_to('first')
        self.commit(self.root)
        with self.assertRaisesRegex(ValueError, 'link cycle'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipIf(os.name == 'nt', 'Source assembly runs on Linux; this fixture requires POSIX symlinks')
    def test_repeated_safe_source_links_remain_in_the_archive(self):
        (self.root / 'alias').symlink_to('.')
        (self.root / 'package-link').symlink_to('alias/alias/apps/desktop/package.json')
        self.commit(self.root)
        sources.archive_release(self.root, self.output)
        with tarfile.open(self.output / 'Mantur-Agent-source-0.1.22.tar.gz') as archive:
            self.assertEqual(archive.getmember('Mantur-Agent-source-0.1.22/package-link').linkname,
                             'alias/alias/apps/desktop/package.json')

    def test_unsafe_patch_names_are_rejected(self):
        self.config['patches'][0]['file'] = '../outside.patch'
        self.write_config()
        with self.assertRaisesRegex(ValueError, 'unsafe patch filename'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_submodules_cannot_be_misreported_as_complete_sources(self):
        (self.root / 'nested-source').mkdir()
        sources.git(self.root, 'update-index', '--add', '--cacheinfo',
                    '160000,' + self.config['upstreamCommit'] + ',nested-source')
        sources.git(self.root, '-c', 'user.name=Source fixture', '-c', 'user.email=fixture@example.invalid',
                    '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'submodule fixture')
        with self.assertRaisesRegex(ValueError, 'submodules are unsupported'):
            sources.archive_release(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_source_artifact_is_not_replaced(self):
        self.output.mkdir()
        existing = self.output / 'DESKTOP-SOURCES.json'
        existing.write_text('preserve existing bytes\n')
        with self.assertRaises(FileExistsError):
            sources.archive_release(self.root, self.output)
        self.assertEqual(existing.read_text(), 'preserve existing bytes\n')
        self.assertEqual(list(self.output.iterdir()), [existing])


if __name__ == '__main__':
    unittest.main()
