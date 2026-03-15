function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEntries(items) {
  if (!items.length) return '<p class="small">Aucun résultat.</p>';
  return items.map((entry) => `
    <article class="result-entry">
      <strong>${escapeHtml(entry.channel)} · &lt;${escapeHtml(entry.nick)}&gt;</strong>
      <div class="small">${escapeHtml(entry.ts)}</div>
      <pre>${escapeHtml(entry.text)}</pre>
    </article>
  `).join("");
}

export async function mountData(container, { api, setStatus }) {
  const summary = await api.getLogsSummary();
  container.innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Exports</p>
            <h3>Sorties locales</h3>
          </div>
        </div>
        <div class="tag-list">
          <button type="button" data-download-json data-path="/api/training/export" data-filename="training.json">Exporter training</button>
          <button type="button" class="secondary" data-download-json data-path="/api/dpo/export" data-filename="dpo.json">Exporter DPO</button>
          <button type="button" class="secondary" data-export-html>Exporter HTML</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Recherche</p>
            <h3>Historique local</h3>
          </div>
        </div>
        <form id="history-search-form" class="stack">
          <label>
            <span class="small">Texte</span>
            <input name="q" placeholder="mot-clé, nick, texte...">
          </label>
          <label>
            <span class="small">Canal</span>
            <input name="channel" placeholder="#general">
          </label>
          <label>
            <span class="small">Limite</span>
            <input name="limit" type="number" min="1" max="500" value="50">
          </label>
          <div>
            <button type="submit">Chercher</button>
          </div>
        </form>
        <div id="history-results" class="results"></div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Résumé logs</p>
            <h3>Canaux les plus récents</h3>
          </div>
        </div>
        <div class="table-like">
          ${summary.map((entry) => `
            <div class="table-row">
              <strong>${escapeHtml(entry.channel)}</strong>
              <div>
                <div>${escapeHtml(entry.lastText || "—")}</div>
                <div class="small">${escapeHtml(entry.lastTs || "—")} · ${escapeHtml(entry.lastNick || "—")}</div>
              </div>
              <span class="tag">${entry.count} lignes</span>
            </div>
          `).join("")}
        </div>
      </section>
    </div>
  `;

  const form = container.querySelector("#history-search-form");
  const results = container.querySelector("#history-results");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      q: formData.get("q"),
      channel: formData.get("channel"),
      limit: formData.get("limit"),
    };

    try {
      setStatus("Recherche historique en cours...", "info");
      const entries = await api.searchHistory(payload);
      results.innerHTML = renderEntries(entries);
      setStatus(`${entries.length} entrée(s) trouvée(s).`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  container.querySelectorAll("[data-download-json]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setStatus(`Téléchargement ${button.dataset.filename}...`, "info");
        await api.downloadJson(button.dataset.path, button.dataset.filename, { admin: true });
        setStatus(`${button.dataset.filename} exporté.`, "ok");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  });

  container.querySelector("[data-export-html]").addEventListener("click", async () => {
    try {
      setStatus("Export HTML en cours...", "info");
      await api.downloadHtmlExport({ limit: 200 });
      setStatus("Export HTML téléchargé.", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}
