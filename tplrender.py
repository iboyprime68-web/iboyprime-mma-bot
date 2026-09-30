#!/usr/bin/env python3
"""Render a staged story through the REAL poster templates, in headless Chrome.

WHY (Sept 30 2026)
------------------
The owner has twenty code-rendered poster templates (commands_worker/poster_page.js,
served at /studio/templates) and none of them was ever used on a real story. He asked for
the latest news to arrive already applied to them. The templates page stays the single
source of truth: nothing here draws a poster. This module drives that page in a headless
Chrome, hands it the story (window.__posters.story), and exports the templates the page
says are ready (window.__posters.png, the exact-grade export the owner's own Download
button uses). The PNGs are attached to the staged Discord message as tpl-<id>.png, which
the Worker lists in the staged contract as `renders`.

HOW IT RUNS
-----------
news_bot stages a story, then dispatches .github/workflows/render.yml with the message id
(ytposts.request_render). That job runs `python tplrender.py --message <id>` on its own
runner, so a slow render can never hold up the news wire. Every failure is a printed line
and exit 0: a red run mails the owner, and a missing template poster is not worth an email.

THE CONNECTION
--------------
Standard library only. Chrome is driven over --remote-debugging-pipe (fd 3 in, fd 4 out,
NUL-terminated JSON), so there is no websocket client, no npm and no pip install. The page
is loaded from the Worker, which serves it (and the UFC data, textures and the story photo)
to a short render session bought with WORKER_BOT_KEY (worker.js renderLogin). Without the
key nothing happens.
"""
import argparse
import base64
import json
import os
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time

import common

RENDER_MAX = 3                  # template posters attached per story
PAGE_TIMEOUT = 60.0             # seconds for the page + fonts to be ready
STORY_TIMEOUT = 150.0           # seconds for the story fill (event card, fighters, images)
PNG_TIMEOUT = 150.0             # seconds for ONE template export (exact grades)
JOB_BUDGET = 480.0              # the whole render, so render.yml's timeout never fires
CHROME_CANDIDATES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome")
SPEC_KEYS = ("kind", "templates", "people", "event", "quote", "line", "hot", "source", "photo")
TPL_ID = re.compile(r"^[a-z0-9]{2,20}$")


def chrome_path():
    """The Chrome binary: $CHROME, else the first candidate on PATH, else ""."""
    env = os.environ.get("CHROME", "").strip()
    if env and os.path.exists(env):
        return env
    for c in CHROME_CANDIDATES:
        p = shutil.which(c)
        if p:
            return p
    return ""


# ---- the staged message ------------------------------------------------------
def spec_of(content):
    """The LAST ```json fence of a staged message as a dict ({} when none), the same
    rule the Worker's stagedParts applies (the bot's spec is always the last fence). Pure."""
    meta = {}
    for m in re.finditer(r"(?:^|\n)```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```", str(content or "")):
        if (m.group(1) or "").lower() != "json":
            continue
        try:
            o = json.loads(m.group(2).strip())
        except Exception:
            continue
        if isinstance(o, dict):
            meta = o
    return meta


def story_spec(meta, mid, attachments):
    """What the page's storyFill() takes, from the fence plus the message. The story photo
    is attachment 1 read through the Worker's proxy (only when it is a real photo: a promo
    cut-out is a studio shot of one fighter, and the templates load those from UFC
    themselves). None when the post carries no story. Pure."""
    if not isinstance(meta, dict) or not meta.get("kind"):
        return None
    spec = {k: meta.get(k) for k in SPEC_KEYS if meta.get(k) not in (None, "", [])}
    spec["kind"] = str(meta.get("kind"))
    spec["templates"] = [t for t in (meta.get("templates") or []) if isinstance(t, str) and TPL_ID.match(t)][:8]
    kind = str(meta.get("photo") or "")
    if kind == "photo" and len(attachments or []) >= 2:
        spec["photo"] = "/studio/api/img/%s/1" % mid
        spec["photoKind"] = "photo"
    else:
        spec.pop("photo", None)
    return spec


def rendered_already(attachments):
    """Template ids already attached (tpl-<id>.png), so a re-run adds nothing twice. Pure."""
    out = []
    for a in attachments or []:
        m = re.match(r"^tpl-([a-z0-9]{2,20})\.png$", str((a or {}).get("filename") or ""))
        if m:
            out.append(m.group(1))
    return out


# ---- Chrome over the debugging pipe ----------------------------------------
class CDPError(Exception):
    pass


class Chrome:
    """A headless Chrome driven over --remote-debugging-pipe. One page, flat sessions."""

    def __init__(self, binary, width=1280, height=900):
        self.prof = tempfile.mkdtemp(prefix="tplrender-")
        r_cmd, self._w = os.pipe()     # we write commands -> Chrome reads fd 3
        self._r, w_res = os.pipe()     # Chrome writes fd 4 -> we read

        def child():
            # os.pipe() fds are close-on-exec; dup them out of the way first, then onto
            # 3 and 4 as INHERITABLE fds (dup2 of an fd onto itself keeps close-on-exec,
            # which silently closed the pipe the first time this was tried)
            a, b = os.dup(r_cmd), os.dup(w_res)
            os.dup2(a, 100)
            os.dup2(b, 101)
            os.dup2(100, 3)
            os.dup2(101, 4)
            os.set_inheritable(3, True)
            os.set_inheritable(4, True)

        args = [binary, "--headless=new", "--remote-debugging-pipe", "--no-first-run",
                "--no-default-browser-check", "--disable-extensions", "--disable-sync",
                "--disable-background-networking", "--mute-audio", "--hide-scrollbars",
                # the page grades in Web Workers and paints on rAF: never let Chrome throttle
                # a page it thinks nobody is looking at
                "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--window-size=%d,%d" % (width, height), "--user-data-dir=" + self.prof]
        if os.geteuid() == 0:
            args.append("--no-sandbox")      # root in a container cannot use the sandbox
        # Chrome decodes third-party article images: it gets none of the job's secrets
        env = {k: v for k, v in os.environ.items()
               if k not in ("DISCORD_BOT_TOKEN", "WORKER_BOT_KEY", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN",
                            "ACTIONS_ID_TOKEN_REQUEST_TOKEN")}
        self.proc = subprocess.Popen(args + ["about:blank"], close_fds=False, preexec_fn=child, env=env,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        os.close(r_cmd)
        os.close(w_res)
        self._buf = b""
        self._id = 0
        self.session = None
        self.events = []

    def _read_one(self, deadline):
        while b"\0" not in self._buf:
            left = deadline - time.time()
            if left <= 0:
                raise CDPError("timed out waiting for Chrome")
            ready, _, _ = select.select([self._r], [], [], min(left, 1.0))
            if not ready:
                if self.proc.poll() is not None:
                    raise CDPError("Chrome exited (%s)" % self.proc.returncode)
                continue
            chunk = os.read(self._r, 1 << 20)
            if not chunk:
                raise CDPError("Chrome closed the pipe")
            self._buf += chunk
        raw, self._buf = self._buf.split(b"\0", 1)
        return json.loads(raw.decode("utf-8", "replace"))

    def send(self, method, params=None, timeout=30.0, session=True):
        self._id += 1
        msg = {"id": self._id, "method": method, "params": params or {}}
        if session and self.session:
            msg["sessionId"] = self.session
        os.write(self._w, json.dumps(msg).encode("utf-8") + b"\0")
        deadline = time.time() + timeout
        while True:
            m = self._read_one(deadline)
            if m.get("id") == self._id:
                if "error" in m:
                    raise CDPError("%s: %s" % (method, (m["error"] or {}).get("message", "error")))
                return m.get("result") or {}
            if "method" in m and len(self.events) < 200:
                self.events.append(m)

    def open(self):
        tid = self.send("Target.createTarget", {"url": "about:blank"}, session=False)["targetId"]
        self.session = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True},
                                 session=False)["sessionId"]
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("Network.enable")

    def eval(self, expr, timeout=30.0):
        """Evaluate an expression in the page, awaiting a promise; returns its JSON value."""
        r = self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                           "returnByValue": True, "timeout": int(timeout * 1000)},
                      timeout=timeout + 5)
        if r.get("exceptionDetails"):
            d = r["exceptionDetails"]
            txt = ((d.get("exception") or {}).get("description") or d.get("text") or "error")
            raise CDPError(txt.split("\n")[0][:200])
        return (r.get("result") or {}).get("value")

    def wait_for(self, expr, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.eval(expr, timeout=5):
                    return True
            except CDPError:
                pass
            time.sleep(0.25)
        return False

    def close(self):
        try:
            self.send("Browser.close", session=False, timeout=5)
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        for fd in (self._w, self._r):
            try:
                os.close(fd)
            except OSError:
                pass
        shutil.rmtree(self.prof, ignore_errors=True)


# ---- the Worker ---------------------------------------------------------------
def render_login(studio_url, key):
    """POST the bot key to /studio/render-login; (cookie name, token) or None."""
    code, text = common.http(studio_url.rstrip("/") + "/render-login", method="POST",
                             headers={"Authorization": "Bearer " + key,
                                      "User-Agent": "iboyprime-render"},
                             body={}, tries=2, timeout=20)
    if code != 200:
        print("  render: the Worker refused the bot key (HTTP %s)" % code)
        return None
    try:
        j = json.loads(text)
    except Exception:
        return None
    if not (isinstance(j, dict) and j.get("token") and j.get("cookie")):
        return None
    return str(j["cookie"]), str(j["token"])


PNG_JS = ("window.__posters.png(%s).then(function (b) { return new Promise(function (res, rej) {"
          " var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); };"
          " fr.onerror = function () { rej(new Error('read failed')); }; fr.readAsDataURL(b); }); })")


def render_story(spec, studio_url, key, want=RENDER_MAX, skip=(), budget=JOB_BUDGET, binary=None):
    """[(template id, png bytes)] for up to `want` ready templates, best first. [] on any
    failure (printed). Never raises."""
    t0 = time.time()
    binary = binary or chrome_path()
    if not binary:
        print("  render: no Chrome on this runner")
        return []
    login = render_login(studio_url, key)
    if not login:
        return []
    host = re.match(r"^https://([^/]+)", studio_url)
    if not host:
        print("  render: studio_url is not https")
        return []
    out = []
    br = None
    try:
        br = Chrome(binary)
        br.open()
        br.send("Network.setCookie", {"name": login[0], "value": login[1], "domain": host.group(1),
                                      "path": "/studio", "secure": True, "httpOnly": True,
                                      "sameSite": "Strict"})
        # before the page's own script runs: no auto-loaded event, nothing drawn on screen
        br.send("Page.addScriptToEvaluateOnNewDocument",
                {"source": "window.__postersNoAuto = true; window.__postersRender = true;"})
        br.send("Page.navigate", {"url": studio_url.rstrip("/") + "/templates"})
        if not br.wait_for("!!(window.__posters && window.__posters.story)", PAGE_TIMEOUT):
            print("  render: the templates page did not load")
            return []
        br.eval("window.__posters.fonts()", timeout=45)
        res = br.eval("window.__posters.story(%s)" % json.dumps(spec), timeout=STORY_TIMEOUT)
        ready = [t for t in ((res or {}).get("ready") or []) if isinstance(t, str) and TPL_ID.match(t)]
        print("  render: %s -> ready %s (event %r, A %r, B %r)"
              % (spec.get("kind"), ready, (res or {}).get("ev"), (res or {}).get("A"), (res or {}).get("B")))
        for tid in ready:
            if len(out) >= want or tid in skip:
                continue
            left = budget - (time.time() - t0)
            if left < 30:
                print("  render: out of time after %d poster(s)" % len(out))
                break
            try:
                b64 = br.eval(PNG_JS % json.dumps(tid), timeout=min(PNG_TIMEOUT, left - 10))
                png = base64.b64decode(b64 or "")
            except Exception as e:
                print("  render: %s failed (%s)" % (tid, str(e)[:120]))
                continue
            if png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 1000:
                out.append((tid, png))
                print("  render: %s ok, %d KB, %.1fs" % (tid, len(png) // 1024, time.time() - t0))
    except Exception as e:
        print("  render: stopped (%s: %s)" % (type(e).__name__, str(e)[:160]))
    finally:
        if br:
            br.close()
    return out


# ---- the job ------------------------------------------------------------------
def attach(channel, mid, msg, pngs):
    """Add the posters to the staged message, keeping every attachment it already has."""
    tmp = []
    try:
        files = []
        for tid, png in pngs:
            fd, p = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, "wb") as f:
                f.write(png)
            tmp.append(p)
            files.append((p, "tpl-%s.png" % tid))
        keep = [str(a.get("id")) for a in (msg.get("attachments") or []) if a and a.get("id")]
        return common.edit_message_files(channel, mid, keep, files)
    finally:
        for p in tmp:
            try:
                os.remove(p)
            except OSError:
                pass


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--message", required=True)
    a = ap.parse_args(argv)
    mid = str(a.message or "").strip()
    if not re.match(r"^[0-9]{15,21}$", mid):
        print("render: not a message id")
        return 0
    key = os.environ.get("WORKER_BOT_KEY", "").strip()
    if not key:
        print("render: WORKER_BOT_KEY is not set, nothing to do")
        return 0
    try:
        import newsconfig
        studio_url = str(newsconfig.load().get("studio_url") or "").strip()
    except Exception:
        studio_url = ""
    if not studio_url.startswith("https://"):
        print("render: newsconfig has no https studio_url")
        return 0
    cfg = common.load_config()
    chan = (cfg.get("channels", {}) or {}).get("studio")
    if not chan:
        print("render: no studio channel")
        return 0
    code, msg = common.discord("GET", "/channels/%s/messages/%s" % (chan, mid))
    if code != 200 or not isinstance(msg, dict):
        print("render: could not read the staged message (HTTP %s)" % code)
        return 0
    me_code, me = common.discord("GET", "/users/@me")
    if me_code != 200 or str((msg.get("author") or {}).get("id")) != str((me or {}).get("id")):
        print("render: that message is not the bot's own")
        return 0
    spec = story_spec(spec_of(msg.get("content")), mid, msg.get("attachments"))
    if not spec:
        print("render: the staged post carries no story")
        return 0
    have = rendered_already(msg.get("attachments"))
    want = RENDER_MAX - len(have)
    if want <= 0:
        print("render: already rendered %s" % have)
        return 0
    pngs = render_story(spec, studio_url, key, want=want, skip=have)
    if not pngs:
        print("render: nothing to attach")
        return 0
    code, _ = attach(chan, mid, msg, pngs)
    print("render: attached %s (HTTP %s)" % ([t for t, _ in pngs], code))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        print("render: failed (%s)" % type(e).__name__)
        sys.exit(0)
