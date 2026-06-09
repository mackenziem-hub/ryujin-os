-- Fix duplicate estimate_number values (2026-06-09)
-- Root cause: imported rows (May 11 + May 30 backfills) carried explicit numbers
-- without advancing the serial sequence; organic inserts then re-issued 62, 77-81.
-- Rule: organic sequence-assigned rows KEEP their numbers; imported rows renumber to 83-88.
-- Guards (`and estimate_number = N`) make this idempotent.
begin;
update estimates set estimate_number = 83 where id = '9f48a3dc-db83-48df-82e4-d4c783769e15' and estimate_number = 62; -- Shelley Hope      62 -> 83
update estimates set estimate_number = 84 where id = '16df57d2-f0df-43f7-8360-ff0f56ced239' and estimate_number = 77; -- Richard Seyeau    77 -> 84
update estimates set estimate_number = 85 where id = '5af8c8f4-3638-4736-8447-315f032b980f' and estimate_number = 78; -- Bukola Sikirra    78 -> 85
update estimates set estimate_number = 86 where id = '704dc4dd-8746-43b2-9eb1-a5aa7f092afa' and estimate_number = 79; -- Brian Northrup    79 -> 86
update estimates set estimate_number = 87 where id = 'b4ef585a-02b8-46e2-b65b-b125f0656309' and estimate_number = 80; -- Gary+Karen Pardy  80 -> 87
update estimates set estimate_number = 88 where id = '6885d1fc-56d5-46c8-97c7-894563ce982a' and estimate_number = 81; -- Korey Fram        81 -> 88
-- Advance the sequence past the new max so future inserts can't collide
select setval(pg_get_serial_sequence('estimates','estimate_number'), (select max(estimate_number) from estimates));
-- Enforce uniqueness per tenant so this class of bug can never recur silently
alter table estimates add constraint estimates_tenant_estimate_number_unique unique (tenant_id, estimate_number);
commit;
select estimate_number, count(*) from estimates group by estimate_number having count(*) > 1;
