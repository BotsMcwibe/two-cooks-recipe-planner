# Yessy: Delat hushåll + Vänner (plan)

Status: phases 0–5 client shipped (`?v=20261109g21`); simplified phase-5 SQL prepared, NOT applied. Updated 2026-11-09 (Europe/Stockholm).
Pending cleanup SQL (manual only): `supabase/migrations/20261109204933_retire_legacy_journal.sql`, identical to `docs/household-sql/20261109204933_retire_legacy_journal.sql`.

## 0. Summary

- **Every signed-in user lives in exactly one household.** Alone, that is a personal kitchen ("Mitt kök"). Joining someone moves you into their household, so the app has one data model, not separate "shared" and "personal" modes.
- **Shared by the household:** Vill laga / Lagad, Inte för oss, the cook log ("Lagad 3 gånger"), and lists (a list can be marked "Bara för mig").
- **Per person, visible to the household:** stars and a written review ("Recension").
- **Per person, private:** "Mina anteckningar" stays private, and so does the yearly challenge goal.
- **Friends** are separate from households. They see what you logged as cooked and your stars for it in "Senast i köket", and nothing else. Each person can switch off sharing with friends.
- **Joining:** a link `…/#join/K7QM2XRA` or the 8-character code typed in. Codes last 7 days, allow 5 uses and can be revoked. Households have up to 8 members.
- **Sync model:** rows carry ids from the client and per-field timestamps, and database triggers make "newer wins" hold on the server too. Offline edits and two devices merge the same way they do today with the prefs JSON.
- **Verification:** mocked multi-user Playwright tests at 412/1280; local PGlite cleanup tests. Real multi-account sign-in remains untested. No cleanup SQL has been run live.

## 1. Current storage

- Static ES-module client; Supabase publishable key + RLS, magic-link PKCE auth.
- Signed in: statuses/log/lists/Inte för oss use household tables; personal ratings/reviews and private notes use their dedicated tables. No legacy table or prefs-journal path.
- Signed out: localStorage remains fully functional. Signed-in local caches and retry logic remain for ordinary offline use, not old-data migration.
- Active account preferences: theme, spiceMixMissing, pantryExcluded, spicesOwned, kitchen, shopping, weekPlan, weekPlanSettings and cookChallenge. Challenge goals/scope merge per year by updatedAt (local wins ties).
- Retired prefs keys: cookLog, recipeNotes, recipeLists, notForUs and journalMigratedAt. The pending SQL deletes them; the client neither reads nor imports them.
- There are effectively no users to preserve: discard legacy data, no archives/back-compat shims. Current household data and privacy/security controls remain intact.

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
  - Sync only active preference adapters; no migration marker or retired-key imports.
  - Theme, kitchen, spices, pantry, shopping, weekPlan and weekPlanSettings stay in prefs.
  - cookChallenge stays personal and account-wide in prefs. Goal/scope records merge independently per year by updatedAt, keeping local records on a tie; existing local goals upload on login. Logged out, localStorage still works. No live SQL is needed for this correction.
- **New views:** the Hushåll and Vänner sections in `account-view.js`, the `#join/` and `#friend/` routes in `router.js`, a feed row in `browse-view.js`, and household stars/reviews in `overview-modal.js`.
- **Realtime (phase 3):** one channel per household on `postgres_changes` for the five tables (RLS-filtered). Incoming rows go through the same merge as sync.

## 5. Cleanup (g21; no legacy-data preservation)

The user runs the pending retire SQL manually after deploying g21. It only:
1. `DROP TABLE IF EXISTS public.user_recipe_state` (no CASCADE). The table-owned policies, triggers, indexes and constraints disappear with it.
2. Remove cookLog, recipeNotes, recipeLists, notForUs and journalMigratedAt from user_preferences.prefs. Keep cookChallenge and every other live/unknown preference untouched.

No archive schema, snapshots, read-only compatibility table, blocking trigger or CHECK constraint. IF EXISTS-level idempotency is sufficient. Old clients are not supported. Do not replay the historical 0003 backfill after retirement.

Read-only inspection of the live project's public function bodies, views, materialized views and pg_depend found no external references to user_recipe_state. There is no persistent migrate_prefs_to_household function: that name is historical migration metadata; 0003 was a one-shot script. Keep merge_recipe_state(): it serves household_recipe_state. No live DDL was executed.

Client cleanup removes catalog-seed/seed-marker migration, cooking→want conversion, unused whole-record legacy applyRemote, pre-v2 weekly-default migration, persisted precook restoration, unused data import shims and old table-mode detection. Current localStorage keys and offline cache/retry remain; no conversion from earlier shapes is supported.

## 6. Phases

| Phase | Scope | Ships |
|---|---|---|
| 0 | Profile (display name, emoji) in Mitt konto. Abstract the journal storage behind a backend switch. | Nothing visible except the name field. |
| 1 | Household tables for the personal kitchen with an offline queue. | Same UI, table-backed. |
| 2 | **Household:** invite (link/code/mailto), join with preview and merge, leave/remove, household name, "who did what" hints, household stars, Recension, private lists. | The Hushåll section and `#join/`. |
| 3 | **Senast i köket** (household only): `kitchen_feed`, browse row, Mitt konto list. **User runs 0004** for Realtime. | Feed and live updates. |
| 4 | **Friends:** friend code and link, requests, list, sharing toggle; the feed includes friends. | The Vänner section and `#friend/`. |
| 5 | Remove legacy paths; drop user_recipe_state and prune retired prefs (manual SQL pending). | g21 |

Each phase is pushed separately and verified headlessly. Two browser contexts signed in as two test accounts need real magic-link sign-ins, so the user has to sign in or create test users once.

## 7. What the user needs to do

1. Existing household schema is already applied. Review and manually run the pending retire SQL; never replay the old 0003 backfill after dropping its source table.
2. For phase 3: run `0004_realtime.sql`, or turn on Realtime for those five tables in **Database → Publications**.
3. No auth or URL changes are needed. `#join/…` and `#friend/…` are hash routes on the existing redirect URL.
4. Optional: custom SMTP in Authentication, if invite sign-ins hit the built-in mail rate limit (a few mails per hour).
5. For testing: create a second account, or let me know which two e-mails to use, so the household flow can be checked end to end.

## 8. Open questions

- When merging on join, should "Lagad" beat a newer "Vill laga"? Today the newer edit wins, which can downgrade Lagad to Vill laga.
- Should existing "Mina anteckningar" stay private, or become the shared Recension? The plan keeps them private.
- Should friends see your stars as well as the dishes? The plan says yes, behind the same sharing toggle.
- Is a maximum of 8 members right?

## SQL status and verification

Already applied household schema: 0002_household_friends, historical 0003 backfill, 0005_household_hardening and 0004_realtime. Their historical migration files remain unchanged; current household RPCs/RLS/grants are retained.

Pending, NOT applied live:
- `supabase/migrations/20261109204933_retire_legacy_journal.sql`
- Identical paste-ready copy: `docs/household-sql/20261109204933_retire_legacy_journal.sql`
- Separate inbox proposal: `docs/household-sql/20261109220329_recipe_inbox.sql` (see recipe-inbox-plan.md). All spam, SSRF, prompt-injection, rate-limit, reviewer-RPC and audit safeguards remain unchanged.

Verification: local PGlite migration runs twice with the old table absent on the second pass; retired keys are deleted, cookChallenge/live prefs remain writable, current household helper/view survive, and no archive/blocking constraint is created. 157 headless mocked multi-user checks passed (`p2.mjs`, `p3.mjs`, `p4.mjs`, `g21-sync.mjs`, `g21-challenge.mjs`, `g21-pages.mjs`, `g21-no-migrations.mjs` under /workspace/shots/hh), covering logged-out storage, household sync/offline retry, feed/realtime, friends, planner, shopping and account-wide challenge goals at 412/1280. Missing-photo 404s are the only allowed console/HTTP noise. Real-account magic-link testing remains outstanding.
