#!/usr/bin/env python3
"""
Corpus sourcing : spectacle en espace public / arts de la rue
Fetches texts from Wikipedia FR, ARTCENA, compagnies, artistes personas
and ingests them into LightRAG via POST /documents/texts
"""

import hashlib
import json
import time
import requests
from bs4 import BeautifulSoup
from loguru import logger

LIGHTRAG_URL = "http://localhost:9621"
SEARXNG_URL = "http://localhost:8080"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
}

# Sites known to block plain requests → use Camoufox
STEALTH_DOMAINS = {
    "artcena.fr",
    "culture.gouv.fr",
    "federationartsdelarue.org",
    "quelquesparts.fr",
    "vivantmag.fr",
    "artsdelarue.fr",
}

# ---------------------------------------------------------------------------
# Seed URLs — high-signal sources
# ---------------------------------------------------------------------------

SHERLOCK_QUEUE_PATH = "/home/kxkm/KXKM_Clown/data/sherlock-discovered-urls.jsonl"


def load_sherlock_queue() -> list[tuple[str, str]]:
    """Read URLs discovered by Sherlock's live searches and add to ingest pool."""
    import os
    if not os.path.exists(SHERLOCK_QUEUE_PATH):
        return []
    entries = []
    try:
        with open(SHERLOCK_QUEUE_PATH) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    for url in obj.get("urls", []):
                        if url and url.startswith("http"):
                            doc_id = f"sherlock_{make_id(url)}"
                            entries.append((doc_id, url))
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        logger.warning(f"Could not read sherlock queue: {e}")
    # Deduplicate by URL
    seen: set[str] = set()
    deduped = []
    for doc_id, url in entries:
        if url not in seen:
            seen.add(url)
            deduped.append((doc_id, url))
    logger.info(f"Sherlock queue: {len(deduped)} discovered URLs")
    return deduped


SEED_URLS = [
    # Wikipedia FR — domaine arts de la rue
    ("wikipedia_theatre_rue",       "https://fr.wikipedia.org/wiki/Th%C3%A9%C3%A2tre_de_rue"),
    ("wikipedia_arts_rue",          "https://fr.wikipedia.org/wiki/Arts_de_la_rue"),
    ("wikipedia_cirque_contemporain","https://fr.wikipedia.org/wiki/Cirque_contemporain"),
    ("wikipedia_performance_art",   "https://fr.wikipedia.org/wiki/Performance_(art)"),
    ("wikipedia_happening",         "https://fr.wikipedia.org/wiki/Happening"),
    ("wikipedia_espace_public",     "https://fr.wikipedia.org/wiki/Espace_public"),

    # Artistes personas
    ("wikipedia_pierre_schaeffer",  "https://fr.wikipedia.org/wiki/Pierre_Schaeffer"),
    ("wikipedia_eliane_radigue",    "https://fr.wikipedia.org/wiki/%C3%89liane_Radigue"),
    ("wikipedia_pauline_oliveros",  "https://fr.wikipedia.org/wiki/Pauline_Oliveros"),
    ("wikipedia_pina_bausch",       "https://fr.wikipedia.org/wiki/Pina_Bausch"),
    ("wikipedia_musique_concrete",  "https://fr.wikipedia.org/wiki/Musique_concr%C3%A8te"),
    ("wikipedia_deep_listening",    "https://en.wikipedia.org/wiki/Deep_listening"),
    ("wikipedia_fluxus",            "https://fr.wikipedia.org/wiki/Fluxus"),
    ("wikipedia_situationnisme",    "https://fr.wikipedia.org/wiki/Situationnisme"),

    # Compagnies arts de la rue
    ("wikipedia_royal_de_luxe",     "https://fr.wikipedia.org/wiki/Royal_de_Luxe"),
    ("wikipedia_compagnie_carabosse","https://fr.wikipedia.org/wiki/Carabosse_(compagnie)"),
    ("wikipedia_ilotopie",          "https://fr.wikipedia.org/wiki/Ilotopie"),

    # Institutions
    ("artcena_espace_public",       "https://www.artcena.fr/guide/diffuser-son-spectacle/diffuser-son-projet-dans-lespace-public"),
    ("culture_gouv_cnarep",         "https://www.culture.gouv.fr/thematiques/theatre-spectacles/le-theatre-et-les-spectacles-en-france/centres-nationaux-des-arts-de-la-rue-et-de-l-espace-public-cnarep"),

    # Texte académique
    ("lyon2_arts_rue_barcelone",    "https://sites.univ-lyon2.fr/iul/barcelone.pdf"),
]

# Queries SearXNG pour enrichir dynamiquement
SEARXNG_QUERIES = [
    "histoire arts de la rue France compagnies",
    "spectacle vivant espace public dramaturgie",
    "théâtre de rue festival Aurillac Chalons",
    "Komplex Kapharnaum compagnie arts rue",
    "Royal de Luxe géants rue spectacle",
    "Ilotopie eau spectacle pyrotechnique",
    "noise art espace public performance sonore",
    "Situationniste dérive espace urbain spectacle",
    "Fluxus performance art rue happening",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_id(key: str) -> str:
    return hashlib.md5(key.encode()).hexdigest()[:16]


def needs_stealth(url: str) -> bool:
    from urllib.parse import urlparse
    domain = urlparse(url).netloc.lstrip("www.")
    return any(domain.endswith(d) for d in STEALTH_DOMAINS)


def fetch_html_stealth(url: str, timeout: int = 30) -> str | None:
    """Fetch via Camoufox (stealth Firefox) for bot-protected sites."""
    try:
        from camoufox.sync_api import Camoufox
        with Camoufox(headless=True) as browser:
            page = browser.new_page()
            page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            return page.content()
    except ImportError:
        logger.warning("camoufox not installed, falling back to requests")
        return fetch_html_plain(url, timeout)
    except Exception as e:
        logger.warning(f"camoufox fetch failed {url}: {e}")
        return None


def fetch_html_plain(url: str, timeout: int = 15) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        return r.text
    except Exception as e:
        logger.warning(f"requests fetch failed {url}: {e}")
        return None


def fetch_html(url: str, timeout: int = 15) -> str | None:
    if needs_stealth(url):
        logger.info(f"  [stealth] {url}")
        return fetch_html_stealth(url, timeout=30)
    html = fetch_html_plain(url, timeout)
    if html is None or len(html) < 500:
        # Retry with stealth on failure
        logger.info(f"  [stealth fallback] {url}")
        return fetch_html_stealth(url, timeout=30)
    return html


def html_to_text(html: str, url: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    # Remove nav, footer, scripts, styles
    for tag in soup(["script", "style", "nav", "footer", "header",
                     "aside", "form", "iframe", "noscript"]):
        tag.decompose()

    # Wikipedia: keep only #content div
    if "wikipedia.org" in url:
        content = soup.find("div", id="mw-content-text")
        if content:
            return content.get_text(separator="\n", strip=True)

    return soup.get_text(separator="\n", strip=True)


def fetch_pdf_text(url: str) -> str | None:
    try:
        # Try docling service first
        r = requests.post(
            "http://localhost:9400/v1alpha/convert/source",
            json={"http_source": {"url": url}},
            timeout=60,
        )
        if r.ok:
            data = r.json()
            return data.get("document", {}).get("md_content") or data.get("text", "")
    except Exception:
        pass

    # Fallback: raw text extraction via pdfminer if available
    try:
        import urllib.request, io
        from pdfminer.high_level import extract_text_to_fp
        from pdfminer.layout import LAParams

        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            pdf_bytes = resp.read()
        out = io.StringIO()
        extract_text_to_fp(io.BytesIO(pdf_bytes), out, laparams=LAParams())
        return out.getvalue()
    except Exception as e:
        logger.warning(f"PDF extraction failed {url}: {e}")
        return None


def searxng_discover(query: str, max_results: int = 5) -> list[tuple[str, str]]:
    try:
        r = requests.get(
            f"{SEARXNG_URL}/search",
            params={"q": query, "format": "json", "language": "fr"},
            timeout=10,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        return [(f"searxng_{make_id(r['url'])}", r["url"])
                for r in results[:max_results]
                if r.get("url")]
    except Exception as e:
        logger.warning(f"SearXNG query failed '{query}': {e}")
        return []


def ingest_batch(texts: list[str], ids: list[str]) -> bool:
    try:
        r = requests.post(
            f"{LIGHTRAG_URL}/documents/texts",
            json={"texts": texts, "ids": ids},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        logger.info(f"Ingested batch {ids[0]}…{ids[-1]}: {data.get('status')}")
        return True
    except Exception as e:
        logger.error(f"Ingest failed: {e}")
        return False


def get_processed_ids() -> set[str]:
    """Read processed doc IDs directly from LightRAG's local status file (avoids API bug)."""
    import os
    status_file = "/home/kxkm/KXKM_Clown/data/lightrag/kv_store_doc_status.json"
    if not os.path.exists(status_file):
        return set()
    try:
        with open(status_file) as f:
            data = json.load(f)
        return {doc_id for doc_id, v in data.items()
                if v.get("status") in ("processed", "processing")}
    except Exception:
        return set()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info("=== KXKM_Clown corpus sourcing — spectacle en espace public ===")

    processed = get_processed_ids()
    logger.info(f"Already ingested: {len(processed)} docs")

    batch_texts, batch_ids = [], []

    def flush(force: bool = False):
        if batch_texts and (force or len(batch_texts) >= 5):
            ingest_batch(batch_texts[:], batch_ids[:])
            batch_texts.clear()
            batch_ids.clear()
            time.sleep(2)  # don't hammer Ollama

    # --- Seed URLs ---
    all_urls = list(SEED_URLS)

    # --- Sherlock live-search discoveries ---
    sherlock_urls = load_sherlock_queue()
    all_urls.extend(sherlock_urls)

    # --- SearXNG discovery ---
    logger.info("Discovering URLs via SearXNG...")
    for query in SEARXNG_QUERIES:
        discovered = searxng_discover(query, max_results=4)
        all_urls.extend(discovered)
        time.sleep(0.5)

    logger.info(f"Total URLs to process: {len(all_urls)}")

    for doc_id, url in all_urls:
        full_id = make_id(doc_id + url)

        if full_id in processed:
            logger.debug(f"Skip (already ingested): {url}")
            continue

        logger.info(f"Fetching: {url}")

        if url.endswith(".pdf"):
            text = fetch_pdf_text(url)
        else:
            html = fetch_html(url)
            text = html_to_text(html, url) if html else None

        if not text or len(text.strip()) < 200:
            logger.warning(f"Too short or empty: {url} ({len(text or '')} chars)")
            continue

        # Truncate to ~8000 chars to avoid overwhelming LLM context
        text = text[:8000]
        logger.info(f"  → {len(text)} chars | id={full_id}")

        batch_texts.append(text)
        batch_ids.append(full_id)
        flush()

    flush(force=True)
    logger.info("=== Sourcing complete ===")


if __name__ == "__main__":
    main()
