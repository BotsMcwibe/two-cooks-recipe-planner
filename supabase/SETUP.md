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
