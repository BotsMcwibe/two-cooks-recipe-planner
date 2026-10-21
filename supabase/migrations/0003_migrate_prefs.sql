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
