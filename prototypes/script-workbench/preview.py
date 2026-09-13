"""Test-only browser fixture server. It can write only its private fixture copy."""
import hashlib
import json
import shutil
import tempfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

SOURCE = Path(__file__).resolve().parent


def serve():
    with tempfile.TemporaryDirectory(prefix='script-workbench-') as directory:
        project = Path(directory)
        for source in (SOURCE / 'fixtures').glob('*.md'):
            shutil.copyfile(source, project / source.name)
        allowed = {p.name: p for p in project.glob('*.md')}

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(SOURCE), **kwargs)

            def reply(self, code, data):
                body = json.dumps(data, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == '/api/project':
                    self.reply(200, {'project': str(project), 'files': sorted(allowed)})
                elif self.path.startswith('/api/file/'):
                    path = allowed.get(unquote(self.path[len('/api/file/'):]))
                    self.reply(200, {'text': path.read_text()}) if path else self.reply(404, {'error': '未知文件'})
                elif self.path in ('/', '/index.html', '/app.mjs', '/model.mjs', '/style.css', '/markdown.mjs', '/browser/marked.mjs', '/browser/purify.mjs'):
                    super().do_GET()
                else:
                    self.reply(404, {'error': '未知资源'})

            def do_POST(self):
                expected_origin = f'http://127.0.0.1:{self.server.server_port}'
                if self.headers.get('Origin') != expected_origin or self.headers.get('Content-Type') != 'application/json':
                    self.reply(403, {'error': '仅接受本地预览页的明确写入'})
                    return
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2_000_000:
                    self.reply(413, {'error': '请求体大小无效'})
                    return
                try:
                    body = json.loads(self.rfile.read(length))
                    path = allowed.get(body['path'])
                    if self.path != '/api/save' or path is None:
                        self.reply(404, {'error': '未知文件'})
                        return
                    current = path.read_text()
                    if current != body['expected']:
                        self.reply(409, {'error': '文件版本冲突：未保存，请重新读取'})
                        return
                    if not isinstance(body['text'], str):
                        raise ValueError('text 必须是字符串')
                    temporary = path.with_suffix('.writing')
                    temporary.write_text(body['text'])
                    temporary.replace(path)
                    self.reply(200, {'version': hashlib.sha256(body['text'].encode()).hexdigest()})
                except (KeyError, ValueError, TypeError) as error:
                    self.reply(400, {'error': str(error)})

        server = HTTPServer(('127.0.0.1', 0), Handler)
        print(f'PREVIEW=http://127.0.0.1:{server.server_port}', flush=True)
        print(f'SYNTHETIC_PROJECT={project}', flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()


if __name__ == '__main__':
    serve()
