const listeners = new Set();

const state = {
  module: "dashboard",
  token: sessionStorage.getItem("kxkmAdminToken") || "",
  status: {
    text: "Prêt.",
    tone: "info",
  },
  publicStatus: null,
};

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function setStatus(text, tone = "info") {
  updateState({
    status: {
      text,
      tone,
    },
  });
}
