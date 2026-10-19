"""Validate release hashes and immutable update URLs without network access."""
import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError
import yaml

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('desktop-publish-tos.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.zip = self.root / 'Mantur-Agent-macOS-arm64.zip'
        self.zip.write_bytes(b'test update')
        self.info = {'version': '0.1.19', 'path': self.zip.name, 'files': [{'url': self.zip.name, 'size': self.zip.stat().st_size, 'sha512': base64.b64encode(hashlib.sha512(self.zip.read_bytes()).digest()).decode()}]}
        self.write_manifest()

    def write_manifest(self):
        meta = self.root / 'latest-mac.yml'
        meta.write_text(yaml.safe_dump(self.info))
        (self.root / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in [self.zip, meta]))

    def test_release_jobs_checkout_before_build_or_publish(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        for name, job in workflow['jobs'].items():
            self.assertEqual(job['steps'][0].get('uses'), 'actions/checkout@v6', name)
        self.assertIn('!cancelled()', workflow['jobs']['publish']['if'])

    def test_versioned_channel(self):
        files, channels = publisher.prepare(self.root, '0.1.19', 'https://resource.mantur.ai/mantur-agent')
        data = yaml.safe_load(channels['latest-mac.yml'])
        self.assertEqual(data['path'], 'https://resource.mantur.ai/mantur-agent/releases/0.1.19/' + self.zip.name)
        self.assertEqual(data['files'][0]['url'], data['path'])
        self.assertNotIn('latest.yml', channels)

    def test_manual_installer_updates_only_present_platform(self):
        name = 'Mantur-Agent-macOS-arm64.dmg'
        artifact = self.root / name
        artifact.write_bytes(b'installer')
        client = MagicMock()
        client.head_object.side_effect = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'HeadObject')
        response = MagicMock()
        response.status = 206
        response.headers = {'Content-Range': 'bytes 0-0/9', 'x-tos-meta-sha256': hashlib.sha256(b'installer').hexdigest()}
        with patch.object(publisher, 'urlopen') as request:
            request.return_value.__enter__.return_value = response
            publisher.publish_installers(client, 'bucket', 'agent', 'https://example.com/agent', {name: artifact}, '0.1.20')
        args = client.copy_object.call_args.kwargs
        self.assertEqual(client.copy_object.call_count, 1)
        self.assertEqual(args['Key'], 'agent/stable/' + name)
        self.assertEqual(args['CopySource']['Key'], 'agent/releases/0.1.20/' + name)
        self.assertEqual(args['Metadata']['version'], '0.1.20')
        self.assertIn('no-cache', args['CacheControl'])

    def test_manual_installer_rejects_downgrade(self):
        client = MagicMock()
        client.head_object.return_value = {'Metadata': {'version': '0.1.21'}}
        with self.assertRaisesRegex(ValueError, 'downgrade'):
            publisher.publish_installers(client, 'bucket', 'agent', 'https://example.com', {'Mantur-Agent-Windows-x64.exe': self.zip}, '0.1.20')
        client.copy_object.assert_not_called()

    def test_manual_installer_rejects_stale_public_copy(self):
        client = MagicMock()
        client.head_object.return_value = {'Metadata': {'version': '0.1.20'}}
        response = MagicMock()
        response.status = 206
        response.headers = {'Content-Range': 'bytes 0-0/11', 'x-tos-meta-sha256': 'old'}
        with patch.object(publisher, 'urlopen') as request:
            request.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(ValueError, 'did not refresh'):
                publisher.publish_installers(client, 'bucket', 'agent', 'https://example.com', {'Mantur-Agent-Windows-x64.exe': self.zip}, '0.1.20')

    def test_separate_windows_manifest_rejects_corruption(self):
        name = 'Mantur-Agent-Windows-x64.exe'
        (self.root / name).write_bytes(b'corrupted windows')
        (self.root / 'SHA256SUMS-Windows.txt').write_text('0' * 64 + '  ' + name + '\n')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            publisher.prepare(self.root, '0.1.19', 'https://example.com')

    def test_corrupted_artifact(self):
        self.zip.write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'SHA256'): publisher.prepare(self.root, '0.1.19', 'https://example.com')

    def test_wrong_update_digest(self):
        self.info['files'][0]['sha512'] = 'wrong'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'artifact mismatch'): publisher.prepare(self.root, '0.1.19', 'https://example.com')

    def test_version_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'version mismatch'): publisher.prepare(self.root, '0.1.20', 'https://example.com')

    def test_path_escape(self):
        (self.root / 'SHA256SUMS').write_text('0' * 64 + '  ../outside\n')
        with self.assertRaisesRegex(ValueError, 'Unsafe'): publisher.prepare(self.root, '0.1.19', 'https://example.com')

    def test_missing_metadata(self):
        (self.root / 'SHA256SUMS').unlink()
        with self.assertRaisesRegex(ValueError, 'required'): publisher.prepare(self.root, '0.1.19', 'https://example.com')


if __name__ == '__main__': unittest.main()
