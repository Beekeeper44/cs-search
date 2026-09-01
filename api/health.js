import { isConfigured, describeTags } from '../lib/metabase.js';

/**
 * Config check. Reports whether each variable is present — never its value.
 * Hit this first after deploying; the UI also calls it to explain a 503.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const url = (process.env.METABASE_URL || process.env.METABASE_HOST || '').trim();
  const key = (process.env.METABASE_API_KEY || process.env.METABASE_KEY || '').trim();
  const urlVar = process.env.METABASE_URL ? 'METABASE_URL' : process.env.METABASE_HOST ? 'METABASE_HOST' : null;

  // /api/health?tags=1 shows what the app discovered about the question's variables
  let tags;
  if (req.query?.tags && isConfigured()) {
    try {
      const found = await describeTags(process.env.CARDS_QUESTION_ID || '4093');
      tags = Object.keys(found).length
        ? Object.fromEntries(
            Object.entries(found).map(([n, t]) => [n, `${t.type} · id from ${t.source}`])
          )
        : 'none discovered — falling back to tag-name ids (this still works)';
    } catch (e) {
      tags = `discovery failed: ${e.message}`;
    }
  }

  res.status(200).json({
    ok: true,
    ...(tags ? { tags } : {}),
    metabase: isConfigured(),
    vars: {
      'METABASE_URL / METABASE_HOST': url ? `set via ${urlVar} -> ${url}` : 'MISSING (set either name)',
      METABASE_API_KEY: key ? `set (${key.length} chars, starts "${key.slice(0, 3)}")` : 'MISSING',
      CARDS_QUESTION_ID: process.env.CARDS_QUESTION_ID || '4093 (default)',
      ORDER_QUESTION_ID: process.env.ORDER_QUESTION_ID || 'not set (shipment table hidden)',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'not set (history stays in-browser)',
      TEAM_MEMBERS: process.env.TEAM_MEMBERS || 'Anthony,Marisa (default)',
    },
    warnings: [
      (process.env.METABASE_URL || '') !== (process.env.METABASE_URL || '').trim() ||
      (process.env.METABASE_HOST || '') !== (process.env.METABASE_HOST || '').trim()
        ? 'the host variable has leading/trailing whitespace'
        : null,
      (process.env.METABASE_API_KEY || '') !== key ? 'METABASE_API_KEY has leading/trailing whitespace' : null,
      key && !key.startsWith('mb_') ? 'METABASE_API_KEY does not start with mb_ — is it an API key?' : null,
      process.env.METABASE_URL && process.env.METABASE_HOST
        ? 'both METABASE_URL and METABASE_HOST are set; METABASE_URL wins'
        : null,
    ].filter(Boolean),
    deployment: {
      env: process.env.VERCEL_ENV || 'local',
      url: process.env.VERCEL_URL || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    },
    build: '2026-08-31h',
  });
}
