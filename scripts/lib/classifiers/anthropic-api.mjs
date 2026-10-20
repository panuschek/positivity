// Klassifizierung über die Claude API (benötigt ANTHROPIC_API_KEY).
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserMessage, mapResults } from './prompt.mjs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

export const name = 'anthropic-api';

export const isAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client;

export async function classifyBatch(batch) {
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(batch) }],
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('Anfrage wurde vom Modell abgelehnt');
  if (response.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten (max_tokens)');
  const textBlock = response.content.find((b) => b.type === 'text');
  const data = JSON.parse(textBlock?.text ?? '{}');
  return mapResults(batch, data.results);
}
