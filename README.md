# CS Search

Return-to-sender lookup for Arena Club customer service. Scan a pre-graded slab
cert or an Arena slab AC number, get the **retrieval order** the card shipped in,
then log who handled it.

Backed by Metabase question **4093 — Cards Life-Cycle**
(`https://arena-club.metabaseapp.com/question/4093`).

---

## Why the retrieve row matters

Question 4093 returns **many rows per card** — one for every order the card has
ever touched. For cert `79067707`:

| order | kind | created | customer |
|---|---|---|---|
| 18303912 | `retrieve` | Aug 30, 12:11 AM | James Henry |
| 17907318 | `slab_pack` | Aug 22, 10:09 AM | James Henry |
| 17852165 | `slab_pack` | Aug 21, 1:35 PM | Aj Prouty |
| 17789433 | `slab_pack` | Aug 20, 4:58 PM | Cam Simms |
| 17651517 | `submit` | Aug 18, 1:38 PM | Arena Club |

Only the `retrieve` row is the order that physically shipped the slab to a
customer, so it is the one a returned package belongs to. The `slab_pack` rows
are **previous repack owners** — shipping to one of those sends the card to the
wrong person. The API always selects the newest `retrieve` row and the UI marks
it with an orange `retrieve` pill.

If a card has no `retrieve` row, the API falls back to the newest order of any
kind and the UI shows an amber "no retrieve row" warning rather than silently
presenting the wrong customer.

---

## Deploy

```bash
npm install
npx vercel link
npx vercel --prod
```

### Required environment variables

Set in Vercel → Project → Settings → Environment Variables.

| Variable | Required | Notes |
|---|---|---|
| `METABASE_URL` *or* `METABASE_HOST` | yes | `https://arena-club.metabaseapp.com`. Either name works — other Arena Club projects use `METABASE_HOST`. A bare hostname gets `https://` added and a trailing slash is dropped. |
| `METABASE_API_KEY` *or* `METABASE_KEY` | yes | Metabase → Admin → Settings → Authentication → API keys. Whitespace is trimmed. |
| `CARDS_QUESTION_ID` | yes | `4093` |
| `ORDER_QUESTION_ID` | no | Question taking `{{order_number}}`, returns every card on an order |
| `DATABASE_URL` | no | Neon Postgres for the History log |
| `TEAM_MEMBERS` | no | Defaults to `Anthony,Marisa` |
| `ADMIN_ORDER_BASE_URL` | no | Defaults to `https://admin.arenaclub.com/orders` |

The Metabase key lives only in the serverless functions. The browser never
receives it and never talks to Metabase directly.

### Metabase API key permissions

Create the key against a group with **view access to question 4093 and its
underlying Snowflake database only**. This app never writes to Metabase.

---

## How the app talks to 4093

**Parameters are built from the question itself.** On the first call of a cold
start, `lib/metabase.js` reads `GET /api/card/4093` and pulls
`dataset_query.native.template-tags`, which gives each variable's internal `id`
and declared type. Both are required:

- Metabase rejects any parameter object without the tag's `id` —
  `{"specific-errors":{"parameters":[{"id":["missing required key"]}]}}`.
- The parameter type must match the declared type. In 4093 `ac_number`,
  `cert_number` and `po_number` are **Number** (sent as `number/=` with a numeric
  value); the rest are **Text** (sent as `category`).

Because the types are read from the question rather than hardcoded, changing a
variable from Number to Text in Metabase needs no code change — just a redeploy
to clear the cached tag map.

Because the tags are numeric, scanner input is reduced to digits before it is
sent: `8AC0001234`, `8 AC 1234`, `AC-1234` and `1234` all become `1234`;
`PSA 79067707` and `CERT-79067707` become `79067707`. Leading zeros are stripped,
which is required — `{{ac_number}}` is a number, and the SQL casts it back with
`c.number::text = {{ac_number}}::text`.

**Never build an order link from `order_number`.** The query returns
`order_url` as `'https://admin.arenaclub.com/orders/' || o.id` — the internal
id — while `order_number` is `o.number`. They are different values, so a link
built from the number would 404. The app only ever uses the `order_url` the
query returns. Repack, auction and purchase rows return `NULL` there (no admin
order page exists for them), so those order numbers render as plain text.

**Two statuses, two meanings.** `card_status` is `admin.cards.status` — the
grading pipeline. `order_status` is `admin.orders.status` — the shipping side.
Both are shown; the hero chip uses `card_status` and the fields show
`order_status` next to it.

**Four order sources feed the life-cycle.** `order` (submit/retrieve/vault),
`slab_pack (repack)`, `auction` and `purchase` are UNIONed, so a card can appear
in all four. Only `order_kind = 'retrieve'` is the shipment CS acts on.

### Shipment contents — off by default

The **cards in this shipment** section is hidden unless `ORDER_QUESTION_ID` is
set. Nothing about it is needed for a return-to-sender: the retrieval order,
customer and email are the answer, and they come from the card lookup.

Set the variable to turn it on, with two options:

- **`ORDER_QUESTION_ID=4093`** — works, because 4093 now carries
  `[[ AND ao.order_ref ILIKE {{order_number}} || '%' ]]`. But it is slow:
  filtering by order alone leaves `match_card` unfiltered — every row in
  `admin.cards`, joined across four UNIONed order sources, before the final
  `WHERE` narrows to one order. A cert lookup filters at the top of the CTE;
  this filters at the very bottom.
- **A dedicated question** from `db/order-question.sql` — hits
  `public.orders → order_items → admin.cards` directly and returns in
  milliseconds.

Either way it is fetched by its own request (`/api/shipment`) after the result
renders, so the retrieval order appears immediately and a slow order query can
never take the main lookup down with it. `SHIPMENT_TIMEOUT_MS` (default 25000)
caps the wait.

`order_number`'s declared type in Metabase is ambiguous — the SQL matches it
with `ILIKE ... || '%'` like the text variables, but its filter widget is
configured like the numeric ones. The endpoint sends it as text and retries as a
number if Metabase rejects the parameter, so either declaration works. Because
the match is a prefix, rows whose `order_number` is not an exact match are then
discarded — otherwise `1830391` would also return `18303912`.

### Ship date

4093 exposes `order_processed_at` (from `admin.orders.processed_at`) but no
carrier or tracking columns, so processed_at stands in as the ship signal. Add
real ship date and tracking to the question later and `lib/normalize.js` will
pick them up by name with no other change.

### Timezones

The query already converts to `America/Los_Angeles` — naive UTC columns via
`CONVERT_TIMEZONE`, and repack `created_at` is left alone because it is already
LA wall-time. The app displays those strings verbatim and does no further
conversion, so nothing shifts by 7 hours.

---

## History log

Completed work is written to Neon:

```sql
-- optional; the API creates this on first call
psql "$DATABASE_URL" -f db/schema.sql
```

`GET /api/history` returns today by default, `?days=7` widens it. Without
`DATABASE_URL` the app still runs — History stays in the browser and clears on
reload, and a warning is logged to the console.

---

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/lookup?cert=79067707` | GET | Card + retrieval order + life-cycle |
| `/api/lookup?ac=3975830` | GET | Same, matched on AC number |
| `/api/shipment?order=18303912` | GET | Other cards on that order (501 when `ORDER_QUESTION_ID` is unset) |
| `/api/history` | GET | Completed work (`?days=N`) |
| `/api/history` | POST | Log one completed item |
| `/api/history?id=123` | DELETE | Undo one entry |
| `/api/health` | GET | Config check — which env vars are set |

Hit `/api/health` first after deploying. It reports which variables are missing
without leaking their values.

---

## Scanner support

Hardware barcode guns and QR readers act as keyboards. Three input shapes are
handled:

1. **Focused field + terminator** — Enter, Tab, or a raw CR/LF submits.
2. **Focused field, no terminator** — five or more keystrokes faster than 35ms
   apart followed by ~130ms of silence auto-submits.
3. **Nothing focused** — a global buffer catches the burst anywhere on the Scan
   tab, routes it to the right field by content, and runs it.

Human typing never auto-fires; it waits for Enter or RUN LOOKUP. There is an
**Auto-submit** toggle to require a manual confirm.

QR payloads are parsed as URLs (`/c/8AC0001234`, `?cert_number=…`), JSON
(`{"ac_number":"…"}`), or plain tokens.

---

## Files

```
index.html          single-page UI, no build step
api/lookup.js       cert / AC -> retrieval order
api/history.js      completed work log (Neon)
api/shipment.js     cards on an order, fetched after the result renders
api/health.js       config check
lib/metabase.js     Metabase client, API key stays server-side
lib/normalize.js    4093 rows -> card + retrieval order, picks the retrieve row
db/schema.sql       history table
db/order-question.sql  optional Metabase question for shipment contents
```

No bundler and no framework — `index.html` is served as a static asset and the
three functions are the only server code.
