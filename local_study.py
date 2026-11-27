import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Lock, Timer
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser


ROOT = Path(__file__).resolve().parent
STUDY_URL = '/%E7%BB%83%E4%B9%A0%E5%89%8D%E7%AB%AF/index.html'
TOKEN_PATH = '/__kunming349__'
PROFILE_API = '/__study_profile__'
BOOT = STUDY_URL.rsplit('/', 1)[0] + '/profile-boot.js'
KEY = re.compile(r'kunming349:(?:review:v1|preferences:v1|attempts:v1:[\w-]+:[\w-]+|term:v1:[\w-]+|day:v1:\d{4}-\d\d-\d\d|(?:choice|subjective):v1:[\w-]+|progress:v1:[\w-]+|resume:v1:[\w-]+)')
LIMIT = 8 * 1024 * 1024


class Profile:
    def __init__(self, filename):
        self.filename = filename
        self.lock = Lock()
        self.entries = self.read()

    def read(self):
        if not self.filename.exists():
            return {}
        raw = json.loads(self.filename.read_text(encoding='utf-8'))
        entries = raw['entries']
        if raw.get('format') != 'kunming349-profile' or raw.get('version') != 2 or not isinstance(entries, dict):
            raise ValueError('个人资料格式有误')
        return entries

    def update(self, changes):
        with self.lock:
            next_values = self.entries.copy()
            for key, entry in changes.items():
                current = next_values.get(key)
                if not current or entry['at'] > current['at']:
                    next_values[key] = entry
            if next_values == self.entries:
                return
            self.filename.parent.mkdir(parents=True, exist_ok=True)
            temp = self.filename.with_suffix('.writing')
            with temp.open('w', encoding='utf-8') as out:
                json.dump({'format':'kunming349-profile','version':2,'entries':next_values}, out, ensure_ascii=False)
                out.flush()
                os.fsync(out.fileno())
            temp.replace(self.filename)
            self.entries = next_values


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, profile, port, **kwargs):
        self.profile = profile
        self.host = f'127.0.0.1:{port}'
        self.origin = 'http://' + self.host
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_body(self, status, media, body):
        self.send_response(status)
        self.send_header('Content-Type', media)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD' and body:
            self.wfile.write(body)

    def do_GET(self):
        if self.headers.get('Host') != self.host:
            return self.send_body(403, 'text/plain', b'Loopback only')
        path = self.path.split('?', 1)[0]
        if path == TOKEN_PATH:
            return self.send_body(200, 'text/plain', b'Kunming349 profile v2')
        if path == '/':
            self.send_response(302)
            self.send_header('Location', STUDY_URL)
            self.end_headers()
            return
        if path.upper() == BOOT.upper():
            local_request = self.headers.get('Sec-Fetch-Site') == 'same-origin' or self.headers.get('Referer', '').startswith(self.origin + '/')
            if not local_request:
                return self.send_body(403, 'text/plain', b'Same origin only')
            with self.profile.lock:
                body = ('window.studyDiskSeed = ' + json.dumps(self.profile.entries, ensure_ascii=True) + ';\n').encode('ascii')
            return self.send_body(200, 'application/javascript; charset=utf-8', body)
        return super().do_GET()

    def do_HEAD(self):
        if self.headers.get('Host') != self.host or self.path.split('?', 1)[0].upper() == BOOT.upper():
            return self.send_body(403, 'text/plain', b'')
        return super().do_HEAD()

    def do_POST(self):
        if (self.path != PROFILE_API or self.headers.get('Host') != self.host
                or self.headers.get('Origin') != self.origin or self.headers.get_content_type() != 'application/json'):
            return self.send_body(403, 'text/plain', b'Same origin only')
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= LIMIT:
                return self.send_body(413, 'text/plain', b'Profile update too large')
            changes = json.loads(self.rfile.read(length))
            if not isinstance(changes, dict) or any(
                not KEY.fullmatch(key) or not isinstance(value, dict) or 'value' not in value
                or type(value.get('at')) is not int or not 0 <= value['at'] <= 9_007_199_254_740_991
                for key, value in changes.items()
            ):
                return self.send_body(400, 'text/plain', b'Invalid study profile')
            self.profile.update(changes)
        except (ValueError, UnicodeError):
            return self.send_body(400, 'text/plain', b'Invalid study profile')
        except OSError:
            return self.send_body(503, 'text/plain', b'Profile storage temporarily unavailable')
        return self.send_body(204, 'text/plain', b'')

    def list_directory(self, path):
        self.send_body(404, 'text/plain', b'Not found')
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8949)
    parser.add_argument('--profile', type=Path, default=Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'Kunming349' / 'profile.json')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    base = f'http://127.0.0.1:{args.port}'
    profile = Profile(args.profile)
    factory = partial(Handler, profile=profile, port=args.port)
    try:
        listener = ThreadingHTTPServer(('127.0.0.1', args.port), factory)
    except OSError:
        try:
            with urlopen(base + TOKEN_PATH, timeout=1) as response:
                if response.read(80) != b'Kunming349 profile v2':
                    raise ValueError('wrong service')
        except (URLError, ValueError, OSError):
            raise SystemExit(f'端口 {args.port} 已被占用。')
        if not args.no_browser:
            webbrowser.open(base + STUDY_URL)
        return
    if not args.no_browser:
        Timer(.25, webbrowser.open, args=(base + STUDY_URL,)).start()
    print('昆医 349 题库', base, flush=True)
    with listener:
        try:
            listener.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
