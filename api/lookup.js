import { runQuestion, isConfigured } from '../lib/metabase.js';
import { buildResult } from '../lib/normalize.js';

const CARDS_Q = process.env.CARDS_QUESTION_ID || '4093';

// scanners send padded values; the warehouse stores them bare
const clean = (v) =>
  String(v || '')
    .toUpperCase()
    .replace(/^(PSA|CERT|SERIAL)[\s:#._-]*/, '')
    .replace(/^8?AC/, '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Use GET' });
  }
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Metabase is not configured. Set METABASE_URL and METABASE_API_KEY.',
    });
  }

  const cert = clean(req.query.cert);
  const ac = clean(req.query.ac);
  if (!cert && !ac) {
    return res.status(400).json({ error: 'Pass ?cert= or ?ac=' });
  }

  try {
    // try the field the scanner said it was first, then fall back to the other,
    // so a cert scanned into the AC box still finds its card
    const order = ac ? ['ac', 'cert'] : ['cert', 'ac'];
    let rows = [];
    let matchedOn = '';

    for (const field of order) {
      const value = field === 'ac' ? ac || cert : cert || ac;
      if (!value) continue;
      // both tags are declared Number in 4093, so send them as numbers
      rows = await runQuestion(CARDS_Q, {
        [field === 'ac' ? 'ac_number' : 'cert_number']: { value, type: 'number' },
      });
      if (rows.length) {
        matchedOn = field === 'ac' ? '8AC barcode' : 'PSA cert';
        break;
      }
    }

    if (!rows.length) return res.status(200).json({ found: false });

    const result = buildResult(rows);
    result.matchedOn = matchedOn;

    // Shipment contents are fetched separately by the client (/api/shipment):
    // filtering 4093 by order alone is much heavier than a card lookup, and the
    // retrieval order should render immediately rather than wait on it.
    result.shipment = [];

    return res.status(200).json(result);
  } catch (e) {
    console.error('lookup failed:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Lookup failed' });
  }
}
