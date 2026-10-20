// Klassifizierung über die Claude-Code-CLI im Headless-Modus (`claude -p`).
// Nutzt das bestehende Claude-Abo (lokaler Login oder CLAUDE_CODE_OAUTH_TOKEN in CI).
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserMessage, mapResults } from './prompt.mjs';

const BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || 'haiku';

export const name = 'claude-cli';

export function isAvailable() {
  // In CI gibt es keinen interaktiven Login – dort nur mit Token aus `claude setup-token`
  if (process.env.CI && !process.env.CLAUDE_CODE_OAUTH_TOKEN) return false;
  const r = spawnSync(BIN, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function run(input, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model', MODEL,
      '--output-format', 'json',
      '--system-prompt', SYSTEM_PROMPT,
      '--json-schema', JSON.stringify(RESPONSE_SCHEMA),
      '--tools', '',          // keine Werkzeuge – reine Textaufgabe
      '--strict-mcp-config',  // keine MCP-Server laden
      '--no-session-persistence',
    ];
    // Neutrales Arbeitsverzeichnis, damit keine Projekt-Einstellungen geladen werden
    const child = spawn(BIN, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Zeitüberschreitung beim Aufruf der Claude-CLI'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let res;
      try {
        res = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude beendet mit Code ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      // Fehler stecken im JSON (Feld "result" + "api_error_status"), nicht in stderr
      if (code !== 0 || res.is_error) return reject(cliError(res));
      resolve(res);
    });
    child.stdin.end(input);
  });
}

function cliError(res) {
  const status = res.api_error_status;
  const msg = String(res.result ?? res.subtype ?? 'unbekannter Fehler').slice(0, 300);
  const err = new Error(`Claude-CLI-Fehler${status ? ` (HTTP ${status})` : ''}: ${msg}`);
  err.status = status;
  if (status === 401 || status === 403 || /authenticat|login/i.test(msg)) {
    err.fatal = true;
    err.message += ' → Token ungültig oder abgelaufen? Lokal `claude setup-token` ausführen und das Secret CLAUDE_CODE_OAUTH_TOKEN neu setzen.';
  }
  return err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function classifyBatch(batch) {
  // Bei Rate-Limits (429) oder Überlastung (5xx/529) mit wachsender Wartezeit erneut versuchen
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await run(buildUserMessage(batch));
      break;
    } catch (e) {
      const retryable = !e.fatal && (e.status === 429 || e.status >= 500 || /rate|overload|limit/i.test(e.message));
      if (!retryable || attempt >= 4) throw e;
      const wait = 15000 * 2 ** (attempt - 1);
      console.log(`    … ${e.message.slice(0, 120)} – neuer Versuch in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
  let data = res.structured_output;
  if (!data && typeof res.result === 'string') {
    try {
      data = JSON.parse(res.result);
    } catch {
      /* unten behandelt */
    }
  }
  if (!data?.results) throw new Error('Claude-CLI lieferte keine strukturierte Antwort');
  return mapResults(batch, data.results);
}
