-- Yessy 0002: shared household + friends.
-- Paste into Supabase -> SQL Editor and run once (after 0001_init.sql). Safe to re-run.
-- Applied to tihxtjesijxwsgsifzac on 2026-10-21 via MCP apply_migration as `household_friends`
-- (begin/commit stripped; the migration tool wraps it in its own transaction).
-- Tables are for the `authenticated` role only (never `anon`); RLS everywhere.
-- Writes that need cross-user checks (join/leave/invite/friend) go through
-- SECURITY DEFINER functions; plain tables only allow what RLS proves is yours.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Human-friendly random code (no 0/O/1/I/L), e.g. 'K7QM2XRA'.
create or replace function public.gen_code(len int default 8)
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := extensions.gen_random_bytes(len);
  out text := '';
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return out;
end $$;

-- 'k7qm-2xra ' -> 'K7QM2XRA'
create or replace function public.norm_code(p text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Generic "newer wins" guard for upserts: a stale UPDATE is silently skipped.
create or replace function public.keep_newer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (display name for households/friends; never expose auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id            uuid        primary key references auth.users (id) on delete cascade,
  display_name       text        not null default '' check (char_length(display_name) <= 40),
  avatar_emoji       text        null check (char_length(avatar_emoji) <= 8),
  friend_code        text        not null unique default public.gen_code(8),
  share_with_friends boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Households (every signed-in user is in exactly one; alone = personal kitchen)
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null default 'Mitt kök' check (char_length(name) between 1 and 60),
  is_personal boolean     not null default true,
  created_by  uuid        null references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  role         text        not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create unique index if not exists household_members_one_per_user on public.household_members (user_id);

create table if not exists public.household_invites (
  code         text        primary key default public.gen_code(8),
  household_id uuid        not null references public.households (id) on delete cascade,
  created_by   uuid        null references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  max_uses     int         not null default 5 check (max_uses between 1 and 20),
  uses         int         not null default 0,
  revoked      boolean     not null default false
);
create index if not exists household_invites_household on public.household_invites (household_id);

-- Membership helpers (SECURITY DEFINER so policies never recurse into household_members RLS)
create or replace function public.my_household_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1
$$;

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid())
$$;

create or replace function public.shares_household(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on b.household_id = a.household_id
    where a.user_id = auth.uid() and b.user_id = other)
$$;

-- ---------------------------------------------------------------------------
-- Shared per-household data
-- ---------------------------------------------------------------------------
-- Vill laga / Lagad + Inte för oss, one row per household and recipe.
-- Each field has its own timestamp so concurrent edits of different fields both survive.
create table if not exists public.household_recipe_state (
  household_id uuid        not null references public.households (id) on delete cascade,
  recipe_id    text        not null check (char_length(recipe_id) between 1 and 200),
  status       text        null check (status in ('want', 'cooked')),
  status_at    timestamptz not null default 'epoch',
  not_for_us   boolean     not null default false,
  nfu_at       timestamptz not null default 'epoch',
  updated_by   uuid        null default auth.uid() references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create or replace function public.merge_recipe_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status_at < old.status_at then new.status := old.status; new.status_at := old.status_at; end if;
  if new.nfu_at < old.nfu_at then new.not_for_us := old.not_for_us; new.nfu_at := old.nfu_at; end if;
  new.updated_at := greatest(new.status_at, new.nfu_at, old.updated_at);
  return new;
end $$;
drop trigger if exists household_recipe_state_merge on public.household_recipe_state;
create trigger household_recipe_state_merge before update on public.household_recipe_state
  for each row execute function public.merge_recipe_state();

-- Cook log ("Datum lagad"): ids come from the client ('ck_...'), stable across devices.
create table if not exists public.cook_log (
  id           text        primary key check (char_length(id) between 3 and 80),
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        null default auth.uid() references auth.users (id) on delete set null,
  recipe_id    text        not null check (char_length(recipe_id) between 1 and 200),
  cooked_on    date        not null,
  cooks        smallint    null check (cooks in (1, 2)),
  deleted      boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cook_log_household_recent on public.cook_log (household_id, created_at desc) where not deleted;
create index if not exists cook_log_household_recipe on public.cook_log (household_id, recipe_id);
create index if not exists cook_log_user_recent on public.cook_log (user_id, created_at desc) where not deleted;
drop trigger if exists cook_log_keep_newer on public.cook_log;
create trigger cook_log_keep_newer before update on public.cook_log
  for each row execute function public.keep_newer();

-- Own lists ("Egna listor"): shared with the household unless visibility = 'private'.
create table if not exists public.recipe_lists (
  id           text        primary key check (char_length(id) between 3 and 80),
  household_id uuid        not null references public.households (id) on delete cascade,
  owner_id     uuid        null default auth.uid() references auth.users (id) on delete set null,
  name         text        not null check (char_length(name) between 1 and 40),
  visibility   text        not null default 'household' check (visibility in ('household', 'private')),
  deleted      boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists recipe_lists_household on public.recipe_lists (household_id);
drop trigger if exists recipe_lists_keep_newer on public.recipe_lists;
create trigger recipe_lists_keep_newer before update on public.recipe_lists
  for each row execute function public.keep_newer();

create table if not exists public.recipe_list_items (
  list_id    text        not null references public.recipe_lists (id) on delete cascade,
  recipe_id  text        not null check (char_length(recipe_id) between 1 and 200),
  in_list    boolean     not null default true,   -- false = removed (tombstone for merging)
  added_by   uuid        null default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (list_id, recipe_id)
);
drop trigger if exists recipe_list_items_keep_newer on public.recipe_list_items;
create trigger recipe_list_items_keep_newer before update on public.recipe_list_items
  for each row execute function public.keep_newer();

-- ---------------------------------------------------------------------------
-- Per-person data
-- ---------------------------------------------------------------------------
-- Own stars + a review the household can read.
create table if not exists public.recipe_ratings (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id  text        not null check (char_length(recipe_id) between 1 and 200),
  rating     smallint    null check (rating between 1 and 5),
  rating_at  timestamptz not null default 'epoch',
  review     text        not null default '' check (char_length(review) <= 4000),
  review_at  timestamptz not null default 'epoch',
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
create or replace function public.merge_rating()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rating_at < old.rating_at then new.rating := old.rating; new.rating_at := old.rating_at; end if;
  if new.review_at < old.review_at then new.review := old.review; new.review_at := old.review_at; end if;
  new.updated_at := greatest(new.rating_at, new.review_at, old.updated_at);
  return new;
end $$;
drop trigger if exists recipe_ratings_merge on public.recipe_ratings;
create trigger recipe_ratings_merge before update on public.recipe_ratings
  for each row execute function public.merge_rating();

-- "Mina anteckningar": private, owner only.
create table if not exists public.recipe_notes (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id  text        not null check (char_length(recipe_id) between 1 and 200),
  text       text        not null default '' check (char_length(text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
drop trigger if exists recipe_notes_keep_newer on public.recipe_notes;
create trigger recipe_notes_keep_newer before update on public.recipe_notes
  for each row execute function public.keep_newer();

-- ---------------------------------------------------------------------------
-- Friends (symmetric pair, user_a < user_b)
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  user_a       uuid        not null references auth.users (id) on delete cascade,
  user_b       uuid        not null references auth.users (id) on delete cascade,
  requested_by uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz null,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists friendships_user_b on public.friendships (user_b);

create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other))
$$;

create or replace function public.has_friend_link(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other))
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.households             enable row level security;
alter table public.household_members      enable row level security;
alter table public.household_invites      enable row level security;
alter table public.household_recipe_state enable row level security;
alter table public.cook_log               enable row level security;
alter table public.recipe_lists           enable row level security;
alter table public.recipe_list_items      enable row level security;
alter table public.recipe_ratings         enable row level security;
alter table public.recipe_notes           enable row level security;
alter table public.friendships            enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in (
    'profiles','households','household_members','household_invites','household_recipe_state','cook_log',
    'recipe_lists','recipe_list_items','recipe_ratings','recipe_notes','friendships')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: see yourself, your household and anyone you have a friend link with; edit only yourself
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_household(user_id) or public.has_friend_link(user_id));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- households: members read and rename
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

-- members: read your household (join/leave/remove go through functions)
create policy household_members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

-- invites: members list and revoke (create via create_household_invite())
create policy household_invites_select on public.household_invites for select to authenticated
  using (public.is_household_member(household_id));
create policy household_invites_update on public.household_invites for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- shared recipe state, cook log, lists: any member of the row's household
create policy hrs_select on public.household_recipe_state for select to authenticated
  using (public.is_household_member(household_id));
create policy hrs_insert on public.household_recipe_state for insert to authenticated
  with check (public.is_household_member(household_id));
create policy hrs_update on public.household_recipe_state for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy cook_log_select on public.cook_log for select to authenticated
  using (public.is_household_member(household_id));
create policy cook_log_insert on public.cook_log for insert to authenticated
  with check (public.is_household_member(household_id) and user_id = (select auth.uid()));
create policy cook_log_update on public.cook_log for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy recipe_lists_select on public.recipe_lists for select to authenticated
  using (public.is_household_member(household_id) and (visibility = 'household' or owner_id = (select auth.uid())));
create policy recipe_lists_insert on public.recipe_lists for insert to authenticated
  with check (public.is_household_member(household_id) and owner_id = (select auth.uid()));
create policy recipe_lists_update on public.recipe_lists for update to authenticated
  using (public.is_household_member(household_id) and (visibility = 'household' or owner_id = (select auth.uid())))
  with check (public.is_household_member(household_id));

-- list items follow their (visible) list
create policy recipe_list_items_select on public.recipe_list_items for select to authenticated
  using (exists (select 1 from public.recipe_lists l where l.id = list_id));
create policy recipe_list_items_insert on public.recipe_list_items for insert to authenticated
  with check (exists (select 1 from public.recipe_lists l where l.id = list_id));
create policy recipe_list_items_update on public.recipe_list_items for update to authenticated
  using (exists (select 1 from public.recipe_lists l where l.id = list_id))
  with check (exists (select 1 from public.recipe_lists l where l.id = list_id));

-- ratings + reviews: you write yours; your household reads them
create policy recipe_ratings_select on public.recipe_ratings for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_household(user_id));
create policy recipe_ratings_insert on public.recipe_ratings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy recipe_ratings_update on public.recipe_ratings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- private notes: owner only
create policy recipe_notes_all on public.recipe_notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- friendships: both sides read; either side can end it (requests/accepts via functions)
create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy friendships_delete on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- ---------------------------------------------------------------------------
-- Functions (RPC)
-- ---------------------------------------------------------------------------
-- Called by the client after every sign-in: profile + personal household if missing.
create or replace function public.ensure_my_household()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_h uuid;
  v_new uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
  select household_id into v_h from public.household_members where user_id = v_uid;
  if v_h is not null then return v_h; end if;
  insert into public.households (name, is_personal, created_by) values ('Mitt kök', true, v_uid) returning id into v_new;
  insert into public.household_members (household_id, user_id, role) values (v_new, v_uid, 'owner')
    on conflict (user_id) do nothing;
  select household_id into v_h from public.household_members where user_id = v_uid;
  if v_h <> v_new then delete from public.households where id = v_new; end if; -- lost a race with another tab
  return v_h;
end $$;

create or replace function public.create_household_invite(p_max_uses int default 5, p_days int default 7)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_h uuid := public.ensure_my_household();
  v_code text;
begin
  if (select count(*) from public.household_invites
      where household_id = v_h and not revoked and expires_at > now() and uses < max_uses) >= 5 then
    raise exception 'too_many_invites';
  end if;
  insert into public.household_invites (household_id, created_by, max_uses, expires_at)
  values (v_h, auth.uid(), greatest(1, least(coalesce(p_max_uses, 5), 20)),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))))
  returning code into v_code;
  return v_code;
end $$;

-- What the join screen shows before you accept. Requires sign-in.
create or replace function public.preview_household_invite(p_code text)
returns table (household_name text, member_names text[], expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select h.name,
         array(select coalesce(nullif(p.display_name, ''), 'Någon')
               from public.household_members m left join public.profiles p on p.user_id = m.user_id
               where m.household_id = h.id order by m.joined_at),
         i.expires_at
  from public.household_invites i
  join public.households h on h.id = i.household_id
  where auth.uid() is not null
    and i.code = public.norm_code(p_code)
    and not i.revoked and i.expires_at > now() and i.uses < i.max_uses
$$;

-- Move everything from a one-person household into another (newer field wins on clashes).
create or replace function public._merge_household(src uuid, dst uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.household_recipe_state as t
    (household_id, recipe_id, status, status_at, not_for_us, nfu_at, updated_by, updated_at)
  select dst, recipe_id, status, status_at, not_for_us, nfu_at, updated_by, updated_at
  from public.household_recipe_state where household_id = src
  on conflict (household_id, recipe_id) do update set
    status = excluded.status, status_at = excluded.status_at,
    not_for_us = excluded.not_for_us, nfu_at = excluded.nfu_at, updated_by = excluded.updated_by;

  update public.cook_log set household_id = dst where household_id = src;

  -- Lists with the same name are merged into the existing one
  insert into public.recipe_list_items (list_id, recipe_id, in_list, added_by, updated_at)
  select d.id, i.recipe_id, i.in_list, i.added_by, i.updated_at
  from public.recipe_lists s
  join public.recipe_lists d on d.household_id = dst and not d.deleted and lower(d.name) = lower(s.name)
  join public.recipe_list_items i on i.list_id = s.id
  where s.household_id = src and not s.deleted
  on conflict (list_id, recipe_id) do nothing;
  update public.recipe_lists s set deleted = true, updated_at = now()
  where s.household_id = src and not s.deleted
    and exists (select 1 from public.recipe_lists d where d.household_id = dst and not d.deleted and lower(d.name) = lower(s.name));
  update public.recipe_lists set household_id = dst where household_id = src;
end $$;

create or replace function public.accept_household_invite(p_code text, p_merge boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.household_invites%rowtype;
  v_old uuid;
  v_old_n int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.household_invites where code = public.norm_code(p_code) for update;
  if not found or v_inv.revoked or v_inv.expires_at <= now() or v_inv.uses >= v_inv.max_uses then
    raise exception 'invite_invalid';
  end if;
  insert into public.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
  select household_id into v_old from public.household_members where user_id = v_uid;
  if v_old = v_inv.household_id then return v_old; end if;
  if (select count(*) from public.household_members where household_id = v_inv.household_id) >= 8 then
    raise exception 'household_full';
  end if;
  if v_old is not null then
    select count(*) into v_old_n from public.household_members where household_id = v_old;
    if p_merge and v_old_n = 1 then perform public._merge_household(v_old, v_inv.household_id); end if;
    delete from public.household_members where household_id = v_old and user_id = v_uid;
    if v_old_n = 1 then
      delete from public.households where id = v_old;
    elsif not exists (select 1 from public.household_members where household_id = v_old and role = 'owner') then
      update public.household_members set role = 'owner'
      where household_id = v_old
        and user_id = (select user_id from public.household_members where household_id = v_old order by joined_at limit 1);
    end if;
  end if;
  insert into public.household_members (household_id, user_id, role) values (v_inv.household_id, v_uid, 'member');
  update public.households set is_personal = false where id = v_inv.household_id;
  update public.household_invites set uses = uses + 1 where code = v_inv.code;
  return v_inv.household_id;
end $$;

-- Leave: the shared data stays with the household; you get a fresh personal kitchen
-- (optionally with a copy of the cook-log entries you logged yourself).
create or replace function public.leave_household(p_copy_my_log boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_new uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select household_id into v_old from public.household_members where user_id = v_uid;
  if v_old is null then return public.ensure_my_household(); end if;
  if (select count(*) from public.household_members where household_id = v_old) = 1 then return v_old; end if;
  delete from public.household_members where household_id = v_old and user_id = v_uid;
  if not exists (select 1 from public.household_members where household_id = v_old and role = 'owner') then
    update public.household_members set role = 'owner'
    where household_id = v_old
      and user_id = (select user_id from public.household_members where household_id = v_old order by joined_at limit 1);
  end if;
  insert into public.households (name, is_personal, created_by) values ('Mitt kök', true, v_uid) returning id into v_new;
  insert into public.household_members (household_id, user_id, role) values (v_new, v_uid, 'owner');
  if p_copy_my_log then
    insert into public.cook_log (id, household_id, user_id, recipe_id, cooked_on, cooks, created_at, updated_at)
    select left(id, 70) || '~' || left(replace(v_new::text, '-', ''), 8), v_new, user_id, recipe_id, cooked_on, cooks, created_at, now()
    from public.cook_log where household_id = v_old and user_id = v_uid and not deleted
    on conflict (id) do nothing;
  end if;
  return v_new;
end $$;

-- Owner removes someone (they get a fresh personal kitchen next time they sign in).
create or replace function public.remove_household_member(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_h uuid := public.my_household_id();
begin
  if not exists (select 1 from public.household_members where household_id = v_h and user_id = auth.uid() and role = 'owner') then
    raise exception 'not_owner';
  end if;
  if p_user = auth.uid() then raise exception 'use_leave_household'; end if;
  delete from public.household_members where household_id = v_h and user_id = p_user;
end $$;

-- Friends: add by friend code. If they already asked you, this accepts.
create or replace function public.request_friend(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  v_row public.friendships%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select user_id into v_other from public.profiles where friend_code = public.norm_code(p_code);
  if v_other is null or v_other = v_uid then raise exception 'friend_code_invalid'; end if;
  select * into v_row from public.friendships
  where user_a = least(v_uid, v_other) and user_b = greatest(v_uid, v_other) for update;
  if not found then
    insert into public.friendships (user_a, user_b, requested_by) values (least(v_uid, v_other), greatest(v_uid, v_other), v_uid);
    return 'pending';
  elsif v_row.status = 'pending' and v_row.requested_by <> v_uid then
    update public.friendships set status = 'accepted', responded_at = now()
    where user_a = v_row.user_a and user_b = v_row.user_b;
    return 'accepted';
  end if;
  return v_row.status;
end $$;

create or replace function public.respond_friend(p_other uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
    where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other)
      and status = 'pending' and requested_by = p_other;
    return case when found then 'accepted' else 'none' end;
  end if;
  delete from public.friendships
  where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other) and status = 'pending';
  return 'declined';
end $$;

-- "Senast i köket": household cook log + what accepted friends logged (if they share).
create or replace function public.kitchen_feed(p_limit int default 30, p_before timestamptz default null)
returns table (entry_id text, recipe_id text, cooked_on date, logged_at timestamptz, user_id uuid,
               display_name text, avatar_emoji text, rating smallint, source text)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid, public.my_household_id() as hid),
  friends as (
    select case when f.user_a = me.uid then f.user_b else f.user_a end as fid
    from public.friendships f, me
    where f.status = 'accepted' and me.uid in (f.user_a, f.user_b)
  )
  select c.id, c.recipe_id, c.cooked_on, c.created_at, c.user_id,
         coalesce(nullif(p.display_name, ''), 'Någon'), p.avatar_emoji, r.rating,
         case when c.household_id = me.hid then 'household' else 'friend' end
  from public.cook_log c
  cross join me
  left join public.profiles p on p.user_id = c.user_id
  left join public.recipe_ratings r on r.user_id = c.user_id and r.recipe_id = c.recipe_id
  where me.uid is not null
    and not c.deleted
    and (p_before is null or c.created_at < p_before)
    and (c.household_id = me.hid
         or (c.user_id in (select fid from friends) and coalesce(p.share_with_friends, true)))
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only; internal helpers not callable from the API
-- ---------------------------------------------------------------------------
-- Revoke from authenticated too: this project's default ACL gives new public tables
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN to anon + authenticated (TRUNCATE ignores RLS).
revoke all on public.profiles, public.households, public.household_members, public.household_invites,
  public.household_recipe_state, public.cook_log, public.recipe_lists, public.recipe_list_items,
  public.recipe_ratings, public.recipe_notes, public.friendships from anon, authenticated;
-- Column-scoped updates: friend_code, is_personal/created_by and invite uses/limits stay server-side.
grant select on public.profiles, public.households, public.household_invites to authenticated;
grant update (display_name, avatar_emoji, share_with_friends, updated_at) on public.profiles to authenticated;
grant update (name) on public.households to authenticated;
grant update (revoked) on public.household_invites to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update on public.household_recipe_state, public.cook_log, public.recipe_lists,
  public.recipe_list_items, public.recipe_ratings to authenticated;
grant select, insert, update, delete on public.recipe_notes to authenticated;
grant select, delete on public.friendships to authenticated;

revoke execute on function public.gen_code(int), public.norm_code(text), public.keep_newer(),
  public.merge_recipe_state(), public.merge_rating(), public._merge_household(uuid, uuid),
  public.my_household_id(), public.is_household_member(uuid), public.shares_household(uuid),
  public.is_friend(uuid), public.has_friend_link(uuid),
  public.ensure_my_household(), public.create_household_invite(int, int), public.preview_household_invite(text),
  public.accept_household_invite(text, boolean), public.leave_household(boolean), public.remove_household_member(uuid),
  public.request_friend(text), public.respond_friend(uuid, boolean), public.kitchen_feed(int, timestamptz)
  from public, anon;
-- RLS policies call these as the signed-in user
grant execute on function public.my_household_id(), public.is_household_member(uuid), public.shares_household(uuid),
  public.is_friend(uuid), public.has_friend_link(uuid) to authenticated;
grant execute on function public.ensure_my_household(), public.create_household_invite(int, int),
  public.preview_household_invite(text), public.accept_household_invite(text, boolean), public.leave_household(boolean),
  public.remove_household_member(uuid), public.request_friend(text), public.respond_friend(uuid, boolean),
  public.kitchen_feed(int, timestamptz) to authenticated;

commit;
