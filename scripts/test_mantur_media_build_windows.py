"""Check Windows build isolation and rejection paths without compiling third-party code."""

import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('windows_media', Path(__file__).with_name('mantur-media-build-windows.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class WindowsMediaBuildTests(unittest.TestCase):
    """Keep candidate inputs and imported DLLs within their declared owners."""

    def test_build_environment_excludes_credentials_and_caller_library_paths(self):
        with patch.dict(os.environ, {'CSC_LINK': 'secret', 'GITHUB_TOKEN': 'secret',
                                     'PATH': '/unreviewed', 'CFLAGS': '-include injected.h',
                                     'PKG_CONFIG_PATH': '/unreviewed', 'SYSTEMROOT': 'C:\\Windows'}, clear=True):
            env = media.build_environment(Path('/work'), Path('/prefix'))
        self.assertNotIn('CSC_LINK', env)
        self.assertNotIn('GITHUB_TOKEN', env)
        self.assertEqual(env['PATH'], '/ucrt64/bin:/usr/bin')
        self.assertEqual(env['CFLAGS'], '-O2')
        self.assertEqual(env['PKG_CONFIG_LIBDIR'], '/prefix/lib/pkgconfig')
        self.assertEqual(env['SYSTEMROOT'], 'C:\\Windows')

    def test_pe_imports_reject_other_architectures_paths_and_unbundled_dlls(self):
        body = 'file format pei-x86-64\nDLL Name: avutil-59.dll\nDLL Name: KERNEL32.dll\nDLL Name: api-ms-win-crt-runtime-l1-1-0.dll\n'
        self.assertEqual(len(media.verify_pe_dependencies('compositor/remotion.exe', body,
                         {'avutil-59.dll'}, {'kernel32.dll'})), 3)
        for changed in (body.replace('pei-x86-64', 'pei-i386'),
                        body.replace('avutil-59.dll', 'unbundled.dll'),
                        body.replace('avutil-59.dll', '../avutil-59.dll')):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                media.verify_pe_dependencies('compositor/remotion.exe', changed, {'avutil-59.dll'}, {'kernel32.dll'})
        with self.assertRaisesRegex(ValueError, 'import table'):
            media.verify_pe_dependencies('empty.exe', 'file format pei-x86-64', set(), set())

    def test_windows_zlib_static_archive_satisfies_the_lz_lookup_without_a_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            build = media.Build(Path(directory), 1)
            libraries = build.prefix / 'lib'
            libraries.mkdir()
            archive = libraries / 'libzs.a'
            archive.write_bytes(b'compiled pinned zlib static archive')
            build.sources['bzip2'] = build.work
            # Stop at the next dependency; only zlib's installed-archive adaptation runs.
            with patch.object(build, 'cmake'), patch.object(build, 'run', side_effect=InterruptedError):
                with self.assertRaises(InterruptedError):
                    build.dependencies()
                self.assertEqual((libraries / 'libz.a').read_bytes(), archive.read_bytes())
                archive.unlink()
                with self.assertRaises(FileNotFoundError):
                    build.dependencies()

    def test_package_excludes_upstream_dlls_and_preserves_static_cli_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            build = media.Build(Path(directory), 1)
            (build.prefix / 'bin').mkdir()
            for name in ('ffmpeg.exe', 'ffprobe.exe'):
                (build.prefix / 'bin' / name).write_bytes(b'new static CLI')
            libraries = build.work / 'compositor-prefix/bin'
            libraries.mkdir(parents=True)
            for name in ('avcodec-61.dll', 'avdevice-61.dll', 'avfilter-10.dll', 'avformat-61.dll',
                         'avutil-59.dll', 'swresample-5.dll', 'swscale-8.dll'):
                (libraries / name).write_bytes(b'new LGPL DLL')
            build.remotion_archive = build.work / 'npm.tar.gz'
            with tarfile.open(build.remotion_archive, 'w:gz') as archive:
                for name in (*build.lock['remotion']['retainedFiles'], 'avcodec-61.dll', 'ffmpeg.exe', 'msvcr100.dll'):
                    value = b'upstream input'
                    member = tarfile.TarInfo('package/' + name)
                    member.size = len(value)
                    archive.addfile(member, io.BytesIO(value))
            build.package()
            self.assertEqual((build.candidate / 'compositor/avcodec-61.dll').read_bytes(), b'new LGPL DLL')
            self.assertEqual((build.candidate / 'compositor/ffmpeg.exe').read_bytes(), b'new static CLI')
            self.assertFalse((build.candidate / 'compositor/msvcr100.dll').exists())
            self.assertEqual((build.candidate / 'compositor/remotion.exe').read_bytes(), b'upstream input')
            self.assertEqual(json.loads((build.candidate / 'SOURCE-LOCK.json').read_text())['target'], 'win32-x64')


if __name__ == '__main__':
    unittest.main()
