import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
const sql = url ? neon(url) : null;
const TEAM = (process.env.TEAM_MEMBERS || 'Anthony,Marisa').split(',').map((s) => s.trim());

// Runs once per cold start; CREATE TABLE IF NOT EXISTS is cheap and idempotent.
// On failure the cached promise is cleared, so a transient Neon hiccup during a
// cold start doesn't poison every later request in that container.
let ready = null;
async function ensureTable() {
  if (!ready) {
    ready = (async () => sql`
      CREATE TABLE IF NOT EXISTS cs_search_history (
        id                     BIGSERIAL PRIMARY KEY,
        completed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        team_member            TEXT NOT NULL,
        outcome                TEXT NOT NULL,
        note                   TEXT,
        scanned_input          TEXT,
        order_number           TEXT,
        order_kind             TEXT,
        order_source           TEXT,
        order_detail           TEXT,
        order_created_at       TEXT,
        order_processed_at     TEXT,
        po_numbers             TEXT,
        customer_name          TEXT,
        username               TEXT,
        user_email             TEXT,
        cards_in_shipment      INTEGER,
        ship_date              TEXT,
        card_status            TEXT,
        ac_number              TEXT,
        cert_number            TEXT,
        player_name            TEXT,
        set_name               TEXT,
        insert_name            TEXT,
        parallel_name          TEXT,
        parallel_total         TEXT,
        sport                  TEXT,
        grade                  TEXT,
        front_slab_picture_url TEXT
      )`)().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!sql) {
    return res.status(503).json({ error: 'DATABASE_URL is not set — history cannot persist.' });
  }

  try {
    await ensureTable();

    if (req.method === 'GET') {
      // default view is today's work; ?days=N widens it
      const days = Math.min(Number(req.query.days || 1), 90);
      const entries = await sql`
        SELECT * FROM cs_search_history
        WHERE completed_at >= now() - (${days} || ' days')::interval
        ORDER BY completed_at DESC
        LIMIT 1000`;
      return res.status(200).json({ entries });
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (!b.team_member || !TEAM.includes(b.team_member)) {
        return res.status(400).json({ error: `team_member must be one of: ${TEAM.join(', ')}` });
      }
      if (!b.outcome) return res.status(400).json({ error: 'outcome is required' });

      const [row] = await sql`
        INSERT INTO cs_search_history (
          team_member, outcome, note, scanned_input,
          order_number, order_kind, order_source, order_detail,
          order_created_at, order_processed_at, po_numbers,
          customer_name, username, user_email,
          cards_in_shipment, ship_date, card_status,
          ac_number, cert_number, player_name, set_name, insert_name,
          parallel_name, parallel_total, sport, grade, front_slab_picture_url
        ) VALUES (
          ${b.team_member}, ${b.outcome}, ${b.note || null}, ${b.scanned_input || null},
          ${b.order_number || null}, ${b.order_kind || null}, ${b.order_source || null}, ${b.order_detail || null},
          ${b.order_created_at || null}, ${b.order_processed_at || null}, ${b.po_numbers || null},
          ${b.customer_name || null}, ${b.username || null}, ${b.user_email || null},
          ${b.cards_in_shipment || 0}, ${b.ship_date || null}, ${b.card_status || null},
          ${b.ac_number || null}, ${b.cert_number || null}, ${b.player_name || null},
          ${b.set_name || null}, ${b.insert_name || null}, ${b.parallel_name || null},
          ${b.parallel_total || null}, ${b.sport || null}, ${b.grade || null}, ${b.front_slab_picture_url || null}
        ) RETURNING id, completed_at`;
      return res.status(201).json(row);
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'Pass ?id=' });
      await sql`DELETE FROM cs_search_history WHERE id = ${id}`;
      return res.status(200).json({ deleted: id });
    }

    return res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch (e) {
    console.error('history failed:', e);
    return res.status(500).json({ error: e.message || 'History failed' });
  }
}
