"use strict";

const NEW_PERSONA_GRAPH_ID = "__new__";
const SESSION_ENDPOINTS = [
  "/api/admin/session",
  "/api/admin/auth/session",
];
const ADMIN_AUTH_MESSAGE = "kxkm-admin-auth";

const tokenInput = document.getElementById("token-input");
const loadButton = document.getElementById("load-button");
const refreshButton = document.getElementById("refresh-button");
const createButton = document.getElementById("create-button");
const statusEl = document.getElementById("status");
const personaGrid = document.getElementById("persona-grid");
const createIdInput = document.getElementById("create-id");
const createNameInput = document.getElementById("create-name");
const createModelInput = document.getElementById("create-model");
const createQueryInput = document.getElementById("create-query");
const createToneInput = document.getElementById("create-tone");
const createThemesInput = document.getElementById("create-themes");
const createLexiconInput = document.getElementById("create-lexicon");
const createFactsInput = document.getElementById("create-facts");
const createQuotesInput = document.getElementById("create-quotes");
const createNotesInput = document.getElementById("create-notes");
const createSourcesInput = document.getElementById("create-sources");
const graphPersonaSelect = document.getElementById("graph-persona-select");
const graphCenterButton = document.getElementById("graph-center-button");
const graphCanvas = document.getElementById("graph-canvas");
const graphCanvasWrap = document.querySelector(".graph-canvas-wrap");
const graphInspector = document.getElementById("graph-inspector");

let sessionActive = false;
let sessionSupported = null;
let sessionEndpointCache;
let sessionEndpointProbe = null;
let legacyAdminToken = "";
let personas = [];
let selectedGraphPersonaId = "";
let selectedGraphNodeKey = "";
let graphEditor = null;
let graphNodeIds = new Map();

const graphBus = createEventBus();

function createEventBus() {
  const listeners = new Map();

  return {
    on(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(handler);
    },
    emit(eventName, payload) {
      for (const handler of listeners.get(eventName) || []) {
        handler(payload);
      }
    },
  };
}

function setStatus(text, tone = "info") {
  statusEl.textContent = text;
  statusEl.className = `status ${tone}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function toMultiline(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSourceRefs(value) {
  return parseLines(value).map((line) => {
    const parts = line.split("|").map((item) => item.trim());
    return {
      title: parts[0] || "",
      url: parts[1] || "",
      notes: parts[2] || "",
    };
  }).filter((entry) => entry.title || entry.url || entry.notes);
}

function truncate(text, max = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function formatTs(ts) {
  if (!ts) return "—";
  return String(ts).replace("T", " ").slice(0, 16);
}

function summarizeItems(label, items, maxItems = 3, maxLength = 36) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return `${label}: —`;
  const head = list
    .slice(0, maxItems)
    .map((item) => truncate(item, maxLength))
    .join(" · ");
  const extra = list.length > maxItems ? ` +${list.length - maxItems}` : "";
  return `${label}: ${head}${extra}`;
}

function getPersonaById(id) {
  return personas.find((persona) => persona.id === id) || null;
}

function syncAuthChrome() {
  tokenInput.disabled = Boolean(sessionActive && sessionSupported);
  if (sessionActive && sessionSupported) {
    tokenInput.placeholder = "Session admin active";
    loadButton.textContent = "Rouvrir la session";
    return;
  }
  if (sessionActive && sessionSupported === false) {
    tokenInput.placeholder = "Token bootstrap local actif en memoire";
    loadButton.textContent = "Recharger l'acces";
    return;
  }
  tokenInput.placeholder = sessionSupported === false
    ? "Token bootstrap local (memoire seulement)"
    : "Token bootstrap admin local";
  loadButton.textContent = "Ouvrir la session";
}

function updateAuthState({ authenticated = sessionActive, cookieSession = sessionSupported, legacyToken = legacyAdminToken } = {}) {
  sessionActive = Boolean(authenticated);
  sessionSupported = cookieSession;
  legacyAdminToken = String(legacyToken || "").trim();
  syncAuthChrome();
  return {
    authenticated: sessionActive,
    sessionSupported,
    mode: sessionSupported ? "cookie" : legacyAdminToken ? "legacy-header" : "none",
  };
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

async function apiFetch(path, options = {}) {
  if (!sessionActive && !legacyAdminToken) throw new Error("Session admin requise");

  const headers = new Headers(options.headers || {});
  if (legacyAdminToken) {
    headers.set("x-admin-bootstrap-token", legacyAdminToken);
  }
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const payload = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      updateAuthState({
        authenticated: false,
        cookieSession: sessionSupported,
      });
    }
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }
  return payload;
}

async function getAdminSession() {
  const endpoint = await resolveSessionEndpoint();
  if (!endpoint) {
    return updateAuthState({
      authenticated: Boolean(legacyAdminToken),
      cookieSession: false,
      legacyToken: legacyAdminToken,
    });
  }

  const response = await fetch(endpoint, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
  });
  const payload = await readJson(response);

  if (response.ok) {
    tokenInput.value = "";
    return updateAuthState({
      authenticated: payload.authenticated !== false,
      cookieSession: true,
      legacyToken: "",
    });
  }

  if (response.status === 401 || response.status === 403) {
    return updateAuthState({
      authenticated: false,
      cookieSession: true,
      legacyToken: "",
    });
  }

  if (response.status === 404 || response.status === 405) {
    sessionEndpointCache = null;
    return getAdminSession();
  }

  throw new Error(payload.error || `Erreur HTTP ${response.status}`);
}

async function openAdminSession(token) {
  const cleanToken = String(token || "").trim();
  const endpoint = await resolveSessionEndpoint();

  if (endpoint) {
    if (!cleanToken) {
      const session = await getAdminSession();
      if (session.authenticated) return session;
      throw new Error("Bootstrap token requis.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ token: cleanToken }),
    });
    const payload = await readJson(response);
    if (response.ok) {
      tokenInput.value = "";
      return updateAuthState({
        authenticated: true,
        cookieSession: true,
        legacyToken: "",
      });
    }
    if (response.status !== 404 && response.status !== 405) {
      throw new Error(payload.error || `Erreur HTTP ${response.status}`);
    }
    sessionEndpointCache = null;
  }

  if (!cleanToken && !legacyAdminToken) {
    throw new Error("Bootstrap token requis.");
  }

  legacyAdminToken = cleanToken || legacyAdminToken;
  const response = await fetch("/api/admin/runtime/status", {
    credentials: "same-origin",
    headers: {
      "x-admin-bootstrap-token": legacyAdminToken,
      accept: "application/json",
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }

  tokenInput.value = "";
  return updateAuthState({
    authenticated: true,
    cookieSession: false,
    legacyToken: legacyAdminToken,
  });
}

async function ensureAdminAccess() {
  const token = tokenInput.value.trim();
  if (token) return openAdminSession(token);

  const session = await getAdminSession();
  if (session.authenticated) return session;

  if (legacyAdminToken) {
    return updateAuthState({
      authenticated: true,
      cookieSession: false,
      legacyToken: legacyAdminToken,
    });
  }

  throw new Error("Session admin requise.");
}

function currentCreatePayload(root = document) {
  const query = (selector) => root.querySelector(selector);
  return {
    id: query('[data-create-field="id"]')?.value ?? createIdInput.value,
    name: query('[data-create-field="name"]')?.value ?? createNameInput.value,
    model: query('[data-create-field="model"]')?.value ?? createModelInput.value,
    targetModel: query('[data-create-field="model"]')?.value ?? createModelInput.value,
    query: query('[data-create-field="query"]')?.value ?? createQueryInput.value,
    tone: query('[data-create-field="tone"]')?.value ?? createToneInput.value,
    themes: parseLines(query('[data-create-field="themes"]')?.value ?? createThemesInput.value),
    lexicon: parseLines(query('[data-create-field="lexicon"]')?.value ?? createLexiconInput.value),
    facts: parseLines(query('[data-create-field="facts"]')?.value ?? createFactsInput.value),
    quotes: parseLines(query('[data-create-field="quotes"]')?.value ?? createQuotesInput.value),
    notes: query('[data-create-field="notes"]')?.value ?? createNotesInput.value,
    summary: query('[data-create-field="notes"]')?.value ?? createNotesInput.value,
    sources: parseSourceRefs(query('[data-create-field="sources"]')?.value ?? createSourcesInput.value),
  };
}

function clearCreateInputs(root = document) {
  [
    '[data-create-field="id"]',
    '[data-create-field="name"]',
    '[data-create-field="model"]',
    '[data-create-field="query"]',
    '[data-create-field="tone"]',
    '[data-create-field="themes"]',
    '[data-create-field="lexicon"]',
    '[data-create-field="facts"]',
    '[data-create-field="quotes"]',
    '[data-create-field="notes"]',
    '[data-create-field="sources"]',
  ].forEach((selector) => {
    const field = root.querySelector(selector);
    if (field) field.value = "";
  });

  createIdInput.value = "";
  createNameInput.value = "";
  createModelInput.value = "";
  createQueryInput.value = "";
  createToneInput.value = "";
  createThemesInput.value = "";
  createLexiconInput.value = "";
  createFactsInput.value = "";
  createQuotesInput.value = "";
  createNotesInput.value = "";
  createSourcesInput.value = "";
}

function renderFeedback(items) {
  if (!items.length) {
    return '<div class="empty">Aucun signal de feedback enregistré pour cette persona.</div>';
  }

  return items.map((entry) => `
    <div class="log-entry">
      <div><strong>${escapeHtml(entry.kind)}</strong> · ${escapeHtml(entry.actor || "runtime")} · ${escapeHtml(entry.channel || "—")}</div>
      <div class="small">${escapeHtml(entry.ts || "")}</div>
      <div>${escapeHtml(entry.reason || entry.payload?.note || "")}</div>
      <div class="small">${escapeHtml(JSON.stringify(entry.payload || {}))}</div>
    </div>
  `).join("");
}

function renderProposals(items) {
  if (!items.length) {
    return '<div class="empty">Aucune proposition journalisée pour cette persona.</div>';
  }

  return items.map((entry) => {
    const before = entry.before || {};
    const after = entry.after || {};
    const flags = [];
    if (entry.applied) flags.push("appliquée");
    if (entry.revertedAt) flags.push(`revert ${entry.revertedAt}`);
    return `
      <div class="log-entry">
        <div><strong>${escapeHtml(entry.mode || "proposal")}</strong> · ${escapeHtml(entry.proposer || "runtime")} · ${escapeHtml(entry.id || "")}</div>
        <div class="small">${escapeHtml(entry.ts || "")}${flags.length ? ` · ${escapeHtml(flags.join(" · "))}` : ""}</div>
        <div>${escapeHtml(entry.reason || "")}</div>
        <div class="small">
          avant: <code>${escapeHtml(`${before.name || "?"} | ${before.model || "?"}`)}</code><br>
          après: <code>${escapeHtml(`${after.name || "?"} | ${after.model || "?"}`)}</code>
        </div>
      </div>
    `;
  }).join("");
}

function renderPersonas(items) {
  personaGrid.innerHTML = "";

  if (!items.length) {
    personaGrid.innerHTML = '<div class="status info">Aucune persona reçue.</div>';
    return;
  }

  for (const persona of items) {
    const article = document.createElement("article");
    article.className = "persona-card";
    article.dataset.personaId = persona.id;
    article.innerHTML = `
      <div class="persona-head">
        <div>
          <h2>${escapeHtml(persona.name)}</h2>
          <div class="meta">
            <span class="pill">id: ${escapeHtml(persona.id)}</span>
            <span class="pill">base: ${escapeHtml(persona.baseName)}</span>
            <span class="pill">${persona.isCustom ? "custom" : "seed"}</span>
            <span class="pill">couleur: ${escapeHtml(persona.color)}</span>
            <span class="pill">priorité: ${escapeHtml(String(persona.priority))}</span>
            <span class="pill">${persona.defaultForModel ? "défaut modèle" : "fallback libre"}</span>
            <span class="pill">${persona.generalEnabled ? "#general OK" : "#general OFF"}</span>
            <span class="pill">${persona.disabled ? "runtime OFF" : "runtime ON"}</span>
            <span class="pill">${escapeHtml(String(persona.feedback.length))} feedback</span>
            <span class="pill">${escapeHtml(String(persona.proposals.length))} proposals</span>
          </div>
        </div>
        <div class="persona-actions">
          <button type="button" data-action="save-persona">Sauvegarder persona</button>
          <button type="button" class="secondary" data-action="save-source">Sauvegarder source</button>
          <button type="button" class="secondary" data-action="reinforce">Renforcer via Pharmacius</button>
          <button type="button" class="${persona.disabled ? "secondary" : "danger"}" data-action="toggle-enabled">${persona.disabled ? "Réactiver l'agent" : "Désactiver l'agent"}</button>
          <button type="button" class="danger" data-action="revert">Revenir au dernier changement</button>
        </div>
      </div>

      <div class="section-box" data-section="runtime">
        <div class="section-title">
          <h3>Runtime actif</h3>
          <div class="hint">${escapeHtml(persona.desc)}</div>
        </div>
        <div class="fields">
          <div class="field">
            <label for="name-${escapeHtml(persona.id)}">Nom affiché</label>
            <input id="name-${escapeHtml(persona.id)}" data-field="name" value="${escapeHtml(persona.name)}" maxlength="20">
          </div>
          <div class="field">
            <label for="model-${escapeHtml(persona.id)}">Modèle utilisé</label>
            <input id="model-${escapeHtml(persona.id)}" data-field="model" value="${escapeHtml(persona.model)}">
          </div>
          <div class="field full">
            <label for="style-${escapeHtml(persona.id)}">Personnalité active</label>
            <textarea id="style-${escapeHtml(persona.id)}" data-field="style">${escapeHtml(persona.style)}</textarea>
          </div>
        </div>
      </div>

      <div class="section-box" data-section="source">
        <div class="section-title">
          <h3>Dossier source</h3>
          <div class="hint">Sujet: ${escapeHtml(persona.source.subjectName || "—")} · mis à jour ${escapeHtml(persona.source.updatedAt || "—")}</div>
        </div>
        <div class="fields">
          <div class="field">
            <label for="source-subject-${escapeHtml(persona.id)}">Personne / sujet</label>
            <input id="source-subject-${escapeHtml(persona.id)}" data-source-field="subjectName" value="${escapeHtml(persona.source.subjectName || "")}">
          </div>
          <div class="field">
            <label for="source-query-${escapeHtml(persona.id)}">Requête / cadrage</label>
            <input id="source-query-${escapeHtml(persona.id)}" data-source-field="query" value="${escapeHtml(persona.source.query || "")}">
          </div>
          <div class="field">
            <label for="source-name-${escapeHtml(persona.id)}">Nom préféré</label>
            <input id="source-name-${escapeHtml(persona.id)}" data-source-field="preferredName" value="${escapeHtml(persona.source.preferredName || "")}" maxlength="20">
          </div>
          <div class="field">
            <label for="source-model-${escapeHtml(persona.id)}">Modèle préféré</label>
            <input id="source-model-${escapeHtml(persona.id)}" data-source-field="preferredModel" value="${escapeHtml(persona.source.preferredModel || "")}">
          </div>
          <div class="field full">
            <label for="source-tone-${escapeHtml(persona.id)}">Ton / posture</label>
            <textarea id="source-tone-${escapeHtml(persona.id)}" data-source-field="tone">${escapeHtml(persona.source.tone || "")}</textarea>
          </div>
          <div class="field">
            <label for="source-themes-${escapeHtml(persona.id)}">Thèmes</label>
            <textarea id="source-themes-${escapeHtml(persona.id)}" data-source-field="themes">${escapeHtml(toMultiline(persona.source.themes))}</textarea>
          </div>
          <div class="field">
            <label for="source-lexicon-${escapeHtml(persona.id)}">Lexique</label>
            <textarea id="source-lexicon-${escapeHtml(persona.id)}" data-source-field="lexicon">${escapeHtml(toMultiline(persona.source.lexicon))}</textarea>
          </div>
          <div class="field">
            <label for="source-facts-${escapeHtml(persona.id)}">Faits stables</label>
            <textarea id="source-facts-${escapeHtml(persona.id)}" data-source-field="facts">${escapeHtml(toMultiline(persona.source.facts))}</textarea>
          </div>
          <div class="field">
            <label for="source-quotes-${escapeHtml(persona.id)}">Citations / formulations</label>
            <textarea id="source-quotes-${escapeHtml(persona.id)}" data-source-field="quotes">${escapeHtml(toMultiline(persona.source.quotes))}</textarea>
          </div>
          <div class="field full">
            <label for="source-notes-${escapeHtml(persona.id)}">Notes éditoriales</label>
            <textarea id="source-notes-${escapeHtml(persona.id)}" data-source-field="notes">${escapeHtml(persona.source.notes || "")}</textarea>
          </div>
          <div class="field full">
            <label for="source-refs-${escapeHtml(persona.id)}">Sources (titre | url | notes)</label>
            <textarea id="source-refs-${escapeHtml(persona.id)}" data-source-field="sources">${escapeHtml((persona.source.sources || []).map((entry) => [entry.title, entry.url, entry.notes].filter(Boolean).join(" | ")).join("\n"))}</textarea>
          </div>
        </div>
      </div>

      <div class="section-box" data-section="feedback">
        <div class="section-title">
          <h3>Feedback récent</h3>
          <div class="small">votes, corrections, signaux de chat et auto-apply</div>
        </div>
        <div class="fields">
          <div class="field full">
            <label for="feedback-note-${escapeHtml(persona.id)}">Ajouter un feedback / drift report</label>
            <textarea id="feedback-note-${escapeHtml(persona.id)}" data-feedback-field="note" placeholder="note locale, correction de ton, dérive observée, signal éditorial..."></textarea>
          </div>
        </div>
        <div class="persona-actions">
          <button type="button" class="secondary" data-action="add-feedback">Ajouter feedback</button>
        </div>
        <div class="log-list">${renderFeedback(persona.feedback)}</div>
      </div>

      <div class="section-box" data-section="proposals">
        <div class="section-title">
          <h3>Propositions et historique</h3>
          <div class="small">toutes les révisions restent journalisées et réversibles</div>
        </div>
        <div class="log-list">${renderProposals(persona.proposals)}</div>
      </div>
    `;
    personaGrid.appendChild(article);
  }
}

async function hydratePersona(persona) {
  const [source, feedback, proposals] = await Promise.all([
    apiFetch(`/api/admin/personas/${persona.id}/source`),
    apiFetch(`/api/admin/personas/${persona.id}/feedback`),
    apiFetch(`/api/admin/personas/${persona.id}/proposals`),
  ]);

  return {
    ...persona,
    source,
    feedback,
    proposals,
  };
}

function getCard(id) {
  return personaGrid.querySelector(`[data-persona-id="${id}"]`);
}

function setCardBusy(card, busy) {
  if (!card) return;
  card.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

function getPersonaPayload(card) {
  return {
    name: card.querySelector('[data-field="name"]').value,
    model: card.querySelector('[data-field="model"]').value,
    style: card.querySelector('[data-field="style"]').value,
  };
}

function getSourcePayload(card) {
  return {
    subjectName: card.querySelector('[data-source-field="subjectName"]').value,
    query: card.querySelector('[data-source-field="query"]').value,
    preferredName: card.querySelector('[data-source-field="preferredName"]').value,
    preferredModel: card.querySelector('[data-source-field="preferredModel"]').value,
    tone: card.querySelector('[data-source-field="tone"]').value,
    themes: parseLines(card.querySelector('[data-source-field="themes"]').value),
    lexicon: parseLines(card.querySelector('[data-source-field="lexicon"]').value),
    facts: parseLines(card.querySelector('[data-source-field="facts"]').value),
    quotes: parseLines(card.querySelector('[data-source-field="quotes"]').value),
    notes: card.querySelector('[data-source-field="notes"]').value,
    sources: parseSourceRefs(card.querySelector('[data-source-field="sources"]').value),
  };
}

async function withCardAction(id, label, action) {
  const card = getCard(id);
  if (!card) return;

  setCardBusy(card, true);
  try {
    setStatus(label, "info");
    await action(card);
    await loadPersonas(id);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setCardBusy(card, false);
  }
}

async function savePersona(id) {
  await withCardAction(id, `Sauvegarde persona ${id}...`, async (card) => {
    await apiFetch(`/api/admin/personas/${id}`, {
      method: "PUT",
      body: JSON.stringify(getPersonaPayload(card)),
    });
    setStatus(`Persona ${id} mise à jour.`, "ok");
  });
}

async function saveSource(id) {
  await withCardAction(id, `Sauvegarde du dossier source ${id}...`, async (card) => {
    await apiFetch(`/api/admin/personas/${id}/source`, {
      method: "PUT",
      body: JSON.stringify(getSourcePayload(card)),
    });
    setStatus(`Dossier source ${id} mis à jour.`, "ok");
  });
}

async function reinforcePersona(id) {
  await withCardAction(id, `Renforcement Pharmacius de ${id}...`, async () => {
    const result = await apiFetch(`/api/admin/personas/${id}/reinforce`, {
      method: "POST",
      body: JSON.stringify({ autoApply: true }),
    });
    const mode = result.changed ? "appliquée" : "sans changement";
    setStatus(`Révision Pharmacius ${mode} pour ${id}.`, result.changed ? "ok" : "info");
  });
}

async function revertPersona(id) {
  await withCardAction(id, `Revert de ${id}...`, async () => {
    await apiFetch(`/api/admin/personas/${id}/revert`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStatus(`Dernier changement appliqué annulé pour ${id}.`, "ok");
  });
}

async function addFeedback(id) {
  await withCardAction(id, `Ajout de feedback sur ${id}...`, async (card) => {
    const note = card.querySelector('[data-feedback-field="note"]').value.trim();
    if (!note) throw new Error("Le feedback manuel ne peut pas être vide");
    await apiFetch(`/api/admin/personas/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        kind: "drift_report",
        actor: "admin",
        channel: "#admin",
        note,
      }),
    });
    setStatus(`Feedback enregistré pour ${id}.`, "ok");
  });
}

async function togglePersonaEnabled(id) {
  const persona = getPersonaById(id);
  const nextAction = persona?.disabled ? "enable" : "disable";

  try {
    setStatus(nextAction === "enable" ? `Réactivation de ${id}...` : `Désactivation de ${id}...`, "info");
    await apiFetch(`/api/admin/personas/${id}/${nextAction}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadPersonas(id);
    setStatus(nextAction === "enable" ? `${id} réactivée.` : `${id} désactivée.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function createPersonaFromSource(root = document) {
  createButton.disabled = true;
  try {
    setStatus("Création de la persona sourcée...", "info");
    const payload = currentCreatePayload(root);
    const result = await apiFetch("/api/admin/personas/from-source", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    clearCreateInputs(root);

    await loadPersonas(result.persona.id);
    setStatus("Persona sourcée créée.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    createButton.disabled = false;
  }
}

function ensureGraphEditor() {
  if (graphEditor || typeof Drawflow !== "function") return;

  graphEditor = new Drawflow(graphCanvas);
  graphEditor.reroute = true;
  graphEditor.line_path = 4;
  graphEditor.zoom_min = 0.7;
  graphEditor.zoom_max = 1.35;
  graphEditor.zoom_value = 0.1;
  graphEditor.editor_mode = "fixed";
  graphEditor.start();

  graphCanvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  graphCanvas.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  graphCanvas.addEventListener("click", (event) => {
    const nodeElement = event.target.closest(".drawflow-node");
    if (!nodeElement) {
      selectedGraphNodeKey = "";
      applyGraphSelection("");
      renderGraphInspectorForPersona(getPersonaById(selectedGraphPersonaId));
      return;
    }

    const editorId = nodeElement.id.replace("node-", "");
    const node = getGraphNodeByEditorId(editorId);
    if (!node?.data) return;
    graphBus.emit("graph:node-selected", {
      personaId: selectedGraphPersonaId,
      nodeData: node.data,
    });
  });
}

function getGraphNodeByEditorId(editorId) {
  return graphEditor?.drawflow?.drawflow?.Home?.data?.[editorId] || null;
}

function clearGraph() {
  ensureGraphEditor();
  if (!graphEditor) return;
  graphEditor.clear();
  graphNodeIds = new Map();
}

function applyGraphSelection(graphKey) {
  selectedGraphNodeKey = graphKey || "";
  for (const [key, editorId] of graphNodeIds.entries()) {
    const wrapper = graphCanvas.querySelector(`#node-${editorId}`);
    if (!wrapper) continue;
    wrapper.classList.toggle("graph-active", key === selectedGraphNodeKey);
  }
}

function renderGraphNodeHtml(node) {
  const meta = (node.meta || [])
    .filter(Boolean)
    .map((value) => `<span class="graph-mini">${escapeHtml(value)}</span>`)
    .join("");

  return `
    <div class="graph-node kind-${escapeHtml(node.kind)}">
      <div class="graph-node-head">
        <div>
          <div class="graph-node-kind">${escapeHtml(node.kindLabel)}</div>
          <div class="graph-node-title">${escapeHtml(node.title)}</div>
        </div>
        ${node.badge ? `<span class="graph-node-badge">${escapeHtml(node.badge)}</span>` : ""}
      </div>
      <div class="graph-node-body">
        <div class="graph-node-text">${escapeHtml(node.text)}</div>
        ${meta ? `<div class="graph-node-meta">${meta}</div>` : ""}
      </div>
    </div>
  `;
}

function buildGraphSpec(persona) {
  const source = persona.source || {};
  const latestFeedback = persona.feedback[0] || null;
  const latestProposal = persona.proposals[0] || null;

  const nodes = [
    {
      key: "persona",
      kind: "persona",
      kindLabel: "persona",
      title: persona.name,
      badge: persona.isCustom ? "custom" : "seed",
      section: "runtime",
      text: [
        `Base: ${persona.baseName}`,
        persona.disabled ? "runtime désactivé" : "runtime actif",
        persona.generalEnabled ? "#general actif" : "#general coupé",
        persona.defaultForModel ? "fallback modèle" : "fallback libre",
      ].join("\n"),
      meta: [`priorité ${persona.priority}`, persona.color],
      x: 430,
      y: 40,
    },
    {
      key: "source",
      kind: "source",
      kindLabel: "source",
      title: source.subjectName || persona.name,
      badge: `${source.sources?.length || 0} refs`,
      section: "source",
      text: [
        `Requête: ${truncate(source.query || "—", 70)}`,
        `Nom préféré: ${truncate(source.preferredName || "—", 24)}`,
        `MAJ: ${formatTs(source.updatedAt)}`,
      ].join("\n"),
      meta: [source.preferredModel || "modèle libre"],
      x: 80,
      y: 180,
    },
    {
      key: "corpus",
      kind: "corpus",
      kindLabel: "corpus",
      title: "Corpus éditorial",
      badge: `${(source.facts?.length || 0) + (source.themes?.length || 0) + (source.lexicon?.length || 0) + (source.quotes?.length || 0)} items`,
      section: "source",
      text: [
        summarizeItems("Faits", source.facts, 2, 34),
        summarizeItems("Thèmes", source.themes, 3, 24),
        summarizeItems("Lexique", source.lexicon, 3, 20),
        summarizeItems("Citations", source.quotes, 1, 56),
      ].join("\n"),
      meta: ["dossier source"],
      x: 80,
      y: 400,
    },
    {
      key: "feedback",
      kind: "feedback",
      kindLabel: "feedback",
      title: "Retour du chat",
      badge: `${persona.feedback.length}`,
      section: "feedback",
      text: [
        `Dernier signal: ${truncate(latestFeedback?.kind || "aucun", 26)}`,
        `Raison: ${truncate(latestFeedback?.reason || latestFeedback?.payload?.note || "—", 70)}`,
        `Horodatage: ${formatTs(latestFeedback?.ts)}`,
      ].join("\n"),
      meta: [latestFeedback?.actor || "runtime", latestFeedback?.channel || "#admin"],
      x: 80,
      y: 620,
    },
    {
      key: "pharmacius",
      kind: "pharmacius",
      kindLabel: "orchestrateur",
      title: "Pharmacius",
      badge: "quasi-auto",
      section: "proposals",
      action: "reinforce",
      text: [
        "Propose et ajuste nom, modèle, style",
        "S’appuie sur source + feedback",
        `Dernière action: ${truncate(latestProposal?.mode || "aucune", 30)}`,
      ].join("\n"),
      meta: ["proposer", "revertable"],
      x: 430,
      y: 360,
    },
    {
      key: "model",
      kind: "model",
      kindLabel: "modèle",
      title: "Cible modèle",
      badge: truncate(persona.model, 16),
      section: "runtime",
      text: [
        `Actif: ${truncate(persona.model, 70)}`,
        `Préféré source: ${truncate(source.preferredModel || "—", 70)}`,
        persona.defaultForModel ? "Persona par défaut pour ce modèle" : "Persona secondaire sur ce modèle",
      ].join("\n"),
      meta: ["runtime"],
      x: 780,
      y: 180,
    },
    {
      key: "style",
      kind: "style",
      kindLabel: "style",
      title: "Voix active",
      badge: `${persona.style.length}c`,
      section: "runtime",
      text: truncate(persona.style, 210),
      meta: [truncate(source.tone || "ton non défini", 32)],
      x: 780,
      y: 390,
    },
    {
      key: "proposals",
      kind: "proposals",
      kindLabel: "historique",
      title: "Proposals",
      badge: `${persona.proposals.length}`,
      section: "proposals",
      text: [
        `Dernière raison: ${truncate(latestProposal?.reason || "—", 70)}`,
        `Mode: ${truncate(latestProposal?.mode || "—", 26)}`,
        `Horodatage: ${formatTs(latestProposal?.ts)}`,
      ].join("\n"),
      meta: [latestProposal?.proposer || "runtime", latestProposal?.applied ? "appliquée" : "journalisée"],
      x: 780,
      y: 620,
    },
    {
      key: "runtime",
      kind: "runtime",
      kindLabel: "runtime",
      title: "Override actif",
      badge: persona.disabled ? "runtime off" : persona.generalEnabled ? "live" : "hors #general",
      section: "runtime",
      text: [
        truncate(persona.desc || "Persona active sans description", 70),
        `Nom: ${truncate(persona.name, 22)}`,
        `Modèle: ${truncate(persona.model, 60)}`,
      ].join("\n"),
      meta: [persona.isCustom ? "locale" : "catalogue", "réversible"],
      x: 430,
      y: 620,
    },
  ];

  const edges = [
    ["persona", "source"],
    ["persona", "feedback"],
    ["persona", "model"],
    ["persona", "style"],
    ["source", "corpus"],
    ["source", "pharmacius"],
    ["corpus", "pharmacius"],
    ["feedback", "pharmacius"],
    ["pharmacius", "proposals"],
    ["model", "runtime"],
    ["style", "runtime"],
    ["proposals", "runtime"],
  ];

  return { nodes, edges };
}

function renderCreateGraph() {
  ensureGraphEditor();
  clearGraph();
  if (!graphEditor) return;

  const nodes = [
    {
      key: "factory",
      kind: "pharmacius",
      kindLabel: "atelier",
      title: "Nouvelle persona",
      badge: "source",
      text: "Créer une persona locale sourcée, puis l'intégrer au runtime sans toucher au catalogue.",
      meta: ["local", "réversible"],
      x: 360,
      y: 80,
    },
    {
      key: "source",
      kind: "source",
      kindLabel: "source",
      title: "Dossier source",
      badge: "web",
      text: "Requête, ton, thèmes, faits, citations et références.",
      meta: ["traçable"],
      x: 90,
      y: 280,
    },
    {
      key: "runtime",
      kind: "runtime",
      kindLabel: "runtime",
      title: "Persona active",
      badge: "override",
      text: "Le résultat devient une persona locale modifiable et réversible.",
      meta: ["data/", "custom"],
      x: 630,
      y: 280,
    },
  ];

  nodes.forEach((node) => {
    const inputCount = node.key === "factory" ? 0 : 1;
    const outputCount = node.key === "runtime" ? 0 : 1;
    const editorId = graphEditor.addNode(
      node.key,
      inputCount,
      outputCount,
      node.x,
      node.y,
      `kind-${node.kind}`,
      node,
      renderGraphNodeHtml(node),
      "html"
    );
    graphNodeIds.set(node.key, editorId);
  });

  graphEditor.addConnection(graphNodeIds.get("factory"), graphNodeIds.get("source"), "output_1", "input_1");
  graphEditor.addConnection(graphNodeIds.get("factory"), graphNodeIds.get("runtime"), "output_1", "input_1");
  renderGraphInspectorForCreate();
}

function renderPersonaGraph(personaId) {
  ensureGraphEditor();
  const persona = getPersonaById(personaId);
  clearGraph();

  if (!persona || !graphEditor) {
    renderGraphInspectorEmpty("Charge les personas pour voir la carte nodale.");
    return;
  }

  const spec = buildGraphSpec(persona);

  spec.nodes.forEach((node) => {
    const inputCount = ["persona"].includes(node.key) ? 0 : 1;
    const outputCount = node.key === "runtime" ? 0 : 1;
    const editorId = graphEditor.addNode(
      node.key,
      inputCount,
      outputCount,
      node.x,
      node.y,
      `kind-${node.kind}`,
      {
        ...node,
        personaId: persona.id,
      },
      renderGraphNodeHtml(node),
      "html"
    );
    graphNodeIds.set(node.key, editorId);
  });

  spec.edges.forEach(([fromKey, toKey]) => {
    const fromId = graphNodeIds.get(fromKey);
    const toId = graphNodeIds.get(toKey);
    if (fromId && toId) {
      graphEditor.addConnection(fromId, toId, "output_1", "input_1");
    }
  });

  applyGraphSelection("");
  renderGraphInspectorForPersona(persona);
}

function renderGraphInspectorEmpty(message) {
  graphInspector.innerHTML = `
    <h3>Inspecteur nodal</h3>
    <p class="hint">${escapeHtml(message)}</p>
  `;
}

function renderGraphInspectorForPersona(persona) {
  if (!persona) {
    renderGraphInspectorEmpty("Charge les personas puis choisis-en une dans le sélecteur.");
    return;
  }

  const source = persona.source || {};
  graphInspector.innerHTML = `
    <h3>${escapeHtml(persona.name)}</h3>
    <p>${escapeHtml(persona.desc || "Persona sans description éditoriale.")}</p>
    <ul>
      <li>${escapeHtml(persona.isCustom ? "Persona locale custom" : "Persona seed du catalogue")}</li>
      <li>${escapeHtml(`Modèle actif: ${persona.model}`)}</li>
      <li>${escapeHtml(`Sujet source: ${source.subjectName || persona.name}`)}</li>
      <li>${escapeHtml(persona.disabled ? "Runtime désactivé" : "Runtime actif")}</li>
      <li>${escapeHtml(`${persona.feedback.length} feedback · ${persona.proposals.length} proposals`)}</li>
    </ul>
    <div class="graph-actions">
      <button type="button" data-graph-action="inspect-section" data-persona-id="${escapeHtml(persona.id)}" data-section="runtime">Inspecter runtime</button>
      <button type="button" class="secondary" data-graph-action="inspect-section" data-persona-id="${escapeHtml(persona.id)}" data-section="source">Inspecter source</button>
      <button type="button" class="secondary" data-graph-action="reinforce" data-persona-id="${escapeHtml(persona.id)}">Renforcer via Pharmacius</button>
    </div>
  `;
}

function renderGraphInspectorForCreate() {
  graphInspector.innerHTML = `
    <h3>Créer une persona sourcée</h3>
    <p class="small">Le dossier source, la synthèse initiale et l’activation locale passent ici.</p>
    <div class="fields">
      <div class="field">
        <label>ID</label>
        <input data-create-field="id" maxlength="32" placeholder="ex: deleuze">
      </div>
      <div class="field">
        <label>Nom affiché</label>
        <input data-create-field="name" maxlength="20" placeholder="ex: Deleuze">
      </div>
      <div class="field">
        <label>Modèle</label>
        <input data-create-field="model" placeholder="ex: qwen2.5:14b">
      </div>
      <div class="field">
        <label>Requête</label>
        <input data-create-field="query" placeholder="ex: Gilles Deleuze entretiens bibliographie">
      </div>
      <div class="field full">
        <label>Ton / posture</label>
        <textarea data-create-field="tone" placeholder="précis, conceptuel, critique, toujours en français"></textarea>
      </div>
      <div class="field">
        <label>Thèmes</label>
        <textarea data-create-field="themes" placeholder="1 thème par ligne"></textarea>
      </div>
      <div class="field">
        <label>Lexique</label>
        <textarea data-create-field="lexicon" placeholder="1 terme par ligne"></textarea>
      </div>
      <div class="field">
        <label>Faits stables</label>
        <textarea data-create-field="facts" placeholder="1 fait par ligne"></textarea>
      </div>
      <div class="field">
        <label>Citations</label>
        <textarea data-create-field="quotes" placeholder="1 citation par ligne"></textarea>
      </div>
      <div class="field full">
        <label>Notes éditoriales</label>
        <textarea data-create-field="notes" placeholder="résumé du dossier source, angle, lignes rouges"></textarea>
      </div>
      <div class="field full">
        <label>Sources (titre | url | notes)</label>
        <textarea data-create-field="sources" placeholder="Titre | https://source | note"></textarea>
      </div>
    </div>
    <div class="graph-actions">
      <button type="button" data-graph-action="create-source">Créer la persona</button>
    </div>
  `;
}

function renderInspectorSection(personaId, section, title, meta = []) {
  const card = getCard(personaId);
  const persona = getPersonaById(personaId);
  const sourceSection = card?.querySelector(`[data-section="${section}"]`);

  graphInspector.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p class="small">${escapeHtml(persona?.name || personaId)} · ${escapeHtml(meta.filter(Boolean).join(" · "))}</p>
    <div class="graph-actions">
      ${section === "runtime" ? `
        <button type="button" data-graph-action="save-persona" data-persona-id="${escapeHtml(personaId)}">Sauvegarder persona</button>
        <button type="button" class="${persona?.disabled ? "secondary" : "danger"}" data-graph-action="toggle-enabled" data-persona-id="${escapeHtml(personaId)}">${persona?.disabled ? "Réactiver l'agent" : "Désactiver l'agent"}</button>
      ` : ""}
      ${section === "source" ? `<button type="button" data-graph-action="save-source" data-persona-id="${escapeHtml(personaId)}">Sauvegarder source</button>` : ""}
      ${section === "feedback" ? `<button type="button" data-graph-action="add-feedback" data-persona-id="${escapeHtml(personaId)}">Ajouter feedback</button>` : ""}
      ${section === "proposals" ? `
        <button type="button" class="secondary" data-graph-action="reinforce" data-persona-id="${escapeHtml(personaId)}">Renforcer via Pharmacius</button>
        <button type="button" class="danger" data-graph-action="revert" data-persona-id="${escapeHtml(personaId)}">Revenir au dernier changement</button>
      ` : ""}
    </div>
  `;

  if (sourceSection) {
    graphInspector.appendChild(sourceSection.cloneNode(true));
  } else {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "Section introuvable pour cette persona.";
    graphInspector.appendChild(empty);
  }
}

function renderGraphInspectorForNode(nodeData) {
  if (selectedGraphPersonaId === NEW_PERSONA_GRAPH_ID) {
    renderGraphInspectorForCreate();
    return;
  }

  const persona = getPersonaById(nodeData.personaId);
  if (nodeData.section) {
    renderInspectorSection(nodeData.personaId, nodeData.section, nodeData.title, [nodeData.kindLabel, ...(nodeData.meta || [])]);
    return;
  }

  const details = (nodeData.meta || []).filter(Boolean);
  graphInspector.innerHTML = `
    <h3>${escapeHtml(nodeData.title)}</h3>
    <p class="small">${escapeHtml(nodeData.kindLabel)} · ${escapeHtml(persona?.name || nodeData.personaId)}</p>
    <p>${escapeHtml(nodeData.text || "")}</p>
    ${details.length ? `<ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    <div class="graph-actions">
      ${nodeData.action === "reinforce" ? `<button type="button" class="secondary" data-graph-action="reinforce" data-persona-id="${escapeHtml(nodeData.personaId)}">Lancer Pharmacius</button>` : ""}
    </div>
  `;
}

function flashElement(element) {
  if (!element) return;
  element.classList.remove("is-focused");
  element.getBoundingClientRect();
  element.classList.add("is-focused");
  setTimeout(() => element.classList.remove("is-focused"), 1400);
}

function openPersonaSection(personaId, section) {
  const card = getCard(personaId);
  if (!card) return;

  const target = section ? card.querySelector(`[data-section="${section}"]`) : card;
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  flashElement(target);
}

function updateGraphPersonaPicker(items) {
  const options = items.map((persona) => `
    <option value="${escapeHtml(persona.id)}">${escapeHtml(`${persona.name} · ${persona.model}`)}</option>
  `).join("");

  graphPersonaSelect.innerHTML = `<option value="${NEW_PERSONA_GRAPH_ID}">+ Nouvelle persona sourcée</option>${options}`;

  if (!items.length) {
    selectedGraphPersonaId = NEW_PERSONA_GRAPH_ID;
    graphPersonaSelect.value = NEW_PERSONA_GRAPH_ID;
    renderCreateGraph();
    return;
  }

  if (selectedGraphPersonaId !== NEW_PERSONA_GRAPH_ID && !items.some((persona) => persona.id === selectedGraphPersonaId)) {
    selectedGraphPersonaId = items[0].id;
  }

  graphPersonaSelect.value = selectedGraphPersonaId;
  graphBus.emit("graph:persona-selected", { personaId: selectedGraphPersonaId });
}

async function loadPersonas(preferredPersonaId = selectedGraphPersonaId) {
  try {
    setStatus("Chargement des personas, sources et historiques...", "info");
    const base = await apiFetch("/api/admin/personas");
    const items = await Promise.all(base.map((persona) => hydratePersona(persona)));
    personas = items;
    renderPersonas(items);
    selectedGraphPersonaId = preferredPersonaId === NEW_PERSONA_GRAPH_ID
      ? NEW_PERSONA_GRAPH_ID
      : preferredPersonaId && items.some((persona) => persona.id === preferredPersonaId)
        ? preferredPersonaId
        : (items[0]?.id || NEW_PERSONA_GRAPH_ID);
    graphBus.emit("personas:loaded", { items, preferredPersonaId: selectedGraphPersonaId });
    setStatus(`${items.length} personas chargées.`, "ok");
  } catch (error) {
    personas = [];
    personaGrid.innerHTML = "";
    selectedGraphPersonaId = NEW_PERSONA_GRAPH_ID;
    graphBus.emit("personas:loaded", { items: [], preferredPersonaId: "" });
    setStatus(error.message, "error");
  }
}

graphBus.on("personas:loaded", ({ items }) => {
  updateGraphPersonaPicker(items);
});

graphBus.on("graph:persona-selected", ({ personaId }) => {
  selectedGraphPersonaId = personaId || "";
  selectedGraphNodeKey = "";
  graphPersonaSelect.value = selectedGraphPersonaId;
  if (selectedGraphPersonaId === NEW_PERSONA_GRAPH_ID) {
    renderCreateGraph();
    return;
  }
  renderPersonaGraph(selectedGraphPersonaId);
});

graphBus.on("graph:node-selected", ({ nodeData }) => {
  selectedGraphNodeKey = nodeData.key;
  applyGraphSelection(selectedGraphNodeKey);
  renderGraphInspectorForNode(nodeData);
});

loadButton.addEventListener("click", async () => {
  try {
    setStatus("Ouverture de la session admin…", "info");
    await ensureAdminAccess();
    await loadPersonas();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    const session = await ensureAdminAccess();
    if (session.authenticated) {
      await loadPersonas(selectedGraphPersonaId);
      return;
    }
    setStatus("Session admin requise.", "info");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

createButton.addEventListener("click", async () => {
  try {
    await ensureAdminAccess();
    createPersonaFromSource();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

graphPersonaSelect.addEventListener("change", () => {
  if (!graphPersonaSelect.value) return;
  graphBus.emit("graph:persona-selected", { personaId: graphPersonaSelect.value });
});

graphCenterButton.addEventListener("click", () => {
  ensureGraphEditor();
  if (graphEditor?.zoom_reset) graphEditor.zoom_reset();
  if (graphCanvasWrap) {
    graphCanvasWrap.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }
});

personaGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = button.closest("[data-persona-id]");
  if (!card) return;

  const id = card.dataset.personaId;
  switch (button.dataset.action) {
    case "save-persona":
      savePersona(id);
      break;
    case "save-source":
      saveSource(id);
      break;
    case "reinforce":
      reinforcePersona(id);
      break;
    case "revert":
      revertPersona(id);
      break;
    case "add-feedback":
      addFeedback(id);
      break;
    case "toggle-enabled":
      togglePersonaEnabled(id);
      break;
  }
});

graphInspector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-graph-action]");
  if (!button) return;

  const personaId = button.dataset.personaId;
  const action = button.dataset.graphAction;

  if (action === "inspect-section") {
    renderInspectorSection(personaId, button.dataset.section, `Inspecteur ${button.dataset.section}`);
    return;
  }

  if (action === "reinforce") {
    reinforcePersona(personaId);
    return;
  }

  if (action === "revert") {
    revertPersona(personaId);
    return;
  }

  if (action === "save-persona") {
    apiFetch(`/api/admin/personas/${personaId}`, {
      method: "PUT",
      body: JSON.stringify(getPersonaPayload(graphInspector)),
    }).then(async () => {
      await loadPersonas(personaId);
      setStatus(`Persona ${personaId} mise à jour.`, "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  if (action === "save-source") {
    apiFetch(`/api/admin/personas/${personaId}/source`, {
      method: "PUT",
      body: JSON.stringify(getSourcePayload(graphInspector)),
    }).then(async () => {
      await loadPersonas(personaId);
      setStatus(`Dossier source ${personaId} mis à jour.`, "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  if (action === "add-feedback") {
    const note = graphInspector.querySelector('[data-feedback-field="note"]')?.value?.trim();
    if (!note) {
      setStatus("Le feedback manuel ne peut pas être vide", "error");
      return;
    }
    apiFetch(`/api/admin/personas/${personaId}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        kind: "drift_report",
        actor: "admin",
        channel: "#admin",
        note,
      }),
    }).then(async () => {
      await loadPersonas(personaId);
      setStatus(`Feedback enregistré pour ${personaId}.`, "ok");
    }).catch((error) => setStatus(error.message, "error"));
    return;
  }

  if (action === "toggle-enabled") {
    togglePersonaEnabled(personaId);
    return;
  }

  if (action === "create-source") {
    createPersonaFromSource(graphInspector);
  }
});

tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadButton.click();
  }
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const payload = event.data || {};
  if (payload.type !== ADMIN_AUTH_MESSAGE) return;

  if (payload.auth?.mode === "legacy-header" && payload.legacyToken) {
    updateAuthState({
      authenticated: true,
      cookieSession: false,
      legacyToken: payload.legacyToken,
    });
    if (!personas.length) {
      loadPersonas(selectedGraphPersonaId || NEW_PERSONA_GRAPH_ID).catch((error) => {
        setStatus(error.message, "error");
      });
    }
    return;
  }

  if (payload.auth?.mode === "cookie") {
    getAdminSession()
      .then((session) => {
        if (session.authenticated && !personas.length) {
          loadPersonas(selectedGraphPersonaId || NEW_PERSONA_GRAPH_ID).catch((error) => {
            setStatus(error.message, "error");
          });
        }
      })
      .catch((error) => setStatus(error.message, "error"));
    return;
  }

  if (payload.auth && !payload.auth.authenticated) {
    updateAuthState({
      authenticated: false,
      cookieSession: Boolean(payload.auth.sessionSupported),
      legacyToken: "",
    });
    personas = [];
    personaGrid.innerHTML = "";
    selectedGraphPersonaId = NEW_PERSONA_GRAPH_ID;
    renderCreateGraph();
  }
});

syncAuthChrome();
ensureGraphEditor();
getAdminSession()
  .then((session) => {
    if (sessionActive) {
      loadPersonas(NEW_PERSONA_GRAPH_ID);
      return;
    }
    selectedGraphPersonaId = NEW_PERSONA_GRAPH_ID;
    renderCreateGraph();
    setStatus(window.parent !== window ? "Attente de la session admin du shell…" : "Session admin requise.", "info");
  })
  .catch(() => {
    updateAuthState({
      authenticated: false,
      cookieSession: sessionSupported,
      legacyToken: "",
    });
    selectedGraphPersonaId = NEW_PERSONA_GRAPH_ID;
    renderCreateGraph();
    setStatus(window.parent !== window ? "Attente de la session admin du shell…" : "Session admin requise.", "info");
  });
