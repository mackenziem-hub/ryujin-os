# Data-hygiene PR 2 close-out (desk D, computer2) - 2026-06-11

Re-verified live against prod (Management API SELECTs + deployed GET APIs) from
computer2, where the SUPABASE_PAT works. The original three-fix premise does not
hold up: two of three have no mechanical target, one is a single row. Live counts
below supersede the earlier verify-only findings from the computer1 checkout.

Live snapshot: 76 estimates, 17 work orders (10 of them with NULL subcontractor_id,
5 of those cancelled), tenant 84c91cb9-df07-4424-8938-075e9c50cb3b.

## Fix 1 - PU-77 estimate-number collision: NOT BUILT (no live target)

Already resolved. There are ZERO duplicate estimate_numbers (migration 095 put a
UNIQUE constraint on estimate_number, applied to prod, so duplicates are now
structurally impossible). Estimate #77 is exactly one row: Catherine Ablak (id
4f6c5130, draft). Richard Seyeau - the other half of the memory's collision - is
now estimate #84 (accepted, id 16df57d2), i.e. he was already renumbered off 77.
(Mike Seyeau, a different person, holds the cancelled #5/#6.) Nothing to renumber.

## Fix 2 - sales_owner backfill: NOT BUILT (needs Mac's decision, not mechanical)

69 of 76 estimates have NULL sales_owner. The column is a USER UUID, not a name
string, so there is no free-text typo to normalize (the earlier "one mac typo"
claim does not exist at this column). Assigning owners is a decision only Mac can
make - who owned each of the 69 estimates. The two non-null owners present are
UUIDs 2854d397... (x4) and e5eac641... (x3).

To turn this into a one mechanical backfill, Mac needs to give ONE of:
  - a per-estimate owner mapping, or
  - a blanket default rule (e.g. "every NULL sales_owner -> <Mac's user UUID>").
With either, desk D builds the deployed-API PATCH one-shot in minutes. Until
then there is nothing safe to run.

## Fix 3 - WO subcontractor_id backfill: BUILT (1 row)

Real but tiny. The link is workorders.linked_paysheet_id -> paysheets, and the
paysheet carries subcontractor_id (confirmed in api/paysheets.js + api/workorders.js).
Of the 5 non-cancelled WOs with NULL subcontractor_id:

  WO-17 (Jonald Magarin, complete)  - linked paysheet, but the paysheet sub is
                                       ALSO null. No source. Skipped.
  WO-20 (Adedoyinsola Egbuwoku, complete) - linked paysheet 58edd6e1 carries sub
                                       Mackenzie Mazerolle (e8fa5df0). BACKFILLABLE.
  WO-24 (Mark Lewis, issued)        - no linked paysheet. Active job, sub not yet
  WO-25 (Michael Pineau, issued)      entered. Data-entry gap, not mechanical -
  WO-26 (Kierstad, issued)            do NOT invent a sub for these.

So the mechanical fix is one row: WO-20. The script
`backfill_wo_subcontractor_from_paysheet_2026-06-11.mjs` implements the GENERAL
rule (copy linked-paysheet sub onto any non-cancelled WO whose own sub is null),
so it also catches future rows, but today it touches WO-20 only. Runs through the
deployed API (GET/PUT), dry-run by default.

## Execution runbook (Terminal A only)

```
cd C:\Users\macke\projects\ryujin-os   # or wherever the deployed code is checked out
node scripts/_oneshot/backfill_wo_subcontractor_from_paysheet_2026-06-11.mjs           # dry-run, prints WO-20
node scripts/_oneshot/backfill_wo_subcontractor_from_paysheet_2026-06-11.mjs --apply    # writes WO-20.subcontractor_id
```

No deploy needed - this is a data backfill against the live API, not a code change.

## Net

Of the three fixes the PR 2 order asked for, only the WO subcontractor backfill
was buildable, and it is a single row. The PU-77 renumber has no live target
(already resolved). The sales_owner gap is real (69 rows) but is a Mac decision,
not a mechanical one-shot. Flagging both back up for the foreman.
