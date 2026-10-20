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
      if (code !== 0) return reject(new Error(`claude beendet mit Code ${code}: ${(stderr || stdout).slice(0, 500)}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Antwort der Claude-CLI ist kein JSON: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.end(input);
  });
}

export async function classifyBatch(batch) {
  const res = await run(buildUserMessage(batch));
  if (res.is_error) throw new Error(`Claude-CLI meldet Fehler: ${res.result?.slice?.(0, 300)}`);
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
