#!/usr/bin/env python3
"""My Cool Server - resolve Google News RSS links to the real article URL.

The news pipeline's speed layer is a Google News search feed, and its item
links point at news.google.com/rss/articles/<id> - an opaque id that only
resolves in a real browser. Server-side that meant NO story page, NO og:image,
and therefore the SAME octagon promo cutout on every staged poster about a
given fighter (the owner's "same image of Islam Makhachev over and over").

Google's own article page carries the two values needed to ask Google for the
real URL (verified live, Aug 19 2026):

    GET  news.google.com/rss/articles/<id>
         -> HTML with data-n-a-sg="<signature>" and data-n-a-ts="<timestamp>"
    POST news.google.com/_/DotsSplashUi/data/batchexecute
         f.req=[[["Fbv4je","[\"garturlreq\",[...],\"<id>\",<ts>,\"<sg>\"]",null,"generic"]]]
         -> reply contains ["garturlres","<the real article URL>"]

This is an internal endpoint, so it WILL break some day without notice. Every
step here is therefore fail-silent: decode() returns "" on any failure and the
caller falls back to exactly the behaviour it had before this module existed
(no photo -> promo cutout -> wash). Nothing downstream may ever depend on a
decode succeeding.

Std-lib only (HTTP via common.http). One decode costs two HTTP calls; results
are cached per process, and the news window only stages a handful of stories
a day, so the load on the endpoint is a rounding error.
"""
import json, re, urllib.parse

import common

GN_HOST = "news.google.com"
BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
ARTICLE_URL = "https://news.google.com/rss/articles/%s"

_SG_RE = re.compile(r'data-n-a-sg="([^"]+)"')
_TS_RE = re.compile(r'data-n-a-ts="(\d+)"')
_ID_RE = re.compile(r"/articles/([A-Za-z0-9_-]+)")
# the real URL rides the reply escaped inside a JSON string:
#   "[\"garturlres\",\"https://...\"
_RES_MARK = '[\\"garturlres\\",\\"'
_RES_END = '\\"'

_cache = {}          # article id -> decoded url ("" = tried and failed)
_CACHE_CAP = 256


def is_gnews(link):
    """True when a link is a Google News ARTICLE redirect - host-anchored,
    never a substring test (a foreign URL carrying news.google.com in a query
    param is not one), and the path must be an /articles/ redirect (the site
    home page has nothing to decode). Pure."""
    try:
        u = urllib.parse.urlparse(str(link or ""))
    except Exception:
        return False
    return ((u.hostname or "").lower() == GN_HOST
            and "/articles/" in (u.path or ""))


def article_id(link):
    """The opaque article id inside a news.google.com link's PATH, or "".
    Pure."""
    try:
        path = urllib.parse.urlparse(str(link or "")).path or ""
    except Exception:
        return ""
    m = _ID_RE.search(path)
    return m.group(1) if m else ""


def parse_attrs(html):
    """(signature, timestamp) off the article page's c-wiz div, or ("", "").
    Pure."""
    sg = _SG_RE.search(html or "")
    ts = _TS_RE.search(html or "")
    return (sg.group(1), ts.group(1)) if (sg and ts) else ("", "")


def freq_body(aid, ts, sg):
    """The urlencoded f.req form body for the batchexecute call. The inner
    payload shape is Google's own "garturlreq" envelope - the X placeholders
    are what their web client sends for an anonymous session. Pure."""
    payload = [
        "garturlreq",
        [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1,
          None, None, None, None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1,
         None, 0, 0, None, 0],
        aid, int(ts), sg,
    ]
    freq = json.dumps([[["Fbv4je", json.dumps(payload), None, "generic"]]])
    return "f.req=" + urllib.parse.quote(freq)


def parse_reply(text):
    """The decoded article URL out of an untrusted batchexecute reply, or "".

    Marker scan, not a backslash-excluding regex: the URL sits inside a
    doubly-JSON-escaped string, so a =/& that Google escaped arrives as
    \\u003d and a class like [^\\"] would refuse the whole match (the first
    version of this did exactly that, making its own unescape unreachable).
    The terminator is the literal two-character sequence backslash-quote,
    which no legal URL escape contains. After unescaping, anything still
    carrying a backslash or quote is rejected - only a plain http(s) URL ever
    leaves here. Pure."""
    blob = text or ""
    i = blob.find(_RES_MARK)
    if i < 0:
        return ""
    j = i + len(_RES_MARK)
    k = blob.find(_RES_END, j)
    if k < 0:
        return ""
    url = blob[j:k]
    for esc, ch in (("\\\\u003d", "="), ("\\\\u0026", "&"),
                    ("\\u003d", "="), ("\\u0026", "&")):
        url = url.replace(esc, ch)
    if not url.startswith("http") or "\\" in url or '"' in url:
        return ""
    return url


def decode(link, timeout=12):
    """The real article URL behind a Google News link, or "". Cached per
    process; never raises. A non-Google link comes back unchanged so callers
    can pipe every link through without branching."""
    try:
        link = str(link or "")
        if not is_gnews(link):
            return link
        aid = article_id(link)
        if not aid:
            return ""
        if aid in _cache:
            return _cache[aid]
        if len(_cache) >= _CACHE_CAP:
            _cache.clear()
        _cache[aid] = ""                      # a failure is cached too
        code, html = common.get_text(ARTICLE_URL % aid, tries=1, timeout=timeout)
        if code != 200 or not html:
            return ""
        sg, ts = parse_attrs(html)
        if not sg:
            return ""
        body = freq_body(aid, ts, sg)
        code, text = common.http(
            BATCH_URL,
            headers={"Content-Type":
                     "application/x-www-form-urlencoded;charset=UTF-8"},
            method="POST", raw_body=body.encode("utf-8"),
            tries=1, timeout=timeout)
        if code != 200 or not text:
            return ""
        url = parse_reply(text)
        _cache[aid] = url
        return url
    except Exception:
        return ""
