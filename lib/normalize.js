/**
 * Shapes raw "Cards Life-Cycle" (question 4093) rows into what CS Search renders.
 *
 * One card returns MANY rows — one per order it has ever appeared in
 * (submit, slab_pack/repack, retrieve). CS needs the RETRIEVE row: that is the
 * order that physically shipped the slab to a customer, and therefore the order
 * a returned-to-sender package belongs to. The slab_pack rows are prior repack
 * owners; shipping to one of those would send the card to the wrong person.
 */

// Defensive: accept rows whether or not the caller already lower-cased keys.
const lower = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v;
  }
  return out;
};

const pickCol = (row, ...names) => {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return '';
};

const str = (v) => (v === null || v === undefined ? '' : String(v));

export function normalizeRow(raw) {
  const row = lower(raw);
  return {
    order: str(pickCol(row, 'order_number', 'order_ref', 'order_id')),
    orderUrl: str(pickCol(row, 'order_url')),
    kind: str(pickCol(row, 'order_kind')) || 'order',
    source: str(pickCol(row, 'order_source')),
    detail: str(pickCol(row, 'order_detail')),
    created: str(pickCol(row, 'order_created_at')),
    processed: str(pickCol(row, 'order_processed_at')),
    customer: str(pickCol(row, 'customer_name')),
    username: str(pickCol(row, 'username')),
    email: str(pickCol(row, 'user_email')),
    userId: str(pickCol(row, 'user_id')),
    po: str(pickCol(row, 'po_numbers', 'po_number')),
    status: str(pickCol(row, 'card_status', 'order_status')),
    ac: str(pickCol(row, 'ac_number')),
    cert: str(pickCol(row, 'cert_number')),
    grade: str(pickCol(row, 'grade', 'grade_overall')),
    set: str(pickCol(row, 'set_name')),
    player: str(pickCol(row, 'player_name')),
    insert: str(pickCol(row, 'insert')),
    parallel: str(pickCol(row, 'parallel_name')),
    parallelTotal: str(pickCol(row, 'parallel_total')),
    sport: str(pickCol(row, 'sport')),
    frontImg: str(pickCol(row, 'front_slab_picture_url')),
  };
}

// Metabase renders order_url as a "Click Me" link column; keep only real URLs.
const isUrl = (v) => /^https?:\/\//i.test(v || '');

/** Most recent first, blanks last. */
function byCreatedDesc(a, b) {
  const ta = Date.parse(a.created) || 0;
  const tb = Date.parse(b.created) || 0;
  return tb - ta;
}

export function buildResult(rawRows, { adminBase = '' } = {}) {
  const rows = rawRows.map(normalizeRow).filter((r) => r.order);
  if (!rows.length) return { found: false };

  const lifecycle = rows.slice().sort(byCreatedDesc);
  const first = lifecycle[0];

  // the order CS acts on: newest retrieve, else newest row of any kind
  const retrieveRows = lifecycle.filter((r) => /retriev/i.test(r.kind));
  const target = retrieveRows[0] || first;

  const card = {
    ac: first.ac,
    cert: first.cert,
    player: first.player,
    set: first.set,
    insert: first.insert,
    parallel: first.parallel,
    parallelTotal: first.parallelTotal,
    sport: first.sport,
    grade: first.grade,
    frontImg: first.frontImg,
    status: target.status,
    lifecycle: lifecycle.map((r) => ({
      order: r.order,
      kind: r.kind,
      source: r.source,
      detail: r.detail,
      created: r.created || '—',
      processed: r.processed || '—',
      customer: r.customer,
      username: r.username,
      email: r.email,
      po: r.po,
      status: r.status,
      url: isUrl(r.orderUrl) || Boolean(adminBase),
    })),
  };

  const retrieval = {
    id: target.order,
    kind: target.kind,
    customer: target.customer,
    username: target.username,
    email: target.email,
    userId: target.userId,
    source: target.source,
    po: target.po,
    createdStr: target.created || '—',
    processedStr: target.processed || '—',
    // 4093 has no carrier feed; order_processed_at is the ship signal
    shipDateStr: (target.processed || '').slice(0, 10) || '—',
    status: target.status,
    orderUrl: isUrl(target.orderUrl) ? target.orderUrl : '',
    noRetrieveRow: retrieveRows.length === 0,
  };

  return { found: true, card, retrieval, lifecycleCount: lifecycle.length };
}

/** Rows from an order-wide query -> the shipment card list. */
export function buildShipment(rawRows) {
  const seen = new Set();
  return rawRows
    .map(normalizeRow)
    .filter((r) => {
      const k = r.ac || r.cert;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({
      slot: i + 1,
      ac: r.ac,
      cert: r.cert,
      player: r.player,
      set: r.set,
      insert: r.insert,
      parallel: r.parallel,
      grade: r.grade,
      sport: r.sport,
    }));
}
