-- Plus Ultra paysheet + workorder hygiene -- 2026-05-24
--
-- Symptom Mac caught Sun morning: Production / Active Jobs shows 4 jobs that
-- are actually done. Shelagh Peach (Apr 27 win, invoice-ready since Apr 27),
-- Kyle Graham (Apr 29 win, invoice-ready), Donna Boosamra (WO completed
-- 2026-05-09), Gary & Karen Pardy (WO completed 2026-05-11). The 4 paysheets
-- never got flipped out of scheduled/in_progress.
--
-- Donna + Pardy: WO already shows status='complete' but the auto-sync from
-- api/workorders.js line 131 only fires on UPDATE through the API, not on
-- direct DB edits. So their paysheets stayed scheduled.
-- Shelagh: WO still 'issued', paysheet stuck on 'in_progress'.
-- Kyle: WO still 'draft', paysheet stuck on 'scheduled' (window-pane dispute
-- left a tail on the GHL Operations / Invoice Ready stage but the install
-- itself was finished).
--
-- Apply via Supabase Dashboard SQL Editor against the production DB.

BEGIN;

UPDATE paysheets
SET status = 'completed',
    updated_at = now()
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND id IN (
    '3c6b2a5f-ed06-4f95-ae16-96af79a4b14d',  -- Kyle Graham
    'cdec1af1-a5bf-48c3-8b41-8a4bedc001b2',  -- Shelagh Peach
    '3fbf1dbf-493a-4e53-a85d-02fd029554b4',  -- Donna Boosamra
    '18ac64bd-a634-4473-bd76-e6b20bffad2f'   -- Gary & Karen Pardy
  );

UPDATE workorders
SET status = 'completed',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND id IN (
    '85635474-5352-47d0-9304-ab05ac3c1bb3',  -- Shelagh Peach (was 'issued')
    'd705a263-5786-47ba-a7ed-21c0ca4d95d0'   -- Kyle Graham (was 'draft')
  );

-- Verify before COMMIT. Expect: paysheets returned = 4, workorders returned = 2.
SELECT 'paysheets' AS table_name, COUNT(*) AS rows_affected
FROM paysheets
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND status = 'completed'
  AND id IN (
    '3c6b2a5f-ed06-4f95-ae16-96af79a4b14d',
    'cdec1af1-a5bf-48c3-8b41-8a4bedc001b2',
    '3fbf1dbf-493a-4e53-a85d-02fd029554b4',
    '18ac64bd-a634-4473-bd76-e6b20bffad2f'
  )
UNION ALL
SELECT 'workorders', COUNT(*)
FROM workorders
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND status = 'completed'
  AND id IN (
    '85635474-5352-47d0-9304-ab05ac3c1bb3',
    'd705a263-5786-47ba-a7ed-21c0ca4d95d0'
  );

COMMIT;
