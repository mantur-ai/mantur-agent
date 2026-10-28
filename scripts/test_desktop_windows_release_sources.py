"""Exercise Windows source delivery with private Git and media fixtures."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import yaml

from test_mantur_media_inputs import encoded, install_media_fixture, write_archive


spec = importlib.util.spec_from_file_location('windows_sources', Path(__file__).with_name('desktop-windows-release-sources.py'))
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class WindowsSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='windows-source-test-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.root = self.directory / 'repository'
        self.root.mkdir()
        self.inputs = self.directory / 'inputs'
        self.inputs.mkdir()
        self.output = self.directory / 'release'
        self.output.mkdir()
        sources.git(self.root, 'init', '--quiet')
        native, _, self.media_files = install_media_fixture(self.root, self.inputs)
        native['target'] = 'win32-x64'
        self.config = {
            'formatVersion': 3, 'repository': 'https://example.invalid/cut.git', 'version': '0.2.14',
            'upstreamCommit': '1' * 40, 'upstreamTree': '2' * 40,
            'whisperRepository': 'https://example.invalid/whisper.git', 'whisperVersion': 'v1.9.2',
            'whisperCommit': '3' * 40, 'whisperTree': '4' * 40,
            'remotionVersion': '4.0.509', 'remotionRendererIntegrity': 'fixture integrity',
            'electronVersion': '43.4.0', 'embeddedNodeVersion': '24.18.1',
            'targets': {'win32-x64': {'chromeVersion': '149.0.7790.0'}},
            'patches': [], 'nativeMedia': native,
        }
        adapter = self.root / 'packages/client/ui-mantur-editing/adapters'
        adapter.mkdir(parents=True)
        for number in range(3):
            name = f'layer-{number}.patch'
            content = f'fixture patch {number}\n'.encode()
            (adapter / name).write_bytes(content)
            self.config['patches'].append({'file': name, 'sha256': hashlib.sha256(content).hexdigest(),
                                           'resultTree': str(number + 5) * 40})
        (self.root / 'apps/desktop/package.json').write_bytes(encoded({'version': '1.0.0'}))
        self.commit()
        self.baseline = self.head()
        media_index = json.loads(self.media_files['SOURCE-INDEX.json'])
        media_index['recipeCommit'] = self.baseline
        self.media_files['SOURCE-INDEX.json'] = encoded(media_index)
        self.write_media()
        self.source_path = self.root / sources.SOURCE_PATH
        self.save_config()
        self.commit()
        self.mac = {'formatVersion': 1, 'harnessCommit': self.baseline, 'desktopVersion': '1.0.0',
                    'cutSource': copy.deepcopy(self.config), 'files': []}
        self.mac['cutSource']['nativeMedia']['target'] = 'darwin-arm64'
        for name, revision, tree in (
                ('OpenChatCut-upstream-source.tar.gz', '1' * 40, '2' * 40),
                ('Mantur-Cut-patched-source.tar.gz', '7' * 40, '7' * 40),
                ('whisper-cpp-source.tar.gz', '3' * 40, '4' * 40)):
            self.mac['files'].append({'name': name, 'gitObject': revision, 'tree': tree, 'size': 10, 'sha256': 'a' * 64})
        self.mac['files'].append({'name': 'Mantur-Media-corresponding-source.tar.gz',
                                  'size': native['correspondingSource']['bytes'],
                                  'sha256': native['correspondingSource']['sha256']})
        self.mac_path = self.directory / 'mac-index.json'
        self.mac_path.write_bytes(encoded(self.mac))
        approved = patch.object(sources, 'MAC_SOURCE_SHA256', hashlib.sha256(self.mac_path.read_bytes()).hexdigest())
        approved.start()
        self.addCleanup(approved.stop)
        installer = b'fixture installer bytes\n'
        (self.output / sources.INSTALLER).write_bytes(installer)
        (self.output / (sources.INSTALLER + '.blockmap')).write_bytes(b'fixture blockmap\n')
        digest = base64.b64encode(hashlib.sha512(installer).digest()).decode()
        self.feed = {'version': '1.0.0', 'path': sources.INSTALLER, 'sha512': digest,
                     'files': [{'url': sources.INSTALLER, 'size': len(installer), 'sha512': digest}]}
        self.write_feed()
        self.smoke = {'status': 'PASS', 'expectedVersion': '1.0.0', 'installedPackageVersion': '1.0.0',
                      'installer': {'sha256': hashlib.sha256(installer).hexdigest(), 'bytes': len(installer),
                                    'authenticodeStatus': 'NotSigned'},
                      'installedApplication': {'authenticodeStatus': 'NotSigned', 'peMachine': '0x8664'}}
        self.smoke_path = self.directory / 'smoke.json'
        self.write_smoke()

    def commit(self):
        sources.git(self.root, 'add', '--all')
        sources.git(self.root, '-c', 'user.name=Source test', '-c', 'user.email=source@example.invalid',
                    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Fixture')

    def head(self):
        return sources.git(self.root, 'rev-parse', 'HEAD').decode().strip()

    def save_config(self):
        self.source_path.write_bytes(encoded(self.config))

    def write_media(self):
        self.media_files['FILES-SHA256.json'] = encoded({name: hashlib.sha256(content).hexdigest()
                                                        for name, content in self.media_files.items()
                                                        if name != 'FILES-SHA256.json'})
        self.config['nativeMedia']['correspondingSource'] = write_archive(
            self.inputs, 'source.tar.gz', 'source', self.media_files)

    def write_feed(self):
        (self.output / 'latest.yml').write_text(yaml.safe_dump(self.feed), encoding='utf-8')

    def write_smoke(self):
        self.smoke_path.write_bytes(encoded(self.smoke))

    def generate(self):
        with patch.object(sources.urllib.request, 'urlopen', side_effect=AssertionError('Unexpected network acquisition')):
            return sources.archive_release(self.root, self.output, self.baseline, '123456',
                                           self.inputs / 'source.tar.gz', self.smoke_path, self.mac_path)

    def assert_no_sources(self):
        self.assertEqual(sorted(path.name for path in self.output.iterdir()),
                         sorted([sources.INSTALLER, sources.INSTALLER + '.blockmap', 'latest.yml']))

    def test_sources_bind_commit_media_unsigned_smoke_and_shared_references_without_downloads(self):
        result = self.generate()
        self.assertEqual(result['harnessCommit'], self.head())
        self.assertEqual(result['baselineCommit'], self.baseline)
        self.assertEqual(result['harnessTree'], sources.git(self.root, 'rev-parse', 'HEAD^{tree}').decode().strip())
        self.assertEqual(result['distributionId'], hashlib.sha256(self.source_path.read_bytes()).hexdigest())
        self.assertEqual(result['cutSource'], self.config)
        self.assertEqual(result['workflowRunId'], '123456')
        self.assertEqual(result['signing']['mode'], 'unsigned')
        self.assertEqual(result['signing']['smokeReport']['sha256'], hashlib.sha256(self.smoke_path.read_bytes()).hexdigest())
        self.assertEqual(len(result['sharedSources']), 4)
        self.assertIn('sources only', result['sharedSources'][-1]['scope'])
        self.assertEqual((self.output / sources.MEDIA_ARCHIVE).read_bytes(), (self.inputs / 'source.tar.gz').read_bytes())
        for row in [*result['files'], *result['releaseArtifacts']]:
            self.assertEqual(row['sha256'], sources.media_inputs.sha256(self.output / row['name']))
            self.assertEqual(row['size'], (self.output / row['name']).stat().st_size)
        with tarfile.open(self.output / result['files'][0]['name']) as archive:
            entry = next(item for item in archive if item.name.endswith('/' + sources.SOURCE_PATH))
            self.assertEqual(archive.extractfile(entry).read(), self.source_path.read_bytes())
        self.assertFalse((self.output / 'DESKTOP-SOURCES.json').exists())
        self.assertFalse((self.output / 'SHA256SUMS-Windows.txt').exists())
        self.assertFalse((self.output / 'Mantur-Media-corresponding-source.tar.gz').exists())

    def test_existing_source_artifact_is_preserved(self):
        path = self.output / sources.MEDIA_ARCHIVE
        path.write_bytes(b'existing')
        with self.assertRaisesRegex(FileExistsError, 'Refusing to replace'):
            self.generate()
        self.assertEqual(path.read_bytes(), b'existing')
        self.assertFalse((self.output / 'DESKTOP-SOURCES-Windows.json').exists())

    def test_modified_tracked_input_and_uncommitted_config_are_rejected(self):
        self.source_path.write_bytes(self.source_path.read_bytes() + b' ')
        with self.assertRaises(subprocess.CalledProcessError):
            self.generate()
        self.assert_no_sources()

    def test_changed_shared_pins_cannot_reuse_mac_sources(self):
        for field in ('repository', 'upstreamCommit', 'whisperCommit', 'remotionVersion', 'electronVersion', 'patches'):
            source = copy.deepcopy(self.config)
            source[field] = [] if field == 'patches' else 'changed'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'Shared source pin differs'):
                sources.shared_sources(source, self.mac, self.baseline, '1.0.0')
        source = copy.deepcopy(self.config)
        source['targets']['win32-x64']['chromeVersion'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'Chromium'):
            sources.shared_sources(source, self.mac, self.baseline, '1.0.0')

    def test_wrong_baseline_and_shared_archive_tree_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'baseline'):
            sources.shared_sources(self.config, self.mac, 'f' * 40, '1.0.0')
        self.mac['files'][0]['tree'] = 'f' * 40
        with self.assertRaisesRegex(ValueError, 'Git identity'):
            sources.shared_sources(self.config, self.mac, self.baseline, '1.0.0')

    def test_only_the_fixed_approved_mac_index_can_be_used(self):
        content = self.mac_path.read_bytes()
        self.mac_path.write_bytes(content + b' ')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.generate()
        response = io.BytesIO(content)
        response.url = sources.MAC_SOURCE_URL
        with patch.object(sources.urllib.request, 'urlopen', return_value=response) as fetch:
            self.assertEqual(sources.read_mac_index(), self.mac)
            fetch.assert_called_once_with(sources.MAC_SOURCE_URL, timeout=60)
        self.assert_no_sources()

    def test_changed_or_missing_media_archive_is_rejected_without_download(self):
        archive = self.inputs / 'source.tar.gz'
        content = archive.read_bytes()
        archive.write_bytes(bytes([content[0] ^ 1]) + content[1:])
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.generate()
        archive.unlink()
        with self.assertRaisesRegex(ValueError, 'byte count mismatch'):
            self.generate()
        self.assert_no_sources()

    def test_media_inventory_and_recipe_commit_are_bound_to_committed_inputs(self):
        del self.media_files['recipe/mantur-media-build.py']
        self.write_media()
        self.save_config()
        self.commit()
        with self.assertRaisesRegex(ValueError, 'recipe mismatch'):
            self.generate()
        self.assert_no_sources()

    def test_media_recipe_must_exist_at_its_recorded_commit(self):
        path = self.root / 'scripts/mantur-media-build.py'
        path.write_bytes(b'new recipe\n')
        self.config['nativeMedia']['recipes'][0]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.media_files['recipe/mantur-media-build.py'] = path.read_bytes()
        self.write_media()
        self.save_config()
        self.commit()
        with self.assertRaisesRegex(ValueError, 'recipe commit'):
            self.generate()
        self.assert_no_sources()

    def test_feed_cannot_name_other_artifacts_or_bind_wrong_bytes(self):
        original = copy.deepcopy(self.feed)
        for field, value in (('version', '0.1.20'), ('path', '../wrong.exe'), ('sha512', 'bad')):
            self.feed = copy.deepcopy(original)
            self.feed[field] = value
            self.write_feed()
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'update metadata'):
                self.generate()
        self.assert_no_sources()

    def test_unsigned_smoke_must_pass_and_match_exact_installer(self):
        original = copy.deepcopy(self.smoke)
        for section, field, value in ((None, 'status', 'FAIL'), (None, 'installedPackageVersion', '0.1.20'),
                                      ('installer', 'sha256', 'f' * 64), ('installer', 'bytes', 1),
                                      ('installer', 'authenticodeStatus', 'HashMismatch'),
                                      ('installedApplication', 'authenticodeStatus', 'Valid'),
                                      ('installedApplication', 'peMachine', '0x14c')):
            self.smoke = copy.deepcopy(original)
            target = self.smoke if section is None else self.smoke[section]
            target[field] = value
            self.write_smoke()
            with self.subTest(section=section, field=field), self.assertRaisesRegex(ValueError, 'Native smoke'):
                self.generate()
        self.assert_no_sources()

    def test_mac_target_and_missing_installer_are_rejected(self):
        self.config['nativeMedia']['target'] = 'darwin-arm64'
        self.save_config()
        self.commit()
        with self.assertRaisesRegex(ValueError, 'win32-x64'):
            self.generate()
        self.config['nativeMedia']['target'] = 'win32-x64'
        self.save_config()
        self.commit()
        (self.output / sources.INSTALLER).unlink()
        with self.assertRaisesRegex(ValueError, 'release artifact'):
            self.generate()


if __name__ == '__main__':
    unittest.main()
