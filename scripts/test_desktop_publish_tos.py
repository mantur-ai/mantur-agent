"""Validate release hashes and immutable update URLs without network access."""
import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
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
