export async function mountPersonas(container, { state } = {}) {
  const authNote = state?.auth?.mode === "legacy-header"
    ? "La surface personas tourne en page dediee, avec un pont d'auth local injecte depuis le shell pour cet onglet."
    : "La surface personas reste dediee pour cette iteration et reutilise la meme session admin same-origin du shell.";

  container.innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Module personas</p>
            <h3>Surface nodale éditoriale</h3>
          </div>
          <a class="secondary-link" href="/admin/personas.html" target="_blank" rel="noopener">Ouvrir dans un onglet</a>
        </div>
        <p class="small">${authNote}</p>
      </section>
      <iframe class="admin-frame" src="/admin/personas.html?embedded=1" title="Admin personas nodal"></iframe>
    </div>
  `;
}
