const ACCENTS = ['#ffc94a', '#ff8a7a', '#8fdcbf', '#9ccbff', '#cdb2ff'];
const LANGS = { en: 'Englischen', fr: 'Französischen', es: 'Spanischen', it: 'Italienischen' };
const STORAGE_KEY = 'gute-nachrichten:global';

const feedEl = document.getElementById('feed');
const toggle = document.getElementById('global-toggle');

let data = null;

// Einfacher, deterministischer Zufall aus der Artikel-ID → jede Karte hat „ihre“ Farbe und Form
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Abstraktes Kunstwerk als Platzhalter, wenn kein Bild vorhanden ist
function artwork(id, accent) {
  const r = seeded(id + 'art');
  const pick = () => ACCENTS[Math.floor(r() * ACCENTS.length)];
  const bg = '#f4ecdb';
  const shapes = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = 20 + r() * 120;
    const y = 15 + r() * 70;
    const s = 18 + r() * 34;
    const color = i === 0 ? accent : pick();
    const kind = Math.floor(r() * 4);
    if (kind === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${s}" fill="${color}"/>`);
    else if (kind === 1) shapes.push(`<path d="M${x - s} ${y}a${s} ${s} 0 0 1 ${s * 2} 0z" fill="${color}" transform="rotate(${Math.floor(r() * 4) * 90} ${x} ${y})"/>`);
    else if (kind === 2) shapes.push(`<rect x="${x - s * 0.7}" y="${y - s * 0.7}" width="${s * 1.4}" height="${s * 1.4}" rx="${s * 0.3}" fill="${color}" transform="rotate(${Math.round(r() * 40 - 20)} ${x} ${y})"/>`);
    else {
      const w = s * 2.4;
      shapes.push(`<path d="M${x - w / 2} ${y}q${w / 8} -14 ${w / 4} 0t${w / 4} 0t${w / 4} 0t${w / 4} 0" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`);
    }
  }
  return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true"><rect width="160" height="100" fill="${bg}"/>${shapes.join('')}</svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
function relTime(iso) {
  const diff = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function card(item, index) {
  const r = seeded(item.id);
  const accent = ACCENTS[Math.floor(r() * ACCENTS.length)];
  const tilt = (r() * 3 - 1.5).toFixed(2);
  const img = item.image
    ? `<img src="${esc(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-id="${esc(item.id)}">`
    : artwork(item.id, accent);
  return `
    <article class="card" style="--accent:${accent};--tilt:${tilt}deg;animation-delay:${Math.min(index, 12) * 50}ms">
      <a href="${esc(item.link)}" target="_blank" rel="noopener">
        <div class="figure">${img}</div>
        <p class="meta"><span>${esc(item.source)}</span><span aria-hidden="true">·</span><time datetime="${esc(item.date)}">${relTime(item.date)}</time></p>
        <h2>${esc(item.title)}</h2>
        ${item.teaser ? `<p class="teaser">${esc(item.teaser)}</p>` : ''}
        ${item.translated ? `<span class="note">aus dem ${LANGS[item.lang] || 'Original'} übersetzt</span>` : ''}
      </a>
    </article>`;
}

function render() {
  if (!data) return;
  const showGlobal = toggle.checked;
  const items = data.items.filter((i) => showGlobal || i.region === 'de');
  feedEl.innerHTML = items.length
    ? items.map(card).join('')
    : '<p class="state">Gerade gibt es keine neuen guten Nachrichten. Schau bald wieder vorbei – die Sonne kommt bestimmt.</p>';
}

// Defekte Bilder durch ein Kunstwerk ersetzen
feedEl.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const accent = getComputedStyle(img.closest('.card')).getPropertyValue('--accent').trim();
  img.outerHTML = artwork(img.dataset.id || img.src, accent);
}, true);

function renderSources(sources) {
  const el = document.getElementById('sources');
  if (!sources) return;
  const group = (title, list) =>
    `<div><h3>${title}</h3><ul>${list.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ul></div>`;
  el.innerHTML =
    group('Deutsche Quellen', sources.filter((s) => s.region === 'de')) +
    group('Internationale Quellen', sources.filter((s) => s.region !== 'de'));
}

function init() {
  document.getElementById('today').textContent = new Date().toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    toggle.checked = localStorage.getItem(STORAGE_KEY) === '1';
  } catch { /* Speicher nicht verfügbar – Standard: nur deutsche Quellen */ }

  toggle.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, toggle.checked ? '1' : '0'); } catch { /* egal */ }
    render();
  });

  fetch('news.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((json) => {
      data = json;
      const updated = new Date(json.generatedAt).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' });
      document.getElementById('updated').textContent = `Zuletzt aktualisiert: ${updated} Uhr`;
      renderSources(json.sources);
      render();
    })
    .catch(() => {
      feedEl.innerHTML = '<p class="state">Die Nachrichten konnten gerade nicht geladen werden. Bitte später noch einmal versuchen.</p>';
    });
}

init();
