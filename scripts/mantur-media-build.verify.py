#!/usr/bin/env python3
"""Exercise rebuilt media tools on macOS arm64; retain commands and decoded evidence.

This checks the dedicated candidate, not an arbitrary third-party distribution's
license. Remotion rendering and final signed-package checks remain separate.
"""

import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time


def require(condition, message):
    """Fail a verification independently of Python optimization settings."""
    if not condition:
        raise RuntimeError(message)


def tone_power(pcm, second, hz):
    """Measure one frequency in a 20 ms Hann window of 48 kHz mono PCM."""
    start, count = round(second * 48000), 960
    require(start + count <= len(pcm), 'PCM ends inside frequency window')
    coefficient = 2 * math.cos(2 * math.pi * hz / 48000)
    previous = older = 0.0
    for index in range(count):
        sample = pcm[start + index] * (.5 - .5 * math.cos(2 * math.pi * index / (count - 1)))
        current = sample + coefficient * previous - older
        older, previous = previous, current
    return max(0, previous * previous + older * older - coefficient * previous * older)


def check_audio_transition(pcm):
    """Reject a shifted or swapped tone even when every edit point remains audible."""
    for second, expected, other in [(0, 440, 660), (.98, 440, 660), (1, 440, 660),
                                    (1.98, 440, 660), (2, 660, 440), (4.98, 660, 440)]:
        require(tone_power(pcm, second, expected) > tone_power(pcm, second, other) * 100,
                f'Audio tone differs at {second} seconds')


class Verification:
    """Run processes with a credential-free environment and durable observations."""

    def __init__(self, candidate, output):
        self.candidate = candidate.resolve()
        self.output = output.resolve()
        self.output.mkdir(parents=True, exist_ok=False)
        self.commands = []
        self.observations = {}
        self.env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C",
                    "HOME": str(self.output), "TMPDIR": str(self.output)}
        self.ffmpeg = self.candidate / "bin/ffmpeg"
        self.ffprobe = self.candidate / "bin/ffprobe"

    def run(self, args, expected=0, extra_env=None):
        """Save command, exit code and separate streams, including failed commands."""
        args = list(map(str, args))
        start = time.monotonic()
        timeout = None
        try:
            result = subprocess.run(args, capture_output=True,
                                    env={**self.env, **(extra_env or {})}, timeout=180)
            stdout, stderr, code = result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired as error:
            stdout, stderr, code = error.stdout or b'', error.stderr or b'', None
            timeout = error.timeout
        name = f"{len(self.commands):03d}"
        (self.output / (name + '.stdout')).write_bytes(stdout)
        (self.output / (name + '.stderr')).write_bytes(stderr)
        self.commands.append({"args": args, "exit": code, "timeoutSeconds": timeout,
                              "seconds": time.monotonic() - start, "log": name,
                              "explicitEnvironment": extra_env or {}})
        self.save()
        require(timeout is None and code == expected, f"Command {name} exited {code}, timeout={timeout}: {args}")
        return stdout

    def ff(self, args):
        """Run FFmpeg with fatal decoding errors and bounded thread use."""
        return self.run([self.ffmpeg, '-hide_banner', '-v', 'error', '-xerror',
                         '-threads', '2', '-filter_threads', '2', *args])

    def save(self, **extra):
        """Record incomplete runs as incomplete until every check succeeds."""
        (self.output / 'result.json').write_text(json.dumps({
            "ok": False, "candidate": str(self.candidate),
            "commands": self.commands, "observations": self.observations, **extra,
        }, indent=2) + '\n')

    def inspect(self):
        """Reject unexpected architecture, external dylibs and nonfree build flags."""
        inventory = []
        for file in sorted(self.candidate.rglob('*')):
            if file.is_symlink() or not file.is_file():
                continue
            kind = self.run(['/usr/bin/file', '-b', file]).decode()
            if 'Mach-O' not in kind:
                continue
            require('arm64' in kind and 'x86_64' not in kind, f"Wrong architecture: {file}")
            linked = self.run(['/usr/bin/otool', '-L', file]).decode()
            dependencies = []
            for line in linked.splitlines()[1:]:
                dependency = line.strip().split(' (compatibility')[0]
                if dependency.startswith(('/usr/lib/', '/System/Library/')):
                    pass
                elif dependency.startswith('@loader_path/'):
                    target = (file.parent / dependency[len('@loader_path/'):]).resolve()
                    require(target.is_relative_to(self.candidate) and target.is_file(),
                            f"Missing/outside candidate dependency: {dependency}")
                else:
                    raise RuntimeError(f"Unresolved/non-system dependency: {file}: {dependency}")
                dependencies.append(dependency)
            inventory.append({"path": str(file.relative_to(self.candidate)),
                              "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                              "bytes": file.stat().st_size, "dependencies": dependencies})
        require(inventory, 'No Mach-O candidate binaries found')
        for tool in [self.ffmpeg, self.ffprobe]:
            license_text = self.run([tool, '-L']).decode()
            config = self.run([tool, '-buildconf']).decode()
            require('not legally redistributable' not in license_text, 'Nonfree license output')
            require('GNU General Public License' in license_text, 'Expected dedicated GPL CLI')
            require('--disable-autodetect' in config and '--disable-nonfree' in config,
                    'Expected explicit dependency and nonfree controls')
            require(not re.search(r'--enable-(nonfree|libfdk[-_]aac|openssl|libtls|decklink)\b', config),
                    'Unexpected dependency in dedicated rebuild')
        self.observations['inventory'] = inventory

    def capabilities(self, av1_fixture):
        """Exercise codecs and filters named by the Cut call-site audit."""
        encoders = self.run([self.ffmpeg, '-hide_banner', '-encoders']).decode()
        for encoder in ['libx264', 'h264_videotoolbox', 'aac', 'pcm_s16le', 'libopus',
                        'libmp3lame', 'libvpx', 'libvpx-vp9', 'prores_ks', 'png', 'mjpeg']:
            require(re.search(r'\s' + re.escape(encoder) + r'\s', encoders), f'Missing {encoder}')
        require(not re.search(r'\slibfdk_aac\s', encoders), 'Unexpected FDK in dedicated rebuild')
        filters = self.run([self.ffmpeg, '-hide_banner', '-filters']).decode()
        for name in ['drawtext', 'scale', 'pad', 'crop', 'overlay', 'fps', 'trim', 'atrim',
                     'concat', 'atempo', 'amix', 'aresample', 'zscale', 'tonemap']:
            require(re.search(r'\s' + name + r'\s', filters), f'Missing filter {name}')
        fixture_hash = hashlib.sha256(av1_fixture.read_bytes()).hexdigest()
        probe = json.loads(self.run([self.ffprobe, '-v', 'error', '-show_streams', '-of', 'json', av1_fixture]))
        require(any(stream['codec_name'] == 'av1' for stream in probe['streams']), 'Fixture is not AV1')
        compositor = self.candidate / 'compositor'
        require(compositor.is_dir(), 'Missing separately built compositor libraries')
        for tool in ['ffmpeg', 'ffprobe']:
            version = self.run([compositor / tool, '-version'],
                               extra_env={'DYLD_LIBRARY_PATH': str(compositor)}).decode()
            for line in version.splitlines():
                if line.startswith(('libav', 'libsw')) and '/' in line:
                    compiled, loaded = line.split('/', 1)
                    compiled = compiled.split(maxsplit=1)[1].replace(' ', '')
                    require(compiled == loaded.replace(' ', ''),
                            f'Remotion loader environment mixes FFmpeg ABIs: {line}')
        plain_probe = self.run([compositor / 'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                '-show_entries', 'stream=codec_name', '-of', 'default=nw=1', av1_fixture],
                               extra_env={'DYLD_LIBRARY_PATH': str(compositor)}).decode()
        require('codec_name=av1' in plain_probe, 'Default ffprobe writer failed in Remotion environment')
        self.ff(['-i', av1_fixture, '-f', 'null', '-'])
        self.observations['av1Fixture'] = {'path': str(av1_fixture), 'sha256': fixture_hash}
        hdr_pixels = self.ff(['-f', 'lavfi', '-i', 'color=red:s=64x64:d=0.2', '-vf',
                             'format=yuv420p10le,setparams=colorspace=bt2020nc:color_primaries=bt2020:'
                             'color_trc=smpte2084,zscale=t=linear:npl=100,format=gbrpf32le,'
                             'zscale=primaries=709,tonemap=tonemap=hable:desat=0,'
                             'zscale=transfer=709:matrix=bt709:range=pc,format=bgr24',
                             '-frames:v', '1', '-f', 'rawvideo', '-'])
        require(len(hdr_pixels) == 64 * 64 * 3, 'HDR conversion did not produce a complete frame')
        for color, seconds, hz in [('red', 2, 440), ('blue', 3, 660)]:
            self.ff(['-f', 'lavfi', '-i', f'color={color}:s=1280x720:r=30:d={seconds}',
                     '-f', 'lavfi', '-i', f'sine=frequency={hz}:sample_rate=48000:duration={seconds}',
                     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                     '-c:a', 'pcm_s16le', '-shortest', self.output / f'{color}.mov'])
        graph = ('[0:v]split[r1][r2];[r1]trim=end=1,setpts=PTS-STARTPTS[v1];'
                 '[r2]trim=start=1,setpts=PTS-STARTPTS[v2];'
                 '[0:a]asplit[a1][a2];[a1]atrim=end=1,asetpts=PTS-STARTPTS[b1];'
                 '[a2]atrim=start=1,asetpts=PTS-STARTPTS[b2];'
                 '[v1][b1][v2][b2][1:v][1:a]concat=n=3:v=1:a=1[v][a]')
        for encoder in ['libx264', 'h264_videotoolbox']:
            target = self.output / f'{encoder}.mp4'
            self.ff(['-i', self.output / 'red.mov', '-i', self.output / 'blue.mov',
                     '-filter_complex_threads', '2', '-filter_complex', graph,
                     '-map', '[v]', '-map', '[a]', '-c:v', encoder, '-b:v', '3M',
                     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', target])
            self.check_timing(target)
        sample = self.output / 'libx264.mp4'
        for codec, suffix in [('libopus', 'ogg'), ('libmp3lame', 'mp3'), ('pcm_s16le', 'wav')]:
            target = self.output / ('audio.' + suffix)
            self.ff(['-i', sample, '-vn', '-c:a', codec, target])
            self.ff(['-i', target, '-f', 'null', '-'])
        for codec in ['libvpx', 'libvpx-vp9']:
            target = self.output / (codec + '.webm')
            self.ff(['-f', 'lavfi', '-i', 'color=red@0.5:s=64x64:d=0.2,format=yuva420p',
                     '-c:v', codec, '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', target])
            pixels = self.ff(['-c:v', codec, '-i', target, '-frames:v', '1',
                              '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'])
            require(120 <= sum(pixels[3::4]) / 4096 <= 135, 'VPx alpha did not survive')
        self.ff(['-i', sample, '-frames:v', '1', '-vf',
                 'drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text=Mantur:fontsize=24',
                 self.output / 'label.png'])
        self.ff(['-i', sample, '-frames:v', '1', self.output / 'thumbnail.jpg'])
        self.ff(['-i', sample, '-t', '0.2', '-c:v', 'prores_ks', '-c:a', 'pcm_s16le',
                 self.output / 'prores.mov'])
        self.ff(['-i', self.output / 'prores.mov', '-f', 'null', '-'])

    def check_timing(self, target):
        """Check every frame and audible PCM across edit points, not duration alone."""
        metadata = json.loads(self.run([self.ffprobe, '-v', 'error', '-show_streams',
                                       '-show_packets', '-of', 'json', target]))
        video = next(x for x in metadata['streams'] if x['codec_type'] == 'video')
        audio = next(x for x in metadata['streams'] if x['codec_type'] == 'audio')
        require(int(video['nb_frames']) == 150, 'Expected 150 video frames')
        require(video['width'] == 1280 and video['height'] == 720, 'Expected 720p')
        require(video['r_frame_rate'] == '30/1', 'Expected 30 fps')
        require(audio['time_base'] == '1/48000' and int(audio['duration_ts']) == 240000
                and int(audio['start_pts']) == 0, 'Expected 240000 logical audio samples at zero')
        pixels = self.ff(['-i', target, '-map', '0:v', '-vf', 'scale=1:1',
                          '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
        require(len(pixels) == 450, 'Decoded video frame count differs')
        for frame in range(150):
            red, _, blue = pixels[frame * 3:frame * 3 + 3]
            require(red > 200 and blue < 20 if frame < 60 else blue > 200 and red < 20,
                    f'Wrong color at frame {frame}')
        pts = sorted(float(x['pts_time']) for x in metadata['packets'] if x['codec_type'] == 'video')
        require(len(pts) == 150 and all(abs(value - index / 30) < 1e-6
                                      for index, value in enumerate(pts)), 'Video timestamps differ from 30 fps')
        require(abs(pts[60] - 2) < 1e-6, 'Color transition differs from 2 seconds')
        pcm = array.array('f', self.ff(['-i', target, '-map', '0:a', '-ac', '1', '-ar', '48000',
                                       '-f', 'f32le', '-']))
        if sys.byteorder != 'little':
            pcm.byteswap()
        require(240000 <= len(pcm) < 241024, 'Decoded audio length exceeds AAC tail padding')
        check_audio_transition(pcm)
        levels = {}
        for second in [0, .005, .995, 1, 1.005, 1.995, 2, 2.005, 4.99, 4.995]:
            start = round(second * 48000)
            window = pcm[start:start + 240]
            require(len(window) == 240, 'PCM ends before final 5 ms window')
            levels[second] = math.sqrt(sum(x * x for x in window) / len(window))
            require(levels[second] > .03, f'PCM gap at {second} seconds')
        self.observations[target.name] = {'frames': 150, 'transitionSeconds': pts[60],
                                          'decodedSamples': len(pcm), 'rms': levels}
        self.ff(['-i', target, '-f', 'null', '-'])


def main():
    """Verify a candidate into a new evidence directory and return nonzero on failure."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--av1-fixture', type=Path, required=True,
                        help='An independently encoded AV1 input; hash is recorded in evidence')
    args = parser.parse_args()
    verification = Verification(args.candidate, args.output)
    try:
        verification.inspect()
        verification.capabilities(args.av1_fixture.resolve())
    except Exception as error:
        verification.save(error=str(error))
        raise
    verification.save(ok=True)
    print(json.dumps({'ok': True, 'result': str(verification.output / 'result.json')}))


if __name__ == '__main__':
    main()
