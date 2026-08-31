import { isConfigured } from '../lib/metabase.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    metabase: isConfigured(),
    metabase_url: process.env.METABASE_URL ? 'set' : 'missing',
    cards_question_id: process.env.CARDS_QUESTION_ID || '4093',
    order_question_id: process.env.ORDER_QUESTION_ID || null,
    history_db: Boolean(process.env.DATABASE_URL),
    team: (process.env.TEAM_MEMBERS || 'Anthony,Marisa').split(','),
  });
}
