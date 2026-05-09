-- Phase 7: Archetype layer
-- 12 Jungian archetypes (Pearson/Mark formalization) mapped to Greek gods.
-- Orthogonal to roles: role = authority (what you can do), archetype = voice/lens (how you sound).
-- Users pick a primary_archetype as their default lens. They can shift mid-conversation via /hermes-style commands or UI switcher.
-- Tenants track which archetype slots are "active" (filled by an actual person/function) for org awareness.

alter table users add column if not exists primary_archetype text default 'ruler'
  check (primary_archetype in (
    'ruler','caregiver','hero','creator','sage','magician',
    'explorer','jester','lover','innocent','everyman','outlaw'
  ));

alter table tenants add column if not exists active_archetypes jsonb
  default '["ruler","caregiver","hero","creator","sage","magician","explorer","jester"]'::jsonb;

comment on column users.primary_archetype is 'User''s default archetype lens (Jungian/Pearson-Mark). One of: ruler, caregiver, hero, creator, sage, magician, explorer, jester, lover, innocent, everyman, outlaw. Greek gods: Zeus, Hestia, Hermes, Hephaestus, Athena, Hecate, Artemis, Apollo, Aphrodite, Persephone, Hercules, Prometheus.';
comment on column tenants.active_archetypes is 'Array of archetype slugs currently filled at this tenant. Informational, does not restrict per-user archetype selection.';
