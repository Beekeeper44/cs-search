/**
 * Thin Metabase client.
 *
 * Runs a saved question by id and returns rows as objects keyed by
 * lower_snake_case column name. Auth is an API key held server-side only —
 * it is never sent to the browser.
 */

const BASE = (process.env.METABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.METABASE_API_KEY || '';
const TIMEOUT_MS = Number(process.env.METABASE_TIMEOUT_MS || 20000);

export function isConfigured() {
  return Boolean(BASE && KEY);
}

/**
 * Question 4093 uses optional template tags: [[ AND c.number::text = {{ac_number}} ]].
 * Text tags take a "category" parameter targeting the variable by name.
 * Tags left out of the array stay unset, so their clause is skipped.
 */
function toParameters(tags) {
  return Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([name, value]) => ({
      type: 'category',
      target: ['variable', ['template-tag', name]],
      value: String(value),
    }));
}

export async function runQuestion(questionId, tags = {}) {
  if (!isConfigured()) {
    const err = new Error('Metabase is not configured');
    err.status = 503;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BASE}/api/card/${questionId}/query/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ parameters: toParameters(tags) }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(
      e.name === 'AbortError' ? 'Metabase timed out' : `Metabase unreachable: ${e.message}`
    );
    err.status = 504;
    throw err;
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Metabase ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status === 401 || res.status === 403 ? 502 : 502;
    throw err;
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    const err = new Error('Metabase returned a non-JSON body');
    err.status = 502;
    throw err;
  }
  if (!Array.isArray(rows)) return [];

  // /query/json keys rows by column display name; normalise to snake_case
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v;
    }
    return out;
  });
}
