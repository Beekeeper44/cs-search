/**
 * Thin Metabase client.
 *
 * Runs a saved question by id and returns rows as objects keyed by
 * lower_snake_case column name. Auth is an API key held server-side only —
 * it is never sent to the browser.
 */

/**
 * Host accepts either name: METABASE_URL or METABASE_HOST (other Arena Club
 * Vercel projects use METABASE_HOST, so both work and neither has to be renamed).
 * A bare hostname is upgraded to https:// and any trailing slash is dropped.
 */
function resolveBase() {
  const raw = (process.env.METABASE_URL || process.env.METABASE_HOST || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

const BASE = resolveBase();
const KEY = (process.env.METABASE_API_KEY || process.env.METABASE_KEY || '').trim();
const TIMEOUT_MS = Number(process.env.METABASE_TIMEOUT_MS || 20000);

export function isConfigured() {
  return Boolean(BASE && KEY);
}

/**
 * Metabase requires every parameter object to carry the template tag's own `id`
 * (a UUID stored in the card definition), not just a target. Without it the run
 * is rejected with:
 *   {"specific-errors":{"parameters":[{"id":["missing required key"]}]}}
 *
 * So we read the card once per cold start to learn each tag's id AND its declared
 * type, which also removes the need to hardcode which tags are numeric.
 */
const tagCache = new Map();

async function getTemplateTags(questionId) {
  if (tagCache.has(questionId)) return tagCache.get(questionId);

  const res = await fetch(`${BASE}/api/card/${questionId}`, {
    headers: { 'x-api-key': KEY },
  });
  if (!res.ok) {
    const err = new Error(`Could not read question ${questionId}: HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const card = await res.json();
  const tags = card?.dataset_query?.native?.['template-tags'] || {};

  const map = {};
  for (const [name, tag] of Object.entries(tags)) {
    map[name] = { id: tag.id, type: tag.type }; // type: 'text' | 'number' | 'date' | 'dimension'
  }
  tagCache.set(questionId, map);
  return map;
}

/** Metabase variable type -> parameter type */
const PARAM_TYPE = { number: 'number/=', date: 'date/single', text: 'category' };

/**
 * Tags left out of the object stay unset, so their [[ optional ]] clause is
 * skipped entirely — that is how one lookup filters on cert OR ac, never both.
 */
function toParameters(tags, tagMeta) {
  return Object.entries(tags)
    .filter(([, v]) => {
      const val = v && typeof v === 'object' ? v.value : v;
      return val !== undefined && val !== null && val !== '';
    })
    .map(([name, v]) => {
      const raw = v && typeof v === 'object' ? v.value : v;
      const meta = tagMeta[name];
      if (!meta) {
        const err = new Error(`Question has no template tag named "${name}"`);
        err.status = 400;
        throw err;
      }
      const kind = meta.type || 'text';
      const isNumber = kind === 'number';
      return {
        id: meta.id,
        type: PARAM_TYPE[kind] || 'category',
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

  const tagMeta = await getTemplateTags(questionId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BASE}/api/card/${questionId}/query/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ parameters: toParameters(tags, tagMeta) }),
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
