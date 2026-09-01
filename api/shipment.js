import { runQuestion, isConfigured } from '../lib/metabase.js';
import { buildShipment } from '../lib/normalize.js';

/**
 * "What else was in this box?"
 *
 * Question 4093 now carries [[ AND ao.order_ref ILIKE {{order_number}} || '%' ]],
 * so ORDER_QUESTION_ID defaults to 4093 and no second question is needed.
 *
 * This runs as its own request rather than inside /api/lookup: filtering 4093 by
 * order alone leaves `match_card` unfiltered (every card, then joined across four
 * UNIONed order sources), so it is far heavier than a cert lookup. Keeping it
 * separate means the retrieval order — the answer CS actually needs — renders
 * immediately and the shipment table fills in behind it, and a slow or timed-out
 * order query can never take the main lookup down with it.
 */
const ORDER_Q = process.env.ORDER_QUESTION_ID || '';
const TIMEOUT = Number(process.env.SHIPMENT_TIMEOUT_MS || 25000);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  if (!isConfigured()) return res.status(503).json({ error: 'Metabase is not configured' });
  if (!ORDER_Q) {
    return res.status(501).json({ error: 'Shipment contents are turned off (ORDER_QUESTION_ID is not set)' });
  }

  const order = String(req.query.order || '').trim();
  if (!order) return res.status(400).json({ error: 'Pass ?order=' });

  try {
    // 4093 matches with ILIKE {{order_number}} || '%'. Whether the variable is
    // declared Text or Number in Metabase decides the parameter type, and the two
    // are not interchangeable — so try text, then retry as a number on rejection.
    let rows;
    try {
      rows = await runQuestion(ORDER_Q, { order_number: { value: order, type: 'text' } }, { timeoutMs: TIMEOUT });
    } catch (e) {
      if (!/400|parameter/i.test(e.message || '')) throw e;
      rows = await runQuestion(ORDER_Q, { order_number: { value: order, type: 'number' } }, { timeoutMs: TIMEOUT });
    }

    // the filter is a prefix match, so drop anything that is not this exact order
    const exact = rows.filter((r) => {
      const n = r.order_number ?? r.order_ref ?? '';
      return String(n) === order;
    });

    return res.status(200).json({
      order,
      questionId: ORDER_Q,
      cards: buildShipment(exact.length ? exact : rows),
    });
  } catch (e) {
    console.error('shipment failed:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Shipment lookup failed' });
  }
}
