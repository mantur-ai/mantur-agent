#!/usr/bin/env python3
"""Build Windows media from pinned sources in the native MSYS2 UCRT64 environment."""

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time

LOCK = Path(__file__).with_suffix('.lock.json')
HELPER = Path(__file__).with_name('mantur-media-build.py')
spec = importlib.util.spec_from_file_location('media_source_helpers', HELPER)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
sha256 = helpers.sha256

NOTICE = """Mantur Windows media: FFmpeg 6.1.6 GPL CLI and independent FFmpeg 7.1.5 LGPL libraries.

The static bin/ffmpeg.exe and bin/ffprobe.exe use GPL-2.0-or-later, including
libx264. Their identical compositor/ copies do not load the adjacent LGPL
FFmpeg DLLs. compositor/av*.dll and compositor/sw*.dll use LGPL-2.1-or-later
with GPL, version3, libx264, FDK AAC and nonfree code disabled. Their seven
FFmpeg ABI versions are 61/61/10/61/59/5/8. No original npm FFmpeg executable
or DLL is retained. Remotion's separately licensed remotion.exe and package
wrappers are the only retained files from its exact npm compositor archive.

Compiled dependencies: x264 (GPL-2.0-or-later, CLI only), libvpx (BSD-3-Clause),
Opus (BSD-3-Clause and patent grant), LAME (LGPL-2.0-or-later), FreeType
(GPL-2.0-or-later for the CLI; FreeType License for the LGPL DLLs), HarfBuzz
(Old MIT), libaom (BSD-2-Clause and patent grant), zimg (WTFPL-2.0),
zlib (Zlib) and bzip2 (bzip2-1.0.6 license). Preserve the notices in licenses/.
Portions of this software are copyright (c) 2024 The FreeType Project
(www.freetype.org). All rights reserved.
This software is based in part on the work of the Independent JPEG Group.

Windows system libraries are supplied by Windows 10 or later and are not
copied. GCC runtime linkage uses the GCC Runtime Library Exception; the
exact toolchain packages and compiler version are recorded in build evidence.
The complete compiled-library source archives, original recipe and lock,
configuration outputs and build evidence accompany the Windows candidate.
The source offer does not reclassify Remotion's separate license terms.
"""


def runtime_identity():
    """Record the interpreter and kernel identifiers without including the caller's environment."""
    uname = os.uname() if hasattr(os, 'uname') else None
    return {'sysPlatform': sys.platform, 'osName': os.name, 'system': platform.system(),
            'machine': platform.machine(), 'msystem': os.environ.get('MSYSTEM'),
            'executable': sys.executable,
            'uname': None if uname is None else {'sysname': uname.sysname, 'machine': uname.machine}}


def verify_runtime(identity):
    """Require MSYS2's POSIX Python in a native Windows x64 UCRT64 shell."""
    # UCRT64 shells also report MINGW64_NT-* on the installed MSYS2 runtime.
    if (identity['sysPlatform'] != 'cygwin' or identity['osName'] != 'posix'
            or identity['msystem'] != 'UCRT64'
            or not identity['system'].startswith(('UCRT64_NT-', 'MINGW64_NT-'))
            or identity['machine'] != 'x86_64' or identity['uname'] is None
            or identity['uname']['sysname'] != identity['system']
            or identity['uname']['machine'] != 'x86_64'):
        raise ValueError('Run with /usr/bin/python3 in native Windows MSYS2 UCRT64')


def verify_compiler(path, target):
    """Require the resolved UCRT64 compiler directory and native Windows x64 target."""
    if path.parent != Path('/ucrt64/bin') or target.strip() != 'x86_64-w64-mingw32':
        raise ValueError('Media compiler must come from /ucrt64/bin and target x86_64-w64-mingw32')


def build_environment(work, prefix):
    """Allow only the UCRT toolchain and private build directories into compiler processes."""
    env = {
        'PATH': '/ucrt64/bin:/usr/bin', 'MSYSTEM': 'UCRT64', 'MINGW_PREFIX': '/ucrt64',
        'HOME': str(work / 'home'), 'TMPDIR': str(work / 'tmp'),
        'LC_ALL': 'C', 'LANG': 'C', 'TZ': 'UTC', 'SOURCE_DATE_EPOCH': '1727712000',
        'CC': 'gcc', 'CXX': 'g++', 'AR': 'ar', 'RANLIB': 'ranlib',
        'CFLAGS': '-O2', 'CXXFLAGS': '-O2',
        'LDFLAGS': '-static-libgcc -static-libstdc++',
        'PKG_CONFIG_PATH': str(prefix / 'lib/pkgconfig'),
        'PKG_CONFIG_LIBDIR': str(prefix / 'lib/pkgconfig'),
    }
    for name in ('SYSTEMROOT', 'SystemRoot', 'WINDIR'):
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def dll_dependencies(output):
    """Read the PE import names emitted by GNU objdump without accepting paths."""
    names = re.findall(r'^\s*DLL Name:\s*(\S+)\s*$', output, re.MULTILINE)
    if not names or any('/' in name or '\\' in name or not name.lower().endswith('.dll') for name in names):
        raise ValueError('Missing or invalid PE import table')
    return names


def verify_pe_dependencies(binary, output, siblings, system_dlls):
    """Allow only a binary's sibling DLLs or an actual Windows system DLL/API set."""
    if 'file format pei-x86-64' not in output:
        raise ValueError('Windows media must be PE x64: ' + binary)
    dependencies = dll_dependencies(output)
    for name in dependencies:
        lower = name.lower()
        api_set = re.fullmatch(r'(?:api|ext)-ms-win-[a-z0-9-]+\.dll', lower)
        if lower not in siblings and lower not in system_dlls and not api_set:
            raise ValueError(f'Unresolved Windows media dependency in {binary}: {name}')
    return dependencies


class Build:
    """Own one fresh native Windows media build and retain every command result."""

    def __init__(self, task, jobs):
        self.task, self.jobs = task, jobs
        self.work = task / 'sources' / ('build-' + str(time.time_ns()))
        self.prefix = self.work / 'prefix'
        self.archives = task / 'sources/archives'
        self.evidence = task / 'evidence'
        self.artifacts = task / 'artifacts'
        self.candidate = self.artifacts / 'candidate'
        self.sources = {}
        self.lock_bytes = LOCK.read_bytes()
        self.lock = json.loads(self.lock_bytes)
        self.recipe_hashes = {path.name: sha256(path) for path in (Path(__file__), HELPER, LOCK)}
        for path in (self.work / 'home', self.work / 'tmp', self.prefix, self.archives, self.evidence, self.artifacts):
            path.mkdir(parents=True, exist_ok=True)
        self.env = build_environment(self.work, self.prefix)

    def run(self, label, command, cwd=None, env=None):
        """Run fixed argv and preserve a bounded command's complete output and exit status."""
        logfile = self.evidence / f'{label}-{time.time_ns()}.log'
        started = time.monotonic()
        with logfile.open('wb') as stream:
            result = subprocess.run([str(arg) for arg in command], cwd=cwd or self.work,
                                    env=env or self.env, stdout=stream, stderr=subprocess.STDOUT)
        record = {'label': label, 'argv': [str(arg) for arg in command], 'cwd': str(cwd or self.work),
                  'log': str(logfile), 'exitCode': result.returncode,
                  'seconds': round(time.monotonic() - started, 3)}
        with (self.evidence / 'build-commands.jsonl').open('a') as stream:
            stream.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)
        if result.returncode:
            raise RuntimeError(f'{label} failed; see {logfile}')
        return logfile.read_text(errors='replace')

    def obtain(self, source):
        """Download a pinned archive once; reject wrong sizes or hashes before extraction."""
        path = self.archives / source['archive']
        if not path.exists():
            temporary = path.with_suffix(path.suffix + '.part')
            self.run('download-' + source['archive'], ['curl', '--disable', '--fail', '--location',
                     '--retry', '2', '--max-time', '240', source['url'], '--output', temporary])
            helpers.verify_archive(temporary, source['sha256'])
            if temporary.stat().st_size != source['bytes']:
                raise ValueError('Source archive size mismatch: ' + source['archive'])
            temporary.rename(path)
        helpers.verify_archive(path, source['sha256'])
        if path.stat().st_size != source['bytes']:
            raise ValueError('Source archive size mismatch: ' + source['archive'])
        return path

    def prepare(self):
        """Resolve only the lock's source archives and record the actual native toolchain."""
        for name in ('gcc', 'g++'):
            executable = shutil.which(name, path=self.env['PATH'])
            if executable is None:
                raise ValueError('Missing UCRT64 compiler: ' + name)
            path = Path(executable).resolve()
            target = self.run('toolchain-target-' + name, [path, '-dumpmachine'])
            verify_compiler(path, target)
        for source in self.lock['sources']:
            helpers.extract_archive(self.obtain(source), self.work)
            self.sources[source['name']] = self.work / source['directory']
        self.remotion_archive = self.obtain(self.lock['remotion'])
        digest = hashlib.sha512(self.remotion_archive.read_bytes()).digest()
        if 'sha512-' + base64.b64encode(digest).decode() != self.lock['remotion']['integrity']:
            raise ValueError('Remotion compositor npm integrity mismatch')
        (self.evidence / 'build-environment.json').write_text(json.dumps(self.env, indent=2) + '\n')
        for label, args in [('gcc', ['gcc', '--version']), ('gxx', ['g++', '--version']),
                            ('cmake', ['cmake', '--version']), ('make', ['make', '--version']),
                            ('nasm', ['nasm', '-v']), ('packages', ['pacman', '-Q'])]:
            self.run('toolchain-' + label, args)

    def autotools(self, name, flags, destination=None):
        """Build a static dependency or the selected FFmpeg set into its private prefix."""
        source = self.sources[name]
        self.run(name + '-configure', ['bash', './configure', f'--prefix={destination or self.prefix}', *flags], source)
        self.run(name + '-make', ['make', f'-j{self.jobs}'], source)
        self.run(name + '-install', ['make', 'install'], source)

    def cmake(self, name, flags):
        """Compile a static UCRT dependency without searching unrelated library prefixes."""
        output = self.work / (name + '-cmake')
        self.run(name + '-configure', ['cmake', '-S', self.sources[name], '-B', output, '-G', 'MSYS Makefiles',
                 '-DCMAKE_BUILD_TYPE=Release', f'-DCMAKE_INSTALL_PREFIX={self.prefix}',
                 f'-DCMAKE_PREFIX_PATH={self.prefix}', '-DBUILD_SHARED_LIBS=OFF',
                 '-DCMAKE_C_COMPILER=gcc', '-DCMAKE_CXX_COMPILER=g++', *flags])
        self.run(name + '-make', ['cmake', '--build', output, '--parallel', str(self.jobs)])
        self.run(name + '-install', ['cmake', '--install', output])

    def dependencies(self):
        """Compile the reviewed codec set plus Windows' separately pinned compression libraries."""
        host = '--host=x86_64-w64-mingw32'
        self.cmake('zlib', ['-DZLIB_BUILD_SHARED=OFF', '-DZLIB_BUILD_STATIC=ON', '-DZLIB_BUILD_TESTING=OFF'])
        # zlib's Windows CMake target installs libzs.a, while zlib.pc and FFmpeg request -lz.
        shutil.copy2(self.prefix / 'lib/libzs.a', self.prefix / 'lib/libz.a')
        source = self.sources['bzip2']
        self.run('bzip2-make', ['make', f'-j{self.jobs}', 'libbz2.a', 'CC=gcc', 'AR=ar', 'RANLIB=ranlib', 'CFLAGS=-O2'], source)
        for subdir in ('lib', 'include'):
            (self.prefix / subdir).mkdir(exist_ok=True)
        shutil.copy2(source / 'libbz2.a', self.prefix / 'lib/libbz2.a')
        shutil.copy2(source / 'bzlib.h', self.prefix / 'include/bzlib.h')
        self.autotools('x264', [host, '--enable-static', '--disable-cli', '--disable-opencl', '--enable-win32thread'])
        self.autotools('vpx', ['--target=x86_64-win64-gcc', '--disable-shared', '--enable-static',
                             '--disable-examples', '--disable-tools', '--disable-unit-tests', '--disable-docs'])
        self.autotools('opus', [host, '--disable-shared', '--enable-static', '--disable-doc', '--disable-extra-programs'])
        self.autotools('lame', [host, '--disable-shared', '--enable-static', '--disable-frontend'])
        self.autotools('freetype', [host, '--disable-shared', '--enable-static', '--with-zlib=no',
                                  '--with-bzip2=no', '--with-png=no', '--with-harfbuzz=no', '--with-brotli=no'])
        self.cmake('harfbuzz', ['-DHB_BUILD_UTILS=OFF', '-DHB_BUILD_TESTS=OFF', '-DHB_BUILD_SUBSET=OFF',
                              '-DHB_HAVE_FREETYPE=ON', '-DHB_HAVE_GLIB=OFF', '-DHB_HAVE_ICU=OFF',
                              '-DHB_HAVE_CAIRO=OFF', '-DHB_HAVE_CORETEXT=OFF'])
        self.run('zimg-autogen', ['bash', './autogen.sh'], self.sources['zimg'])
        self.autotools('zimg', [host, '--disable-shared', '--enable-static', '--disable-test-apps'])
        self.cmake('aom', ['-DENABLE_TESTS=OFF', '-DENABLE_EXAMPLES=OFF', '-DENABLE_TOOLS=OFF',
                          '-DENABLE_DOCS=OFF', '-DCONFIG_AV1_ENCODER=0'])

    def ffmpeg(self, compositor=False):
        """Build a static GPL CLI or independent LGPL shared libraries with separate ABI names."""
        name = 'ffmpegCompositor' if compositor else 'ffmpeg'
        prefix = self.work / 'compositor-prefix' if compositor else self.prefix
        flags = self.lock['compositorConfigure' if compositor else 'ffmpegConfigure']
        ldflags = f'-L{self.prefix}/lib -static-libgcc -static-libstdc++'
        if not compositor:
            ldflags += ' -static'
        self.autotools(name, [f'--extra-cflags=-I{self.prefix}/include', f'--extra-ldflags={ldflags}',
                            '--extra-libs=-Wl,-Bstatic -lstdc++ -lwinpthread -Wl,-Bdynamic', *flags], prefix)
        for filename in ('config.h', 'config_components.h', 'ffbuild/config.mak', 'ffbuild/config.log'):
            shutil.copy2(self.sources[name] / filename, self.evidence / (name + '-' + filename.replace('/', '-')))

    def package(self):
        """Keep only new FFmpeg binaries, selected Remotion files and the complete notices."""
        if self.candidate.exists():
            raise ValueError('Candidate already exists; use a fresh task directory')
        for child in ('bin', 'compositor', 'licenses'):
            (self.candidate / child).mkdir(parents=True)
        for name in ('ffmpeg.exe', 'ffprobe.exe'):
            for folder in ('bin', 'compositor'):
                shutil.copy2(self.prefix / 'bin' / name, self.candidate / folder / name)
        expected = {'avcodec-61.dll', 'avdevice-61.dll', 'avfilter-10.dll', 'avformat-61.dll',
                    'avutil-59.dll', 'swresample-5.dll', 'swscale-8.dll'}
        libraries = list((self.work / 'compositor-prefix/bin').glob('*.dll'))
        if {path.name for path in libraries} != expected:
            raise ValueError('Compositor FFmpeg DLL ABI set differs from Remotion imports')
        for path in libraries:
            shutil.copy2(path, self.candidate / 'compositor' / path.name)
        with tarfile.open(self.remotion_archive) as archive:
            for name in self.lock['remotion']['retainedFiles']:
                member = archive.getmember('package/' + name)
                if not member.isfile():
                    raise ValueError('Selected Remotion file is not ordinary: ' + name)
                with archive.extractfile(member) as source, (self.candidate / 'compositor' / name).open('xb') as output:
                    shutil.copyfileobj(source, output)
        for name, source in self.sources.items():
            for path in source.rglob('*'):
                rel = path.relative_to(source)
                wanted = path.name.upper().startswith(('COPYING', 'LICENSE', 'PATENTS', 'NOTICE', 'AUTHORS', 'README'))
                wanted = wanted or path.name in ('FTL.TXT', 'GPLv2.TXT') or (name == 'freetype' and rel.as_posix() in
                         ('src/base/fthash.c', 'include/freetype/internal/fthash.h'))
                if path.is_file() and wanted:
                    target = self.candidate / 'licenses' / name / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, target)
        (self.candidate / 'SOURCE-LOCK.json').write_bytes(self.lock_bytes)
        (self.candidate / 'NOTICE.txt').write_text(NOTICE)
        (self.candidate / 'REMOTION-SOURCE.json').write_text(json.dumps(self.lock['remotion'], indent=2) + '\n')

    def verify(self):
        """Probe the actual PE closure and encode/decode with no build-prefix DLL search path."""
        system_root = os.environ.get('SYSTEMROOT') or os.environ.get('SystemRoot')
        if not system_root:
            raise ValueError('Windows SystemRoot is required for native verification')
        converted = subprocess.check_output(['cygpath', '-u', system_root], text=True).strip()
        system_dlls = {path.name.lower() for path in (Path(converted) / 'System32').glob('*.dll')}
        records = []
        for path in sorted(self.candidate.rglob('*')):
            if path.suffix.lower() not in ('.exe', '.dll'):
                continue
            output = self.run('pe-' + path.name, ['objdump', '-p', path])
            siblings = {sibling.name.lower() for sibling in path.parent.glob('*.dll')}
            imports = verify_pe_dependencies(path.relative_to(self.candidate).as_posix(), output, siblings, system_dlls)
            records.append({'file': path.relative_to(self.candidate).as_posix(), 'imports': imports, 'sha256': sha256(path)})
        if len(records) != 12:
            raise ValueError('Expected two static CLI copies, two compositor CLI copies, seven DLLs and Remotion')
        (self.evidence / 'pe-inventory.json').write_text(json.dumps(records, indent=2) + '\n')
        native_env = {'PATH': converted + '/System32', 'SYSTEMROOT': system_root,
                      'TEMP': str(self.work / 'tmp'), 'TMP': str(self.work / 'tmp')}
        for folder in ('bin', 'compositor'):
            for name in ('ffmpeg', 'ffprobe'):
                executable = self.candidate / folder / (name + '.exe')
                output = self.run('version-' + folder + '-' + name, [executable, '-version'], env=native_env)
                if not output.startswith(name + ' version 6.1.6') or '--enable-gpl' not in output or '--enable-libfdk' in output or '--enable-nonfree' in output:
                    raise ValueError('Unexpected Windows FFmpeg CLI configuration')
                output = self.run('license-' + folder + '-' + name, [executable, '-L'], env=native_env)
                if 'GNU General Public License' not in output:
                    raise ValueError('Unexpected Windows FFmpeg CLI license')
        ffmpeg = self.candidate / 'bin/ffmpeg.exe'
        output = self.artifacts / 'windows-media-smoke.mp4'
        self.run('media-encode', [ffmpeg, '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=1',
                 '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264',
                 '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', output], env=native_env)
        self.run('media-decode', [ffmpeg, '-nostdin', '-v', 'error', '-i', output, '-f', 'null', '-'], env=native_env)
        self.run('media-probe', [self.candidate / 'bin/ffprobe.exe', '-v', 'error', '-show_streams', '-of', 'json', output], env=native_env)

    def archive(self):
        """Retain candidate hashes plus complete compiled sources, recipes and build evidence."""
        for path in (Path(__file__), HELPER, LOCK):
            if sha256(path) != self.recipe_hashes[path.name]:
                raise ValueError('Recipe or lock changed during build')
        inventory = {path.relative_to(self.candidate).as_posix(): sha256(path)
                     for path in sorted(self.candidate.rglob('*')) if path.is_file()}
        inventory_path = self.evidence / 'candidate-inventory.json'
        inventory_path.write_text(json.dumps(inventory, indent=2) + '\n')
        candidate_archive = self.artifacts / 'Mantur-Media-Windows-x64.tar.gz'
        with tarfile.open(candidate_archive, 'w:gz') as archive:
            archive.add(self.candidate, arcname='mantur-media-windows-x64')
        source_root = self.work / 'corresponding-source'
        (source_root / 'archives').mkdir(parents=True)
        (source_root / 'recipe').mkdir()
        sources = []
        for source in self.lock['sources']:
            shutil.copy2(self.archives / source['archive'], source_root / 'archives' / source['archive'])
            sources.append({'file': 'archives/' + source['archive'], 'sha256': source['sha256'], 'bytes': source['bytes']})
        for path in (Path(__file__), HELPER, LOCK):
            shutil.copy2(path, source_root / 'recipe' / path.name)
        shutil.copy2(inventory_path, source_root / 'CANDIDATE-SHA256.json')
        shutil.copytree(self.evidence, source_root / 'evidence')
        # Do not redistribute the excluded upstream GPL DLLs as part of a source archive.
        shutil.copytree(self.candidate / 'compositor', source_root / 'remotion-selected',
                        ignore=shutil.ignore_patterns('*.dll', 'ffmpeg.exe', 'ffprobe.exe'))
        recipe_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Path(__file__).resolve().parents[1], text=True).strip()
        index = {'recipeCommit': recipe_commit, 'archives': sources, 'remotionBinaryInput': self.lock['remotion']}
        (source_root / 'SOURCE-INDEX.json').write_text(json.dumps(index, indent=2) + '\n')
        source_files = {path.relative_to(source_root).as_posix(): sha256(path)
                        for path in sorted(source_root.rglob('*')) if path.is_file()}
        (source_root / 'FILES-SHA256.json').write_text(json.dumps(source_files, indent=2) + '\n')
        source_archive = self.artifacts / 'Mantur-Media-Windows-corresponding-source.tar.gz'
        with tarfile.open(source_archive, 'w:gz') as archive:
            archive.add(source_root, arcname='mantur-media-windows-source')
        report = {'status': 'PASS_NATIVE_MEDIA_BUILD_AND_CLI_SMOKE', 'target': 'win32-x64',
                  'recipeCommit': recipe_commit, 'recipeHashes': self.recipe_hashes,
                  'artifacts': [{'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha256(path)}
                                for path in (candidate_archive, source_archive, inventory_path)],
                  'remotionDynamicRender': 'PENDING_PACKAGED_EDITOR_SMOKE', 'signed': False}
        (self.evidence / 'BUILD-RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)


def main():
    """Run only on native Windows through MSYS2 UCRT64 and never reuse a completed candidate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task', type=Path, required=True)
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    identity = runtime_identity()
    print(json.dumps({'runtimeIdentity': identity}), flush=True)
    try:
        verify_runtime(identity)
    except ValueError as error:
        parser.error(str(error))
    if not 1 <= args.jobs <= 32:
        parser.error('--jobs must be between 1 and 32')
    task = args.task.resolve()
    if (task / 'artifacts/candidate').exists():
        parser.error('Candidate already exists; choose a fresh task directory')
    build = Build(task, args.jobs)
    (build.evidence / 'platform-identity.json').write_text(json.dumps(identity, indent=2) + '\n')
    build.prepare()
    build.dependencies()
    build.ffmpeg()
    build.ffmpeg(compositor=True)
    build.package()
    build.verify()
    build.archive()


if __name__ == '__main__':
    main()
