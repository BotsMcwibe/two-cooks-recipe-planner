# Supabase setup (Yessy)

The app works without this (everything stays in the browser). These steps turn on
login + sync. Project: https://tihxtjesijxwsgsifzac.supabase.co

## 1. Create the tables
1. Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/0001_init.sql` and click **Run**.
   It creates `user_recipe_state` and `user_preferences`, turns on RLS with
   "own rows only" policies, and grants access to `authenticated` only (not `anon`).
   It is safe to run again.
3. Check: **Table Editor** shows both tables with the RLS badge on.

## 2. Allow the login redirect
Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `https://botsmcwibe.github.io/two-cooks-recipe-planner/`
- **Redirect URLs** → **Add URL** for each:
  - `https://botsmcwibe.github.io/two-cooks-recipe-planner/`
  - `https://botsmcwibe.github.io/two-cooks-recipe-planner/**`
  - `http://localhost:8765/**` (local testing; add your own port if different)
- Save.

## 3. Email
Authentication → **Sign In / Providers** → **Email** is enabled by default; keep it on.
The built-in mail sender is rate limited (a few emails per hour) — fine for personal
use; add custom SMTP later if needed.

## What is synced
| Data | Local key | Server |
|---|---|---|
| Status (Vill laga / Lagar nu / Lagad) + own rating | `jesse.recipeState.v1` | `user_recipe_state` (one row per recipe) |
| "Har inte mixen" choices | `yessy.spiceMixMissing.v1` | `user_preferences.prefs.spiceMixMissing` |
| Theme choice | `jesse-theme` | `user_preferences.prefs.theme` |
| Inköpslista (recipes + portions) | `recipeApp.state.v3` (shopping part) | `user_preferences.prefs.shopping` |

Not synced (device-only / ephemeral): cooking progress (checked steps), photo
availability cache.

Merge rule: on login, local and server are merged per recipe and per preference key;
the newer `updatedAt` wins. After that every change is written to both
(optimistic; offline changes are pushed when the browser comes back online or on
the next login).

## 4. Household + friends tables (applied 2026-10-21 through the Supabase MCP)
| File | What |
|---|---|
| `migrations/0002_household_friends.sql` | profiles, households, members, invites, household_recipe_state, cook_log, recipe_lists(+items), recipe_ratings, recipe_notes, friendships; RLS; RPCs (ensure_my_household, invites, join/leave, friends, kitchen_feed). Client UPDATE is column-scoped. |
| `migrations/0003_migrate_prefs.sql` | Idempotent copy of user_recipe_state + prefs journal keys into the new tables (re-run before phase 1 shipped). |
| `migrations/0005_household_hardening.sql` | Timestamp clamp (now + 5 min), server-stamped "who" columns, owner-only list visibility, stale writes keep updated_by. |

With these tables the app (`js/core/table-sync.js`) syncs status (shared), stars (yours),
cook log, lists and Inte för oss (shared) and Mina anteckningar (private) through them;
status + stars are still written to `user_recipe_state` for older cached clients.
Without them it falls back to the old tables. Server test: `docs/household-sql/test_household_rls.sql`
in the project folder (one transaction that always rolls back).
