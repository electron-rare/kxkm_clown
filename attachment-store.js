const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeExtName(name) {
  const ext = path.extname(String(name || "").trim()).slice(0, 12).toLowerCase();
  return /^[a-z0-9.]+$/i.test(ext) ? ext : "";
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sanitizeId(id, maxLength = 60) {
  return String(id || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, maxLength);
}

function createAttachmentStore({ dataDir }) {
  const uploadsDir = path.join(dataDir, "uploads");
  const uploadsMetaDir = path.join(dataDir, "uploads-meta");

  ensureDir(uploadsDir);
  ensureDir(uploadsMetaDir);

  function metaPath(id) {
    return path.join(uploadsMetaDir, `${sanitizeId(id)}.json`);
  }

  function buildStoragePath(id, originalName) {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const safeId = sanitizeId(id);
    const ext = safeExtName(originalName);
    const dir = path.join(uploadsDir, year, month);
    ensureDir(dir);
    const resolved = path.join(dir, `${safeId}${ext}`);
    if (!resolved.startsWith(uploadsDir)) {
      throw new Error("Invalid upload path");
    }
    return resolved;
  }

  function readMeta(id) {
    const file = metaPath(id);
    if (!fs.existsSync(file)) return null;

    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }

  function writeMeta(id, data) {
    fs.writeFileSync(metaPath(id), JSON.stringify(data, null, 2));
    return data;
  }

  function sanitizeRecord(record) {
    if (!record) return null;

    return {
      id: String(record.id || ""),
      sessionId: String(record.sessionId || ""),
      nick: String(record.nick || ""),
      channel: String(record.channel || ""),
      kind: String(record.kind || "unknown"),
      mime: String(record.mime || "application/octet-stream"),
      originalName: String(record.originalName || "attachment"),
      sizeBytes: Number(record.sizeBytes) || 0,
      sha256: String(record.sha256 || ""),
      storedPath: String(record.storedPath || ""),
      status: String(record.status || "uploaded"),
      createdAt: String(record.createdAt || new Date().toISOString()),
      updatedAt: String(record.updatedAt || record.createdAt || new Date().toISOString()),
      analysis: clone(record.analysis) || null,
      error: clone(record.error) || null,
    };
  }

  function createAttachmentRecord({
    sessionId,
    nick,
    channel,
    kind,
    mime,
    originalName,
    buffer,
  }) {
    const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const storedPath = buildStoragePath(id, originalName);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const createdAt = new Date().toISOString();

    fs.writeFileSync(storedPath, buffer);

    const record = sanitizeRecord({
      id,
      sessionId,
      nick,
      channel,
      kind,
      mime,
      originalName,
      sizeBytes: buffer.length,
      sha256,
      storedPath,
      status: "uploaded",
      createdAt,
      updatedAt: createdAt,
      analysis: null,
      error: null,
    });

    writeMeta(id, record);
    return record;
  }

  function updateAttachment(id, patch = {}) {
    const current = readMeta(id);
    if (!current) return null;

    const next = sanitizeRecord({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      analysis: patch.analysis === undefined ? current.analysis : clone(patch.analysis),
      error: patch.error === undefined ? current.error : clone(patch.error),
    });

    writeMeta(id, next);
    return next;
  }

  function getAttachment(id) {
    return sanitizeRecord(readMeta(id));
  }

  function readAttachmentBuffer(id) {
    const record = getAttachment(id);
    if (!record?.storedPath || !fs.existsSync(record.storedPath)) return null;
    return fs.readFileSync(record.storedPath);
  }

  function toClientAttachment(record) {
    if (!record) return null;

    return {
      id: record.id,
      nick: record.nick,
      channel: record.channel,
      kind: record.kind,
      mime: record.mime,
      originalName: record.originalName,
      sizeBytes: record.sizeBytes,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      analysis: record.analysis
        ? {
            kind: record.analysis.kind,
            title: record.analysis.title,
            sourceSummary: record.analysis.sourceSummary,
            caption: record.analysis.caption || "",
            transcript: record.analysis.transcript || "",
            extractedText: record.analysis.extractedText || "",
            tags: Array.isArray(record.analysis.tags) ? record.analysis.tags : [],
            warnings: Array.isArray(record.analysis.warnings) ? record.analysis.warnings : [],
            adapter: record.analysis.adapter || "none",
          }
        : null,
      error: record.error || null,
      downloadUrl: `/api/chat/attachments/${encodeURIComponent(record.id)}/blob`,
    };
  }

  return {
    createAttachmentRecord,
    updateAttachment,
    getAttachment,
    readAttachmentBuffer,
    toClientAttachment,
  };
}

module.exports = {
  createAttachmentStore,
};
