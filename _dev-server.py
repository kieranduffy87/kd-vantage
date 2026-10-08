#!/usr/bin/env python3
"""Dev server + local companion for KD Vantage. Binds to 127.0.0.1 only.

Companion APIs (the app detects them via /api/ping and hides the features
when they are missing, e.g. on static hosting):

  GET  /api/capture?url=…&device=desktop|tablet|mobile&full=1
       Screenshots a live site with headless Chrome (Playwright) → JPEG.
  POST /api/push       body = PNG, headers X-Frame-Id / X-Frame-Name
       Used by the Figma plugin (figma-plugin/) to send frames.
  GET  /api/inbox      → [{id, name, ver}]   frames received so far
  GET  /api/frame?id=… → PNG


Sends no-store and also stamps every local module URL with a version (the
newest mtime under js/ and vendor/). The Claude Browser pane caches ES modules
by URL and ignores no-store, so without the stamp an edited js/*.js keeps
running the old code through reloads.
"""

import asyncio
import io
import json
import os
import re
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] != '--capture' else os.path.dirname(os.path.abspath(__file__)))
IMPORT = re.compile(r"""((?:from|import)\s*\(?\s*['"])(\.{1,2}/[^'"?]+\.js)(['"])""")
SCRIPT = re.compile(r"""(src=["']|"three":\s*["'])(\.?/?(?:js|vendor)/[^"'?]+\.js)(["'])""")


def version():
    v = 0
    for sub in ('js', 'vendor', 'css'):
        for dp, _, fs in os.walk(os.path.join(ROOT, sub)):
            for f in fs:
                v = max(v, int(os.path.getmtime(os.path.join(dp, f))))
    return str(v)


CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
DEVICES = {
    # viewport w, h, device scale, output width, mobile
    'desktop': (1440, 900, 2, 1920, False),
    'tablet': (834, 1194, 2, 1668, True),
    'mobile': (402, 874, 3, 1206, True),
}
INBOX = {}          # frame id -> {name, ver, png}
INBOX_LOCK = threading.Lock()
CAPTURE_LOCK = threading.Lock()


async def _capture(url, device, full):
    from playwright.async_api import async_playwright
    from PIL import Image
    vw, vh, dpr, out_w, mobile = DEVICES[device]
    async with async_playwright() as p:
        kw = {'executable_path': CHROME} if os.path.exists(CHROME) else {}
        browser = await p.chromium.launch(args=['--headless=new', '--hide-scrollbars'], **kw)
        try:
            ctx = await browser.new_context(
                viewport={'width': vw, 'height': vh}, device_scale_factor=dpr,
                is_mobile=mobile, has_touch=mobile,
                user_agent=None if not mobile else (
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
                    '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
            )
            page = await ctx.new_page()
            await page.goto(url, wait_until='load', timeout=45000)
            try:  # give fonts and hero media a moment, but never wait on analytics
                await page.wait_for_load_state('networkidle', timeout=4000)
            except Exception:
                pass
            await page.wait_for_timeout(1200)
            if full:
                # walk down the page so lazy images and scroll reveals fire
                height = await page.evaluate('document.documentElement.scrollHeight')
                for y in range(0, min(height, vh * 4), vh // 2):
                    await page.evaluate(f'window.scrollTo(0, {y})')
                    await page.wait_for_timeout(120)
                await page.evaluate('window.scrollTo(0, 0)')
                await page.wait_for_timeout(900)
            png = await page.screenshot(full_page=bool(full))
        finally:
            await browser.close()
    im = Image.open(io.BytesIO(png)).convert('RGB')
    im = im.crop((0, 0, im.width, min(im.height, vh * dpr * 4)))
    if im.width != out_w:
        im = im.resize((out_w, round(im.height * out_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=88, optimize=True)
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        # the Figma plugin UI runs on a null origin
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Frame-Id, X-Frame-Name')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        super().end_headers()

    def _send(self, code, body, ctype='application/json'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/api/push':
            return self._send(404, {'error': 'not found'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 60_000_000:
            return self._send(400, {'error': 'empty or too large'})
        data = self.rfile.read(n)
        fid = (self.headers.get('X-Frame-Id') or 'frame')[:80]
        from urllib.parse import unquote
        name = unquote(self.headers.get('X-Frame-Name') or 'Figma frame')[:120]
        with INBOX_LOCK:
            ver = INBOX.get(fid, {}).get('ver', 0) + 1
            INBOX[fid] = {'name': name, 'ver': ver, 'png': data, 't': time.time()}
        return self._send(200, {'ok': True, 'id': fid, 'ver': ver})

    def _api(self, u):
        q = parse_qs(u.query)
        if u.path == '/api/ping':
            return self._send(200, {'ok': True, 'capture': True, 'figma': True})
        if u.path == '/api/inbox':
            with INBOX_LOCK:
                rows = [{'id': k, 'name': v['name'], 'ver': v['t']} for k, v in INBOX.items()]
            return self._send(200, rows)
        if u.path == '/api/frame':
            fid = (q.get('id') or [''])[0]
            with INBOX_LOCK:
                row = INBOX.get(fid)
            if not row:
                return self._send(404, {'error': 'no such frame'})
            return self._send(200, row['png'], 'image/png')
        if u.path == '/api/capture':
            url = (q.get('url') or [''])[0].strip()
            device = (q.get('device') or ['desktop'])[0]
            full = (q.get('full') or ['1'])[0] != '0'
            if not re.match(r'^https?://', url):
                url = 'https://' + url
            pu = urlparse(url)
            if pu.scheme not in ('http', 'https') or not pu.netloc or device not in DEVICES:
                return self._send(400, {'error': 'Give a full web address, e.g. example.com'})
            # Playwright hangs when driven from a server worker thread, so each
            # capture runs in its own short-lived process.
            import subprocess
            with CAPTURE_LOCK:  # one Chrome at a time keeps laptops happy
                try:
                    r = subprocess.run([sys.executable, os.path.abspath(__file__), '--capture', url, device, '1' if full else '0'],
                                       capture_output=True, timeout=90)
                except subprocess.TimeoutExpired:
                    return self._send(504, {'error': f'{pu.netloc} took too long to load'})
            if r.returncode != 0 or not r.stdout:
                err = (r.stderr.decode(errors='ignore').strip().splitlines() or ['unknown error'])[-1]
                if 'No module named' in err:
                    err = 'Playwright is not installed: pip3 install playwright'
                return self._send(502, {'error': f'Could not capture {pu.netloc}: {err[:160]}'})
            return self._send(200, r.stdout, 'image/jpeg')
        return self._send(404, {'error': 'not found'})

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/'):
            return self._api(u)
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'
        fs = os.path.join(ROOT, path.lstrip('/'))
        if (path.endswith('.js') or path.endswith('.html')) and os.path.isfile(fs):
            v = version()
            with open(fs, encoding='utf-8') as fh:
                body = fh.read()
            if path.endswith('.js'):
                body = IMPORT.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={v}{m.group(3)}', body)
                ctype = 'text/javascript; charset=utf-8'
            else:
                body = SCRIPT.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={v}{m.group(3)}', body)
                body = body.replace('css/app.css"', f'css/app.css?v={v}"')
                ctype = 'text/html; charset=utf-8'
            data = body.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--capture':
    sys.stdout.buffer.write(asyncio.run(_capture(sys.argv[2], sys.argv[3], sys.argv[4] != '0')))
    sys.exit(0)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8590
    srv = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    srv.daemon_threads = True
    print(f'KD Vantage on http://localhost:{port}', flush=True)
    srv.serve_forever()
