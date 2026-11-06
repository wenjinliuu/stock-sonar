"""stock-sonar 计算容器（P0 占位）。

P1 在这里实现：接收主 Worker 发来的日线 → 计算五类指标、自身 250 日分位数、信号与打分 → 返回结果，
由主 Worker 写入 D1。容器本身不直连外部数据源。
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.0.1"


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            import numpy, pandas  # noqa: E401  确认依赖可用

            self._send(200, {"ok": True, "version": VERSION, "pandas": pandas.__version__, "numpy": numpy.__version__})
        else:
            self._send(404, {"error": "not found"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
