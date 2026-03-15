export async function mountPersonas(container) {
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
        <p class="small">La surface personas reste dédiée pour cette itération, mais elle partage le même token admin via <code>sessionStorage</code>.</p>
      </section>
      <iframe class="admin-frame" src="/admin/personas.html?embedded=1" title="Admin personas nodal"></iframe>
    </div>
  `;
}
