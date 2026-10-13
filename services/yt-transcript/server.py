"""yt-transcript: YouTube transcript servisi.

Ev IP'sinde (Pi) çalışır. Bulut IP'leri YouTube tarafından engellendiği için
bulut session'ları transcript'i buradan alır.

Ortam: YT_TOKEN (zorunlu, en az 16 karakter), PORT (varsayılan 8000)

GET /healthz
GET /transcript?v=<id ya da link>&lang=tr,en[&format=txt]
GET /channel?h=@avenoxai[&n=15]        -> kanalın son videoları (RSS, en fazla 15)
Yetki: Authorization: Bearer <YT_TOKEN>
"""
import hmac
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi

TOKEN = os.environ.get("YT_TOKEN", "")
PORT = int(os.environ.get("PORT", "8000"))

UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36"
ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/|live/|embed/)([\w-]{11})|^([\w-]{11})$")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
api = YouTubeTranscriptApi()


def video_id(s):
    m = ID_RE.search(s.strip())
    return (m.group(1) or m.group(2)) if m else None


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "tr,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


@lru_cache(maxsize=64)
def channel_id(handle):
    if re.fullmatch(r"UC[\w-]{22}", handle):
        return handle
    html = get("https://www.youtube.com/@" + handle.lstrip("@"))
    # Sayfada önerilen başka kanalların id'leri de geçer; kanalın kendi id'si canonical link'te.
    m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', html) \
        or re.search(r'"externalId":"(UC[\w-]{22})"', html)
    if not m:
        raise LookupError("kanal bulunamadı")
    return m.group(1)


def channel_videos(handle, n):
    cid = channel_id(handle)
    root = ET.fromstring(get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid))
    videos = [
        {
            "id": e.findtext("yt:videoId", namespaces=NS),
            "title": e.findtext("a:title", namespaces=NS),
            "published": e.findtext("a:published", namespaces=NS),
        }
        for e in root.findall("a:entry", NS)[:n]
    ]
    return {"channel_id": cid, "channel": root.findtext("a:title", namespaces=NS), "videos": videos}


def transcript(vid, langs):
    tl = api.list(vid)
    try:
        t = tl.find_manually_created_transcript(langs)  # elle yazılmış altyazı varsa onu tercih et
    except Exception:
        t = tl.find_transcript(langs)
    text = " ".join(s.text.replace("\n", " ") for s in t.fetch().snippets)
    return {"id": vid, "lang": t.language_code, "generated": t.is_generated, "text": text}


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, ctype="application/json; charset=utf-8"):
        raw = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/healthz":
            return self.reply(200, {"ok": True})
        auth = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(auth, ("Bearer " + TOKEN).encode()):
            return self.reply(401, {"error": "yetkisiz"})
        try:
            if u.path == "/transcript":
                vid = video_id(q.get("v", ""))
                if not vid:
                    return self.reply(400, {"error": "geçersiz video"})
                langs = [x for x in q.get("lang", "tr,en").split(",") if x]
                r = transcript(vid, langs)
                if q.get("format") == "txt":
                    return self.reply(200, r["text"], "text/plain; charset=utf-8")
                return self.reply(200, r)
            if u.path == "/channel":
                h = q.get("h", "")
                if not re.fullmatch(r"@?[\w.-]{1,100}", h):
                    return self.reply(400, {"error": "geçersiz kanal"})
                n = max(1, min(15, int(q.get("n", "15"))))
                return self.reply(200, channel_videos(h, n))
            return self.reply(404, {"error": "yok"})
        except Exception as e:
            return self.reply(502, {"error": type(e).__name__, "detail": str(e)[:300]})

    def log_message(self, fmt, *args):
        print(self.command, urlparse(self.path).path, flush=True)


if __name__ == "__main__":
    if len(TOKEN) < 16:
        raise SystemExit("YT_TOKEN en az 16 karakter olmalı")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
