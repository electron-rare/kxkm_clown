#!/usr/bin/env python3
"""Extract text from PDF using Docling (HTTP API → local library → PyMuPDF fallback)."""
import argparse, json, os, sys, time


def try_docling_http(filepath: str, max_chars: int) -> dict | None:
    """Try Docling-serve HTTP API if DOCLING_URL is set."""
    docling_url = os.environ.get("DOCLING_URL", "").rstrip("/")
    if not docling_url:
        return None
    import urllib.request, urllib.error
    from pathlib import Path

    url = f"{docling_url}/v1/convert/file"
    filename = Path(filepath).name

    # Build multipart form data manually (no requests dependency)
    boundary = f"----DoclingBoundary{int(time.time()*1000)}"
    file_data = Path(filepath).read_bytes()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            # docling-serve response: {document: {md_content, filename}, status, processing_time}
            text = ""
            if isinstance(result, dict):
                doc = result.get("document", {})
                if isinstance(doc, dict):
                    text = doc.get("md_content", "") or doc.get("text_content", "") or ""
                if not text:
                    text = result.get("text", "") or result.get("markdown", "")
                if not text:
                    text = json.dumps(result, ensure_ascii=False)
            text = text[:max_chars]
            status = result.get("status", "unknown") if isinstance(result, dict) else "unknown"
            return {"status": "completed", "text": text, "pages": "?", "backend": "docling-serve",
                    "docling_status": status}
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError) as e:
        print(f"[docling-http] fallback: {e}", file=sys.stderr)
        return None


def try_docling_local(filepath: str, max_chars: int) -> dict | None:
    """Try local Docling Python library."""
    try:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        doc = converter.convert(filepath)
        text = doc.document.export_to_markdown()[:max_chars]
        pages = len(doc.document.pages) if hasattr(doc.document, "pages") else 0
        return {"status": "completed", "text": text, "pages": pages, "backend": "docling-local"}
    except ImportError:
        return None
    except Exception as e:
        print(f"[docling-local] fallback: {e}", file=sys.stderr)
        return None


def try_pymupdf(filepath: str, max_chars: int) -> dict | None:
    """Fallback to PyMuPDF."""
    try:
        import fitz
        doc = fitz.open(filepath)
        text = ""
        for page in doc:
            text += page.get_text()
        text = text[:max_chars]
        return {"status": "completed", "text": text, "pages": len(doc), "backend": "pymupdf"}
    except ImportError:
        return None
    except Exception as e:
        print(f"[pymupdf] error: {e}", file=sys.stderr)
        return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--max-chars", type=int, default=12000)
    args = p.parse_args()
    start = time.time()

    # Try backends in order: HTTP API → local library → PyMuPDF
    for backend_fn in [try_docling_http, try_docling_local, try_pymupdf]:
        result = backend_fn(args.input, args.max_chars)
        if result:
            result["duration"] = round(time.time() - start, 2)
            print(json.dumps(result))
            return

    print(json.dumps({"status": "failed", "error": "No PDF backend available (docling-serve, docling, PyMuPDF)"}))


if __name__ == "__main__":
    main()
