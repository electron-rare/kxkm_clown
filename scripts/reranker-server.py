#!/usr/bin/env python3
"""BGE Reranker HTTP Server — reranks query-document pairs."""
import json, sys, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from FlagEmbedding import FlagReranker

reranker = FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=True)
PORT = int(os.environ.get("RERANKER_PORT", "9500"))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "model": "bge-reranker-v2-m3"}).encode())
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/rerank":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        query = body.get("query", "")
        documents = body.get("documents", [])
        top_k = body.get("top_k", 5)

        if not query or not documents:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "query and documents required"}).encode())
            return

        pairs = [[query, doc] for doc in documents]
        scores = reranker.compute_score(pairs, normalize=True)
        if isinstance(scores, float):
            scores = [scores]

        ranked = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)[:top_k]
        results = [{"text": doc, "score": round(score, 4)} for doc, score in ranked]

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"results": results}).encode())

    def log_message(self, format, *args):
        print(f"[reranker] {args[0]}", file=sys.stderr)

print(f"[reranker] BGE reranker-v2-m3 loaded, serving on :{PORT}", file=sys.stderr)
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
