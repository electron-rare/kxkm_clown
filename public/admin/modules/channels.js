import { escapeHtml } from "../utils.js";

export async function mountChannels(container, { api, setStatus }) {
  const channels = await api.getChannels();
  container.innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Canaux</p>
            <h3>Topics et activité</h3>
          </div>
        </div>
        <div class="table-like">
          ${channels.map((channel) => `
            <form class="table-row is-column" data-channel-form data-channel="${channel.name}">
              <div class="panel-header">
                <div>
                  <strong>${channel.name}</strong>
                  <div class="small">${channel.type} · ${channel.model || "pas de modèle fixe"} · ${channel.userCount} utilisateurs visibles</div>
                </div>
                <div class="tag-list">
                  <span class="tag">${channel.respondersMode || channel.type}</span>
                </div>
              </div>
              <label>
                <span class="small">Topic</span>
                <input name="topic" value="${escapeHtml(channel.topic || "")}" placeholder="Topic du canal">
              </label>
              <div class="small">Mis à jour: ${escapeHtml(channel.updatedAt || "—")} · par ${escapeHtml(channel.updatedBy || "—")}</div>
              <div class="tag-list">
                ${(channel.users || []).map((user) => `<span class="tag">${escapeHtml(user)}</span>`).join("") || '<span class="small">Aucun utilisateur visible.</span>'}
              </div>
              <div>
                <button type="submit">Sauvegarder le topic</button>
              </div>
            </form>
          `).join("")}
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll("[data-channel-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const channel = form.dataset.channel;
      const topic = form.querySelector('input[name="topic"]').value;
      try {
        setStatus(`Mise à jour du topic ${channel}...`, "info");
        await api.updateChannelTopic(channel, topic, "admin");
        setStatus(`Topic mis à jour pour ${channel}.`, "ok");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  });
}
