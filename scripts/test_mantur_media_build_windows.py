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

    def test_native_ucrt64_accepts_the_observed_mingw64_uname_with_posix_python(self):
        identity = {'sysPlatform': 'cygwin', 'osName': 'posix', 'system': 'MINGW64_NT-10.0-26100',
                    'machine': 'x86_64', 'msystem': 'UCRT64', 'executable': '/usr/bin/python3.exe',
                    'uname': {'sysname': 'MINGW64_NT-10.0-26100', 'machine': 'x86_64'}}
        media.verify_runtime(identity)
        media.verify_runtime({**identity, 'system': 'UCRT64_NT-10.0-26100',
                              'uname': {'sysname': 'UCRT64_NT-10.0-26100', 'machine': 'x86_64'}})
        for changed in ({'sysPlatform': 'win32', 'osName': 'nt'},
                        {'sysPlatform': 'linux', 'system': 'Linux'},
                        {'sysPlatform': 'darwin', 'system': 'Darwin'},
                        {'msystem': 'MINGW64', 'system': 'MINGW64_NT-10.0-26100'},
                        {'system': 'MSYS_NT-10.0-26100'}, {'machine': 'aarch64'},
                        {'uname': None}, {'uname': {'sysname': 'UCRT64_NT-10.0-26100', 'machine': 'i686'}}):
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, 'MSYS2 UCRT64'):
                media.verify_runtime({**identity, **changed})

    def test_media_compiler_requires_the_ucrt64_directory_and_x64_windows_target(self):
        media.verify_compiler(Path('/ucrt64/bin/gcc.exe'), 'x86_64-w64-mingw32\n')
        media.verify_compiler(Path('/ucrt64/bin/g++.exe'), 'x86_64-w64-mingw32\n')
        for path, target in [('/mingw64/bin/gcc.exe', 'x86_64-w64-mingw32'),
                             ('/usr/bin/gcc.exe', 'x86_64-pc-cygwin'),
                             ('/ucrt64/bin/gcc.exe', 'aarch64-w64-mingw32'),
                             ('/ucrt64/bin/gcc.exe', 'x86_64-linux-gnu')]:
            with self.subTest(path=path, target=target), self.assertRaisesRegex(ValueError, '/ucrt64/bin'):
                media.verify_compiler(Path(path), target)

    def test_runtime_diagnostic_records_only_platform_fields(self):
        identity = media.runtime_identity()
        self.assertEqual(set(identity), {'sysPlatform', 'osName', 'system', 'machine', 'msystem', 'executable', 'uname'})
        self.assertEqual(identity['sysPlatform'], media.sys.platform)
        self.assertEqual(identity['osName'], os.name)
        self.assertEqual(identity['executable'], media.sys.executable)

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
            with patch.object(build, 'autotools'), patch.object(build, 'cmake'), \
                    patch.object(build, 'run', side_effect=InterruptedError):
                with self.assertRaises(InterruptedError):
                    build.dependencies()
                self.assertEqual((libraries / 'libz.a').read_bytes(), archive.read_bytes())
                archive.unlink()
                with self.assertRaises(FileNotFoundError):
                    build.dependencies()

    def test_freetype_uses_file_preprocessing_before_the_codec_builds(self):
        with tempfile.TemporaryDirectory() as directory:
            build = media.Build(Path(directory), 4)
            source = build.work / 'freetype'
            build.sources['freetype'] = source
            with patch.object(build, 'run') as run, \
                    patch.object(build, 'cmake', side_effect=InterruptedError) as cmake:
                with self.assertRaises(InterruptedError):
                    build.dependencies()
            commands = [call.args for call in run.call_args_list]
            self.assertEqual([command[0] for command in commands],
                             ['freetype-configure', 'freetype-make', 'freetype-install'])
            self.assertEqual(commands[0], ('freetype-configure', ['bash', './configure',
                             f'--prefix={build.prefix}', '--host=x86_64-w64-mingw32',
                             'RC=windres --use-temp-file', '--disable-shared', '--enable-static',
                             '--with-zlib=no', '--with-bzip2=no', '--with-png=no',
                             '--with-harfbuzz=no', '--with-brotli=no'], source))
            self.assertEqual(commands[1], ('freetype-make', ['make', '-j4'], source))
            self.assertEqual(commands[2], ('freetype-install', ['make', 'install'], source))
            self.assertEqual(cmake.call_args.args[0], 'zlib')
            self.assertEqual(build.env['PATH'], '/ucrt64/bin:/usr/bin')
            self.assertNotIn('RC', build.env)

    def test_both_ffmpeg_builds_preserve_resources_with_file_preprocessing(self):
        with tempfile.TemporaryDirectory() as directory:
            build = media.Build(Path(directory), 4)
            for compositor, name in ((False, 'ffmpeg'), (True, 'ffmpegCompositor')):
                with self.subTest(compositor=compositor):
                    build.sources[name] = build.work / name
                    with patch.object(build, 'autotools') as compile_library, patch.object(media.shutil, 'copy2'):
                        build.ffmpeg(compositor=compositor)
                    actual_name, flags, prefix = compile_library.call_args.args
                    self.assertEqual(actual_name, name)
                    self.assertEqual(prefix, build.work / 'compositor-prefix' if compositor else build.prefix)
                    self.assertEqual([flag for flag in flags if flag.startswith('--windres=')],
                                     ['--windres=windres --use-temp-file'])
                    locked = build.lock['compositorConfigure' if compositor else 'ffmpegConfigure']
                    self.assertEqual(flags[-len(locked):], locked)

    def test_resource_probe_compiles_before_accepting_the_x64_object(self):
        with tempfile.TemporaryDirectory() as directory:
            build = media.Build(Path(directory), 4)
            with patch.object(build, 'run', side_effect=['', 'file format pe-x86-64\n']) as run:
                build.probe_resource_compiler()
            source = build.evidence / 'windres-probe.rc'
            output = build.work / 'windres-probe.o'
            self.assertIn('#define MANTUR_RESOURCE_ID', source.read_text())
            self.assertEqual([call.args for call in run.call_args_list], [
                ('toolchain-windres-probe', ['windres', '--use-temp-file', '-i', source, '-o', output, '-O', 'coff']),
                ('toolchain-windres-object', ['objdump', '-f', output]),
            ])
            with patch.object(build, 'run', side_effect=['', 'file format pe-i386\n']):
                with self.assertRaisesRegex(ValueError, 'Windows x64 COFF'):
                    build.probe_resource_compiler()
            with patch.object(build, 'run', side_effect=RuntimeError('windres failed')) as run:
                with self.assertRaisesRegex(RuntimeError, 'windres failed'):
                    build.probe_resource_compiler()
            self.assertEqual(run.call_count, 1)

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
