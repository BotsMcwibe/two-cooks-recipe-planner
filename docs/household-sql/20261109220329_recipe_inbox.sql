-- Yessy recipe inbox: paste any https recipe link → review later.
-- MANUAL ONLY. Do not apply automatically to the live project; yesber runs SQL himself.
-- Safe to re-run. No auth.users writes. No DROP of unrelated tables.
-- Numbering: timestamped like 20261109204933_retire_legacy_journal.sql (0001–0005
-- and that retire file are taken). Suggested MCP apply_migration name: `recipe_inbox`.
-- Also keep a copy under docs/household-sql/ next to the plan; copy into
-- supabase/migrations/ when applying (same dual-path pattern as phase 5).

begin;

-- ---------------------------------------------------------------------------
-- Admins (yesber-managed; no client writes)
-- ---------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note       text null check (char_length(note) <= 200)
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from public, anon, authenticated;
-- Members can see whether *they* are admin (for UI); list of all admins stays opaque.
drop policy if exists app_admins_self_select on public.app_admins;
create policy app_admins_self_select on public.app_admins
  for select to authenticated using (user_id = auth.uid());
grant select on public.app_admins to authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- URL normalisation + structural validation (no DNS here — that is fetch-time)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_recipe_url(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  u text := trim(coalesce(p, ''));
  host text;
  path text;
  q text;
  scheme text;
  rest text;
  pair text;
  kept text[] := array[]::text[];
  k text;
  v text;
  port text;
begin
  if char_length(u) < 12 or char_length(u) > 2000 then
    return '';
  end if;
  if u !~* '^https://' then
    return '';
  end if;
  if u ~* '^(javascript|data|file|blob|about|http):' then
    return '';
  end if;

  scheme := 'https';
  rest := substring(u from '^https://(.*)$');
  if rest is null or rest = '' then
    return '';
  end if;

  host := lower(split_part(rest, '/', 1));
  -- Reject userinfo
  if position('@' in host) > 0 then
    return '';
  end if;
  port := null;
  if host ~ ':[0-9]+$' then
    port := substring(host from ':([0-9]+)$');
    host := regexp_replace(host, ':[0-9]+$', '');
    if port is distinct from '443' then
      return '';
    end if;
  end if;
  host := regexp_replace(host, '^www\.', '');

  -- Host must be a DNS name, not an IP literal (v4 / v6 / IPv4-mapped).
  if host ~ '^[0-9.]+$' then
    return '';
  end if;
  if host ~ ':' or host ~ '^\[|\]$' then
    return '';
  end if;
  if host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    return '';
  end if;
  -- Local / internal hostnames (structural; DNS re-check happens at fetch).
  if host in ('localhost', 'localhost.localdomain')
     or host ~ '\.localhost$'
     or host ~ '\.local$'
     or host ~ '\.internal$'
     or host ~ '\.intranet$'
     or host ~ '\.corp$'
     or host ~ '\.home$'
     or host ~ '\.lan$'
     or host ~ '^metadata\.'
     or host = 'metadata.google.internal'
  then
    return '';
  end if;

  path := substring(rest from length(split_part(rest, '/', 1)) + 1);
  if path is null then path := ''; end if;
  if position('?' in path) > 0 then
    q := substring(path from position('?' in path) + 1);
    path := substring(path from 1 for position('?' in path) - 1);
  else
    q := '';
  end if;
  path := split_part(path, '#', 1);
  path := regexp_replace(path, '/+$', '');

  if q <> '' then
    foreach pair in array string_to_array(q, '&') loop
      k := lower(split_part(pair, '=', 1));
      v := substring(pair from length(split_part(pair, '=', 1)) + 2);
      if k = '' then continue; end if;
      if k in (
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'utm_id', 'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'msclkid',
        'ref', 'ref_', 'cmpid'
      ) then
        continue;
      end if;
      kept := array_append(kept, k || '=' || coalesce(v, ''));
    end loop;
  end if;

  u := scheme || '://' || host || path;
  if array_length(kept, 1) is not null then
    u := u || '?' || array_to_string(kept, '&');
  end if;
  if char_length(u) > 2000 then
    return '';
  end if;
  return u;
end $$;

-- ---------------------------------------------------------------------------
-- Inbox + audit
-- ---------------------------------------------------------------------------
create table if not exists public.recipe_inbox (
  id              uuid        primary key default gen_random_uuid(),
  -- Submitter's household at insert time (for household visibility + Vill laga).
  household_id    uuid        not null references public.households (id) on delete cascade,
  added_by        uuid        not null references auth.users (id) on delete cascade,
  url             text        not null check (char_length(url) between 12 and 2000),
  url_normalized  text        not null check (char_length(url_normalized) between 12 and 2000),
  note            text        null check (char_length(note) <= 500),
  created_at      timestamptz not null default now(),
  -- new=ny, reviewed=granskad, added=tillagd, rejected=avvisad, blocked=blockerad
  status          text        not null default 'new'
                    check (status in ('new', 'reviewed', 'added', 'rejected', 'blocked')),
  review_notes    text        null check (char_length(review_notes) <= 8000),
  reviewed_at     timestamptz null,
  suggestion      text        null
                    check (suggestion is null or suggestion in (
                      'import', 'skip', 'duplicate', 'needs_data', 'wrong_site', 'spam'
                    )),
  recipe_id       text        null check (recipe_id is null or char_length(recipe_id) between 1 and 200),
  -- Set when duplicate-rejected so the UI can deep-link without making raw url clickable.
  duplicate_of    text        null check (duplicate_of is null or char_length(duplicate_of) between 1 and 200),
  report_count    int         not null default 0 check (report_count >= 0),
  updated_at      timestamptz not null default now()
);

create unique index if not exists recipe_inbox_household_url
  on public.recipe_inbox (household_id, url_normalized);
create index if not exists recipe_inbox_added_by_created
  on public.recipe_inbox (added_by, created_at desc);
create index if not exists recipe_inbox_status_new
  on public.recipe_inbox (status, created_at)
  where status = 'new';

create table if not exists public.recipe_inbox_audit (
  id          bigserial primary key,
  inbox_id    uuid        null references public.recipe_inbox (id) on delete set null,
  actor_id    uuid        null references auth.users (id) on delete set null,
  action      text        not null check (char_length(action) between 1 and 64),
  detail      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists recipe_inbox_audit_inbox on public.recipe_inbox_audit (inbox_id, created_at desc);
create index if not exists recipe_inbox_audit_actor on public.recipe_inbox_audit (actor_id, created_at desc);

create table if not exists public.recipe_inbox_reports (
  id          uuid        primary key default gen_random_uuid(),
  inbox_id    uuid        not null references public.recipe_inbox (id) on delete cascade,
  reporter_id uuid        not null references auth.users (id) on delete cascade,
  reason      text        not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  unique (inbox_id, reporter_id)
);

-- Rate-limit buckets (per user + global), touched only by SECURITY DEFINER RPCs.
create table if not exists public.recipe_inbox_rate (
  bucket      text        primary key check (char_length(bucket) between 1 and 80),
  window_start timestamptz not null default now(),
  count       int         not null default 0 check (count >= 0)
);

-- ---------------------------------------------------------------------------
-- Triggers: freeze client writes to review fields
-- ---------------------------------------------------------------------------
create or replace function public.recipe_inbox_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n text;
begin
  new.url := trim(new.url);
  n := public.normalize_recipe_url(new.url);
  if n = '' then
    raise exception 'invalid recipe url';
  end if;
  new.url_normalized := n;

  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      -- Direct INSERTs from clients are denied by grants; belt-and-braces anyway.
      raise exception 'use submit_recipe_inbox';
    elsif tg_op = 'UPDATE' then
      if old.added_by is distinct from auth.uid() or old.status <> 'new' then
        raise exception 'not allowed';
      end if;
      new.added_by := old.added_by;
      new.household_id := old.household_id;
      new.url := old.url;
      new.url_normalized := old.url_normalized;
      new.status := old.status;
      new.review_notes := old.review_notes;
      new.reviewed_at := old.reviewed_at;
      new.suggestion := old.suggestion;
      new.recipe_id := old.recipe_id;
      new.duplicate_of := old.duplicate_of;
      new.report_count := old.report_count;
      new.created_at := old.created_at;
      if new.note is not null and char_length(new.note) > 500 then
        raise exception 'note too long';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists recipe_inbox_before_write on public.recipe_inbox;
create trigger recipe_inbox_before_write
  before insert or update on public.recipe_inbox
  for each row execute function public.recipe_inbox_before_write();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.recipe_inbox enable row level security;
alter table public.recipe_inbox_audit enable row level security;
alter table public.recipe_inbox_reports enable row level security;
alter table public.recipe_inbox_rate enable row level security;

-- Inbox: submitter sees own rows; household members see household rows; admins see all.
drop policy if exists recipe_inbox_select on public.recipe_inbox;
create policy recipe_inbox_select on public.recipe_inbox
  for select to authenticated
  using (
    added_by = auth.uid()
    or public.is_household_member(household_id)
    or public.is_app_admin()
  );

-- No direct client INSERT (RPC only). Note-only update on own "new" rows.
drop policy if exists recipe_inbox_update_own_note on public.recipe_inbox;
create policy recipe_inbox_update_own_note on public.recipe_inbox
  for update to authenticated
  using (added_by = auth.uid() and status = 'new')
  with check (added_by = auth.uid() and status = 'new');

drop policy if exists recipe_inbox_delete_own_new on public.recipe_inbox;
create policy recipe_inbox_delete_own_new on public.recipe_inbox
  for delete to authenticated
  using (added_by = auth.uid() and status = 'new');

-- Audit: admins read all; actors read their own rows; no client writes.
drop policy if exists recipe_inbox_audit_select on public.recipe_inbox_audit;
create policy recipe_inbox_audit_select on public.recipe_inbox_audit
  for select to authenticated
  using (actor_id = auth.uid() or public.is_app_admin());

-- Reports: reporter sees own; admins see all; insert via RPC only ideally,
-- but allow insert of own report with RLS check.
drop policy if exists recipe_inbox_reports_select on public.recipe_inbox_reports;
create policy recipe_inbox_reports_select on public.recipe_inbox_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_app_admin());

drop policy if exists recipe_inbox_reports_insert on public.recipe_inbox_reports;
create policy recipe_inbox_reports_insert on public.recipe_inbox_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- Rate table: no client access
revoke all on public.recipe_inbox_rate from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate-limit helper
-- ---------------------------------------------------------------------------
create or replace function public._inbox_rate_take(p_bucket text, p_limit int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipe_inbox_rate%rowtype;
begin
  insert into public.recipe_inbox_rate (bucket, window_start, count)
  values (p_bucket, now(), 0)
  on conflict (bucket) do nothing;

  select * into r from public.recipe_inbox_rate where bucket = p_bucket for update;
  if r.window_start + p_window <= now() then
    update public.recipe_inbox_rate
      set window_start = now(), count = 1
      where bucket = p_bucket;
    return;
  end if;
  if r.count >= p_limit then
    raise exception 'rate limit exceeded';
  end if;
  update public.recipe_inbox_rate set count = count + 1 where bucket = p_bucket;
end $$;

create or replace function public._inbox_audit(
  p_inbox uuid, p_action text, p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.recipe_inbox_audit (inbox_id, actor_id, action, detail)
  values (p_inbox, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Cheap empty-check for the morning routine (no row payload).
create or replace function public.recipe_inbox_pending_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint from public.recipe_inbox where status = 'new'
$$;

-- Any signed-in user may submit any https URL (validated). Limits enforced here.
-- Defaults: 10 / user / rolling hour, 100 global / rolling hour, max 25 pending (new) per user.
create or replace function public.submit_recipe_inbox(p_url text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  rid uuid;
  n text;
  note_clean text;
  pending int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  perform public.ensure_my_household();
  hid := public.my_household_id();
  if hid is null then
    raise exception 'no household';
  end if;

  n := public.normalize_recipe_url(p_url);
  if n = '' then
    raise exception 'invalid recipe url';
  end if;

  note_clean := nullif(trim(coalesce(p_note, '')), '');
  if note_clean is not null and char_length(note_clean) > 500 then
    raise exception 'note too long';
  end if;

  perform public._inbox_rate_take('user:' || uid::text, 10, interval '1 hour');
  perform public._inbox_rate_take('global', 100, interval '1 hour');

  select count(*)::int into pending
  from public.recipe_inbox
  where added_by = uid and status = 'new';
  if pending >= 25 then
    raise exception 'too many pending links';
  end if;

  insert into public.recipe_inbox as t (household_id, added_by, url, url_normalized, note, status)
  values (hid, uid, trim(p_url), n, note_clean, 'new')
  on conflict (household_id, url_normalized) do nothing
  returning id into rid;

  if rid is null then
    select id into rid from public.recipe_inbox
    where household_id = hid and url_normalized = n;
    perform public._inbox_audit(rid, 'submit_duplicate', jsonb_build_object('url_normalized', n));
    raise exception 'already submitted';
  end if;

  perform public._inbox_audit(rid, 'submit', jsonb_build_object('url_normalized', n));
  return rid;
end $$;

-- Narrow reviewer write path: ONLY status / notes / suggestion / recipe_id / duplicate_of.
-- Callable by app admins (human) OR by the Supabase MCP/service role (Alfred routine
-- runs execute_sql as a privileged role and can UPDATE via this function with a
-- SET LOCAL or by calling it after SET ROLE — simplest for MCP: call this RPC
-- via execute_sql as `select public.review_recipe_inbox(...)` which is SECURITY
-- DEFINER and additionally checks is_app_admin() OR current_user is a superuser /
-- bypassing role). For MCP service path we allow when auth.uid() is null AND
-- current_user is not 'authenticated'/'anon' (i.e. table owner / postgres).
create or replace function public.review_recipe_inbox(
  p_id uuid,
  p_status text,
  p_review_notes text default null,
  p_suggestion text default null,
  p_recipe_id text default null,
  p_duplicate_of text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  privileged boolean;
  notes text;
begin
  privileged := public.is_app_admin()
    or (auth.uid() is null and current_user not in ('authenticated', 'anon', 'public'));
  if not privileged then
    raise exception 'not allowed';
  end if;

  if p_status is null or p_status not in ('reviewed', 'added', 'rejected', 'blocked') then
    raise exception 'invalid status';
  end if;
  if p_suggestion is not null and p_suggestion not in (
    'import', 'skip', 'duplicate', 'needs_data', 'wrong_site', 'spam'
  ) then
    raise exception 'invalid suggestion';
  end if;
  if p_status = 'added' and (p_recipe_id is null or length(trim(p_recipe_id)) = 0) then
    raise exception 'recipe_id required when status is added';
  end if;
  if p_suggestion = 'duplicate' and (p_duplicate_of is null or length(trim(p_duplicate_of)) = 0) then
    raise exception 'duplicate_of required when suggestion is duplicate';
  end if;

  notes := nullif(trim(coalesce(p_review_notes, '')), '');
  if notes is not null and char_length(notes) > 8000 then
    raise exception 'review_notes too long';
  end if;

  update public.recipe_inbox i
  set
    status = p_status,
    review_notes = notes,
    suggestion = p_suggestion,
    recipe_id = case when p_status = 'added' then trim(p_recipe_id) else i.recipe_id end,
    duplicate_of = case
      when p_suggestion = 'duplicate' then trim(p_duplicate_of)
      else i.duplicate_of
    end,
    reviewed_at = now(),
    updated_at = now()
  where i.id = p_id;

  if not found then
    raise exception 'not found';
  end if;

  perform public._inbox_audit(
    p_id, 'review',
    jsonb_build_object(
      'status', p_status,
      'suggestion', p_suggestion,
      'recipe_id', p_recipe_id,
      'duplicate_of', p_duplicate_of
    )
  );
end $$;

-- After import: mark added + put recipe on the submitter household's Vill laga
-- (household_recipe_state.status = 'want'). Household-scoped status:
-- this single upsert is the only write path.
create or replace function public.complete_recipe_inbox_import(p_id uuid, p_recipe_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipe_inbox%rowtype;
  privileged boolean;
  rid text := trim(p_recipe_id);
begin
  privileged := public.is_app_admin()
    or (auth.uid() is null and current_user not in ('authenticated', 'anon', 'public'));
  if not privileged then
    raise exception 'not allowed';
  end if;
  if rid is null or rid = '' or char_length(rid) > 200 then
    raise exception 'invalid recipe_id';
  end if;

  select * into r from public.recipe_inbox where id = p_id for update;
  if not found then
    raise exception 'not found';
  end if;

  update public.recipe_inbox
  set status = 'added',
      recipe_id = rid,
      suggestion = coalesce(suggestion, 'import'),
      reviewed_at = coalesce(reviewed_at, now()),
      updated_at = now()
  where id = p_id;

  -- Prefer Vill laga; never downgrade an existing Lagad row.
  insert into public.household_recipe_state as h (
    household_id, recipe_id, status, status_at, updated_by, updated_at
  ) values (
    r.household_id, rid, 'want', now(), r.added_by, now()
  )
  on conflict (household_id, recipe_id) do update
  set status = case when h.status = 'cooked' then h.status else 'want' end,
      status_at = case
        when h.status = 'cooked' then h.status_at
        else greatest(h.status_at, excluded.status_at)
      end,
      updated_by = case when h.status = 'cooked' then h.updated_by else excluded.updated_by end,
      updated_at = now();

  perform public._inbox_audit(
    p_id, 'import_complete',
    jsonb_build_object('recipe_id', rid, 'household_id', r.household_id)
  );
end $$;

-- User or admin report. Household members can report a visible row.
create or replace function public.report_recipe_inbox(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recipe_inbox%rowtype;
  reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if char_length(reason) < 3 or char_length(reason) > 500 then
    raise exception 'invalid reason';
  end if;

  select * into r from public.recipe_inbox where id = p_id;
  if not found then
    raise exception 'not found';
  end if;
  if not (
    r.added_by = auth.uid()
    or public.is_household_member(r.household_id)
    or public.is_app_admin()
  ) then
    raise exception 'not allowed';
  end if;

  insert into public.recipe_inbox_reports (inbox_id, reporter_id, reason)
  values (p_id, auth.uid(), reason)
  on conflict (inbox_id, reporter_id) do update set reason = excluded.reason;

  update public.recipe_inbox
  set report_count = report_count + 1, updated_at = now()
  where id = p_id;

  perform public._inbox_audit(p_id, 'report', jsonb_build_object('reason', reason));
end $$;

-- Admin reject / block shortcut.
create or replace function public.admin_reject_recipe_inbox(
  p_id uuid, p_status text, p_review_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not allowed';
  end if;
  if p_status not in ('rejected', 'blocked') then
    raise exception 'invalid status';
  end if;
  perform public.review_recipe_inbox(
    p_id, p_status, p_review_notes,
    case when p_status = 'blocked' then 'spam' else 'skip' end,
    null, null
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.recipe_inbox from public, anon, authenticated;
revoke all on public.recipe_inbox_audit from public, anon, authenticated;
revoke all on public.recipe_inbox_reports from public, anon, authenticated;
revoke all on public.recipe_inbox_rate from public, anon, authenticated;

grant select on public.recipe_inbox to authenticated;
grant update (note, updated_at) on public.recipe_inbox to authenticated;
grant delete on public.recipe_inbox to authenticated;

grant select on public.recipe_inbox_audit to authenticated;
grant select, insert on public.recipe_inbox_reports to authenticated;

revoke execute on function public.normalize_recipe_url(text),
  public.recipe_inbox_before_write(),
  public._inbox_rate_take(text, int, interval),
  public._inbox_audit(uuid, text, jsonb),
  public.is_app_admin(),
  public.recipe_inbox_pending_count(),
  public.submit_recipe_inbox(text, text),
  public.review_recipe_inbox(uuid, text, text, text, text, text),
  public.complete_recipe_inbox_import(uuid, text),
  public.report_recipe_inbox(uuid, text),
  public.admin_reject_recipe_inbox(uuid, text, text)
  from public, anon;

grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.recipe_inbox_pending_count() to authenticated;
grant execute on function public.submit_recipe_inbox(text, text) to authenticated;
grant execute on function public.report_recipe_inbox(uuid, text) to authenticated;
grant execute on function public.admin_reject_recipe_inbox(uuid, text, text) to authenticated;
-- review + complete_import: granted to authenticated but function body requires
-- is_app_admin() or a non-client role (MCP/service). Keeps a single RPC surface.
grant execute on function public.review_recipe_inbox(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.complete_recipe_inbox_import(uuid, text) to authenticated;

-- Optional Realtime for submitter/household list updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipe_inbox'
  ) then
    execute 'alter publication supabase_realtime add table public.recipe_inbox';
  end if;
end $$;

commit;
