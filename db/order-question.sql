-- =====================================================================
-- CS Search — "Order Contents" question
--
-- Save this in Metabase as a new SQL question against Snowflake, add ONE
-- variable named  order_number  of type **Number**, then put that question's
-- id in the Vercel env var ORDER_QUESTION_ID.
--
-- It answers "what else was in this box?" — question 4093 filters by card and
-- cannot. The column names match 4093 so the app parses both identically.
-- =====================================================================

SELECT
  c.number                                        AS ac_number,
  cc.cert_number,
  c.player_name,
  c.set_name,
  c."INSERT"                                      AS "INSERT",
  c.parallel_name,
  c.parallel_total,
  c.sport,
  (c.grading_company || ' ' || c.overall)         AS grade,
  c.front_slab_picture_url,
  c.status                                        AS card_status,
  o.number::text                                  AS order_number,
  'https://admin.arenaclub.com/orders/' || o.id   AS order_url
FROM (SELECT * FROM APP_PROD.PUBLIC.ORDERS
      WHERE NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)) o
JOIN (SELECT * FROM APP_PROD.PUBLIC.ORDER_ITEMS
      WHERE NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)) oi ON oi.order_id = o.id
JOIN (SELECT * FROM APP_PROD.ADMIN.CARDS
      WHERE NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)) c  ON c.id = oi.card_id
LEFT JOIN (SELECT * FROM APP_PROD.ADMIN.CARD_CERT_NUMBER
      WHERE NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)) cc ON cc.card_id = c.id
WHERE o.number::text = {{order_number}}::text
ORDER BY c.number
LIMIT 500;
