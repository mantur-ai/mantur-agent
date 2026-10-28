"""Verify promotion identity, safe extraction and write ordering with local fixtures."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import unittest
from unittest.mock import MagicMock, patch
import urllib.error
import zipfile

import yaml

import test_desktop_windows_release_sources as source_fixture_tests

source_fixture = source_fixture_tests.sources


spec = importlib.util.spec_from_file_location('promote', Path(__file__).with_name('desktop-windows-promote.py'))
promote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promote)


class PromotionTests(unittest.TestCase):
    def setUp(self):
        fixture = source_fixture_tests.WindowsSourceTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture
        baseline = patch.object(promote, 'BASELINE', fixture.baseline)
        baseline.start()
        self.addCleanup(baseline.stop)
        self.directory = fixture.directory / 'promotion'
        self.candidate = self.directory / 'candidate'
        self.evidence = self.candidate / 'evidence'
        (self.evidence / 'installed').mkdir(parents=True)
        (self.evidence / 'media').mkdir()
        fixture.smoke_path = self.evidence / 'installed/RESULT.json'
        fixture.smoke.update({
            'normalMainExit': True, 'cleanupComplete': True, 'forcedCleanupUsed': False, 'mainExitCode': 0,
            'closeMainWindowRequested': True, 'failures': [], 'processesAfterNormalExit': [],
            'installation': {'exitCode': 0, 'timedOut': False},
            'launch': {'pid': 100, 'electronRunAsNode': False, 'sandboxDisabled': False},
            'window': {'ownerPid': 100}, 'http': {'exchangeStatus': 303, 'pageStatus': 200, 'bootPayload': True},
        })
        fixture.smoke['installedApplication'].update({'sha256': 'c' * 64, 'bytes': 123, 'productVersion': '1.0.0'})
        fixture.write_smoke()
        media = fixture.config['nativeMedia']
        media['candidate']['url'] = promote.PUBLIC_URL + '/releases/1.0.0/Mantur-Media-Windows-x64.tar.gz'
        media['correspondingSource']['url'] = promote.PUBLIC_URL + '/releases/1.0.0/' + promote.sources.MEDIA_ARCHIVE
        archive = fixture.inputs / promote.sources.MEDIA_ARCHIVE
        shutil.copyfile(fixture.inputs / 'source.tar.gz', archive)
        fixture.save_config()
        fixture.commit()
        self.source_bytes = fixture.source_path.read_bytes()
        self.commit = fixture.head()
        self.tree = source_fixture.git(fixture.root, 'rev-parse', 'HEAD^{tree}').decode().strip()
        self.index = source_fixture.archive_release(fixture.root, fixture.output, fixture.baseline, '123456',
                                                     archive, fixture.smoke_path, fixture.mac_path)
        shutil.copyfile(fixture.inputs / 'candidate.tar.gz', fixture.output / 'Mantur-Media-Windows-x64.tar.gz')
        self.release = self.candidate / 'release'
        shutil.copytree(fixture.output, self.release)
        self.media_ci = {'formatVersion': 1, 'runId': '999', 'runAttempt': '1', 'headSha': fixture.baseline}
        self.write_json(self.evidence / 'MEDIA-RUN.json', {'pins': self.media_ci, 'run': {'conclusion': 'success', 'head_sha': fixture.baseline}})
        self.write_json(self.evidence / 'MEDIA-INPUTS.json', {
            'sourceConfigSha256': self.index['distributionId'], 'candidate': media['candidate'],
            'correspondingSource': self.index['files'][1],
        })
        self.write_json(self.evidence / 'UNSIGNED-IDENTITIES.json', [
            {'path': 'apps/desktop/dist/' + promote.sources.INSTALLER, **fixture.smoke['installer']},
            {'path': 'apps/desktop/dist/win-unpacked/ManTur Agent.exe', **fixture.smoke['installedApplication']},
        ])
        app = 'C:/runner/apps/desktop/dist/win-unpacked'
        self.media_result = {'ok': True, 'sourceSha256': self.index['distributionId'], 'exportStatus': 200, 'app': app,
                             'commands': [{'label': label, 'code': 0, 'signal': None, 'executable': app + '/ManTur Agent.exe'}
                                          for label in ('synthetic-input', 'output-probe', 'output-decode', 'compositor-probe')]}
        self.write_json(self.evidence / 'media/RESULT.json', self.media_result)
        rows = [promote.sources.file_record(path) for path in sorted(self.release.iterdir())]
        (self.release / 'SHA256SUMS-Windows.txt').write_text(''.join(row['sha256'] + '  ' + row['name'] + '\n' for row in rows))
        self.candidate_report = {
            'formatVersion': 1, 'publish': False, 'desktopVersion': '1.0.0', 'platform': 'win32-x64',
            'harnessCommit': self.commit, 'harnessTree': self.tree, 'runId': '123456', 'runAttempt': '2',
            'mediaCi': self.media_ci, 'signing': self.index['signing'],
        }
        self.rebind_report()
        self.archive = fixture.directory / 'candidate.zip'
        self.zip_candidate(self.archive)
        self.approval = {'commit': self.commit, 'runId': '123456', 'runAttempt': '2', 'artifactId': '456',
                         'artifactDigest': 'sha256:' + promote.sources.media_inputs.sha256(self.archive),
                         'sourceConfigSha256': self.index['distributionId'],
                         'manifestSha256': promote.sources.media_inputs.sha256(self.release / 'SHA256SUMS-Windows.txt')}
        self.run = {'status': 'completed', 'conclusion': 'success', 'id': 123456, 'run_attempt': 2,
                    'head_sha': self.commit, 'path': '.github/workflows/desktop-windows-release.yml',
                    'repository': {'full_name': promote.REPOSITORY}, 'head_repository': {'full_name': promote.REPOSITORY}}
        self.artifact = {'id': 456, 'name': 'windows-desktop-candidate-123456-2', 'expired': False,
                         'digest': self.approval['artifactDigest'], 'size_in_bytes': self.archive.stat().st_size,
                         'workflow_run': {'id': 123456, 'head_sha': self.commit}}
        self.write_json(self.directory / 'REMOTE.json', {'run': self.run, 'artifact': self.artifact})

    def write_json(self, path, value):
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

    def rebind_report(self):
        self.candidate_report['releaseFiles'] = [promote.sources.file_record(path) for path in sorted(self.release.iterdir())]
        self.candidate_report['verificationFiles'] = [
            {**promote.sources.file_record(self.evidence / name), 'name': name} for name in sorted(promote.VERIFICATION_FILES)]
        self.write_json(self.evidence / 'CANDIDATE.json', self.candidate_report)

    def zip_candidate(self, path, extra=None):
        with zipfile.ZipFile(path, 'w') as archive:
            for file in sorted(self.candidate.rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(self.candidate).as_posix())
            if extra is not None:
                archive.writestr(extra, b'escape')

    def verify(self):
        return promote.verify_candidate(self.candidate, self.approval, self.source_bytes, self.tree)

    def test_exact_candidate_safely_extracts_and_promotes_only_after_preflight(self):
        parsed = promote.parse_approval(json.dumps(self.approval), 'v1.0.0-windows.123456', self.commit)
        promote.verify_remote(parsed, self.run, self.artifact)
        destination = self.fixture.directory / 'extracted'
        promote.safe_extract(self.archive, destination)
        actual = promote.verify_candidate(destination, self.approval, self.source_bytes, self.tree)
        self.assertEqual(actual['manifestSha256'], self.approval['manifestSha256'])
        with patch.object(promote.publisher, 'publish') as publish:
            first = promote.promote(self.directory, self.approval, self.source_bytes, self.tree, True)
            second = promote.promote(self.directory, self.approval, self.source_bytes, self.tree, False)
        self.assertEqual(first['status'], 'PREFLIGHT_PASS')
        self.assertEqual(second['status'], 'PUBLISHED')
        self.assertEqual([call.kwargs for call in publish.call_args_list], [
            {'check_only': True, 'windows_only': True}, {'check_only': False, 'windows_only': True}])
        self.assertTrue(all(call.args == (self.release, '1.0.0') for call in publish.call_args_list))

    def test_no_preflight_or_failed_preflight_cannot_publish(self):
        with patch.object(promote.publisher, 'publish') as publish:
            with self.assertRaisesRegex(ValueError, 'JSON evidence'):
                promote.promote(self.directory, self.approval, self.source_bytes, self.tree, False)
            publish.assert_not_called()
            publish.side_effect = ValueError('Remote immutable object conflict')
            with self.assertRaisesRegex(ValueError, 'immutable'):
                promote.promote(self.directory, self.approval, self.source_bytes, self.tree, True)
        self.assertFalse((self.directory / 'PREFLIGHT.json').exists())
        self.assertFalse((self.directory / 'PUBLISHED.json').exists())

    def test_approval_must_bind_dedicated_tag_commit_and_all_exact_fields(self):
        for tag, commit in (('v1.0.0', self.commit), ('v1.0.0-windows.987', self.commit),
                            ('v1.0.0-windows.123456', 'f' * 40)):
            with self.subTest(tag=tag, commit=commit), self.assertRaisesRegex(ValueError, 'tag or checkout'):
                promote.parse_approval(json.dumps(self.approval), tag, commit)
        for field, value in (('artifactDigest', 'wrong'), ('sourceConfigSha256', 'bad'), ('runAttempt', '0')):
            approval = {**self.approval, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                promote.parse_approval(json.dumps(approval), 'v1.0.0-windows.123456', self.commit)
        with self.assertRaisesRegex(ValueError, 'seven'):
            promote.parse_approval(json.dumps({**self.approval, 'unreviewed': True}), 'v1.0.0-windows.123456', self.commit)

    def test_wrong_workflow_attempt_commit_or_artifact_is_rejected(self):
        mutations = [
            ('run', 'status', 'in_progress'), ('run', 'conclusion', 'failure'), ('run', 'run_attempt', 1),
            ('run', 'head_sha', 'f' * 40), ('run', 'path', '.github/workflows/desktop-release.yml'),
            ('run', 'head_repository', {'full_name': 'other/fork'}), ('artifact', 'id', 999),
            ('artifact', 'expired', True), ('artifact', 'digest', 'sha256:' + 'f' * 64),
            ('artifact', 'workflow_run', {'id': 123456, 'head_sha': 'f' * 40}),
        ]
        for owner, field, value in mutations:
            run, artifact = copy.deepcopy(self.run), copy.deepcopy(self.artifact)
            (run if owner == 'run' else artifact)[field] = value
            with self.subTest(owner=owner, field=field), self.assertRaisesRegex(ValueError, 'mismatch'):
                promote.verify_remote(self.approval, run, artifact)

    def test_zip_escape_symlink_duplicate_and_unlisted_file_are_rejected(self):
        link = zipfile.ZipInfo('release/link')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        extras = ('../outside', '/absolute', 'release\\escape', 'release/other.exe', link, 'evidence/CANDIDATE.json')
        for index, extra in enumerate(extras):
            archive = self.fixture.directory / f'bad-{index}.zip'
            self.zip_candidate(archive, extra)
            destination = self.fixture.directory / f'bad-extraction-{index}'
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                promote.safe_extract(archive, destination)
            self.assertFalse(destination.exists())

    def test_download_drops_bearer_token_at_storage_and_checks_zip_digest(self):
        content = self.archive.read_bytes()
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError('https://api.github.com', 302, 'Found',
                                                        {'Location': 'https://storage.example.invalid/candidate.zip'}, io.BytesIO(b''))
        destination = self.fixture.directory / 'download.zip'
        with patch.dict(os.environ, {'GH_TOKEN': 'fixture-token'}), patch.object(promote.urllib.request, 'build_opener', return_value=opener), \
                patch.object(promote.urllib.request, 'urlopen', return_value=io.BytesIO(content)) as storage:
            promote.download_artifact(destination, self.approval, self.artifact)
        self.assertEqual(opener.open.call_args.args[0].get_header('Authorization'), 'Bearer fixture-token')
        storage.assert_called_once_with('https://storage.example.invalid/candidate.zip', timeout=120)
        self.assertEqual(destination.read_bytes(), content)
        wrong = {**self.approval, 'artifactDigest': 'sha256:' + 'f' * 64}
        opener.open.side_effect = None
        opener.open.return_value = io.BytesIO(content)
        with patch.dict(os.environ, {'GH_TOKEN': 'fixture-token'}), patch.object(promote.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'approved SHA256'):
                promote.download_artifact(self.fixture.directory / 'wrong.zip', wrong, self.artifact)

    def test_source_manifest_or_candidate_commit_mismatch_is_rejected(self):
        for field in ('sourceConfigSha256', 'manifestSha256'):
            original = self.approval[field]
            self.approval[field] = 'f' * 64
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify()
            self.approval[field] = original
        self.candidate_report['harnessCommit'] = 'f' * 40
        self.rebind_report()
        with self.assertRaisesRegex(ValueError, 'Candidate report'):
            self.verify()

    def test_changed_exe_fails_before_any_publisher_write(self):
        (self.release / promote.sources.INSTALLER).write_bytes(b'substituted installer')
        with patch.object(promote.publisher, 'publish') as publish:
            with self.assertRaisesRegex(ValueError, 'Candidate file differs'):
                promote.promote(self.directory, self.approval, self.source_bytes, self.tree, True)
            publish.assert_not_called()

    def test_media_failure_and_wrong_electron_are_rejected_even_with_rehashed_reports(self):
        for field, value in (('ok', False), ('sourceSha256', 'f' * 64), ('exportStatus', 500)):
            changed = {**self.media_result, field: value}
            self.write_json(self.evidence / 'media/RESULT.json', changed)
            self.rebind_report()
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'media export'):
                self.verify()
        changed = copy.deepcopy(self.media_result)
        changed['commands'][-1]['executable'] = 'C:/unrelated/node.exe'
        self.write_json(self.evidence / 'media/RESULT.json', changed)
        self.rebind_report()
        with self.assertRaisesRegex(ValueError, 'packaged Electron'):
            self.verify()

    def test_installed_executable_identity_cannot_be_substituted(self):
        path = self.evidence / 'UNSIGNED-IDENTITIES.json'
        rows = promote.read_json(path)
        rows[1]['sha256'] = 'f' * 64
        self.write_json(path, rows)
        self.rebind_report()
        with self.assertRaisesRegex(ValueError, 'Installed application'):
            self.verify()

    def test_workflow_only_promotes_tag_candidates_after_readonly_preflight(self):
        path = Path(__file__).parent.parent / '.github/workflows/desktop-windows-publish.yml'
        text = path.read_text()
        workflow = yaml.safe_load(text)
        self.assertEqual(workflow[True], {'push': {'tags': ['v1.0.0-windows.*']}})
        self.assertEqual(workflow['permissions'], {'contents': 'read', 'actions': 'read'})
        job = workflow['jobs']['publish']
        self.assertEqual(job['environment'], 'macos-release')
        self.assertEqual(job['env'], {'MANTUR_WINDOWS_RELEASE_APPROVAL': '${{ vars.MANTUR_WINDOWS_RELEASE_APPROVAL }}'})
        commands = [step['run'] for step in job['steps'] if 'run' in step]
        self.assertTrue(commands[1].endswith('--prepare'))
        self.assertTrue(commands[2].endswith('--check-only'))
        self.assertTrue(commands[3].endswith('--publish'))
        for forbidden in ('gh release', 'git tag', 'contents: write', 'pnpm', 'CSC_', 'MANTUR_CUT_DISTRIBUTION_APPROVAL'):
            self.assertNotIn(forbidden, text)


if __name__ == '__main__':
    unittest.main()
