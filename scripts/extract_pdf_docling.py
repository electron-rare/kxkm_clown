#!/usr/bin/env python3
"""Extract text from PDF using Docling (tables, layout, OCR)."""
import argparse, json, sys, time

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--max-chars", type=int, default=12000)
    args = p.parse_args()
    start = time.time()
    result = {"status": "failed", "text": "", "error": None}
    try:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        doc = converter.convert(args.input)
        text = doc.document.export_to_markdown()[:args.max_chars]
        pages = len(doc.document.pages) if hasattr(doc.document, 'pages') else 0
        result = {"status": "completed", "text": text, "pages": pages, "duration": round(time.time()-start, 2)}
    except ImportError:
        # Fallback to pdf-parse style
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(args.input)
            text = ""
            for page in doc:
                text += page.get_text()
            text = text[:args.max_chars]
            result = {"status": "completed", "text": text, "pages": len(doc), "duration": round(time.time()-start, 2)}
        except ImportError:
            result["error"] = "Neither docling nor PyMuPDF installed"
    except Exception as e:
        result["error"] = str(e)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
