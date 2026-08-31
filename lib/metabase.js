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
 * Question 4093 uses optional template tags: [[ AND c.number::text = {{ac_number}}::text ]].
 * Tags left out of the array stay unset, so their clause is skipped entirely.
 *
 * The parameter type MUST match the variable type declared in Metabase, or the
 * run is rejected. In 4093: ac_number, cert_number and po_number are declared
 * Number; sport, player_name, set_name, parallel_name, user_email and username
 * are Text. Pass tags as { name: value } for text, or { name: { value, type } }.
 */
const NUMBER_TAGS = new Set(['ac_number', 'cert_number', 'po_number']);

function toParameters(tags) {
  return Object.entries(tags)
    .filter(([, v]) => {
      const val = v && typeof v === 'object' ? v.value : v;
      return val !== undefined && val !== null && val !== '';
    })
    .map(([name, v]) => {
      const raw = v && typeof v === 'object' ? v.value : v;
      const isNumber =
        (v && typeof v === 'object' && v.type === 'number') || NUMBER_TAGS.has(name);
      return {
        type: isNumber ? 'number/=' : 'category',
        target: ['variable', ['template-tag', name]],
        value: isNumber ? Number(raw) : String(raw),
      };
    });
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
