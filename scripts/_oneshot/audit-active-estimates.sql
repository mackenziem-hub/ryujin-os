SELECT
  e.estimate_number,
  c.full_name,
  e.selected_package,
  e.created_at::date AS created_date,
  -- Selected tier under new rules
  (e.calculated_packages->COALESCE(e.selected_package,'platinum')->'summary'->>'sellingPrice')::numeric AS sel_sell,
  (e.calculated_packages->COALESCE(e.selected_package,'platinum')->'summary'->>'macNetPerWorkday')::numeric AS sel_mnpw,
  (e.calculated_packages->COALESCE(e.selected_package,'platinum')->'summary'->>'floorCleared')::boolean AS sel_cleared,
  (e.calculated_packages->COALESCE(e.selected_package,'platinum')->'summary'->>'recommendedMinSell')::numeric AS sel_recom,
  -- Diamond fallback (top-tier auto-clears for most)
  (e.calculated_packages->'diamond'->'summary'->>'sellingPrice')::numeric AS dia_sell,
  (e.calculated_packages->'diamond'->'summary'->>'macNetPerWorkday')::numeric AS dia_mnpw,
  (e.calculated_packages->'diamond'->'summary'->>'floorCleared')::boolean AS dia_cleared
FROM estimates e
LEFT JOIN customers c ON c.id = e.customer_id
WHERE e.tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND e.status NOT IN ('cancelled', 'lost', 'rejected')
  AND e.accepted_at IS NULL
  AND e.created_at > '2026-01-01'
ORDER BY e.created_at DESC;
