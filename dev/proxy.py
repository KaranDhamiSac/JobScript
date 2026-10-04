# Test-only reverse proxy: serves a real job site from 127.0.0.1 without its CSP, GET only.
# An optional 4th argument is a regex of read-only POST paths to forward too, for sites that
# load the form itself with a POST (Ashby's GraphQL), e.g. 'op=Api(JobPosting|Organization)'.
import http.server, os, re, sys, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__))
PORT, TARGET, SITE = int(sys.argv[1]), sys.argv[2], sys.argv[3]   # e.g. 8766 job-boards.greenhouse.io Greenhouse
ALLOW_POST = sys.argv[4] if len(sys.argv) > 4 else ''
DROP = {'content-security-policy', 'content-security-policy-report-only', 'content-encoding', 'content-length',
        'transfer-encoding', 'strict-transport-security', 'x-frame-options', 'connection', 'alt-svc'}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): sys.stderr.write((fmt % a) + '\n')
    def send(self, code, body, ctype='text/plain', extra=()):
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in extra: self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/__js/'):
            name = self.path[6:].split('?')[0]
            path = os.path.join(HERE, name)
            if name in ('guard.js', 'bundle.js') and os.path.exists(path):
                body = open(path, 'rb').read()
                if name == 'bundle.js':
                    body = ('window.__jsTargetSite=%r;\n' % SITE).encode() + body
                else:
                    body = ('window.__jsAllowPost=%r;\n' % ALLOW_POST).encode() + body
                return self.send(200, body, 'application/javascript')
            return self.send(404, b'nope')
        self.forward()
    def forward(self, data=None):
        req = urllib.request.Request('https://' + TARGET + self.path, data=data, headers={
            'User-Agent': self.headers.get('User-Agent', 'Mozilla/5.0'), 'Accept': self.headers.get('Accept', '*/*'),
            'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity',
            'Cookie': self.headers.get('Cookie', ''), 'X-Requested-With': self.headers.get('X-Requested-With', ''),
            'Content-Type': self.headers.get('Content-Type', ''), 'Referer': 'https://' + TARGET + '/'})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        opener = urllib.request.build_opener(NoRedirect)
        try:
            resp = opener.open(req, timeout=20); code = resp.status; headers = resp.headers; body = resp.read()
        except urllib.error.HTTPError as e:
            code, headers, body = e.code, e.headers, e.read()
        extra = []
        for k, v in headers.items():
            lk = k.lower()
            if lk in DROP or lk == 'content-type': continue
            if lk == 'location': v = re.sub(r'^https://' + re.escape(TARGET), '', v)
            if lk == 'set-cookie': v = re.sub(r';\s*(domain=[^;]*|secure|samesite=[^;]*)', '', v, flags=re.I)
            extra.append((k, v))
        ctype = headers.get('Content-Type', 'application/octet-stream')
        if 'text/html' in ctype:
            html = body.decode('utf-8', 'replace')
            html = re.sub(r'<meta[^>]+http-equiv=["\']?Content-Security-Policy[^>]*>', '', html, flags=re.I)
            html = re.sub(r'(<head[^>]*>)', r'\1<script src="/__js/guard.js"></script>', html, count=1, flags=re.I)
            body = html.encode('utf-8')
        self.send(code, body, ctype, extra)
    def _refuse(self): self.send(405, b'JobScript test proxy: only GET is allowed')
    def do_POST(self):
        if not (ALLOW_POST and re.search(ALLOW_POST, self.path)): return self._refuse()
        self.forward(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
    do_PUT = do_PATCH = do_DELETE = _refuse
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
