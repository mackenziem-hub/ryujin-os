-- migration_103_questscan_dispatch_cat.sql
-- Confirmation-first office dispatch: route the questscan to-do scanner to
-- Catherine (the EA / confirmation hub) and enable it for Plus Ultra.
--
-- questscan already detects the three office-dispatch events (a stale sent
-- proposal, an accepted job not yet scheduled, a completed job not yet invoiced)
-- and drops an assigned, idempotent, self-expiring to-do on the owner's board.
-- This points proposal follow-up + job scheduling/WO at Cat (she works the queue
-- and loops Mac early, per the "check with Cat first" rule), and finance
-- close-outs at Melodie. Nothing auto-executes - these are to-dos only, so this
-- is the safe confirmation-first layer. The crew-dispatch agent (repair -> Diego,
-- etc.) lands in a later phase.
--
-- Idempotent: re-running re-applies the same routing + flag. The cron is added in
-- vercel.json; it stays a no-op until questscan_agent_enabled flips true (here).

update tenant_settings ts
set
  questscan_config = coalesce(ts.questscan_config, '{}'::jsonb) || jsonb_build_object(
    'sales_user_id',     '82c7b9b3-9188-4309-bab9-c86eb9b08e49', -- Catherine: stale-proposal follow-up
    'scheduler_user_id', '82c7b9b3-9188-4309-bab9-c86eb9b08e49', -- Catherine: schedule + work order (confirms with Mac first)
    'finance_user_id',   '62c74c1f-2398-42f2-8766-fe682bbacff0'  -- Melodie: invoice close-out
  ),
  questscan_agent_enabled = true
from tenants t
where ts.tenant_id = t.id
  and t.slug = 'plus-ultra';
