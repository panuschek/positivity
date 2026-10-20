// Prüft alle Quellen aus sources.json: erreichbar? wie viele Artikel? wie viele mit Bild?
import { readFile } from 'node:fs/promises';
import { fetchSource, mapLimit } from './lib/feeds.mjs';

const { sources } = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));

const rows = await mapLimit(sources, 8, async (s) => {
  try {
    const items = await fetchSource(s, { maxItems: 1000 });
    return { s, ok: true, n: items.length, img: items.filter((i) => i.image).length, newest: items[0]?.date?.slice(0, 16) ?? '–' };
  } catch (e) {
    return { s, ok: false, err: e.message };
  }
});

for (const { s, ok, n, img, newest, err } of rows) {
  const tag = s.region === 'de' ? 'DE ' : 'INT';
  console.log(ok ? `✓ ${tag} ${s.name.padEnd(28)} ${String(n).padStart(4)} Artikel, ${String(img).padStart(4)} mit Bild, neuester: ${newest}` : `✗ ${tag} ${s.name.padEnd(28)} ${err}`);
}
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} Quellen erreichbar`);
