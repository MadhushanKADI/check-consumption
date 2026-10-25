"""Web app that estimates UPS energy use (kWh) from a ViewPower monitor.

Polls the ViewPower web interface, integrates load power (W) over time and
serves a dashboard at http://localhost:8000/.

Configuration (environment variables):
  VIEWPOWER_URL    page/endpoint returning UPS data (default http://localhost:15178/ViewPower/)
  POWER_REGEX      regex whose first group is the output load in watts
  LOAD_REGEX       regex whose first group is the load percentage (used with UPS_RATED_WATTS)
  UPS_RATED_WATTS  UPS rated real power in watts (used when only load % is available)
  POLL_SECONDS     polling interval (default 10)
  DATA_FILE        where totals persist (default consumption.json)
  DEMO=1           use simulated readings instead of contacting ViewPower
  PORT             HTTP port (default 8000)
"""
import json
import os
import random
import re
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_GAP_SECONDS = 600  # don't integrate across long outages


def extract_watts(text, power_regex=None, load_regex=None, rated_watts=None):
    """Return load in watts parsed from ViewPower output, or None."""
    if power_regex:
        m = re.search(power_regex, text, re.S)
        if m:
            return float(m.group(1))
    if load_regex and rated_watts:
        m = re.search(load_regex, text, re.S)
        if m:
            return float(m.group(1)) / 100.0 * float(rated_watts)
    return None


class Meter:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.total_kwh = 0.0
        self.watts = None
        self.last_ts = None
        self.error = None
        self.started = time.time()
        self._load()

    def _load(self):
        try:
            with open(self.path) as f:
                self.total_kwh = float(json.load(f).get("total_kwh", 0.0))
        except (OSError, ValueError):
            pass

    def add_reading(self, watts, now=None):
        now = time.time() if now is None else now
        with self.lock:
            if self.last_ts is not None and self.watts is not None:
                dt = now - self.last_ts
                if 0 < dt <= MAX_GAP_SECONDS:
                    self.total_kwh += self.watts * dt / 3600000.0
            self.watts, self.last_ts, self.error = watts, now, None
            self._save()

    def set_error(self, msg):
        with self.lock:
            self.error = msg

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"total_kwh": self.total_kwh}, f)
        os.replace(tmp, self.path)

    def snapshot(self):
        with self.lock:
            return {"watts": self.watts, "total_kwh": round(self.total_kwh, 4),
                    "updated": self.last_ts, "error": self.error}


def poll_loop(meter, cfg):
    while True:
        try:
            if cfg["demo"]:
                watts = 150 + random.random() * 50
            else:
                with urllib.request.urlopen(cfg["url"], timeout=10) as r:
                    text = r.read().decode("utf-8", "replace")
                watts = extract_watts(text, cfg["power_regex"], cfg["load_regex"], cfg["rated"])
                if watts is None:
                    raise ValueError("could not find load in ViewPower response; set POWER_REGEX or LOAD_REGEX")
            meter.add_reading(watts)
        except Exception as e:  # keep polling on any failure
            meter.set_error(str(e))
        time.sleep(cfg["interval"])


PAGE = """<!doctype html><meta charset=utf-8><title>UPS consumption</title>
<body style="font-family:sans-serif;text-align:center;margin-top:3em">
<h1>UPS consumption</h1>
<h2 id=kwh>-</h2><p id=w></p><p id=err style="color:red"></p>
<script>
async function t(){const d=await (await fetch('/api/consumption')).json();
kwh.textContent=d.total_kwh.toFixed(3)+' kWh';
w.textContent=d.watts==null?'':'Current load: '+d.watts.toFixed(0)+' W';
err.textContent=d.error||'';}
t();setInterval(t,5000);
</script>"""


def make_handler(meter):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/consumption":
                body, ctype = json.dumps(meter.snapshot()).encode(), "application/json"
            elif self.path in ("/", "/index.html"):
                body, ctype = PAGE.encode(), "text/html; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass
    return H


def main():
    env = os.environ.get
    cfg = {
        "demo": env("DEMO") == "1",
        "url": env("VIEWPOWER_URL", "http://localhost:15178/ViewPower/"),
        "power_regex": env("POWER_REGEX"),
        "load_regex": env("LOAD_REGEX"),
        "rated": env("UPS_RATED_WATTS"),
        "interval": float(env("POLL_SECONDS", "10")),
    }
    meter = Meter(env("DATA_FILE", "consumption.json"))
    threading.Thread(target=poll_loop, args=(meter, cfg), daemon=True).start()
    port = int(env("PORT", "8000"))
    print(f"Serving on http://0.0.0.0:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(meter)).serve_forever()


if __name__ == "__main__":
    main()
