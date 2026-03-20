const fs = require("fs");
const path = require("path");

function createAuditLogger({ dataDir }) {
  const logDir = path.join(dataDir, "audit");

  function ensureDir() {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  function todayFile() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return path.join(logDir, `${yyyy}-${mm}-${dd}.jsonl`);
  }

  function log({ actor, action, target, detail, ip }) {
    ensureDir();
    const entry = {
      timestamp: new Date().toISOString(),
      actor: actor || "unknown",
      action: action || "unknown",
      target: target || null,
      detail: detail || null,
      ip: ip || null,
    };
    try {
      fs.appendFileSync(todayFile(), JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      console.error("[audit-log] write error:", err.message);
    }
  }

  function readRecent(limit = 100) {
    ensureDir();
    const entries = [];
    let files;
    try {
      files = fs.readdirSync(logDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()
        .reverse();
    } catch {
      return entries;
    }

    for (const file of files) {
      if (entries.length >= limit) break;
      try {
        const content = fs.readFileSync(path.join(logDir, file), "utf-8");
        const lines = content.trim().split("\n").filter(Boolean).reverse();
        for (const line of lines) {
          if (entries.length >= limit) break;
          try {
            entries.push(JSON.parse(line));
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    return entries;
  }

  return { log, readRecent };
}

module.exports = { createAuditLogger };
