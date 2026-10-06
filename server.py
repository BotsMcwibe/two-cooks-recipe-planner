#!/usr/bin/env python3
"""Serve the recipe app from the repository root on port 8000 (no-cache)."""
import http.server
import socketserver
import os
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).resolve().parent

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == "__main__":
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
        print(f"Serving {ROOT} on http://localhost:{PORT} (caching disabled)")
        httpd.serve_forever()
