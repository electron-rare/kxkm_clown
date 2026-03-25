#!/usr/bin/env bash
# Export DPO training data from chat logs
set -e
source ~/.nvm/nvm.sh
cd ~/KXKM_Clown

export OUTDIR=data/dpo-exports/$(date +%Y%m%d)
mkdir -p $OUTDIR

echo "[dpo] Exporting from chat logs..."

# Extract chosen/rejected pairs from feedback
node -e "
const fs = require('fs');
const path = require('path');

const logDir = 'data/chat-logs';
const pairs = [];

// Read recent chat logs
const files = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl')).sort().slice(-7);
for (const file of files) {
  const lines = fs.readFileSync(path.join(logDir, file), 'utf-8').trim().split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    try {
      const msg = JSON.parse(lines[i]);
      const next = JSON.parse(lines[i + 1]);
      if (msg.type === 'message' && msg.nick && next.type === 'message' && next.nick !== msg.nick) {
        pairs.push({
          prompt: msg.text,
          chosen: next.text,
          persona: next.nick,
        });
      }
    } catch {}
  }
}

fs.writeFileSync(process.env.OUTDIR + '/dpo-pairs.jsonl', pairs.map(p => JSON.stringify(p)).join('\n'));
console.log('[dpo] Exported ' + pairs.length + ' pairs to ' + process.env.OUTDIR + '/dpo-pairs.jsonl');
"

echo "[dpo] Done. Output: $OUTDIR/"
ls -la $OUTDIR/
