import {
  adminApi,
  clearAdminSession,
  getAdminAuthSnapshot,
  getAdminSession,
  getLegacyAdminToken,
  openAdminSession,
} from "./admin-api.js";
import { getState, subscribe, updateState, setStatus } from "./admin-store.js";
import { escapeHtml } from "./utils.js";
import { mountDashboard } from "./modules/dashboard.js";
import { mountPersonas } from "./modules/personas.js";
import { mountRuntime } from "./modules/runtime.js";
import { mountChannels } from "./modules/channels.js";
import { mountData } from "./modules/data.js";
import { mountNodeEngine } from "./modules/node-engine.js";

const modules = {
  dashboard: {
    eyebrow: "Vue d'ensemble",
    title: "Dashboard",
    summary: "Statut du serveur, personas actives, canaux et modèles.",
    mount: mountDashboard,
  },
  personas: {
    eyebrow: "Éditorial",
    title: "Personas",
    summary: "Catalogue, nodal, runtime, sources, feedback et Pharmacius.",
    mount: mountPersonas,
  },
  runtime: {
    eyebrow: "Serveur",
    title: "Runtime",
    summary: "État Ollama, modèles chargés, sessions et personas désactivées.",
    mount: mountRuntime,
  },
  channels: {
    eyebrow: "IRC",
    title: "Canaux",
    summary: "Topics, activité et routage par canal.",
    mount: mountChannels,
  },
  data: {
    eyebrow: "Persistance",
    title: "Données",
    summary: "Recherche historique, résumé logs et exports locaux.",
    mount: mountData,
  },
  "node-engine": {
    eyebrow: "Pipelines IA",
    title: "Node Engine",
    summary: "Graphes datasets, training, évaluation, registry et déploiement.",
    mount: mountNodeEngine,
  },
};

const tokenInput = document.getElementById("admin-token");
const saveTokenButton = document.getElementById("save-token-button");
const logoutButton = document.getElementById("logout-button");
const refreshButton = document.getElementById("refresh-button");
const authSummary = document.getElementById("auth-summary");
const moduleRoot = document.getElementById("module-root");
const statusBanner = document.getElementById("status-banner");
const moduleEyebrow = document.getElementById("module-eyebrow");
const moduleTitle = document.getElementById("module-title");
const moduleSummary = document.getElementById("module-summary");

function syncStatusStrip(status) {
  document.getElementById("status-connection").textContent = status ? "ok" : "hors ligne";
  document.getElementById("status-clients").textContent = status?.clients ?? "—";
  document.getElementById("status-sessions").textContent = status?.sessions ?? "—";
  document.getElementById("status-personas").textContent = status?.personas ?? "—";
  document.getElementById("status-models").textContent = status?.models ?? "—";
}

function setActiveNav(moduleName) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.module === moduleName);
  });
}

function describeAuth(auth) {
  if (auth.authenticated && auth.mode === "cookie") {
    return "Session admin active via cookie same-origin.";
  }
  if (auth.authenticated && auth.mode === "legacy-header") {
    return auth.sessionSupported === false
      ? "Fallback local actif: le bootstrap token reste seulement en memoire pour cet onglet."
      : "Acces admin actif en fallback local.";
  }
  if (auth.sessionSupported === true) {
    return "Aucune session admin active. Ouvre une session avec un bootstrap token.";
  }
  if (auth.sessionSupported === false) {
    return "Backend sans endpoint de session detecte. Le bootstrap token reste seulement en memoire pour cet onglet.";
  }
  return "Verification de la session admin en cours.";
}

function syncAuthControls(auth) {
  authSummary.textContent = describeAuth(auth);
  logoutButton.disabled = !auth.authenticated;

  if (auth.authenticated && auth.mode === "cookie") {
    tokenInput.placeholder = "session active, token optionnel";
    saveTokenButton.textContent = "Rouvrir session";
    return;
  }

  if (auth.authenticated && auth.mode === "legacy-header") {
    tokenInput.placeholder = "fallback local actif pour cet onglet";
    saveTokenButton.textContent = "Recharger l'acces";
    return;
  }

  tokenInput.placeholder = auth.sessionSupported === false
    ? "bootstrap token local (memoire seulement)"
    : "bootstrap token pour ouvrir la session";
  saveTokenButton.textContent = "Ouvrir session";
}

async function refreshPublicStatus() {
  try {
    const status = await adminApi.getPublicStatus();
    updateState({ publicStatus: status });
    syncStatusStrip(status);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function refreshAdminAuth({ quiet = false } = {}) {
  try {
    const auth = await getAdminSession();
    updateState({ auth });
    return auth;
  } catch (error) {
    if (!quiet) setStatus(error.message, "error");
    throw error;
  }
}

function syncEmbeddedPersonasFrame() {
  const frame = moduleRoot.querySelector(".admin-frame");
  if (!frame?.contentWindow) return;

  frame.contentWindow.postMessage({
    type: "kxkm-admin-auth",
    auth: getAdminAuthSnapshot(),
    legacyToken: getLegacyAdminToken(),
  }, window.location.origin);
}

function wirePersonasFrameBridge() {
  const frame = moduleRoot.querySelector(".admin-frame");
  if (!frame) return;
  frame.addEventListener("load", () => {
    syncEmbeddedPersonasFrame();
  });
  syncEmbeddedPersonasFrame();
}

async function mountCurrentModule() {
  const state = getState();
  const moduleName = modules[state.module] ? state.module : "dashboard";
  const descriptor = modules[moduleName];

  moduleEyebrow.textContent = descriptor.eyebrow;
  moduleTitle.textContent = descriptor.title;
  moduleSummary.textContent = descriptor.summary;
  setActiveNav(moduleName);
  moduleRoot.innerHTML = '<div class="small">Chargement du module…</div>';

  if (!state.auth.authenticated && moduleName !== "dashboard") {
    moduleRoot.innerHTML = '<div class="result-entry"><strong>Session requise</strong><pre>Ouvre d’abord une session admin pour utiliser ce module.</pre></div>';
    setStatus("Session admin requise pour ce module.", "info");
    return;
  }

  try {
    await descriptor.mount(moduleRoot, {
      api: adminApi,
      state,
      setStatus,
    });

    if (moduleName === "personas") {
      wirePersonasFrameBridge();
    }

    setStatus(`${descriptor.title} pret.`, "ok");
  } catch (error) {
    moduleRoot.innerHTML = `<div class="result-entry"><strong>Erreur module</strong><pre>${escapeHtml(error.message)}</pre></div>`;
    setStatus(error.message, "error");
  }
}

function syncHash() {
  const moduleName = location.hash.replace(/^#\/?/, "") || "dashboard";
  updateState({ module: modules[moduleName] ? moduleName : "dashboard" });
}

subscribe((state) => {
  statusBanner.textContent = state.status.text;
  statusBanner.className = `status-banner ${state.status.tone}`;
  syncAuthControls(state.auth);
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    location.hash = `#/${button.dataset.module}`;
  });
});

saveTokenButton.addEventListener("click", async () => {
  try {
    setStatus("Ouverture de la session admin…", "info");
    const auth = await openAdminSession(tokenInput.value.trim());
    tokenInput.value = "";
    updateState({ auth });
    await refreshPublicStatus();
    await mountCurrentModule();
    if (getState().module === "personas") syncEmbeddedPersonasFrame();
  } catch (error) {
    updateState({ auth: getAdminAuthSnapshot() });
    setStatus(error.message, "error");
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    setStatus("Fermeture de la session admin…", "info");
    const auth = await clearAdminSession();
    tokenInput.value = "";
    updateState({ auth });
    await mountCurrentModule();
    setStatus("Session admin fermee.", "info");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

refreshButton.addEventListener("click", async () => {
  setStatus("Rafraichissement admin…", "info");
  await refreshPublicStatus();
  await refreshAdminAuth({ quiet: true }).catch(() => null);
  await mountCurrentModule();
});

tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveTokenButton.click();
  }
});

window.addEventListener("hashchange", async () => {
  syncHash();
  await mountCurrentModule();
});

async function bootstrap() {
  syncHash();
  await refreshPublicStatus();
  await refreshAdminAuth({ quiet: true }).catch(() => null);
  syncAuthControls(getState().auth);
  await mountCurrentModule();
}

bootstrap();
