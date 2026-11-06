"""stock-sonar 计算容器。

POST /scan
  请求：{"as_of": "YYYY-MM-DD", "tickers": [{"ticker", "tier", "d": [...], "o": [...], "h": [...], "l": [...], "c": [...], "v": [...]}]}
  响应：{"spec": "v1", "results": [scan_ticker 的输出, ...]}
容器本身不直连外部数据源，数据由主 Worker 从 D1 读出后发来，结果由主 Worker 写回 D1。
"""
from __future__ import annotations

import json
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from sonar import SPEC_VERSION
from sonar.scan import scan_ticker

VERSION = "0.1.0"


def columnar_to_bars(t: dict) -> list[dict]:
    return [
        {"date": d, "open": o, "high": h, "low": l, "close": c, "volume": v}
        for d, o, h, l, c, v in zip(t["d"], t["o"], t["h"], t["l"], t["c"], t["v"])
    ]


def handle_scan(payload: dict) -> dict:
    as_of = payload.get("as_of")
    results = []
    for t in payload.get("tickers", []):
        try:
            results.append(scan_ticker(t["ticker"], t.get("tier", "extended"), columnar_to_bars(t), as_of))
        except Exception as e:  # 单只出错不影响整批
            results.append({"ticker": t.get("ticker"), "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]})
    return {"spec": SPEC_VERSION, "results": results}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            import numpy

            self._send(200, {"ok": True, "version": VERSION, "spec": SPEC_VERSION, "numpy": numpy.__version__})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/scan":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(n))
            t0 = time.time()
            out = handle_scan(payload)
            out["elapsed_ms"] = round((time.time() - t0) * 1000)
            self._send(200, out)
        except Exception as e:
            self._send(400, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):  # 精简日志
        print(fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
