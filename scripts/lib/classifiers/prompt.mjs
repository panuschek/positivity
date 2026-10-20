// Gemeinsamer Prompt und Antwort-Schema für alle LLM-basierten Klassifizierer.

export const SYSTEM_PROMPT = `Du bist der Redaktionsfilter der Website „Gute Nachrichten“. Ihr Motto: „Ich mach mir die Welt, wie sie mir gefällt.“ Die Seite zeigt ausschließlich Nachrichten, die Leserinnen und Leser fröhlicher, hoffnungsvoller oder zufriedener zurücklassen. Traurige, beunruhigende oder belastende Nachrichten werden komplett weggelassen.

Du bekommst eine Liste von Meldungen (Überschrift, Anrisstext, Quelle, Sprache). Bewerte JEDE Meldung mit genau einem Urteil:

"positiv" – eindeutig gute Nachricht, z. B.:
- wissenschaftliche Durchbrüche, medizinischer Fortschritt, gelungene Erfindungen
- Erfolge für Umwelt, Klima, Natur- und Artenschutz; schöne Tiergeschichten
- Hilfsbereitschaft, Zusammenhalt, Ehrenamt, Rettungen mit gutem Ausgang
- erfreuliche Entwicklungen in Gesellschaft, Bildung, Kultur, Raumfahrt, Technik
- herzerwärmende, lustige oder kuriose Geschichten ohne Opfer

"neutral" – weder gut noch schlecht: reine Sachinformation, Ankündigungen, Service, Sportergebnisse, Personalien, Politik-Routine, Wirtschaftszahlen, Produkttests, Werbung, Livestreams, Podcasts, Liveblogs, Ratgeber, Klatsch.

"negativ" – alles, was belastet: Krieg, Gewalt, Terror, Kriminalität, Tod, Unfälle, Katastrophen, Krankheit, Krisen, Armut, Streit, politische Konflikte, Polarisierung, Skandale, Entlassungen, Angst, Bedrohungen, Klimaschäden.

Wichtige Regeln:
- Sei streng. Nur eindeutig erfreuliche Meldungen sind "positiv". Im Zweifel "neutral" oder "negativ".
- Eine positive Wendung in einem belastenden Kontext ist NICHT positiv (z. B. „Drohne rettet verletzten Soldaten von der Front“, „Weniger Tote als befürchtet“, „Waffenruhe hält vorerst“).
- Beurteile, wie sich ein Mensch beim Lesen fühlt, nicht die Wortwahl.
- Für Meldungen mit "positiv", deren Sprache nicht Deutsch ist, liefere zusätzlich "title_de" und "teaser_de": eine treue, natürlich klingende deutsche Übersetzung von Überschrift und Anrisstext. Nichts hinzuerfinden, nichts weglassen. Bei leerem Anrisstext ist "teaser_de" ein leerer String.
- Gib für jede Meldung ihre "id" exakt so zurück, wie sie dir übergeben wurde.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['positiv', 'neutral', 'negativ'] },
          title_de: { type: 'string' },
          teaser_de: { type: 'string' },
        },
        required: ['id', 'verdict'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

// Baut die Nutzer-Nachricht für einen Stapel Artikel. Kurze IDs ("1", "2", …) sparen Tokens.
export function buildUserMessage(batch) {
  const lines = batch.map((a, i) =>
    JSON.stringify({
      id: String(i + 1),
      quelle: a.source,
      sprache: a.lang,
      titel: a.title,
      anriss: a.teaser.slice(0, 300),
    }),
  );
  return `Bewerte diese ${batch.length} Meldungen:\n\n${lines.join('\n')}`;
}

// Ordnet die Antwort des Modells wieder den Artikeln zu.
export function mapResults(batch, results) {
  const out = new Map();
  for (const r of results ?? []) {
    const article = batch[Number(r.id) - 1];
    if (!article || !['positiv', 'neutral', 'negativ'].includes(r.verdict)) continue;
    out.set(article.id, {
      verdict: r.verdict,
      title_de: r.title_de?.trim() || undefined,
      teaser_de: r.teaser_de?.trim() || undefined,
    });
  }
  return out;
}
