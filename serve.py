#!/usr/bin/env python3
"""
serve.py — เว็บเซิร์ฟเวอร์เล็ก ๆ สำหรับ Vocab Runner ที่ "ห้ามแคช"

ทำไมต้องมีไฟล์นี้ แทนที่จะใช้ `python3 -m http.server` เฉย ๆ?
  http.server ปกติไม่ส่ง Cache-Control header เลย เบราว์เซอร์เลยเดาเอาเอง
  ว่าไฟล์ยัง "สด" อยู่แล้วแคชไว้นาน ผลคือพอคุณแก้ deck หรือแก้โค้ดแล้ว reload
  คุณจะยังเห็นของเก่า แล้วงงว่าทำไมไม่เปลี่ยน

  ไฟล์นี้บังคับ no-store ทุก response → reload ทีเดียวเห็นของใหม่เสมอ
  (เกมเป็นไฟล์เล็ก โหลดใหม่หมดทุกครั้งก็ยังเร็ว ไม่ต้องกลัวช้า)

วิธีใช้:
    python3 serve.py            # เปิดที่พอร์ต 8080
    python3 serve.py 9000       # เลือกพอร์ตเอง
"""

import functools
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # แทรกก่อนบรรทัดว่างที่ปิดหัว response — เป็นจุดมาตรฐานที่ทำแบบนี้ได้
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # เงียบ ๆ ไม่ต้องรก terminal ด้วย log ทุก request


# บาง OS ไม่รู้จัก .js เป็น JavaScript → ES module จะโหลดไม่ได้ ตั้งให้ชัด
NoCacheHandler.extensions_map[".js"] = "text/javascript"

handler = functools.partial(NoCacheHandler, directory=ROOT)

# allow_reuse_address กัน error "Address already in use" ตอนรีสตาร์ทเร็ว ๆ
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), handler) as httpd:
    print(f"Vocab Runner  →  http://localhost:{PORT}")
    print("(กด Ctrl+C เพื่อหยุด)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nหยุดเซิร์ฟเวอร์แล้ว")
