export async function mountDashboard(container, { api }) {
  const status = await api.getPublicStatus();
  let runtime = {
    modelsLoaded: [],
    modelsAvailable: [],
    disabledPersonaIds: [],
    channels: [],
    generalPersonas: [],
  };

  try {
    runtime = await api.getRuntime();
  } catch {
    // The dashboard still renders the public status without admin token.
  }

  container.innerHTML = `
    <div class="stack">
      <div class="grid-cards">
        <article class="card">
          <p class="eyebrow">Serveur</p>
          <h3>${status.name}</h3>
          <p class="small">Version ${status.version} · ${status.accessMode === "lan_controlled" ? "LAN contrôlé" : "Loopback"} · ${status.ollama}</p>
        </article>
        <article class="card">
          <p class="eyebrow">Charge</p>
          <h3>${status.clients} clients / ${status.sessions} sessions</h3>
          <p class="small">${status.channels} canaux · ${status.personas} personas actives</p>
        </article>
        <article class="card">
          <p class="eyebrow">Runtime modèles</p>
          <h3>${runtime.modelsLoaded.length} chargés</h3>
          <p class="small">${runtime.modelsAvailable.length} visibles · ${runtime.disabledPersonaIds.length} personas désactivées</p>
        </article>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Canaux</p>
            <h3>Activité immédiate</h3>
          </div>
        </div>
        <div class="table-like">
          ${runtime.channels.map((channel) => `
            <div class="table-row">
              <strong>${channel.name}</strong>
              <div>
                <div>${channel.topic || "KXKM_Clown - Local LLM Chat"}</div>
                <div class="small">${channel.type} · ${channel.users} utilisateurs visibles</div>
              </div>
              <span class="tag">${channel.model || channel.type}</span>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Personas</p>
            <h3>Actives dans #general</h3>
          </div>
        </div>
        <div class="tag-list">
          ${runtime.generalPersonas.map((persona) => `<span class="tag ok">${persona.name} · ${persona.model}</span>`).join("") || '<span class="small">Aucune persona active.</span>'}
        </div>
      </section>
    </div>
  `;
}
