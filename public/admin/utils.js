export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTs(value) {
  if (!value) return "\u2014";
  return String(value).replace("T", " ").slice(0, 19);
}
