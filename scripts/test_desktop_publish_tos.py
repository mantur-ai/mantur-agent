"""Validate release hashes and immutable update URLs without network access."""
import base64
import hashlib
import importlib.util
import os
import subprocess
import shlex
import sys
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
        meta = self.root / ('rc-mac.yml' if '-rc.' in self.info['version'] else 'latest-mac.yml')
        meta.write_text(yaml.safe_dump(self.info))
        (self.root / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in [self.zip, meta]))

    def make_release(self, directory, metadata, architectures, windows):
        version = '0.1.22-rc.2' if metadata == 'rc' else '0.1.22'
        mac_files = []
        for arch in architectures:
            for extension in ('dmg', 'dmg.blockmap', 'zip', 'zip.blockmap'):
                artifact = directory / ('Mantur-Agent-macOS-' + arch + '.' + extension)
                artifact.write_bytes((arch + extension).encode())
                if extension == 'zip':
                    mac_files.append({'url': artifact.name, 'size': artifact.stat().st_size, 'sha512': base64.b64encode(hashlib.sha512(artifact.read_bytes()).digest()).decode()})
        (directory / (metadata + '-mac.yml')).write_text(yaml.safe_dump({'version': version, 'path': mac_files[0]['url'], 'files': mac_files}))
        if windows:
            installer = directory / 'Mantur-Agent-Windows-x64.exe'
            installer.write_bytes(b'windows')
            (directory / (installer.name + '.blockmap')).write_bytes(b'blockmap')
            (directory / (metadata + '.yml')).write_text(yaml.safe_dump({'version': version, 'path': installer.name, 'files': [{'url': installer.name, 'size': installer.stat().st_size, 'sha512': base64.b64encode(hashlib.sha512(installer.read_bytes()).digest()).decode()}]}))
        self.checksums(directory)
        return version

    def checksums(self, directory):
        (directory / 'SHA256SUMS').write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' for path in sorted(directory.iterdir()) if path.name != 'SHA256SUMS'))

    def test_publication_matrix(self):
        for metadata in ('latest', 'rc'):
            for architectures in (('arm64',), ('arm64', 'x64')):
                for windows in (False, True):
                    with self.subTest(metadata=metadata, architectures=architectures, windows=windows), tempfile.TemporaryDirectory() as temp:
                        directory = Path(temp)
                        version = self.make_release(directory, metadata, architectures, windows)
                        client = MagicMock()
                        missing = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'GetObject')
                        client.get_object.side_effect = missing
                        client.head_object.side_effect = missing
                        response = MagicMock()
                        response.status = 206
                        def public_response(url, **kwargs):
                            target = url.full_url if hasattr(url, 'full_url') else url
                            name = target.rsplit('/', 1)[1]
                            if name.endswith('.yml') and '/releases/' not in target:
                                response.read.return_value = client.put_object.call_args.kwargs['Body']
                            else:
                                artifact = directory / name
                                response.headers = {'Content-Range': 'bytes 0-0/' + str(artifact.stat().st_size), 'x-tos-meta-sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()}
                            return response
                        response.__enter__.return_value = response
                        with patch.dict(os.environ, self.publisher_environment(), clear=True), patch.object(publisher.boto3, 'client', return_value=client), patch.object(publisher, 'urlopen', side_effect=public_response) as request:
                            publisher.publish(directory, version, check_only=True, require_windows=windows)
                            for method in (client.upload_file, client.copy_object, client.put_object, request):
                                method.assert_not_called()
                            publisher.publish(directory, version, require_windows=windows)
                        channel = 'rc' if metadata == 'rc' else 'stable'
                        keys = [call.kwargs['Key'] for call in client.put_object.call_args_list]
                        self.assertEqual(keys, ['agent/' + channel + '/' + metadata + '-mac.yml'] + (['agent/' + channel + '/' + metadata + '.yml'] if windows else []))
                        self.assertEqual(client.copy_object.call_count, 2 if windows else 1)
                        self.assertEqual(client.upload_file.call_count, len(list(directory.iterdir())))
                        forbidden = '/stable/' if metadata == 'rc' else '/rc/'
                        self.assertNotIn(forbidden, str(client.mock_calls))
                        if metadata == 'rc':
                            self.assertNotIn('latest', str(client.mock_calls))

    def test_failed_preflight_matrix_has_no_github_or_tos_writes(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        steps = workflow['jobs']['publish']['steps']
        preflight = next(step['run'] for step in steps if step.get('name') == 'Preflight release publication without remote writes')
        create = next(step['run'] for step in steps if step.get('name') == 'Create GitHub release')
        publisher_path = Path(publisher.__file__).resolve()
        bootstrap = self.root / 'offline-publisher.py'
        bootstrap.write_text('''import os, runpy, sys
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock
import boto3
from botocore.exceptions import ClientError
client = MagicMock()
missing = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'GetObject')
client.get_object.side_effect = missing
def head(**kwargs):
    if kwargs['Key'].endswith('/SHA256SUMS') and os.environ.get('CONFLICT') == 'true':
        return {'Metadata': {'sha256': 'conflict'}, 'ContentLength': 0}
    raise missing
client.head_object.side_effect = head
def write(*args, **kwargs):
    Path(os.environ['WRITE_LOG']).write_text('unexpected remote write')
    raise AssertionError('remote writes forbidden')
client.upload_file.side_effect = write
client.copy_object.side_effect = write
client.put_object.side_effect = write
boto3.client = lambda *args, **kwargs: client
urllib.request.urlopen = write
runpy.run_path(sys.argv.pop(1), run_name='__main__')
''')
        gh = self.root / 'gh'
        gh.write_text('#!/bin/sh\necho called >> "$GH_CALL_LOG"\nexit 1\n')
        gh.chmod(0o755)
        for metadata in ('latest', 'rc'):
            for failure in ('config', 'mac-metadata', 'windows-exe', 'windows-blockmap', 'windows-metadata', 'sha256', 'sha512', 'conflict'):
                with self.subTest(metadata=metadata, failure=failure), tempfile.TemporaryDirectory() as temp:
                    directory = Path(temp)
                    release = directory / 'release'
                    release.mkdir()
                    version = self.make_release(release, metadata, ('arm64', 'x64'), True)
                    if failure.startswith('windows-') or failure == 'mac-metadata':
                        name = {'mac-metadata': metadata + '-mac.yml', 'windows-exe': 'Mantur-Agent-Windows-x64.exe', 'windows-blockmap': 'Mantur-Agent-Windows-x64.exe.blockmap', 'windows-metadata': metadata + '.yml'}[failure]
                        (release / name).unlink()
                        self.checksums(release)
                    elif failure == 'sha256':
                        (release / 'Mantur-Agent-macOS-arm64.zip').write_bytes(b'corrupt')
                    elif failure == 'sha512':
                        path = release / (metadata + '-mac.yml')
                        info = yaml.safe_load(path.read_text())
                        info['files'][0]['sha512'] = 'incorrect'
                        path.write_text(yaml.safe_dump(info))
                        self.checksums(release)
                    command = preflight.replace("${{ inputs.windows && '--require-windows' || '' }}", '--require-windows').replace('python scripts/desktop-publish-tos.py', shlex.join([sys.executable, str(bootstrap), str(publisher_path)]))
                    env = {**self.publisher_environment(), 'PATH': str(self.root) + os.pathsep + os.defpath, 'GH_CALL_LOG': str(directory / 'gh.log'), 'WRITE_LOG': str(directory / 'writes.log'), 'RELEASE_VERSION': version, 'CONFLICT': str(failure == 'conflict').lower()}
                    if failure == 'config':
                        env['TOS_SECRET_KEY'] = ''
                    result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + command + '\n' + create], cwd=directory, env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    expected = {'config': 'TOS_SECRET_KEY', 'mac-metadata': 'Mac update metadata', 'windows-exe': 'Windows release artifacts', 'windows-blockmap': 'Windows release artifacts', 'windows-metadata': 'Windows release artifacts', 'sha256': 'SHA256 mismatch', 'sha512': 'artifact mismatch', 'conflict': 'replace existing release'}[failure]
                    self.assertIn(expected, result.stderr)
                    self.assertFalse((directory / 'gh.log').exists())
                    self.assertFalse((directory / 'writes.log').exists())

    def test_github_creation_channel_flags(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        script = next(step['run'] for step in workflow['jobs']['publish']['steps'] if step.get('name') == 'Create GitHub release')
        gh = self.root / 'gh'
        gh.write_text('#!/bin/sh\nif [ "$2" = view ]; then exit 1; fi\nprintf "%s\\n" "$@" > "$GH_CALL_LOG"\n')
        gh.chmod(0o755)
        for version in ('0.1.22', '0.1.22-rc.2'):
            log = self.root / 'gh-create'
            result = subprocess.run(['bash', '-c', script], cwd=self.root, env={'PATH': str(self.root) + os.pathsep + os.defpath, 'VERSION': version, 'TAG': 'v' + version, 'GITHUB_REPOSITORY': 'fixture/repo', 'GH_CALL_LOG': str(log)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = log.read_text().splitlines()
            self.assertEqual(args[:3], ['release', 'create', 'v' + version])
            self.assertEqual('--latest=false' in args, '-rc.' in version)
            self.assertEqual('--prerelease' in args, '-rc.' in version)

    def test_release_jobs_checkout_before_build_or_publish(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        for name, job in workflow['jobs'].items():
            self.assertEqual(job['steps'][0].get('uses'), 'actions/checkout@v6', name)
        self.assertIn('!cancelled()', workflow['jobs']['publish']['if'])

    def test_workflow_channel_and_preflight_order(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        jobs = workflow['jobs']
        for job, suffix in (('macos', '-mac.yml'), ('windows', '.yml')):
            upload = jobs[job]['steps'][-1]['with']['path']
            self.assertIn('${{ needs.validate.outputs.metadata }}' + suffix, upload)
            self.assertNotIn('latest', upload)
        assembly = next(step['run'] for step in jobs['assemble']['steps'] if step.get('name') == 'Merge native artifacts and update metadata')
        self.assertIn('$METADATA-mac.yml', assembly)
        self.assertIn('$METADATA.yml', assembly)
        steps = jobs['publish']['steps']
        names = [step.get('name', '') for step in steps]
        preflight = names.index('Preflight release publication without remote writes')
        create = names.index('Create GitHub release')
        self.assertLess(preflight, create)
        self.assertLess(names.index('Require review of the exact Mantur Cut distribution'), preflight)
        self.assertIn('--check', steps[preflight]['run'])
        self.assertIn('--require-windows', steps[preflight]['run'])
        self.assertIn('--prerelease --latest=false', steps[create]['run'])

    def test_failed_preflight_never_reaches_github_creation(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        steps = workflow['jobs']['publish']['steps']
        preflight = next(step['run'] for step in steps if step.get('name') == 'Preflight release publication without remote writes')
        create = next(step['run'] for step in steps if step.get('name') == 'Create GitHub release')
        preflight = preflight.replace("${{ inputs.windows && '--require-windows' || '' }}", '').replace('python ', shlex.quote(sys.executable) + ' ', 1)
        gh = self.root / 'gh'
        gh.write_text('#!/bin/sh\necho called >> "$GH_CALL_LOG"\nexit 1\n')
        gh.chmod(0o755)
        log = self.root / 'gh-calls'
        result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + preflight + '\n' + create], env={**os.environ, **self.publisher_environment(), 'TOS_SECRET_KEY': '', 'PATH': str(self.root) + os.pathsep + os.environ['PATH'], 'GH_CALL_LOG': str(log), 'RELEASE_VERSION': '0.1.22-rc.1'}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('TOS_SECRET_KEY', result.stderr)
        self.assertFalse(log.exists())

    def test_workflow_resolves_only_supported_channels(self):
        workflow = yaml.safe_load((Path(__file__).parent.parent / '.github/workflows/desktop-release.yml').read_text())
        script = workflow['jobs']['validate']['steps'][1]['run']
        start = script.index('if [[ "$version" =~')
        end = script.index('mantur_cut_distribution=', start)
        script = script[start:end]
        for version, metadata in (('0.1.22', 'latest'), ('0.1.22-rc.1', 'rc'), ('0.1.22-beta.1', None), ('0.1.22-rc.01', None)):
            output = self.root / 'output'
            output.write_text('')
            result = subprocess.run(['bash', '-c', script], env={**os.environ, 'version': version, 'GITHUB_OUTPUT': str(output)}, capture_output=True, text=True)
            with self.subTest(version=version):
                self.assertEqual(result.returncode, 0 if metadata else 1)
                self.assertEqual(output.read_text(), 'metadata=' + metadata + '\n' if metadata else '')

    def test_rc_downgrade_preflight_has_no_mutations(self):
        self.info['version'] = '0.1.22-rc.2'
        self.write_manifest()
        client = MagicMock()
        client.get_object.return_value['Body'].__enter__.return_value.read.return_value = yaml.safe_dump({'version': '0.1.22-rc.10'}).encode()
        with patch.dict(os.environ, self.publisher_environment()), patch.object(publisher.boto3, 'client', return_value=client):
            with self.assertRaisesRegex(ValueError, 'downgrade'):
                publisher.publish(self.root, self.info['version'], check_only=True)
        client.upload_file.assert_not_called()
        client.copy_object.assert_not_called()
        client.put_object.assert_not_called()

    def test_rc_metadata_and_version_order(self):
        self.info['version'] = '0.1.22-rc.10'
        self.write_manifest()
        _, channels = publisher.prepare(self.root, self.info['version'], 'https://example.com')
        self.assertEqual(list(channels), ['rc-mac.yml'])
        self.assertIn('/releases/0.1.22-rc.10/', yaml.safe_load(channels['rc-mac.yml'])['path'])
        self.assertGreater(publisher.version_key('0.1.22-rc.10'), publisher.version_key('0.1.22-rc.2'))
        self.assertGreater(publisher.version_key('0.1.22'), publisher.version_key('0.1.22-rc.10'))
        for version in ('0.1.22-beta.1', '0.1.22-rc', '0.1.22-rc.01', '../0.1.22', '01.1.22'):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'version is required'):
                publisher.prepare(self.root, version, 'https://example.com')

    def test_rc_rejects_stable_metadata(self):
        with self.assertRaisesRegex(ValueError, 'different release channel'):
            publisher.prepare(self.root, '0.1.22-rc.1', 'https://example.com')

    def test_selected_windows_requires_real_artifacts(self):
        with self.assertRaisesRegex(ValueError, 'Windows release artifacts are missing'):
            publisher.prepare(self.root, '0.1.19', 'https://example.com', require_windows=True)

    def test_selected_windows_accepts_verified_rc_files(self):
        self.info['version'] = '0.1.22-rc.1'
        self.write_manifest()
        installer = self.root / 'Mantur-Agent-Windows-x64.exe'
        installer.write_bytes(b'windows installer')
        blockmap = self.root / (installer.name + '.blockmap')
        blockmap.write_bytes(b'blockmap')
        info = {'version': self.info['version'], 'path': installer.name, 'files': [{'url': installer.name, 'size': installer.stat().st_size, 'sha512': base64.b64encode(hashlib.sha512(installer.read_bytes()).digest()).decode()}]}
        meta = self.root / 'rc.yml'
        meta.write_text(yaml.safe_dump(info))
        with (self.root / 'SHA256SUMS').open('a') as manifest:
            for file in (installer, blockmap, meta):
                manifest.write(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n')
        _, channels = publisher.prepare(self.root, self.info['version'], 'https://example.com', require_windows=True)
        self.assertEqual(set(channels), {'rc-mac.yml', 'rc.yml'})

    def test_missing_credentials_fail_before_client_creation(self):
        with patch.dict(os.environ, {**self.publisher_environment(), 'TOS_SECRET_KEY': ''}), patch.object(publisher.boto3, 'client') as client:
            with self.assertRaisesRegex(ValueError, 'TOS_SECRET_KEY'):
                publisher.publish(self.root, '0.1.19', check_only=True)
        client.assert_not_called()

    def publisher_environment(self):
        return {name: value for name, value in (
            ('TOS_PUBLIC_URL', 'https://example.com/agent'), ('TOS_BUCKET', 'bucket'),
            ('TOS_PREFIX', 'agent'), ('TOS_ENDPOINT', 'https://example.com'),
            ('TOS_REGION', 'region'), ('TOS_ACCESS_KEY', 'test'), ('TOS_SECRET_KEY', 'test'))}

    def test_readonly_preflight_and_rc_publication_never_use_stable(self):
        self.info['version'] = '0.1.22-rc.1'
        self.write_manifest()
        client = MagicMock()
        missing = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'GetObject')
        client.get_object.side_effect = missing
        client.head_object.side_effect = missing
        with patch.dict(os.environ, self.publisher_environment()), patch.object(publisher.boto3, 'client', return_value=client), patch.object(publisher, 'urlopen') as request:
            publisher.publish(self.root, self.info['version'], check_only=True)
            client.upload_file.assert_not_called()
            client.copy_object.assert_not_called()
            client.put_object.assert_not_called()
            request.assert_not_called()
            response = request.return_value.__enter__.return_value
            response.status = 206
            def public_response(url, **kwargs):
                target = url.full_url if hasattr(url, 'full_url') else url
                if '/releases/' in target:
                    name = target.rsplit('/', 1)[1]
                    response.headers = {'Content-Range': 'bytes 0-0/' + str((self.root / name).stat().st_size)}
                else:
                    response.read.return_value = client.put_object.call_args.kwargs['Body']
                return request.return_value
            request.side_effect = public_response
            publisher.publish(self.root, self.info['version'])
        self.assertEqual(client.put_object.call_args.kwargs['Key'], 'agent/rc/rc-mac.yml')
        for call in client.mock_calls:
            self.assertNotIn('/stable/', str(call))
            self.assertNotIn('latest', str(call))

    def test_preflight_checks_every_object_before_upload(self):
        client = MagicMock()
        client.get_object.side_effect = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'GetObject')
        client.head_object.side_effect = [ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'HeadObject'), {'Metadata': {'sha256': 'conflict'}, 'ContentLength': 0}]
        with patch.dict(os.environ, self.publisher_environment()), patch.object(publisher.boto3, 'client', return_value=client):
            with self.assertRaisesRegex(ValueError, 'replace existing release'):
                publisher.publish(self.root, '0.1.19')
        client.upload_file.assert_not_called()
        client.copy_object.assert_not_called()
        client.put_object.assert_not_called()

    def test_versioned_channel(self):
        files, channels = publisher.prepare(self.root, '0.1.19', 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent')
        data = yaml.safe_load(channels['latest-mac.yml'])
        self.assertEqual(data['path'], 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent/releases/0.1.19/' + self.zip.name)
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

    def test_rc_manual_installer_uses_only_rc_address(self):
        name = 'Mantur-Agent-macOS-arm64.dmg'
        client = MagicMock()
        client.head_object.side_effect = ClientError({'ResponseMetadata': {'HTTPStatusCode': 404}}, 'HeadObject')
        response = MagicMock()
        response.status = 206
        response.headers = {'Content-Range': 'bytes 0-0/' + str(self.zip.stat().st_size), 'x-tos-meta-sha256': hashlib.sha256(self.zip.read_bytes()).hexdigest()}
        with patch.object(publisher, 'urlopen') as request:
            request.return_value.__enter__.return_value = response
            publisher.publish_installers(client, 'bucket', 'agent', 'https://example.com/agent', {name: self.zip}, '0.1.22-rc.1')
            self.assertEqual(request.call_args.args[0].full_url, 'https://example.com/agent/rc/' + name)
        self.assertEqual(client.copy_object.call_args.kwargs['Key'], 'agent/rc/' + name)
        self.assertEqual(client.head_object.call_args.kwargs['Key'], 'agent/rc/' + name)

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
