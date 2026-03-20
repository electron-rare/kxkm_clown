const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac",
  "audio/x-flac",
]);

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 12000;

function cleanText(value, maxLength = 12000) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function pickAttachmentKind(mime, fileName = "") {
  const normalizedMime = String(mime || "").toLowerCase().trim();
  const lowerName = String(fileName || "").toLowerCase();

  if (TEXT_MIME_TYPES.has(normalizedMime) || /\.(txt|md|json)$/i.test(lowerName)) return "text";
  if (IMAGE_MIME_TYPES.has(normalizedMime) || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return "image";
  if (AUDIO_MIME_TYPES.has(normalizedMime) || /\.(wav|mp3|ogg|m4a|flac)$/i.test(lowerName)) return "audio";
  return "unknown";
}

function getAcceptedMimeTypes() {
  return [
    ...TEXT_MIME_TYPES,
    ...IMAGE_MIME_TYPES,
    ...AUDIO_MIME_TYPES,
  ];
}

function assertSupportedUpload({ mime, fileName, sizeBytes }) {
  if (!sizeBytes || sizeBytes < 1) {
    const error = new Error("Fichier vide");
    error.statusCode = 400;
    throw error;
  }

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    const error = new Error(`Fichier trop volumineux (${Math.round(sizeBytes / 1024 / 1024)} Mo > ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo)`);
    error.statusCode = 413;
    throw error;
  }

  const kind = pickAttachmentKind(mime, fileName);
  if (kind === "unknown") {
    const error = new Error("Type de fichier non supporté");
    error.statusCode = 415;
    throw error;
  }

  return kind;
}

function summarizeText(text) {
  const clean = cleanText(text, MAX_EXTRACTED_TEXT_CHARS);
  if (!clean) return "Fichier texte joint.";
  const lines = clean.split(/\r?\n/).filter(Boolean).slice(0, 6);
  return cleanText(lines.join(" ").replace(/\s+/g, " "), 260) || "Fichier texte joint.";
}

function createImageAnalyzer({ adapter } = {}) {
  return async function analyzeImage(record, buffer) {
    if (adapter) {
      return adapter(record, buffer);
    }
    console.warn("[attachment-pipeline] analyzeImage called but no vision adapter configured — returning stub result");
    return {
      type: "image",
      analyzed: false,
      reason: "not_implemented",
      kind: "image",
      title: record.originalName || "image",
      sourceSummary: `Image jointe (${record.mime}, ${Math.round((record.sizeBytes || buffer.length) / 1024)} Ko).`,
      extractedText: "",
      transcript: "",
      caption: "Analyse vision indisponible: stub en attente d'intégration.",
      tags: ["image", "metadata_only", "stub"],
      warnings: ["Aucun adaptateur vision configuré — résultat stub."],
      adapter: "stub",
    };
  };
}

function createAudioAnalyzer({ adapter } = {}) {
  return async function analyzeAudio(record, buffer) {
    if (adapter) {
      return adapter(record, buffer);
    }
    console.warn("[attachment-pipeline] analyzeAudio called but no transcription adapter configured — returning stub result");
    return {
      type: "audio",
      analyzed: false,
      reason: "not_implemented",
      kind: "audio",
      title: record.originalName || "audio",
      sourceSummary: `Audio joint (${record.mime}, ${Math.round((record.sizeBytes || buffer.length) / 1024)} Ko).`,
      extractedText: "",
      transcript: "",
      caption: "",
      tags: ["audio", "metadata_only", "stub"],
      warnings: ["Aucun adaptateur de transcription configuré — résultat stub."],
      adapter: "stub",
    };
  };
}

const analyzeImageStub = createImageAnalyzer();
const analyzeAudioStub = createAudioAnalyzer();

async function analyzeAttachment(record, buffer) {
  const kind = record.kind || pickAttachmentKind(record.mime, record.originalName);

  if (kind === "text") {
    const extractedText = cleanText(buffer.toString("utf-8"), MAX_EXTRACTED_TEXT_CHARS);
    return {
      kind,
      title: record.originalName,
      sourceSummary: summarizeText(extractedText),
      extractedText,
      transcript: "",
      caption: "",
      tags: ["text", "local_upload"],
      warnings: extractedText ? [] : ["Texte vide après normalisation UTF-8."],
      adapter: "native",
    };
  }

  if (kind === "image") {
    return analyzeImageStub(record, buffer);
  }

  if (kind === "audio") {
    return analyzeAudioStub(record, buffer);
  }

  const error = new Error("Type de fichier non supporté");
  error.statusCode = 415;
  throw error;
}

module.exports = {
  MAX_UPLOAD_BYTES,
  getAcceptedMimeTypes,
  pickAttachmentKind,
  assertSupportedUpload,
  analyzeAttachment,
  createImageAnalyzer,
  createAudioAnalyzer,
};
