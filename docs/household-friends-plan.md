# Yessy: Delat hushåll + Vänner (plan)

Status: phases 0–5 client shipped; phase-5 SQL prepared, NOT applied. Updated 2026-11-09 (Europe/Stockholm). Original plan written 2026-10-21.
SQL files ready to paste: `docs/household-sql/0002_household_friends.sql`, `0003_migrate_prefs.sql`, `0004_realtime.sql`.
The same SQL is included at the bottom of this document.

## 0. Summary

- **Every signed-in user lives in exactly one household.** Alone, that is a personal kitchen ("Mitt kök"). Joining someone moves you into their household, so the app has one data model, not separate "shared" and "personal" modes.
- **Shared by the household:** Vill laga / Lagad, Inte för oss, the cook log ("Lagad 3 gånger"), and lists (a list can be marked "Bara för mig").
- **Per person, visible to the household:** stars and a written review ("Recension").
- **Per person, private:** "Mina anteckningar" stays private, and so does the yearly challenge goal.
- **Friends** are separate from households. They see what you logged as cooked and your stars for it in "Senast i köket", and nothing else. Each person can switch off sharing with friends.
- **Joining:** a link `…/#join/K7QM2XRA` or the 8-character code typed in. Codes last 7 days, allow 5 uses and can be revoked. Households have up to 8 members.
- **Sync model:** rows carry ids from the client and per-field timestamps, and database triggers make "newer wins" hold on the server too. Offline edits and two devices merge the same way they do today with the prefs JSON.
- **Tested** against a local Postgres 17 with Supabase-like stubs (an `auth.uid()` reading the JWT subject, and the `anon`/`authenticated` roles). 0002 and 0003 both run and re-run cleanly. Invite, preview, join with merge, RLS isolation, stale-write guard, friends, feed, opt-out, leaving and denied direct writes all behaved as intended. This was not run on the real project.

## 1. What exists today (findings)

- **Client:** `js/config.js` holds the project URL `https://tihxtjesijxwsgsifzac.supabase.co` and a **publishable** key (`sb_publishable_…`, meant to be public and protected by RLS). `supabase-js@2` is loaded from jsDelivr, and sign-in is by magic link with PKCE (`js/core/sync.js`).
- **Tables (`supabase/migrations/0001_init.sql`):**
  - `user_recipe_state(user_id, recipe_id, status in want|cooking|cooked, rating, updated_at)`.
  - `user_preferences(user_id, prefs jsonb)`. Each key in `prefs` is `{ value, updatedAt }`, and the keys are theme, spiceMixMissing, shopping, pantryExcluded, spicesOwned, kitchen, **cookLog, recipeNotes, recipeLists, notForUs, cookChallenge**.
- **Journal records** (`js/core/recipe-journal.js`) already have stable ids, a `by` user id, tombstones and `updatedAt`. Lists already have `owner` and `members`. They map one to one onto the tables below.
- **Admin access from the box: none.**
  - There is no Supabase CLI, no `~/.supabase` login and no access token (`sbp_…`).
  - There is no service-role or secret key and no DB password or `postgres://` URL in the environment, in /workspace, in /home/box or in the agent stores. I only searched for file names and patterns and did not read or use any values.
  - There is no Supabase MCP tool either.
  - **So the SQL has to be pasted into the Supabase SQL editor by the user**, which is the same as how 0001 was applied (`supabase/SETUP.md`).

## 2. UX

### 2.1 Mitt konto → "Hushåll" (new section, high in the rail)
- **Alone (personal kitchen):**
  - "Du lagar själv just nu. Bjud in den du lagar med så delar ni Vill laga, Lagad, listor och loggen."
  - **[Bjud in]** creates a code and shows a card containing:
    - the link `https://botsmcwibe.github.io/two-cooks-recipe-planner/#join/K7QM2XRA`;
    - the code written as `K7QM-2XRA`;
    - buttons **Kopiera länk**, **Dela…** (`navigator.share`, falls back to copy) and **Skicka e-post** (a `mailto:` with Swedish subject and body containing the link and the code);
    - the text "Gäller i 7 dagar · upp till 5 personer · Återkalla".
  - "Har du en kod?" offers a [____] field and a **Gå med** button.
- **In a household of 2–8:**
  - The name can be edited inline ("Vårt kök").
  - A member list shows avatar (emoji or initial, never colour alone), name, "du" and "ägare".
  - Active invites can be revoked.
  - "Lämna hushållet" asks for confirmation and offers "Ta med en kopia av det jag loggat".
  - The owner sees "Ta bort" on the other members.
- **Profile row:** a display name ("Visas för ditt hushåll och dina vänner") and an optional emoji. The name is asked for the first time you invite or join.

### 2.2 Joining by link or code
1. `#join/CODE` opens a sheet. If you are signed out, it saves `yessy.pendingJoin` in localStorage and shows "Logga in för att gå med". The magic link comes back to the same path, and the hash route resumes.
2. `preview_household_invite(code)` shows "Gå med i **Vårt kök**? Anna och Bo lagar här."
3. If you have data of your own, a checkbox **"Ta med mina recept, betyg och logg"** is on by default. It merges your personal kitchen into theirs; where both have changed something, the newer edit wins. Lists with the same name are merged.
4. If the code is invalid or expired, it says "Koden gäller inte längre. Be om en ny." When the household is full, it says "Hushållet är fullt (8)."

### 2.3 Shared vs personal in the existing UI
- **Status button and the ▾ menu:** these work as today but act for the household. The menu has a small header "Gäller hela hushållet". If the last change was by someone else, the tooltip on the button says "Anna markerade Lagad i går".
- **Stars:** "Mitt betyg" stays where it is, and personal. Next to it, a compact row shows the other members, e.g. `Anna ★★★★☆`. Cards show your stars, plus "Hushållet 4,5" only when others have rated.
- **Cook log:** shows "Lagad 3 gånger ▾" for the whole household. When expanded, each date shows who logged it ("Anna", "du") and "2 kockar". Anyone in the household can edit or remove a date.
- **Notes:**
  - "Mina anteckningar" gets a 🔒 "Bara du" hint.
  - A new **"Recension"** field shows reviews from household members with author and date, e.g. "Anna, 12 okt: Perfekt med extra citron".
  - Existing notes stay private.
- **Lists:** household lists by default. When you create one you can tick "Bara för mig"; private lists show a 🔒 on their chip.
- **Inte för oss:** hides the recipe for the whole household. The browse notice reads "N recept är inte för er".
- **Årets matutmaning:** the goal is personal. A toggle "Räkna hela hushållets lagningar" is on by default, because the log is shared.
- **Laga igen?:** uses your own stars and the household's last cook date.

### 2.4 Vänner (friends)
- **Mitt konto → "Vänner":**
  - Your friend code and link (`#friend/CODE`, with Kopiera/Dela).
  - "Lägg till vän" by code.
  - Incoming requests with **Godkänn / Avböj**, and requests you have sent.
  - A friends list with a "Ta bort" option.
  - The toggle **"Visa vad jag lagar för mina vänner"** (on by default, with a sentence on exactly what is shared: recipe, date and your stars, never notes or reviews).
- Friends see only cook-log entries **you** logged, through the feed. They never see your household's statuses, lists, notes or Inte för oss.

### 2.5 "Senast i köket" feed
- **Browse:** when you are signed in and the feed has something, a slim row sits under the filter chips. It shows the latest 3–6 entries as small cards: avatar, "Anna lagade **Kyckling Kiev**", "i går" and `★★★★★` if rated.
  - A label "Hushållet" or "Vän" carries the meaning in words, not colour.
  - Tapping an entry opens the översikt. A quick **+ Vill laga** saves it to your household's Vill laga.
  - The row can be collapsed, and that choice is remembered.
- **Mitt konto → "Senast i köket":** the full list, with "Visa fler" paging (`p_before`).
- **Source:** the RPC `kitchen_feed(limit, before)`, refreshed on load, on focus and through Realtime in phase 3.

## 3. Data model (Supabase)

| Table | Key | Scope | Notes |
|---|---|---|---|
| `profiles` | user_id | self, household, friend links | display_name, avatar_emoji, `friend_code`, `share_with_friends` |
| `households` | id | members | name, is_personal |
| `household_members` | (household_id, user_id), unique user_id | members | role owner/member; one household per user |
| `household_invites` | code | members | expires_at, max_uses, uses, revoked |
| `household_recipe_state` | (household_id, recipe_id) | members | status want/cooked + `status_at`; not_for_us + `nfu_at`; per-field merge trigger |
| `cook_log` | id (client `ck_…`) | members | household_id, user_id (who logged), cooked_on, cooks, deleted tombstone; keep-newer trigger |
| `recipe_lists` | id (client `ls_…`) | members (`private` = owner only) | owner_id, name, visibility, deleted |
| `recipe_list_items` | (list_id, recipe_id) | follows list | in_list tombstone; keep-newer trigger |
| `recipe_ratings` | (user_id, recipe_id) | self + household | rating/`rating_at`, review/`review_at`; per-field merge trigger |
| `recipe_notes` | (user_id, recipe_id) | self only | private notes |
| `friendships` | (user_a, user_b), a < b | both | pending/accepted, requested_by |

**RPC functions:** all are `SECURITY DEFINER` with `search_path = ''` and can be executed by `authenticated` only.
- `ensure_my_household()` creates a profile and a personal household if missing. The client calls it after every sign-in.
- `create_household_invite(max_uses, days)` returns the code. There are at most 5 active invites per household.
- `preview_household_invite(code)` returns the name, member names and expiry.
- `accept_household_invite(code, merge)` joins, optionally merging a one-person kitchen; it handles ownership, use count and the 8-member cap.
- `leave_household(copy_my_log)` gives the leaver a fresh personal kitchen. The shared data stays with the household.
- `remove_household_member(user)` is for the owner only.
- `request_friend(code)` either sends a request or accepts a crossed request. `respond_friend(other, accept)` answers one.
- `kitchen_feed(limit, before)` returns household entries plus friends' own entries for friends who share.

**Security notes:**
- Membership checks go through definer helpers (`is_household_member`, `shares_household`, `has_friend_link`), so policies never recurse into `household_members`' own RLS.
- Clients cannot insert memberships, invites, friendships or profiles directly. All of that goes through the RPCs.
- Codes use a 31-character alphabet without 0/O/1/I/L and 8 random bytes from `pgcrypto`, which gives about 8.5·10¹¹ combinations. Normalisation ignores case and dashes.
- `anon` gets nothing.

**Not included on purpose:**
- Server-side e-mail invites. Supabase can't send arbitrary mail from SQL, so "Skicka e-post" is a `mailto:`. A real e-mail invite would need an Edge Function with SMTP and is left for later.
- Rate limiting of code guessing. The code space is large and invites expire. If it's ever needed, add a per-user attempt counter in `accept_household_invite`.

## 4. Client changes (for when it is built)

- `js/core/household.js`
  - Holds the current household, members, profile and friends, and wraps the RPCs.
  - Emits `householdchange`.
- `js/core/recipe-journal.js`
  - Keeps the same public API.
  - Logged out, it behaves as today (localStorage).
  - Logged in, it reads from cached table rows (localStorage cache per household) and writes with `upsert` plus an offline queue that retries on `online` and sign-in.
  - Ids stay client-generated, so retries are idempotent.
- `js/core/user-recipe-state.js`
  - The status moves to `household_recipe_state` (with `status_at`), and the rating moves to `recipe_ratings`.
  - Phase 5: all `user_recipe_state` reads/writes removed; unavailable household tables leave edits queued locally.
- `js/core/sync.js`
  - Phase 5: never imports the retired prefs keys, regardless of migration marker.
  - Theme, kitchen, spices, pantry, shopping, weekPlan and weekPlanSettings stay in prefs.
  - cookChallenge stays personal and account-wide in prefs (g20 correction). Goal/scope records merge independently per year by updatedAt, keeping local records on a tie; existing local goals upload on login. Logged out, localStorage still works. No live SQL is needed for this correction.
- **New views:** the Hushåll and Vänner sections in `account-view.js`, the `#join/` and `#friend/` routes in `router.js`, a feed row in `browse-view.js`, and household stars/reviews in `overview-modal.js`.
- **Realtime (phase 3):** one channel per household on `postgres_changes` for the five tables (RLS-filtered). Incoming rows go through the same merge as sync.

## 5. Migration from the prefs JSON keys

1. **Server, once:** the user runs `0003_migrate_prefs.sql`. It is idempotent and keeps every source row and key.
   - Every user with data gets a profile and a personal household.
   - Statuses (`cooking` → `want`) and ratings are copied from `user_recipe_state`.
   - `notForUs`, `cookLog` (same ids, tombstones kept), `recipeLists` plus items, and private `recipeNotes` are copied from `user_preferences.prefs`.
2. **Client, on the first sign-in with the new version:**
   - Call `ensure_my_household()`.
   - Upsert anything still only on this device (local journal maps, local `jesse.recipeState.v1`) into the tables. Ids are stable and the triggers keep the newer version, so re-running is harmless.
   - Then set `prefs.journalMigratedAt` and stop writing the five journal keys.
3. **Stragglers:** an old cached client (g9) may still write prefs after the migration.
   - The global `?v=` bump forces new code on the next load.
   - For safety, the new client imports any prefs journal record whose `updatedAt` is newer than `journalMigratedAt` (one extra upsert pass).
4. **Phase 5 cleanup (later, separate SQL):** after a few weeks, remove the journal keys from `prefs` (`update user_preferences set prefs = prefs - 'cookLog' - …`). Make `user_recipe_state` read-only, or drop it once nothing reads it.

Tested on a local copy: two users were seeded with every key, including bad rows (invalid date, empty note, deleted list). 0003 ran twice with no duplicates. Bad rows were skipped, tombstones were kept and `cooking` became `want`.

## 6. Phases

| Phase | Scope | Ships |
|---|---|---|
| 0 | Profile (display name, emoji) in Mitt konto. Abstract the journal storage behind a backend switch. | Nothing visible except the name field. |
| 1 | **User runs 0002 + 0003.** Client reads and writes the new tables for the personal kitchen, with an offline queue, dual write of status to `user_recipe_state`, and the client migration step. | Same UI, now table-backed. Verify on two devices. |
| 2 | **Household:** invite (link/code/mailto), join with preview and merge, leave/remove, household name, "who did what" hints, household stars, Recension, private lists. | The Hushåll section and `#join/`. |
| 3 | **Senast i köket** (household only): `kitchen_feed`, browse row, Mitt konto list. **User runs 0004** for Realtime. | Feed and live updates. |
| 4 | **Friends:** friend code and link, requests, list, sharing toggle; the feed includes friends. | The Vänner section and `#friend/`. |
| 5 | Cleanup: stop dual writes, prune the prefs keys, retire `user_recipe_state`. | — |

Each phase is pushed separately and verified headlessly. Two browser contexts signed in as two test accounts need real magic-link sign-ins, so the user has to sign in or create test users once.

## 7. What the user needs to do

1. Supabase dashboard → **SQL Editor**: paste and run `0002_household_friends.sql`, then `0003_migrate_prefs.sql`. Both are safe to re-run.
2. For phase 3: run `0004_realtime.sql`, or turn on Realtime for those five tables in **Database → Publications**.
3. No auth or URL changes are needed. `#join/…` and `#friend/…` are hash routes on the existing redirect URL.
4. Optional: custom SMTP in Authentication, if invite sign-ins hit the built-in mail rate limit (a few mails per hour).
5. For testing: create a second account, or let me know which two e-mails to use, so the household flow can be checked end to end.

## 8. Open questions

- When merging on join, should "Lagad" beat a newer "Vill laga"? Today the newer edit wins, which can downgrade Lagad to Vill laga.
- Should existing "Mina anteckningar" stay private, or become the shared Recension? The plan keeps them private.
- Should friends see your stars as well as the dishes? The plan says yes, behind the same sharing toggle.
- Is a maximum of 8 members right?

## Appendix: SQL

### 0002_household_friends.sql

```sql
-- Yessy 0002: shared household + friends.
-- Paste into Supabase -> SQL Editor and run once (after 0001_init.sql). Safe to re-run.
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
```

### 0003_migrate_prefs.sql

```sql
-- Yessy 0003: copy existing data into the new tables (run once after 0002; safe to re-run).
-- Sources: user_recipe_state (status + rating) and user_preferences.prefs keys
-- cookLog, recipeNotes, recipeLists, notForUs (each { value: {...}, updatedAt }).
-- Nothing is deleted; the old table/keys stay as a fallback until phase 5.

begin;

create or replace function pg_temp.ms(v text) returns timestamptz language sql immutable as $$
  select to_timestamp(coalesce(nullif(v, '')::numeric, 0) / 1000.0)
$$;

-- 1. Profile + personal household for every user that has any data
insert into public.profiles (user_id)
select u.user_id from (select user_id from public.user_recipe_state union select user_id from public.user_preferences) u
on conflict (user_id) do nothing;

insert into public.households (name, is_personal, created_by)
select 'Mitt kök', true, u.user_id
from (select user_id from public.user_recipe_state union select user_id from public.user_preferences) u
where not exists (select 1 from public.household_members m where m.user_id = u.user_id)
  and not exists (select 1 from public.households h where h.created_by = u.user_id and h.is_personal
                  and not exists (select 1 from public.household_members m2 where m2.household_id = h.id));

insert into public.household_members (household_id, user_id, role)
select h.id, h.created_by, 'owner'
from public.households h
where h.is_personal and h.created_by is not null
  and not exists (select 1 from public.household_members m where m.household_id = h.id)
on conflict (user_id) do nothing;

-- 2. Status ('cooking' was retired -> 'want') and ratings
insert into public.household_recipe_state (household_id, recipe_id, status, status_at, updated_by)
select m.household_id, s.recipe_id, case s.status when 'cooking' then 'want' else s.status end, s.updated_at, s.user_id
from public.user_recipe_state s join public.household_members m on m.user_id = s.user_id
on conflict (household_id, recipe_id) do update
  set status = excluded.status, status_at = excluded.status_at, updated_by = excluded.updated_by;

insert into public.recipe_ratings (user_id, recipe_id, rating, rating_at)
select s.user_id, s.recipe_id, s.rating, s.updated_at
from public.user_recipe_state s where s.rating is not null
on conflict (user_id, recipe_id) do update set rating = excluded.rating, rating_at = excluded.rating_at;

-- 3. Inte för oss
insert into public.household_recipe_state (household_id, recipe_id, not_for_us, nfu_at, updated_by)
select m.household_id, f.key, coalesce((f.value ->> 'on')::boolean, false), pg_temp.ms(f.value ->> 'updatedAt'), p.user_id
from public.user_preferences p
join public.household_members m on m.user_id = p.user_id
cross join lateral jsonb_each(coalesce(p.prefs -> 'notForUs' -> 'value', '{}'::jsonb)) f
where jsonb_typeof(f.value) = 'object'
on conflict (household_id, recipe_id) do update
  set not_for_us = excluded.not_for_us, nfu_at = excluded.nfu_at;

-- 4. Cook log (ids kept, so devices that sync later merge instead of duplicating)
insert into public.cook_log (id, household_id, user_id, recipe_id, cooked_on, cooks, deleted, created_at, updated_at)
select e.key, m.household_id, p.user_id, e.value ->> 'recipeId', (e.value ->> 'date')::date,
       case when e.value ->> 'cooks' in ('1', '2') then (e.value ->> 'cooks')::smallint end,
       coalesce((e.value ->> 'deleted')::boolean, false),
       pg_temp.ms(e.value ->> 'createdAt'), pg_temp.ms(e.value ->> 'updatedAt')
from public.user_preferences p
join public.household_members m on m.user_id = p.user_id
cross join lateral jsonb_each(coalesce(p.prefs -> 'cookLog' -> 'value', '{}'::jsonb)) e
where jsonb_typeof(e.value) = 'object'
  and char_length(e.key) between 3 and 80
  and coalesce(e.value ->> 'recipeId', '') <> ''
  and (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (id) do update
  set cooked_on = excluded.cooked_on, deleted = excluded.deleted, updated_at = excluded.updated_at;

-- 5. Lists + items
insert into public.recipe_lists (id, household_id, owner_id, name, visibility, deleted, created_at, updated_at)
select l.key, m.household_id, p.user_id,
       left(coalesce(nullif(btrim(l.value ->> 'name'), ''), 'Lista'), 40), 'household',
       coalesce((l.value ->> 'deleted')::boolean, false),
       pg_temp.ms(l.value ->> 'createdAt'), pg_temp.ms(l.value ->> 'updatedAt')
from public.user_preferences p
join public.household_members m on m.user_id = p.user_id
cross join lateral jsonb_each(coalesce(p.prefs -> 'recipeLists' -> 'value', '{}'::jsonb)) l
where jsonb_typeof(l.value) = 'object' and char_length(l.key) between 3 and 80
on conflict (id) do update set name = excluded.name, deleted = excluded.deleted, updated_at = excluded.updated_at;

insert into public.recipe_list_items (list_id, recipe_id, in_list, added_by, updated_at)
select l.key, r.rid, true, p.user_id, pg_temp.ms(l.value ->> 'updatedAt')
from public.user_preferences p
cross join lateral jsonb_each(coalesce(p.prefs -> 'recipeLists' -> 'value', '{}'::jsonb)) l
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(l.value -> 'recipeIds') = 'array' then l.value -> 'recipeIds' else '[]'::jsonb end) r(rid)
where jsonb_typeof(l.value) = 'object'
  and exists (select 1 from public.recipe_lists x where x.id = l.key)
  and char_length(r.rid) between 1 and 200
on conflict (list_id, recipe_id) do nothing;

-- 6. Private notes
insert into public.recipe_notes (user_id, recipe_id, text, updated_at)
select p.user_id, n.key, left(n.value ->> 'text', 4000), pg_temp.ms(n.value ->> 'updatedAt')
from public.user_preferences p
cross join lateral jsonb_each(coalesce(p.prefs -> 'recipeNotes' -> 'value', '{}'::jsonb)) n
where jsonb_typeof(n.value) = 'object' and coalesce(n.value ->> 'text', '') <> ''
  and char_length(n.key) between 1 and 200
on conflict (user_id, recipe_id) do update set text = excluded.text, updated_at = excluded.updated_at;

commit;
```

### 0004_realtime.sql

```sql
-- Yessy 0004 (phase 3, optional): live updates for household tables via Supabase Realtime.
-- Realtime postgres_changes respects RLS, so members only receive their household's rows.
do $$
declare t text;
begin
  foreach t in array array['household_recipe_state', 'cook_log', 'recipe_lists', 'recipe_list_items', 'recipe_ratings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
```


## Migration status (live project tihxtjesijxwsgsifzac)

Applied 2026-10-21 ~13:09 CEST through the Supabase MCP (`apply_migration`):

| version | name | source |
|---|---|---|
| 20261021110844 | household_friends | household-sql/0002_household_friends.sql |
| 20261021110851 | migrate_prefs_to_household | household-sql/0003_migrate_prefs.sql |
| 20261021113417 | household_hardening | household-sql/0005_household_hardening.sql |
| 20261021115607 | realtime | household-sql/0004_realtime.sql (publication supabase_realtime: household_recipe_state, cook_log, recipe_lists, recipe_list_items, recipe_ratings) |

Phase 5 (2026-11-09, Europe/Stockholm): client cleanup in g19; account-wide cookChallenge restored in `?v=20261109g20`. No legacy state requests, prefs journal imports, or migration-marker/straggler fallback remain. Logged-out localStorage, signed-in table cache/offline retry, and active non-journal prefs remain.

Pending manual SQL (NOT run against live Supabase): `supabase/migrations/20261109204933_retire_legacy_journal.sql`, also copied to `docs/household-sql/20261109204933_retire_legacy_journal.sql`. Transactionally archives full legacy source rows in an RLS-protected, API-inaccessible `yessy_archive` schema before pruning cookLog, recipeNotes, recipeLists, notForUs and journalMigratedAt. Keeps user_recipe_state and its data, but revokes all client writes (authenticated retains own-row SELECT). A prefs CHECK prevents old clients restoring retired keys. Re-runnable; no household data is changed. Run only after reviewing the archive/backfill and deploying g20; SQL intentionally does not replay old household data on re-run.

Headless verification: mocked household client tests at 412 and 1280, including logged-out local mode, household sync/offline retry, feed/friends, planner/shopping, ignored retired prefs and no user_recipe_state calls. Runs: `/workspace/shots/hh/p2.mjs`, `p3.mjs`, `p4.mjs`, adapted `p5-sync.mjs` and `p5-pages.mjs`. No runtime/console errors apart from audited missing recipe-photo 404s. Instrumented retired prefs wrappers had zero value/timestamp reads. Local PGlite SQL test ran the migration twice and verified archive contents, idempotency, own-row SELECT, denied client writes (including column grants), denied archive access, retained active prefs and rejected stale keys. **No SQL was run on the live project. The g20 follow-up passed 51 headless checks at 412/1280 (`g20-challenge.mjs`, `g20-pages.mjs`): local/cloud goal merging, second-device sync, per-year conflict resolution, cleared goals, offline retry, logged-out editing/login upload, and planner/shopping regressions. The local PGlite migration test ran twice and confirms cookChallenge remains intact and editable.** Real multi-account sign-in remains untested.

All earlier SQL copied into the repo as `supabase/migrations/0002…0005`. App status (2026-10-21): phase 0 + 1 shipped in g15 (5494de0), phase 2 Hushåll in g16 (d5c638b), phase 3 Senast i köket + realtime in g17 (50a3983), phase 4 Vänner in g18 (d80d4eb).
Security advisors after 0004: no ERROR; WARNs = authenticated may execute the definer RPCs (intended), pre-existing `public.rls_auto_enable()` executable by anon/authenticated (not ours), leaked password protection off.

- Fix vs. the locally tested version: grants now revoke from `authenticated` as well as `anon`, since the project's default ACL gives new tables TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, and client UPDATE is column-scoped: profiles(display_name, avatar_emoji, share_with_friends, updated_at), households(name), household_invites(revoked). Client code must not PATCH other columns of those tables.
- Backfill result: 2 profiles, 2 personal households (1 member each), 7 household_recipe_state rows (2 'cooking' → 'want'), 2 recipe_ratings. cook_log, recipe_lists, recipe_notes and notForUs had no synced data yet (prefs held none of those keys), so 0 rows. **Re-run 0003 right before app phase 1 ships** so journal data synced in the meantime is copied too (it's idempotent).
- Legacy tables are byte-identical to the backup (user_preferences 2 rows, user_recipe_state 7 rows; auth.users 2).
- Snapshot and backups: household-sql/pre-migration-snapshot.md, backup-user_preferences.json, backup-user_recipe_state.json.

### Test accounts

None (by decision): server side is tested with test_household_rls.sql (simulated users in a rolled-back transaction, T1–T21 all pass), client side with the mocked two/three-user Playwright runs in /workspace/shots/hh (p0–p4). A real two-account test is still to be done by the user. Earlier note: The bot has no email inbox, and the app signs in by magic link only. Options: (a) the user names an inbox local part for the bot so it can claim it and sign up `<name>+yessy-test-1@…` / `+yessy-test-2@…` through the normal signup/OTP flow, or (b) the user adds two users in Dashboard → Authentication → Users → Add user with auto-confirm and gives the agent a way to sign in (for example a test inbox it can read).
