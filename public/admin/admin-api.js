const SESSION_ENDPOINTS = [
  "/api/admin/session",
  "/api/admin/auth/session",
];

let sessionEndpointCache;
let sessionEndpointProbe = null;
let legacyAdminToken = "";
let authSnapshot = {
  authenticated: false,
  mode: "none",
  sessionSupported: null,
  sessionEndpoint: null,
  source: "bootstrap",
};

function normalizeAuth(patch = {}) {
  authSnapshot = {
    ...authSnapshot,
    ...patch,
  };
  return authSnapshot;
}

function authFromEndpoint(endpoint, { authenticated, source }) {
  return normalizeAuth({
    authenticated,
    mode: endpoint ? "cookie" : legacyAdminToken ? "legacy-header" : "none",
    sessionSupported: Boolean(endpoint),
    sessionEndpoint: endpoint || null,
    source,
  });
}

function safeToken(value) {
  return String(value || "").trim();
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function resolveSessionEndpoint(force = false) {
  if (!force && sessionEndpointCache !== undefined) return sessionEndpointCache;
  if (sessionEndpointProbe) return sessionEndpointProbe;

  sessionEndpointProbe = (async () => {
    for (const endpoint of SESSION_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        });

        if (response.status === 404 || response.status === 405) continue;

        sessionEndpointCache = endpoint;
        return endpoint;
      } catch {
        continue;
      }
    }

    sessionEndpointCache = null;
    return null;
  })();

  try {
    return await sessionEndpointProbe;
  } finally {
    sessionEndpointProbe = null;
  }
}

function buildAdminHeaders(input, { admin = false } = {}) {
  const headers = new Headers(input || {});
  if (admin && legacyAdminToken) {
    headers.set("x-admin-bootstrap-token", legacyAdminToken);
  }
  return headers;
}

// Request deduplication: prevent duplicate concurrent requests to the same endpoint
const inflightRequests = new Map(); // key → Promise

function deduplicatedFetch(key, fetchFn) {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }
  const promise = fetchFn().finally(() => {
    inflightRequests.delete(key);
  });
  inflightRequests.set(key, promise);
  return promise;
}

async function jsonFetchCore(path, options = {}, { admin = false } = {}) {
  const endpoint = admin ? await resolveSessionEndpoint() : null;
  if (admin && !endpoint && !legacyAdminToken) {
    throw new Error("Session admin requise");
  }

  const headers = buildAdminHeaders(options.headers, { admin });
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    if (admin && (response.status === 401 || response.status === 403)) {
      authFromEndpoint(endpoint, { authenticated: false, source: "request" });
    }
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }

  if (admin) {
    authFromEndpoint(endpoint, { authenticated: true, source: endpoint ? "cookie" : "legacy-fallback" });
  }

  return payload;
}

function jsonFetch(path, options = {}, flags = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method === "GET") {
    return deduplicatedFetch(path, () => jsonFetchCore(path, options, flags));
  }
  return jsonFetchCore(path, options, flags);
}

async function blobFetch(path, { admin = false } = {}) {
  const endpoint = admin ? await resolveSessionEndpoint() : null;
  if (admin && !endpoint && !legacyAdminToken) {
    throw new Error("Session admin requise");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    headers: buildAdminHeaders(null, { admin }),
  });

  if (!response.ok) {
    if (admin && (response.status === 401 || response.status === 403)) {
      authFromEndpoint(endpoint, { authenticated: false, source: "request" });
    }
    const payload = await response.text();
    throw new Error(payload || `Erreur HTTP ${response.status}`);
  }

  if (admin) {
    authFromEndpoint(endpoint, { authenticated: true, source: endpoint ? "cookie" : "legacy-fallback" });
  }

  return response.blob();
}

async function fetchAdminSessionState() {
  const endpoint = await resolveSessionEndpoint();
  if (!endpoint) {
    return normalizeAuth({
      authenticated: Boolean(legacyAdminToken),
      mode: legacyAdminToken ? "legacy-header" : "none",
      sessionSupported: false,
      sessionEndpoint: null,
      source: legacyAdminToken ? "legacy-fallback" : "anonymous",
    });
  }

  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
  });
  const payload = await readJson(response);

  if (response.ok) {
    legacyAdminToken = "";
    return normalizeAuth({
      authenticated: payload.authenticated !== false,
      mode: "cookie",
      sessionSupported: true,
      sessionEndpoint: endpoint,
      source: "cookie",
    });
  }

  if (response.status === 401 || response.status === 403) {
    return normalizeAuth({
      authenticated: false,
      mode: "cookie",
      sessionSupported: true,
      sessionEndpoint: endpoint,
      source: "cookie",
    });
  }

  if (response.status === 404 || response.status === 405) {
    sessionEndpointCache = null;
    return fetchAdminSessionState();
  }

  throw new Error(payload.error || `Erreur HTTP ${response.status}`);
}

export function getLegacyAdminToken() {
  return legacyAdminToken;
}

export function getAdminAuthSnapshot() {
  return { ...authSnapshot };
}

export async function getAdminSession() {
  return fetchAdminSessionState();
}

export async function openAdminSession(token) {
  const cleanToken = safeToken(token);
  const endpoint = await resolveSessionEndpoint();

  if (endpoint) {
    if (!cleanToken) {
      const current = await fetchAdminSessionState();
      if (current.authenticated) return current;
      throw new Error("Token bootstrap requis pour ouvrir la session admin");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ token: cleanToken }),
    });
    const payload = await readJson(response);

    if (response.ok) {
      legacyAdminToken = "";
      return normalizeAuth({
        authenticated: true,
        mode: "cookie",
        sessionSupported: true,
        sessionEndpoint: endpoint,
        source: "bootstrap",
      });
    }

    if (response.status !== 404 && response.status !== 405) {
      throw new Error(payload.error || `Erreur HTTP ${response.status}`);
    }

    sessionEndpointCache = null;
  }

  if (!cleanToken) {
    if (legacyAdminToken) {
      return normalizeAuth({
        authenticated: true,
        mode: "legacy-header",
        sessionSupported: false,
        sessionEndpoint: null,
        source: "legacy-fallback",
      });
    }
    throw new Error("Token bootstrap requis");
  }

  legacyAdminToken = cleanToken;
  await jsonFetch("/api/admin/runtime/status", {}, { admin: true });
  return normalizeAuth({
    authenticated: true,
    mode: "legacy-header",
    sessionSupported: false,
    sessionEndpoint: null,
    source: "legacy-fallback",
  });
}

export async function clearAdminSession() {
  legacyAdminToken = "";
  const endpoint = await resolveSessionEndpoint();

  if (endpoint) {
    const response = await fetch(endpoint, {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    });

    if (![200, 204, 401, 403, 404, 405].includes(response.status)) {
      const payload = await readJson(response);
      throw new Error(payload.error || `Erreur HTTP ${response.status}`);
    }

    if (response.status === 404 || response.status === 405) {
      sessionEndpointCache = null;
    }
  }

  return normalizeAuth({
    authenticated: false,
    mode: sessionEndpointCache ? "cookie" : "none",
    sessionSupported: sessionEndpointCache ? true : false,
    sessionEndpoint: sessionEndpointCache || null,
    source: "logout",
  });
}

export const adminApi = {
  getPublicStatus() {
    return jsonFetch("/api/status");
  },
  createAdminSession(token) {
    return openAdminSession(token);
  },
  getAdminSession() {
    return getAdminSession();
  },
  destroyAdminSession() {
    return clearAdminSession();
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
  async cancelNodeEngineRun(id, payload = {}) {
    const encodedId = encodeURIComponent(id);
    const attempts = [
      `/api/admin/node-engine/runs/${encodedId}/cancel`,
      `/api/admin/node-engine/runs/${encodedId}/actions/cancel`,
    ];

    for (const path of attempts) {
      try {
        return await jsonFetch(path, {
          method: "POST",
          body: JSON.stringify(payload),
        }, { admin: true });
      } catch (error) {
        if (/Erreur HTTP 404|Erreur HTTP 405/.test(error.message)) continue;
        throw error;
      }
    }

    throw new Error("Annulation Node Engine non disponible sur ce backend");
  },
  getNodeEngineArtifacts(runId) {
    return jsonFetch(`/api/admin/node-engine/artifacts/${encodeURIComponent(runId)}`, {}, { admin: true });
  },
  previewNodeEngineNode(payload) {
    return jsonFetch("/api/admin/node-engine/nodes/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }, { admin: true });
  },
  getNodeEngineModels(limit = 20) {
    return jsonFetch(`/api/admin/node-engine/models?limit=${encodeURIComponent(limit)}`, {}, { admin: true });
  },
  getNodeEngineModel(id) {
    return jsonFetch(`/api/admin/node-engine/models/${encodeURIComponent(id)}`, {}, { admin: true });
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
