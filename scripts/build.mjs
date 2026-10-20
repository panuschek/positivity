// Build-Pipeline: Feeds laden → neue Artikel per KI bewerten → nur positive in public/news.json schreiben.
//
// Umgebungsvariablen:
//   CLASSIFIER   auto | claude-cli | anthropic-api | keywords   (Standard: auto)
//   BATCH_SIZE   Artikel pro KI-Aufruf (Standard: 40)
//   CONCURRENCY  gleichzeitige KI-Aufrufe (Standard: 2)
//   MAX_NEW      max. neu zu bewertende Artikel pro Lauf (Standard: 600)
//   MAX_AGE_H    Artikel älter als X Stunden werden ignoriert (Standard: 48)
//   KEEP_DAYS    so lange bleiben positive Artikel auf der Seite (Standard: 3)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSource, fetchOgImage, mapLimit } from './lib/feeds.mjs';
import * as claudeCli from './lib/classifiers/claude-cli.mjs';
import * as anthropicApi from './lib/classifiers/anthropic-api.mjs';
import * as keywords from './lib/classifiers/keywords.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = join(ROOT, 'data', 'cache.json');
const OUT_FILE = join(ROOT, 'public', 'news.json');

const env = (k, d) => process.env[k] ?? d;
const BATCH_SIZE = Number(env('BATCH_SIZE', 40));
const CONCURRENCY = Number(env('CONCURRENCY', 2));
const MAX_NEW = Number(env('MAX_NEW', 600));
const MAX_AGE_H = Number(env('MAX_AGE_H', 48));
const KEEP_DAYS = Number(env('KEEP_DAYS', 3));
const CACHE_DAYS = 7;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function pickClassifier() {
  const wanted = env('CLASSIFIER', 'auto');
  const all = [claudeCli, anthropicApi, keywords];
  if (wanted !== 'auto') {
    const c = all.find((c) => c.name === wanted);
    if (!c) throw new Error(`Unbekannter Klassifizierer: ${wanted}`);
    if (!c.isAvailable()) throw new Error(`Klassifizierer ${wanted} ist nicht verfügbar`);
    return c;
  }
  return all.find((c) => c.isAvailable());
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Gleiche Meldung aus mehreren Quellen (z. B. Agenturmeldungen) nur einmal zeigen
const titleKey = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function main() {
  const started = Date.now();
  const { sources } = JSON.parse(await readFile(join(ROOT, 'sources.json'), 'utf8'));
  const cache = await readJson(CACHE_FILE, { articles: {} });
  const classifier = pickClassifier();
  log(`Klassifizierer: ${classifier.name}`);

  // 1. Feeds laden
  const now = Date.now();
  const minDate = new Date(now - MAX_AGE_H * 3600e3).toISOString();
  const feedStats = [];
  const fetched = (
    await mapLimit(sources, 8, async (s) => {
      try {
        const items = await fetchSource(s);
        feedStats.push({ id: s.id, ok: true, count: items.length });
        return items;
      } catch (e) {
        feedStats.push({ id: s.id, ok: false, error: e.message });
        log(`  ⚠ ${s.name}: ${e.message}`);
        return [];
      }
    })
  ).flat();
  log(`${fetched.length} Artikel aus ${feedStats.filter((f) => f.ok).length}/${sources.length} Quellen geladen`);

  // 2. Neue Artikel ermitteln (bereits bewertete stehen im Cache)
  const seen = new Set();
  const fresh = [];
  for (const a of fetched) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const cached = cache.articles[a.id];
    // Ergebnisse des Schlagwort-Filters werden neu bewertet, sobald eine KI verfügbar ist
    if (cached && (cached.classifier !== 'keywords' || classifier.name === 'keywords')) continue;
    if (a.date && a.date < minDate) continue;
    fresh.push(a);
  }
  // Reißverschluss über alle Quellen, damit ein Limit nicht nur die letzten Quellen der Liste trifft
  const perSource = Object.values(Object.groupBy(fresh, (a) => a.sourceId));
  const interleaved = [];
  for (let i = 0; interleaved.length < fresh.length; i++) {
    for (const list of perSource) if (list[i]) interleaved.push(list[i]);
  }
  const todo = interleaved.slice(0, MAX_NEW);
  log(`${fresh.length} neue Artikel, bewerte ${todo.length} in Stapeln à ${BATCH_SIZE}`);

  // 3. Bewerten
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));
  let failed = 0;
  let fatal = null;
  await mapLimit(batches, classifier.name === 'keywords' ? 1 : CONCURRENCY, async (batch, i) => {
    if (fatal) return; // z. B. ungültiger Token – weitere Aufrufe sind zwecklos
    try {
      const results = await classifier.classifyBatch(batch);
      for (const a of batch) {
        const r = results.get(a.id);
        if (!r) continue; // fehlt in der Antwort → nächster Lauf versucht es erneut
        cache.articles[a.id] = {
          ...a,
          ...r,
          firstSeen: new Date().toISOString(),
          date: a.date || new Date().toISOString(),
          classifier: classifier.name,
        };
      }
      const pos = [...results.values()].filter((r) => r.verdict === 'positiv').length;
      log(`  Stapel ${i + 1}/${batches.length}: ${pos} von ${batch.length} positiv`);
    } catch (e) {
      failed++;
      if (e.fatal) fatal = e;
      log(`  ⚠ Stapel ${i + 1}/${batches.length} fehlgeschlagen: ${e.message}`);
    }
  });
  if (fatal) throw new Error(`Abbruch: ${fatal.message}`);
  if (failed) log(`${failed} von ${batches.length} Stapeln fehlgeschlagen – diese Artikel werden beim nächsten Lauf erneut bewertet.`);
  if (batches.length && failed === batches.length) {
    throw new Error('Alle Bewertungs-Aufrufe sind fehlgeschlagen – Abbruch, news.json bleibt unverändert.');
  }

  // 4. Fehlende Bilder für positive Artikel über og:image nachladen
  const keepFrom = new Date(now - KEEP_DAYS * 86400e3).toISOString();
  const positives = Object.values(cache.articles).filter((a) => a.verdict === 'positiv' && a.date >= keepFrom);
  const needImage = positives.filter((a) => !a.image && !a.imageChecked);
  if (needImage.length) {
    log(`Lade Vorschaubilder für ${needImage.length} Artikel …`);
    await mapLimit(needImage, 6, async (a) => {
      a.image = await fetchOgImage(a.link);
      a.imageChecked = true;
    });
  }

  // 5. Cache aufräumen und speichern
  const pruneBefore = new Date(now - CACHE_DAYS * 86400e3).toISOString();
  for (const [id, a] of Object.entries(cache.articles)) {
    if ((a.firstSeen || a.date) < pruneBefore) delete cache.articles[id];
  }
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));

  // 6. news.json schreiben
  const byTitle = new Set();
  const items = positives
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((a) => {
      const k = titleKey(a.title_de || a.title);
      if (byTitle.has(k)) return false;
      byTitle.add(k);
      return true;
    })
    .map((a) => ({
      id: a.id,
      title: a.title_de || a.title,
      teaser: a.teaser_de ?? a.teaser,
      link: a.link,
      image: a.image || null,
      date: a.date,
      source: a.source,
      region: a.region,
      lang: a.lang,
      translated: Boolean(a.title_de && a.lang !== 'de'),
    }));

  const out = {
    generatedAt: new Date().toISOString(),
    classifier: classifier.name,
    count: items.length,
    sources: sources.map(({ name, region }) => ({ name, region })),
    items,
  };
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out, null, 1));
  const de = items.filter((i) => i.region === 'de').length;
  log(`✓ ${items.length} positive Artikel (${de} deutsch, ${items.length - de} international) → public/news.json`);
  log(`Fertig in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
