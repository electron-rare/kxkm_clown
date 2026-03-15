function renderModelList(items, emptyText) {
  if (!items.length) return `<p class="small">${emptyText}</p>`;
  return items.map((model) => `
    <div class="table-row is-column">
      <strong>${model.name}</strong>
      <div class="small">
        ${model.family ? `${model.family} · ` : ""}${model.size || "taille inconnue"}${model.expiresAt ? ` · expire ${model.expiresAt}` : ""}
      </div>
    </div>
  `).join("");
}

export async function mountRuntime(container, { api }) {
  const runtime = await api.getRuntime();
  const network = runtime.network || {
    host: "127.0.0.1",
    accessMode: "loopback",
    adminApiProtection: "token",
    adminAllowedSubnets: [],
  };
  container.innerHTML = `
    <div class="stack">
      <div class="grid-cards">
        <article class="card">
          <p class="eyebrow">Ollama</p>
          <h3>${runtime.ollama}</h3>
          <p class="small">${runtime.modelsAvailable.length} modèles visibles</p>
        </article>
        <article class="card">
          <p class="eyebrow">Chargés</p>
          <h3>${runtime.modelsLoaded.length}</h3>
          <p class="small">Selon /api/ps</p>
        </article>
        <article class="card">
          <p class="eyebrow">Sessions</p>
          <h3>${runtime.sessions} actives</h3>
          <p class="small">${runtime.savedSessions.length} snapshots récents</p>
        </article>
        <article class="card">
          <p class="eyebrow">Accès</p>
          <h3>${network.accessMode === "lan_controlled" ? "LAN contrôlé" : "Loopback"}</h3>
          <p class="small">${network.host} · ${network.adminApiProtection}</p>
        </article>
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Réseau admin</p>
            <h3>Politique active</h3>
          </div>
        </div>
        <div class="table-like">
          <div class="table-row is-column">
            <strong>Pages admin</strong>
            <div class="small">${network.adminPagesPublic ? "lisibles sur le LAN" : "restreintes"}</div>
          </div>
          <div class="table-row is-column">
            <strong>API admin</strong>
            <div class="small">${network.adminApiProtection}</div>
          </div>
          <div class="table-row is-column">
            <strong>Subnets autorisés</strong>
            <div class="small">${(network.adminAllowedSubnets || []).join(", ") || "aucun"}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Modèles chargés</p>
            <h3>Runtime actuel</h3>
          </div>
        </div>
        <div class="table-like">
          ${renderModelList(runtime.modelsLoaded, "Aucun modèle chargé signalé par Ollama.")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Modèles disponibles</p>
            <h3>Catalogue visible</h3>
          </div>
        </div>
        <div class="table-like">
          ${renderModelList(runtime.modelsAvailable, "Aucun modèle visible.")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Personas coupées</p>
            <h3>Exclues du runtime</h3>
          </div>
        </div>
        <div class="tag-list">
          ${runtime.disabledPersonaIds.map((id) => `<span class="tag off">${id}</span>`).join("") || '<span class="small">Aucune persona désactivée.</span>'}
        </div>
      </section>
    </div>
  `;
}
