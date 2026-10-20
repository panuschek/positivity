# Prozessdokumentation: „Gute Nachrichten“ mit KI entwickeln

Dieses Dokument hält fest, wie die Website mit Hilfe von KI entstanden ist: Ausgangsprompt,
Rückfragen und Entscheidungen, Vorgehen, Probleme und Lösungen. Es wird mit jedem Arbeitsschritt
fortgeschrieben.

**Werkzeug:** Claude Code (KI-Coding-Assistent im Terminal), Modell Claude Opus 5.5.
**KI in der fertigen Website:** Claude Haiku – bewertet jede Nachricht und übersetzt internationale Meldungen.

---

## Schritt 1 – Ausgangsprompt (20.10.2026)

Unser Auftrag an die KI (im Original auf Englisch):

> I need to build a website for a university project. It explicitly is an AI project so we are
> supposed to do it using ai, documenting our process to our ultimate goal. The goal is to build a
> website that draws news from public sources like rss feeds or other news APIs but with a twist.
> The motive is "I'll make the world the way I like it". This motive is implemented by only showing
> positive/happy news and omitting sad news entirely. It is based in germany so it should be in
> german. Default news should be from german sources only with an optional setting to toggle global
> news too. The news can be about global events, it's just about where the sources are from.
> Compile a static list of news sources that will be used for that. The design of the page should
> be very simplistic and cheerful. Minimalist, artistic style. If you have any more questions ask
> for clarity until we are fully aligned. Then start implementing.

## Schritt 2 – Klärung der Anforderungen

Bevor Code entstand, hat die KI in zwei Runden Rückfragen gestellt (jeweils mit Empfehlung).
Unsere Antworten:

| Frage | Optionen der KI | Unsere Entscheidung |
| --- | --- | --- |
| Wie wird „positiv“ erkannt? | LLM · lokales Sentiment-Modell · Schlagwörter · Hybrid | **LLM-Klassifizierung** |
| Technischer Aufbau / Hosting? | Statisch + geplanter Build · Node-Server · nur lokal | **Statische Seite + geplanter Build (GitHub Actions/Pages)** |
| Was zeigt ein Artikel? | Titel+Teaser+Link · zusätzlich Bilder · KI-Zusammenfassung | **Mit Bildern** |
| Dokumentation? | Markdown-Log (DE/EN) · selbst | **`PROZESS.md` auf Deutsch** |
| Wie streng filtern? | nur eindeutig positiv · auch harmlos-neutral | **Nur eindeutig positiv** |
| API-Key vorhanden? | – | Rückfrage unsererseits: *„Kann ich mein bestehendes Abo nutzen?“* |
| Zusatzfunktionen (Kategorien, Glücks-Score, Statistik, Dark Mode)? | – | **Keine – Artikel schlicht anzeigen** |
| Git-Repository anlegen? | – | **Ja** |

**Abo statt API-Key:** Die KI erklärte, dass sich die Claude-Code-CLI im Headless-Modus
(`claude -p`) mit dem bestehenden Claude-Abo nutzen lässt – lokal über den vorhandenen Login, in
GitHub Actions über einen Token aus `claude setup-token` (Secret `CLAUDE_CODE_OAUTH_TOKEN`).
Nachteil: Jeder Lauf verbraucht etwas vom Abo-Kontingent, deshalb läuft der Build alle 3 statt
jede Stunde. Als Ausweichlösungen gibt es zusätzlich die API (mit Key) und einen Schlagwortfilter.

**Eigene Entscheidung der KI (von uns akzeptiert):** Meldungen internationaler Quellen werden
beim Bewerten gleich *treu* ins Deutsche übersetzt (nicht umgeschrieben), damit die Seite
durchgehend deutsch ist. Übersetzte Artikel tragen den Hinweis „aus dem Englischen übersetzt“.

## Schritt 3 – Architektur

```
 sources.json ──► Feeds laden ──► neue Artikel? ──► Claude bewertet  ──► nur "positiv" ──► public/news.json ──► Website
 (42 Quellen)     (RSS/Atom)      (Cache)          (je 40 pro Aufruf)    + Bild suchen                          (statisch)
```

- **Build-Skript (Node.js)** lädt alle Feeds, vereinheitlicht RSS und Atom, sucht Bilder
  (Enclosure, `media:content`, `<img>` im Text, notfalls `og:image` der Artikelseite).
- **Cache** (`data/cache.json`): Jeder Artikel wird nur einmal bewertet. Das spart KI-Aufrufe.
  Positive Artikel bleiben 3 Tage sichtbar, auch wenn sie aus dem Feed verschwunden sind.
- **GitHub Actions** führt den Build alle 3 Stunden aus und veröffentlicht `public/` auf GitHub
  Pages. Es wird kein eigener Server benötigt.

## Schritt 4 – Quellenauswahl

Die KI hat eine Kandidatenliste von 57 Feed-Adressen zusammengestellt und jede automatisch
getestet (HTTP-Status, Anzahl Einträge, Bilder vorhanden?).

- Fehlerhafte Adressen (404) wurden durch funktionierende ersetzt, z. B. NDR, oder gestrichen,
  z. B. BR24, hr-iNFO, nur-positive-nachrichten.de.
- **FOCUS online** und **CBC News** blockieren automatisierte Zugriffe (403/Verbindungsabbruch).
  Statt den Bot als Browser zu tarnen, haben wir die beiden Quellen entfernt.
- Ergebnis: **42 Quellen**, davon **27 deutsche** (öffentlich-rechtliche Sender, große Zeitungen,
  Wissenschaftsmagazine, konstruktiver Journalismus wie Good Impact und Perspective Daily) und
  **15 internationale** (BBC, Guardian, NYT, NPR, Al Jazeera …, plus Positive News, Good News
  Network, Reasons to be Cheerful, NASA u. a.).

Die Liste steht in `sources.json`. Mit `npm run check-sources` lässt sich jederzeit prüfen, ob
noch alle Quellen erreichbar sind.

## Schritt 5 – Der Filter (Herzstück)

Der Prompt (`scripts/lib/classifiers/prompt.mjs`) ist auf Deutsch geschrieben und definiert drei
Urteile: **positiv**, **neutral**, **negativ**. Wichtige Regeln:

- *Sei streng. Im Zweifel nicht positiv.*
- *Eine positive Wendung in einem belastenden Kontext ist NICHT positiv*, z. B. „Drohne rettet
  verletzten Soldaten von der Front“ oder „Weniger Tote als befürchtet“.
- Bewertet wird, wie sich ein Mensch beim Lesen fühlt, nicht die Wortwahl.

Die Antwort wird über ein **JSON-Schema** erzwungen (strukturierte Ausgabe). Dadurch lässt sich
das Ergebnis zuverlässig weiterverarbeiten.

### Vergleich: Schlagwortfilter vs. KI (erster Testlauf, 20.10.2026)

| | Schlagwortfilter | KI (Claude Haiku) |
| --- | --- | --- |
| Bewertete Artikel | 600 | 889 |
| Als positiv eingestuft | 78 (13 %) | 119 (13 %) |
| Typische Fehler | „Kühlungsborn verliert pro Jahr über 10 Millionen Euro“ → positiv (wegen „Booking“-Kontext nicht erkannt); „News-Quiz vom 20. Oktober“ → positiv | keine offensichtlichen; Grenzfälle eher zu streng |

Beispiele für KI-Urteile:

- ✅ *positiv:* „Japan startet Mission zu Mars-Monden“, „Tierbabys: Die kleinsten Otter der Welt
  haben Nachwuchs“, „Mann in Texas findet mehr als 128.000 Dollar auf einem Geldautomaten – und
  gibt jeden Dollar zurück“
- ➖ *neutral:* „Vier Wochen keine Regionalbahnen zwischen Hamburg-Hauptbahnhof und Harburg“,
  „Ende der Zeitumstellung: Winter- oder Sommerzeit – was wäre besser?“
- ❌ *negativ:* „Ukraine-Krieg: Neuer Ort, neue Hoffnung? Selenskyj trifft Witkoff in Oslo“
  (trotz „Hoffnung“), „Krippenfiguren in Grünhain geklaut“

Fazit: Der Schlagwortfilter erkennt Wörter, aber keine Bedeutung. Die KI versteht den Kontext und
kann zusätzlich übersetzen. Der erste vollständige Lauf (23 Aufrufe à 40 Artikel) dauerte ca. 2 Minuten.

## Schritt 6 – Design

Vorgabe: *simpel, fröhlich, minimalistisch, künstlerisch.* Umsetzung durch die KI:

- warmer Papierton als Hintergrund mit feinem Punktraster, viel Weißraum
- Schrift **Fraunces** (verspielte Serifenschrift) für Überschriften, **DM Sans** für Text
- lachende Sonne im Kopf (dreht sich langsam), Motto „Ich mach mir die Welt, wie sie mir gefällt.“
  (angelehnt an Pippi Langstrumpf)
- Jede Karte bekommt eine Pastell-Akzentfarbe (Sonnengelb, Koralle, Mint, Himmelblau, Flieder)
  als leicht gedrehte Fläche hinter dem Bild
- Fehlt ein Bild oder lädt es nicht, erzeugt die Seite ein **abstraktes Kunstwerk** aus Kreisen,
  Halbkreisen und Wellen (aus der Artikel-ID berechnet, also immer gleich)
- Schalter „Auch internationale Quellen“, die Einstellung wird im Browser gespeichert

## Probleme und Lösungen

| Problem | Lösung |
| --- | --- |
| Bei begrenzter Artikelanzahl pro Lauf wurden nur deutsche Quellen bewertet (Reihenfolge der Liste) | Artikel aller Quellen werden im Reißverschlussverfahren gemischt |
| WordPress-Feeds (Positive News, Good News Network, Utopia …) liefern keine Bilder | Für positive Artikel wird das `og:image` der Artikelseite nachgeladen |
| Feed-Texte enthalten HTML, Entities und Floskeln („The post … appeared first on …“) | Bereinigung in `stripHtml()` |
| In CI gibt es keinen interaktiven Login für die Claude-CLI | Token via `claude setup-token`; ohne Token wird automatisch auf API bzw. Schlagwörter ausgewichen |
| Spaltenlayout (Masonry) zerstörte die zeitliche Reihenfolge | Umstellung auf zeilenweises Grid |
| Erster Lauf in GitHub Actions: einzelne Stapel scheiterten mit „claude beendet mit Code 1“, die eigentliche Ursache war im Log abgeschnitten | Die KI hat den Fehler lokal mit einem ungültigen Token nachgestellt: Die CLI schreibt den Grund in das JSON-Feld `result`/`api_error_status`. Jetzt: verständliche Fehlermeldung, bei 401 sofortiger Abbruch mit Hinweis auf `claude setup-token`, bei Rate-Limit (429)/Überlastung bis zu 3 neue Versuche mit Wartezeit, nur noch 2 parallele Aufrufe |

## Offene Punkte / Ideen

- Repository auf GitHub veröffentlichen, Pages aktivieren, Secret hinterlegen (siehe README)
- Prompt nach einigen Tagen anhand echter Grenzfälle nachschärfen
