#!/usr/bin/env bash
KXKM_DIR=/home/kxkm/KXKM_Clown
find $KXKM_DIR/data/chat-logs -name "*.jsonl" -mtime +30 -delete 2>/dev/null
for f in $KXKM_DIR/data/persona-memory/*.json; do
  size=$(stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$size" -gt 102400 ] && python3 -c "
import json
with open(\"$f\") as fh: d = json.load(fh)
d[\"facts\"] = d.get(\"facts\", [])[-20:]
with open(\"$f\", \"w\") as fh: json.dump(d, fh, indent=2)
" && echo "[cleanup] Trimmed $f"
done
echo "[cleanup] Done $(date)"
