"""
Camoufox HTTP microservice — stealth page fetching for KXKM_Clown web search.
Exposes GET /fetch?url=... → { text: str, ok: bool }
Port: 8091
"""
import re
import logging
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("camoufox-server")

app = FastAPI(title="KXKM Camoufox Server")

STEALTH_DOMAINS = {
    "artcena.fr",
    "culture.gouv.fr",
    "centrepompidou.fr",
    "theatrecontemporain.net",
    "festival-avignon.com",
    "philharmoniedeparis.fr",
    "ircam.fr",
}

MAX_TEXT_LENGTH = 8000


def _strip_html(html: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<nav[\s\S]*?</nav>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<footer[\s\S]*?</footer>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_TEXT_LENGTH]


def _is_stealth(url: str) -> bool:
    from urllib.parse import urlparse
    try:
        host = urlparse(url).hostname or ""
        return any(host.endswith(d) for d in STEALTH_DOMAINS)
    except Exception:
        return False


@app.get("/fetch")
def fetch_url(url: str = Query(..., description="URL to fetch")):
    """Fetch a URL with Camoufox stealth browser, return plain text."""
    try:
        from camoufox.sync_api import Camoufox
        with Camoufox(headless=True) as browser:
            page = browser.new_page()
            page.goto(url, timeout=20_000, wait_until="domcontentloaded")
            html = page.content()
        text = _strip_html(html)
        logger.info(f"[fetch] {url} → {len(text)} chars")
        return {"ok": True, "text": text, "url": url}
    except Exception as e:
        logger.warning(f"[fetch] failed {url}: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e), "url": url})


@app.get("/fetch-plain")
def fetch_plain(url: str = Query(..., description="URL to fetch with plain requests (no stealth)")):
    """Fetch a URL with plain requests — for non-protected domains."""
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        text = _strip_html(html)
        return {"ok": True, "text": text, "url": url}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e), "url": url})


@app.get("/health")
def health():
    return {"ok": True, "service": "camoufox-server"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8091)
