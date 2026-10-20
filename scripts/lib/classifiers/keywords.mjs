// Einfacher Schlagwort-Filter als Fallback (z. B. zum Testen ohne KI).
// Deutlich ungenauer als die KI – dient vor allem dem Vergleich in der Dokumentation.

export const name = 'keywords';

export const isAvailable = () => true;

const NEGATIVE = new RegExp(
  [
    // Deutsch
    'krieg', 'tote?n?\\b', 'getötet', 'tötet', 'stirbt', 'gestorben', 'sterben', 'mord', 'anschlag', 'terror', 'angriff', 'attacke',
    'gewalt', 'verletzt', 'unfall', 'absturz', 'brand', 'feuer', 'explosion', 'katastroph', 'flut', 'hochwasser', 'erdbeben', 'dürre',
    'krise', 'insolvenz', 'pleite', 'entlass', 'stellenabbau', 'rezession', 'inflation', 'streik', 'protest', 'demonstr', 'ausschreitung',
    'krank', 'virus', 'pandemie', 'krebs', 'polizei', 'festgenommen', 'festnahme', 'prozess', 'urteil', 'gericht', 'anklage', 'verdacht',
    'missbrauch', 'vergewalt', 'betrug', 'skandal', 'streit', 'drohung', 'droht', 'warnung', 'warnt', 'gefahr', 'angst', 'rakete', 'drohne',
    'militär', 'soldat', 'armee', 'waffe', 'sanktion', 'flucht', 'opfer', 'leiche', 'vermisst', 'afd', 'rechtsextrem', 'hass', 'rassis',
    'ukraine', 'russland', 'gaza', 'israel', 'iran', 'nahost', 'trump', 'zoll',
    // Englisch
    'war\\b', 'kill', 'dead', 'death', 'dies\\b', 'died', 'murder', 'attack', 'shooting', 'violence', 'injur', 'crash', 'disaster',
    'flood', 'earthquake', 'crisis', 'layoff', 'strike', 'protest', 'arrest', 'police', 'court', 'trial', 'abuse', 'fraud', 'scandal',
    'threat', 'warn', 'fear', 'missile', 'military', 'troops', 'weapon', 'sanction', 'victim', 'missing', 'tariff',
  ].join('|'),
  'i',
);

const POSITIVE = new RegExp(
  [
    // Deutsch
    'durchbruch', 'entdeck', 'erfolg', 'gelingt', 'gelungen', 'rettet', 'gerettet', 'hilft', 'hilfe', 'spende', 'ehrenamt', 'freude',
    'glück', 'feier', 'gewinnt', 'preis', 'auszeichnung', 'rekord', 'erstmals', 'neu entdeckt', 'artenschutz', 'naturschutz', 'nachwuchs',
    'geboren', 'baby', 'zoo', 'heilung', 'fortschritt', 'innovation', 'erfindung', 'lösung', 'solar', 'erneuerbar', 'wiederentdeckt',
    'lächeln', 'herz', 'schön', 'zusammenhalt', 'kostenlos',
    // Englisch
    'breakthrough', 'discover', 'success', 'rescue', 'saved', 'help', 'donat', 'volunteer', 'joy', 'happy', 'celebrat', 'wins?\\b',
    'award', 'record', 'first ever', 'conservation', 'wildlife', 'born', 'baby', 'cure', 'progress', 'innovation', 'invent', 'solution',
    'renewable', 'restor', 'thriv', 'kindness', 'smile',
  ].join('|'),
  'i',
);

export async function classifyBatch(batch) {
  const out = new Map();
  for (const a of batch) {
    const t = `${a.title} ${a.teaser}`;
    const verdict = NEGATIVE.test(t) ? 'negativ' : POSITIVE.test(t) ? 'positiv' : 'neutral';
    out.set(a.id, { verdict });
  }
  return out;
}
