#!/usr/bin/env python3
"""Build pinned FFmpeg media tools without ambient credentials or package managers."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import time

LOCK = Path(__file__).with_suffix('.lock.json')
NOTICE = """Mantur media candidate: FFmpeg 6.1.6 CLI and FFmpeg 7.1.5 compositor libraries for darwin-arm64.

FFmpeg is Copyright (c) the FFmpeg developers. bin/ffmpeg, bin/ffprobe and lib/
use GPL version 2 or later, including libx264. compositor/*.dylib use LGPL
version 2.1 or later, with GPL code and libx264 disabled. compositor/ffmpeg and
compositor/ffprobe are copies of the GPL CLI and load lib/, not compositor/*.dylib. This candidate contains no FDK AAC library and
--enable-nonfree is not enabled. This statement describes this candidate only;
it does not classify separately supplied Remotion binaries or their AAC fork.

Included static libraries: x264 (GPL-2.0-or-later), libvpx (BSD-3-Clause),
Opus (BSD-3-Clause and its included patent grant), LAME (LGPL-2.0-or-later),
FreeType (GPL-2.0-or-later for the GPL CLI set; FreeType License for the LGPL
compositor library set),
HarfBuzz (Old MIT), libaom (BSD-2-Clause and its included patent grant),
and zimg (WTFPL-2.0). Preserve the complete notices in licenses/.
Portions of this software are copyright (c) 2024 The FreeType Project
(www.freetype.org). All rights reserved.

This software is based in part on the work of the Independent JPEG Group.
The upstream FFmpeg IJG-derived files are unmodified. No upstream source patches
are applied by this recipe. Generated configure and build files are not patches.

The complete pinned source archives and build recipe accompany the release as
a separate corresponding-source artifact. Distributors must distribute that
artifact and the applicable license texts with the exact binaries; a URL list
alone is not the corresponding source. Do not strip these notices. Apple system
libraries and frameworks are supplied by macOS and are not copied into this
candidate. The macOS SDK/compiler version is recorded in build evidence.
"""


def sha256(path):
    """Return the SHA256 digest of a file without loading it into memory."""
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_archive(path, expected):
    """Reject an archive that does not match its pinned digest."""
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f'SHA256 mismatch for {path}: expected {expected}, got {actual}')


def extract_archive(path, destination):
    """Extract a pinned tar archive while rejecting paths outside the destination."""
    root = Path(destination).resolve()
    with tarfile.open(path) as archive:
        for item in archive.getmembers():
            target = (root / item.name).resolve()
            if target != root and root not in target.parents:
                raise ValueError(f'Unsafe archive path: {item.name}')
            if item.issym() or item.islnk():
                base = target.parent if item.issym() else root
                linked = (base / item.linkname).resolve()
                if linked != root and root not in linked.parents:
                    raise ValueError(f'Unsafe archive link: {item.name}')
            if item.isdev():
                raise ValueError(f'Unsupported device in archive: {item.name}')
        archive.extractall(root)


def build_environment(work, prefix, tool_bin, sdk):
    """Return a whitelist environment; no caller credentials or compiler flags survive."""
    flags = '-O2 -fPIC -mmacosx-version-min=11.0'
    return {
        'PATH': f'{tool_bin}:/usr/bin:/bin:/usr/sbin:/sbin',
        'HOME': str(work / 'home'), 'TMPDIR': str(work / 'tmp'),
        'LC_ALL': 'C', 'LANG': 'C', 'TZ': 'UTC',
        'CC': '/usr/bin/clang', 'CXX': '/usr/bin/clang++',
        'CFLAGS': flags, 'CXXFLAGS': flags,
        'LDFLAGS': '-mmacosx-version-min=11.0',
        'MACOSX_DEPLOYMENT_TARGET': '11.0', 'SDKROOT': sdk,
        'PKG_CONFIG_PATH': str(prefix / 'lib/pkgconfig'),
        'PKG_CONFIG_LIBDIR': str(prefix / 'lib/pkgconfig'),
        'SOURCE_DATE_EPOCH': '1727712000',
    }


class Build:
    """Run the fixed dependency recipe and retain command logs, including failures."""

    def __init__(self, task, work, jobs):
        self.task, self.work, self.jobs = task, work, jobs
        self.archives = task / 'sources/archives'
        self.evidence = task / 'evidence'
        self.prefix = work / 'prefix'
        self.tools = work / 'tools'
        self.records = []
        for path in (self.archives, self.evidence, self.prefix, self.tools / 'bin', work / 'home', work / 'tmp'):
            path.mkdir(parents=True, exist_ok=True)
        sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True).strip()
        self.env = build_environment(work, self.prefix, self.tools / 'bin', sdk)
        self.recipe_sha256 = sha256(__file__)
        self.lock_bytes = LOCK.read_bytes()
        self.lock = json.loads(self.lock_bytes)
        self.specs = self.lock['sources']
        self.source_inventory = {}
        self.sources = {}

    def run(self, label, command, cwd=None):
        """Run a shell-free command and durably record its exit code and complete output."""
        logfile = self.evidence / f'build-{label}-{time.time_ns()}.log'
        started = time.time()
        with logfile.open('wb') as output:
            result = subprocess.run([str(x) for x in command], cwd=cwd or self.work,
                                    env={**self.env, 'PWD': str(cwd or self.work)}, stdout=output, stderr=subprocess.STDOUT)
        record = {'label': label, 'argv': [str(x) for x in command], 'cwd': str(cwd or self.work),
                  'log': str(logfile), 'exitCode': result.returncode, 'seconds': round(time.time() - started, 3)}
        self.records.append(record)
        with (self.evidence / 'build-commands.jsonl').open('a') as stream:
            stream.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)
        if result.returncode:
            raise RuntimeError(f'{label} failed; see {logfile}')

    def prepare(self):
        """Fetch and verify every archive, then extract sources and the pinned CMake tool."""
        for spec in self.specs:
            archive = self.archives / spec['archive']
            if not archive.exists():
                partial = archive.with_suffix(archive.suffix + '.part')
                self.run('download-' + spec['name'], ['/usr/bin/curl', '--disable', '--fail', '--location',
                         '--retry', '2', '--max-time', '180', spec['url'], '--output', partial])
                verify_archive(partial, spec['sha256'])
                partial.rename(archive)
            verify_archive(archive, spec['sha256'])
            source = self.work / spec['directory']
            if not source.exists():
                extract_archive(archive, self.work)
            self.sources[spec['name']] = source
            self.source_inventory[spec['name']] = {'archiveSha256': spec['sha256'], 'directory': str(source)}
        cmake = self.sources['cmake'] / 'CMake.app/Contents/bin/cmake'
        target = self.tools / 'bin/cmake'
        if not target.exists():
            target.symlink_to(cmake)
        (self.evidence / 'build-environment.json').write_text(json.dumps(self.env, indent=2) + '\n')
        self.run('toolchain', ['/usr/bin/clang', '--version'])
        self.run('system', ['/usr/bin/sw_vers'])
        self.run('sdk', ['/usr/bin/xcrun', '--show-sdk-version'])
        self.run('make-version', ['/usr/bin/make', '--version'])
        (self.evidence / 'build-source-inputs.json').write_text(json.dumps(self.source_inventory, indent=2) + '\n')

    def autotools(self, name, args, target=None):
        """Build one pinned configure-based dependency into the isolated prefix."""
        destination = target or self.prefix
        source = self.sources[name]
        self.run(name + '-configure', ['./configure', f'--prefix={destination}', *args], source)
        self.run(name + '-make', ['/usr/bin/make', f'-j{self.jobs}'], source)
        self.run(name + '-install', ['/usr/bin/make', 'install'], source)

    def cmake(self, name, args):
        """Build one pinned CMake dependency as a static position-independent library."""
        build = self.work / (name + '-cmake')
        self.run(name + '-configure', ['cmake', '-S', self.sources[name], '-B', build,
                 '-DCMAKE_BUILD_TYPE=Release', f'-DCMAKE_INSTALL_PREFIX={self.prefix}', f'-DCMAKE_PREFIX_PATH={self.prefix}',
                 '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0', '-DCMAKE_OSX_ARCHITECTURES=arm64',
                 '-DCMAKE_POSITION_INDEPENDENT_CODE=ON', '-DBUILD_SHARED_LIBS=OFF', *args])
        self.run(name + '-make', ['cmake', '--build', build, '--parallel', str(self.jobs)])
        self.run(name + '-install', ['cmake', '--install', build])

    def dependencies(self):
        """Compile the audited library set; autodetected third-party dependencies stay disabled."""
        self.autotools('pkgconf', ['--disable-shared', '--enable-static'], self.tools)
        pkg_config = self.tools / 'bin/pkg-config'
        if not pkg_config.exists():
            pkg_config.symlink_to('pkgconf')
        self.autotools('x264', ['--enable-static', '--enable-pic', '--disable-cli', '--disable-opencl'])
        self.autotools('vpx', ['--target=arm64-darwin20-gcc', '--enable-pic', '--disable-shared',
                             '--enable-static', '--disable-examples', '--disable-tools',
                             '--disable-unit-tests', '--disable-docs'])
        self.autotools('opus', ['--disable-shared', '--enable-static', '--disable-doc', '--disable-extra-programs'])
        self.autotools('lame', ['--disable-shared', '--enable-static', '--disable-frontend'])
        self.autotools('freetype', ['--disable-shared', '--enable-static', '--with-zlib=no',
                                  '--with-bzip2=no', '--with-png=no', '--with-harfbuzz=no', '--with-brotli=no'])
        self.cmake('harfbuzz', ['-DHB_BUILD_UTILS=OFF', '-DHB_BUILD_TESTS=OFF', '-DHB_BUILD_SUBSET=OFF',
                              '-DHB_HAVE_FREETYPE=ON', '-DHB_HAVE_GLIB=OFF', '-DHB_HAVE_ICU=OFF',
                              '-DHB_HAVE_CAIRO=OFF', '-DHB_HAVE_CORETEXT=OFF'])
        self.autotools('m4', [], self.tools)
        self.autotools('autoconf', [], self.tools)
        self.autotools('automake', [], self.tools)
        self.autotools('libtool', ['--disable-shared', '--enable-static'], self.tools)
        self.run('zimg-autogen', ['./autogen.sh'], self.sources['zimg'])
        self.autotools('zimg', ['--disable-shared', '--enable-static', '--disable-test-apps'])
        self.cmake('aom', ['-DENABLE_TESTS=OFF', '-DENABLE_EXAMPLES=OFF', '-DENABLE_TOOLS=OFF',
                          '-DENABLE_DOCS=OFF', '-DCONFIG_AV1_ENCODER=0'])

    def ffmpeg(self, compositor=False):
        """Compile the GPL CLI set or the separate LGPL libraries for Remotion's 7.1 ABI."""
        name = 'ffmpegCompositor' if compositor else 'ffmpeg'
        destination = self.work / 'compositor-prefix' if compositor else self.prefix
        flags = self.lock['compositorConfigure' if compositor else 'ffmpegConfigure']
        args = ['--arch=arm64', '--cc=/usr/bin/clang', '--cxx=/usr/bin/clang++',
                f'--extra-cflags=-I{self.prefix}/include -mmacosx-version-min=11.0',
                f'--extra-ldflags=-L{self.prefix}/lib -mmacosx-version-min=11.0', *flags]
        self.autotools(name, args, destination)
        source = self.sources[name]
        for filename in ['config.h', 'config_components.h', 'ffbuild/config.mak', 'ffbuild/config.log']:
            shutil.copy2(source / filename, self.evidence / ('build-' + name + '-' + filename.replace('/', '-')))

    def copy_libraries(self, prefix, destination, versioned=False):
        """Copy actual FFmpeg dylibs and map all installed version aliases to their output names."""
        dylibs = sorted((prefix / 'lib').glob('libav*.dylib')) + sorted((prefix / 'lib').glob('libsw*.dylib'))
        aliases = {}
        for path in dylibs:
            base = path.name.split('.')[0]
            major = '.' + path.resolve().name.split('.')[1] if versioned else ''
            short = base + major + '.dylib'
            aliases[path.name] = short
            if not path.is_symlink():
                shutil.copy2(path, destination / short)
        if len(set(aliases.values())) != 7:
            raise ValueError(f'Expected seven FFmpeg dylibs in {prefix}')
        return aliases

    def relocate(self, binaries, aliases):
        """Reject unresolved non-system dylibs and apply loader-relative install names."""
        for binary in binaries:
            listing = subprocess.check_output(['/usr/bin/otool', '-L', binary], text=True, env=self.env)
            for line in listing.splitlines()[1:]:
                dep = line.strip().split(' (', 1)[0]
                short = aliases.get(Path(dep).name)
                if short:
                    relative = '' if binary.suffix == '.dylib' else '../lib/'
                    replacement = '@loader_path/' + relative + short
                    self.run('relocate-' + binary.name, ['/usr/bin/install_name_tool', '-change', dep, replacement, binary])
                elif not dep.startswith(('/usr/lib/', '/System/Library/')):
                    raise ValueError(f'Unexpected non-system dependency in {binary}: {dep}')
            if binary.suffix == '.dylib':
                self.run('identity-' + binary.name, ['/usr/bin/install_name_tool', '-id', '@loader_path/' + binary.name, binary])
            self.run('adhoc-sign-' + binary.name, ['/usr/bin/codesign', '--force', '--sign', '-', binary])

    def package(self):
        """Copy the candidate with loader-relative dylibs and record complete artifact hashes."""
        if sha256(__file__) != self.recipe_sha256 or LOCK.read_bytes() != self.lock_bytes:
            raise ValueError('Build recipe or source lock changed during this run')
        target = self.task / 'artifacts/candidate'
        if target.exists():
            raise ValueError(f'Candidate already exists: {target}; choose a fresh task directory')
        for path in (target / 'bin', target / 'lib', target / 'compositor', target / 'licenses'):
            path.mkdir(parents=True)
        for name in ['ffmpeg', 'ffprobe']:
            shutil.copy2(self.prefix / 'bin' / name, target / 'bin' / name)
        cli_aliases = self.copy_libraries(self.prefix, target / 'lib', versioned=True)
        self.relocate(sorted((target / 'bin').iterdir()) + sorted((target / 'lib').iterdir()), cli_aliases)
        compositor_aliases = self.copy_libraries(self.work / 'compositor-prefix', target / 'compositor')
        self.relocate(sorted((target / 'compositor').iterdir()), compositor_aliases)
        for name in ['ffmpeg', 'ffprobe']:
            shutil.copy2(target / 'bin' / name, target / 'compositor' / name)
        for name, source in self.sources.items():
            if name in ['cmake', 'pkgconf', 'autoconf', 'automake', 'libtool', 'm4']:
                continue
            license_dir = target / 'licenses' / name
            license_dir.mkdir()
            for path in source.rglob('*'):
                relative = path.relative_to(source)
                notice = path.name.upper().startswith(('COPYING', 'LICENSE', 'PATENTS', 'NOTICE', 'AUTHORS', 'README'))
                freetype_exception = name == 'freetype' and relative.as_posix() in {
                    'src/base/fthash.c', 'include/freetype/internal/fthash.h',
                }
                if path.is_file() and (notice or freetype_exception or path.name in ['FTL.TXT', 'GPLv2.TXT']):
                    destination = license_dir / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, destination)
        (target / 'SOURCE-LOCK.json').write_bytes(self.lock_bytes)
        shutil.copy2(Path(__file__).with_name('mantur-media-build.README.md'), target / 'BUILD-README.md')
        (target / 'NOTICE.txt').write_text(NOTICE)
        inventory = {str(path.relative_to(target)): sha256(path) for path in sorted(target.rglob('*')) if path.is_file()}
        (self.evidence / 'build-candidate-sha256.json').write_text(json.dumps(inventory, indent=2) + '\n')


def main():
    """Build from fresh sources; reuse only archives verified against the checked-in lock."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task', required=True, type=Path)
    parser.add_argument('--jobs', type=int, default=8)
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        parser.error('This recipe requires native darwin-arm64')
    if args.jobs < 1 or args.jobs > 32:
        parser.error('--jobs must be between 1 and 32')
    task = args.task.resolve()
    if (task / 'artifacts/candidate').exists():
        parser.error('artifacts/candidate already exists; choose a fresh task directory')
    real_work = task / 'sources' / ('build-' + str(time.time_ns()))
    real_work.mkdir(parents=True, exist_ok=False)
    parent = Path(tempfile.mkdtemp(prefix='mantur-media-'))
    alias = parent / 'work'
    alias.symlink_to(real_work, target_is_directory=True)
    evidence = task / 'evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    metadata = {
        'work': str(real_work), 'alias': str(alias), 'freshSources': True,
        'recipeSha256': sha256(__file__), 'lockSha256': sha256(LOCK),
        'python': platform.python_version(), 'platform': platform.platform(),
        'jobs': args.jobs, 'status': 'running',
    }
    record = evidence / ('build-run-' + str(time.time_ns()) + '.json')
    record.write_text(json.dumps(metadata, indent=2) + '\n')
    build = Build(task, alias, args.jobs)
    try:
        build.prepare()
        build.dependencies()
        build.ffmpeg()
        build.ffmpeg(compositor=True)
        build.package()
    except Exception:
        metadata['status'] = 'failed'
        raise
    else:
        metadata['status'] = 'complete'
    finally:
        record.write_text(json.dumps(metadata, indent=2) + '\n')


if __name__ == '__main__':
    main()
