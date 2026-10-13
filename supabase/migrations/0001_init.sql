-- Yessy: per-user data (recipe status/rating + preferences).
-- Paste into Supabase → SQL Editor and run once. Safe to re-run.
-- Project has "auto-expose new tables" OFF, so grants are explicit and
-- only for the `authenticated` role (never `anon`). RLS limits rows to auth.uid().

begin;

-- ---------------------------------------------------------------------------
-- Per-user recipe state (Goodreads-style)
--   status: 'want' = Vill laga, 'cooking' = Lagar nu, 'cooked' = Lagad, null = none
--   rating: personal 1–5 stars, null = none
--   A row with both null is a deliberate "cleared" record (newer-wins sync).
-- ---------------------------------------------------------------------------
create table if not exists public.user_recipe_state (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id  text        not null check (char_length(recipe_id) between 1 and 200),
  status     text        null check (status in ('want', 'cooking', 'cooked')),
  rating     smallint    null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

comment on table public.user_recipe_state is 'Yessy: per-user recipe status (want=Vill laga, cooking=Lagar nu, cooked=Lagad) and 1-5 rating.';

-- ---------------------------------------------------------------------------
-- Per-user preferences, one row per user.
--   prefs jsonb: { "<key>": { "value": <any>, "updatedAt": <epoch ms> }, ... }
--   keys today: theme ('light'|'dark'), spiceMixMissing (mix ids with
--   "Har inte mixen"), shopping ({ selections: [...], portions: {...} })
--   Per-key updatedAt lets the client merge key by key (newer wins).
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs      jsonb       not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at timestamptz not null default now()
);

comment on table public.user_preferences is 'Yessy: per-user preferences as jsonb with per-key updatedAt.';

-- ---------------------------------------------------------------------------
-- Row level security: own rows only
-- ---------------------------------------------------------------------------
alter table public.user_recipe_state enable row level security;
alter table public.user_preferences  enable row level security;

drop policy if exists "recipe_state_select_own" on public.user_recipe_state;
drop policy if exists "recipe_state_insert_own" on public.user_recipe_state;
drop policy if exists "recipe_state_update_own" on public.user_recipe_state;
drop policy if exists "recipe_state_delete_own" on public.user_recipe_state;

create policy "recipe_state_select_own" on public.user_recipe_state
  for select to authenticated using (user_id = (select auth.uid()));
create policy "recipe_state_insert_own" on public.user_recipe_state
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "recipe_state_update_own" on public.user_recipe_state
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "recipe_state_delete_own" on public.user_recipe_state
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "preferences_select_own" on public.user_preferences;
drop policy if exists "preferences_insert_own" on public.user_preferences;
drop policy if exists "preferences_update_own" on public.user_preferences;
drop policy if exists "preferences_delete_own" on public.user_preferences;

create policy "preferences_select_own" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "preferences_insert_own" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "preferences_update_own" on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "preferences_delete_own" on public.user_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants: authenticated only (anon gets nothing)
-- ---------------------------------------------------------------------------
revoke all on public.user_recipe_state from anon;
revoke all on public.user_preferences  from anon;
grant select, insert, update, delete on public.user_recipe_state to authenticated;
grant select, insert, update, delete on public.user_preferences  to authenticated;

commit;
