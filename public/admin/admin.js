import { adminApi, loadAdminToken, saveAdminToken } from "./admin-api.js";
import { getState, subscribe, updateState, setStatus } from "./admin-store.js";
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
const refreshButton = document.getElementById("refresh-button");
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

async function refreshPublicStatus() {
  try {
    const status = await adminApi.getPublicStatus();
    updateState({ publicStatus: status });
    syncStatusStrip(status);
  } catch (error) {
    setStatus(error.message, "error");
  }
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

  if (!state.token && moduleName !== "dashboard") {
    moduleRoot.innerHTML = '<div class="result-entry"><strong>Token requis</strong><pre>Charge d’abord le bootstrap token admin pour ouvrir ce module.</pre></div>';
    setStatus("Token admin requis pour ce module.", "info");
    return;
  }

  try {
    await descriptor.mount(moduleRoot, {
      api: adminApi,
      state,
      setStatus,
    });
    setStatus(`${descriptor.title} prêt.`, "ok");
  } catch (error) {
    moduleRoot.innerHTML = `<div class="result-entry"><strong>Erreur module</strong><pre>${escapeHtml(error.message)}</pre></div>`;
    setStatus(error.message, "error");
  }
}

function syncHash() {
  const moduleName = location.hash.replace(/^#\/?/, "") || "dashboard";
  updateState({ module: modules[moduleName] ? moduleName : "dashboard" });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

subscribe((state) => {
  tokenInput.value = state.token;
  statusBanner.textContent = state.status.text;
  statusBanner.className = `status-banner ${state.status.tone}`;
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    location.hash = `#/${button.dataset.module}`;
  });
});

saveTokenButton.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  saveAdminToken(token);
  updateState({ token });
  setStatus(token ? "Token admin chargé." : "Token admin effacé.", token ? "ok" : "info");
  await mountCurrentModule();
});

refreshButton.addEventListener("click", async () => {
  await refreshPublicStatus();
  await mountCurrentModule();
});

window.addEventListener("hashchange", async () => {
  syncHash();
  await mountCurrentModule();
});

async function bootstrap() {
  const token = loadAdminToken();
  updateState({ token });
  syncHash();
  await refreshPublicStatus();
  await mountCurrentModule();
}

bootstrap();
