const TOKEN_KEY = "kxkmAdminToken";

export function loadAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function saveAdminToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function jsonFetch(path, options = {}, { admin = false } = {}) {
  const headers = new Headers(options.headers || {});
  if (admin) {
    const token = loadAdminToken();
    if (!token) throw new Error("Token admin requis");
    headers.set("x-admin-bootstrap-token", token);
  }
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }
  return payload;
}

async function blobFetch(path, { admin = false } = {}) {
  const headers = new Headers();
  if (admin) {
    const token = loadAdminToken();
    if (!token) throw new Error("Token admin requis");
    headers.set("x-admin-bootstrap-token", token);
  }
  const response = await fetch(path, { headers });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Erreur HTTP ${response.status}`);
  }
  return response.blob();
}

export const adminApi = {
  getPublicStatus() {
    return jsonFetch("/api/status");
  },
  getNodeEngineOverview() {
    return jsonFetch("/api/admin/node-engine/overview", {}, { admin: true });
  },
  getNodeEngineNodeTypes() {
    return jsonFetch("/api/admin/node-engine/node-types", {}, { admin: true });
  },
  getNodeEngineGraphs() {
    return jsonFetch("/api/admin/node-engine/graphs", {}, { admin: true });
  },
  getNodeEngineGraph(id) {
    return jsonFetch(`/api/admin/node-engine/graphs/${encodeURIComponent(id)}`, {}, { admin: true });
  },
  createNodeEngineGraph(payload) {
    return jsonFetch("/api/admin/node-engine/graphs", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { admin: true });
  },
  updateNodeEngineGraph(id, payload) {
    return jsonFetch(`/api/admin/node-engine/graphs/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }, { admin: true });
  },
  getNodeEngineRuns(limit = 20) {
    return jsonFetch(`/api/admin/node-engine/runs?limit=${encodeURIComponent(limit)}`, {}, { admin: true });
  },
  getNodeEngineRun(id) {
    return jsonFetch(`/api/admin/node-engine/runs/${encodeURIComponent(id)}`, {}, { admin: true });
  },
  runNodeEngineGraph(id, payload = {}) {
    return jsonFetch(`/api/admin/node-engine/graphs/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, { admin: true });
  },
  getRuntime() {
    return jsonFetch("/api/admin/runtime", {}, { admin: true });
  },
  getChannels() {
    return jsonFetch("/api/admin/channels", {}, { admin: true });
  },
  updateChannelTopic(channel, topic, updatedBy = "admin") {
    const encoded = encodeURIComponent(channel.replace(/^#/, ""));
    return jsonFetch(`/api/admin/channels/${encoded}/topic`, {
      method: "PUT",
      body: JSON.stringify({ topic, updatedBy }),
    }, { admin: true });
  },
  getLogsSummary(limit = 12) {
    return jsonFetch(`/api/admin/logs/summary?limit=${encodeURIComponent(limit)}`, {}, { admin: true });
  },
  searchHistory(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.channel) query.set("channel", params.channel);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.before) query.set("before", params.before);
    return jsonFetch(`/api/admin/history/search?${query.toString()}`, {}, { admin: true });
  },
  async downloadHtmlExport(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.channel) query.set("channel", params.channel);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.before) query.set("before", params.before);
    const blob = await blobFetch(`/api/admin/export/html?${query.toString()}`, { admin: true });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kxkm-export.html";
    anchor.click();
    URL.revokeObjectURL(url);
  },
  async downloadJson(path, filename, { admin = false } = {}) {
    const blob = await blobFetch(path, { admin });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};
