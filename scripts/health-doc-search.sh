#!/usr/bin/env bash
set -euo pipefail

SEARCH_URL="${SEARXNG_URL:-http://localhost:8080}"
SEARCH_QUERY="${SEARCH_QUERY:-kxkm clown}"
STRICT=0
VERBOSE=0
JSON_MODE=0
CHECK_SEARCH=1
CHECK_DOCS=1

usage() {
  cat <<'EOF'
Usage: scripts/health-doc-search.sh [options]

Checks the readiness of the search and document parsing seams.

Options:
  --search-url URL   SearXNG base URL (default: $SEARXNG_URL or http://localhost:8080)
  --query TEXT       Query used for the search probe (default: "kxkm clown")
  --skip-search      Skip the SearXNG probe
  --skip-docs        Skip document parser dependency checks
  --yes              Accepted as a no-op for CLI parity
  --strict           Exit non-zero if any check fails
  --json             Emit JSON lines instead of human-readable output
  --verbose          Print probe details
  --help             Show this help
EOF
}

log() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"level": "info", "msg": sys.argv[1]}))
PY
  else
    printf '[health-doc-search] %s\n' "$message"
  fi
}

warn() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"level": "warn", "msg": sys.argv[1]}))
PY
  else
    printf '[health-doc-search] warn: %s\n' "$message" >&2
  fi
}

die() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"level": "error", "msg": sys.argv[1]}))
PY
  else
    printf '[health-doc-search] error: %s\n' "$message" >&2
  fi
  exit 1
}

check_search() {
  python3 - "$SEARCH_URL" "$SEARCH_QUERY" "$VERBOSE" "$JSON_MODE" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

base = sys.argv[1].rstrip("/")
query = sys.argv[2]
verbose = sys.argv[3] == "1"
json_mode = sys.argv[4] == "1"
target = f"{base}/search?q={urllib.parse.quote(query)}&format=json"
request = urllib.request.Request(target, headers={"User-Agent": "kxkm-clown/lot14-health/1.0"})

payload = {
    "check": "search",
    "url": target,
    "ok": False,
    "results": 0,
    "error": None,
}

try:
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
        results = body.get("results") or []
        payload["ok"] = True
        payload["results"] = len(results)
        payload["status"] = getattr(response, "status", 200)
except Exception as exc:
    payload["error"] = str(exc)

if payload["error"] and "HTTP Error 403" in payload["error"]:
    payload["hint"] = "SearXNG returned 403. Check search.formats includes json in settings.yml."

if json_mode:
    print(json.dumps(payload))
else:
    if payload["ok"]:
        detail = f"{payload['results']} result(s) from {target}"
        print(f"[health-doc-search] search ok: {detail}")
    else:
        hint = f" hint={payload.get('hint')}" if payload.get("hint") else ""
        print(f"[health-doc-search] search failed: {payload['error']} ({target}){hint}", file=sys.stderr)

if not payload["ok"]:
    raise SystemExit(1)
PY
}

check_docs() {
  python3 - "$VERBOSE" "$JSON_MODE" <<'PY'
import importlib.util
import json
import os
import shutil
import sys

verbose = sys.argv[1] == "1"
json_mode = sys.argv[2] == "1"

def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False

docling_ok = has_module("docling")
pymupdf_ok = has_module("fitz")
magic_pdf_ok = has_module("magic_pdf")
magic_pdf_cli = shutil.which("magic-pdf") is not None

payload = {
    "check": "docs",
    "ok": docling_ok or pymupdf_ok,
    "docling": docling_ok,
    "pymupdf": pymupdf_ok,
    "mineru": magic_pdf_ok or magic_pdf_cli,
    "error": None,
}

if json_mode:
    print(json.dumps(payload))
else:
    prefix = "docs ready" if payload["ok"] else "docs probe"
    print(
        f"[health-doc-search] {prefix}: "
        f"docling={'yes' if docling_ok else 'no'}, "
        f"pymupdf={'yes' if pymupdf_ok else 'no'}, "
        f"mineru={'yes' if payload['mineru'] else 'no'}"
    )

if not payload["ok"]:
    raise SystemExit(1)
PY
}

SUBCOMMAND="all"
if [[ $# -gt 0 && "$1" != --* ]]; then
  SUBCOMMAND="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --search-url)
      shift
      [[ $# -gt 0 ]] || die "--search-url requires a value"
      SEARCH_URL="$1"
      ;;
    --query)
      shift
      [[ $# -gt 0 ]] || die "--query requires a value"
      SEARCH_QUERY="$1"
      ;;
    --skip-search)
      CHECK_SEARCH=0
      ;;
    --skip-docs)
      CHECK_DOCS=0
      ;;
    --yes)
      ;;
    --strict)
      STRICT=1
      ;;
    --json)
      JSON_MODE=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

case "$SUBCOMMAND" in
  all|search|docs) ;;
  *) die "unknown subcommand: $SUBCOMMAND" ;;
esac

if [[ "$SUBCOMMAND" == "search" ]]; then
  CHECK_DOCS=0
elif [[ "$SUBCOMMAND" == "docs" ]]; then
  CHECK_SEARCH=0
fi

log "search-url=$SEARCH_URL"
log "query=$SEARCH_QUERY"

failures=0

if [[ "$CHECK_SEARCH" -eq 1 ]]; then
  if ! check_search; then
    warn "SearXNG probe failed; search fallback still covers /web via DuckDuckGo/custom API"
    failures=$((failures + 1))
  fi
fi

if [[ "$CHECK_DOCS" -eq 1 ]]; then
  if ! check_docs; then
    warn "Document parser probe failed; PDFs will fall back to PyMuPDF only if available"
    failures=$((failures + 1))
  fi
fi

if [[ "$CHECK_SEARCH" -eq 0 && "$CHECK_DOCS" -eq 0 ]]; then
  log "nothing to check"
fi

if [[ "$failures" -gt 0 && "$STRICT" -eq 1 ]]; then
  die "one or more probes failed"
fi

exit 0
