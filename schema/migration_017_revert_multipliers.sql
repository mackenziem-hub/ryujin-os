-- Audit trail: revert plus-ultra residential multipliers from the
-- evening session (1.89 / 2.08 / 2.38) back to v1 SOP (1.47 / 1.52 / 1.58).
-- Applied programmatically via scripts/revert-multipliers-to-v1.mjs on Apr 24.
-- Reason: evening multipliers overshot the Moncton/Riverview market. 42 Patricia
-- Gold quoted at $33,100 vs comparable Cornhill Gold accepted at $19,336 for a
-- similar-complexity 34 SQ roof. Mac confirmed v1 SOP is the correct model.

update offers set multipliers = jsonb_set(coalesce(multipliers,'{}')::jsonb, '{local}', '1.47', true)
  where tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b' and slug = 'gold';
update offers set multipliers = jsonb_set(coalesce(multipliers,'{}')::jsonb, '{local}', '1.52', true)
  where tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b' and slug = 'platinum';
update offers set multipliers = jsonb_set(coalesce(multipliers,'{}')::jsonb, '{local}', '1.58', true)
  where tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b' and slug = 'diamond';
