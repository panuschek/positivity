# Gute Nachrichten ☀

> „Ich mach mir die Welt, wie sie mir gefällt.“

Eine Nachrichtenseite, die nur **positive Nachrichten** zeigt. Die Meldungen stammen aus den RSS-Feeds
großer Medien (`sources.json`). Eine KI (Claude) bewertet jede Meldung, und auf der Seite landet nur,
was eindeutig erfreulich ist. Standardmäßig werden nur **deutsche Quellen** angezeigt, internationale
Quellen lassen sich per Schalter dazunehmen (deren Meldungen werden ins Deutsche übersetzt).

Uni-Projekt – der Entstehungsprozess mit KI ist in [`PROZESS.md`](PROZESS.md) dokumentiert.

## Aufbau

```
sources.json                 statische Liste aller Quellen (region: de | global)
scripts/build.mjs            Pipeline: Feeds laden → bewerten → public/news.json
scripts/lib/feeds.mjs        RSS/Atom laden und vereinheitlichen, Bilder finden
scripts/lib/classifiers/     claude-cli (Abo) · anthropic-api (API-Key) · keywords (Fallback)
scripts/check-sources.mjs    prüft, ob alle Quellen erreichbar sind
public/                      statische Website (index.html, style.css, app.js)
.github/workflows/update.yml baut alle 3 Stunden neu und veröffentlicht auf GitHub Pages
```

Bereits bewertete Artikel werden in `data/cache.json` gespeichert und nicht erneut bewertet.

## Lokal starten

Voraussetzung: Node.js ≥ 22.

```bash
npm install
npm run build        # Nachrichten laden und filtern
npm run serve        # Vorschau auf http://localhost:8080
```

### Welche KI bewertet?

`CLASSIFIER=auto` (Standard) nimmt den ersten verfügbaren Klassifizierer:

| Klassifizierer  | Voraussetzung                                                             |
| --------------- | ------------------------------------------------------------------------- |
| `claude-cli`    | Claude Code ist installiert und eingeloggt (nutzt das Claude-Abo)         |
| `anthropic-api` | `ANTHROPIC_API_KEY` ist gesetzt                                           |
| `keywords`      | immer – einfacher Schlagwortfilter, nur zum Testen bzw. Vergleichen       |

Beispiele: `CLASSIFIER=keywords npm run build` oder `npm run build:keywords`.

Weitere Einstellungen über Umgebungsvariablen: `CLAUDE_MODEL` (Standard `haiku`), `ANTHROPIC_MODEL`
(Standard `claude-haiku-4-5`), `BATCH_SIZE`, `MAX_NEW`, `MAX_AGE_H`, `KEEP_DAYS` (siehe Kopf von
`scripts/build.mjs`).

## Veröffentlichen mit GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. **Settings → Pages → Source: „GitHub Actions“** auswählen.
3. Token für das Claude-Abo erzeugen (einmalig, lokal):
   ```bash
   claude setup-token
   ```
   Den ausgegebenen Token unter **Settings → Secrets and variables → Actions** als Secret
   `CLAUDE_CODE_OAUTH_TOKEN` speichern. (Alternativ: Secret `ANTHROPIC_API_KEY` für die API.)
4. Unter **Actions → „Gute Nachrichten aktualisieren“ → Run workflow** den ersten Lauf starten.

Danach aktualisiert sich die Seite automatisch alle 3 Stunden. Jeder Lauf verbraucht einen kleinen
Teil des Abo-Kontingents (ca. 40 Meldungen pro KI-Aufruf, Modell Haiku).

Hinweis: GitHub pausiert geplante Workflows, wenn im Repository 60 Tage lang nichts passiert.
