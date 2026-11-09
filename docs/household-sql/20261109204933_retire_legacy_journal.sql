-- Yessy phase 5: MANUAL ONLY. Do not apply automatically to the live project.
-- Deploy g19 first; review 0003 backfill/archives before running in SQL Editor.
-- Old household journals are not replayed here: that could resurrect stale data.
-- Keeps every user_recipe_state row, but retires client writes. No DROP TABLE.
-- cookChallenge stays local-only in g19; its cloud value is archived, not imported.
-- All changes are transactional and safe to re-run. No auth.users writes.
begin;

-- Block concurrent legacy writes until the archive, prune and grants commit.
lock table public.user_preferences, public.user_recipe_state in access exclusive mode;

create schema if not exists yessy_archive;
revoke all on schema yessy_archive from public, anon, authenticated;
create table if not exists yessy_archive.phase5_legacy (
  source text not null,
  row_key text not null,
  row_data jsonb not null,
  archived_at timestamptz not null default now(),
  primary key (source, row_key)
);
alter table yessy_archive.phase5_legacy enable row level security;
revoke all on yessy_archive.phase5_legacy from public, anon, authenticated;

-- Immutable first snapshot; re-running never overwrites the pre-prune backup.
insert into yessy_archive.phase5_legacy (source, row_key, row_data)
select 'user_preferences', user_id::text, to_jsonb(p)
from public.user_preferences p
on conflict (source, row_key) do nothing;
insert into yessy_archive.phase5_legacy (source, row_key, row_data)
select 'user_recipe_state', user_id::text || '/' || recipe_id, to_jsonb(s)
from public.user_recipe_state s
on conflict (source, row_key) do nothing;

update public.user_preferences
set prefs = prefs - array['cookLog','recipeNotes','recipeLists','notForUs','cookChallenge','journalMigratedAt']::text[]
where prefs ?| array['cookLog','recipeNotes','recipeLists','notForUs','cookChallenge','journalMigratedAt'];

-- A stale client cannot put retired journals back; active prefs are unaffected.
alter table public.user_preferences drop constraint if exists prefs_no_retired_journal;
alter table public.user_preferences add constraint prefs_no_retired_journal
check (not (prefs ?| array['cookLog','recipeNotes','recipeLists','notForUs','cookChallenge','journalMigratedAt']));

-- Preserve existing own-row SELECT/RLS, but remove every client write grant.
alter table public.user_recipe_state enable row level security;
revoke all on public.user_recipe_state from public, anon, authenticated;
-- Also remove any column grants (table-level REVOKE alone doesn't remove these).
do $$
declare col record;
begin
  for col in select attname from pg_attribute
    where attrelid = 'public.user_recipe_state'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke all (%I) on public.user_recipe_state from public, anon, authenticated', col.attname);
  end loop;
end $$;
grant select on public.user_recipe_state to authenticated;

commit;
