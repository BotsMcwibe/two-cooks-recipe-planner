/**
 * Personal status control (Goodreads-style "Vill laga ▾" split button) + clickable
 * 1–5 stars, the cook-log line ("Lagad 3 gånger · senast 12 okt") and the compact
 * card badge. Backed by core/user-recipe-state.js (status, rating) and
 * core/recipe-journal.js (cook log, Inte för oss, lists).
 */
import * as UserState from '../core/user-recipe-state.js?v=20261021g17';
import * as Journal from '../core/recipe-journal.js?v=20261021g17';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g17';
import * as Household from '../core/household.js?v=20261021g17';

const STATUS_ICON = { want: '☆', cooked: '✓' };
const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** '2026-10-12' → '12 okt' (year added when it is not this year). */
export function fmtCookDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const y = Number(m[1]);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
export const timesLabel = (n) => `${n} ${n === 1 ? 'gång' : 'gånger'}`;
/** '2026-06-02' → 'för 4 månader sedan' (rough, for lists where the exact date is secondary). */
export function agoLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const days = Math.max(0, Math.round((Date.now() - t) / 864e5));
  if (days === 0) return 'i dag';
  if (days === 1) return 'i går';
  if (days < 14) return `för ${days} dagar sedan`;
  if (days < 60) return `för ${Math.round(days / 7)} veckor sedan`;
  if (days < 365) { const m = Math.round(days / 30.4); return `för ${m} ${m === 1 ? 'månad' : 'månader'} sedan`; }
  const y = Math.round(days / 365);
  return `för ${y} år sedan`;
}

/** 'i dag' / 'i går' / 'för 3 dagar sedan' for an epoch-ms timestamp. */
function agoFromMs(t) {
  const d = new Date(t);
  return Number.isFinite(t) && t > 0 ? agoLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) : '';
}

/**
 * Shared household: who last set the status, when it wasn't me.
 * Returns { by, text } ("Anna markerade Lagad i går") or null.
 */
export function statusBy(id) {
  if (!Household.isShared()) return null;
  const { status } = UserState.get(id);
  const m = Household.statusMeta(id);
  if (!status || !m || !m.by || m.by === Household.myId()) return null;
  if (UserState.statusAt(id) > m.at + 1000) return null; // changed here since the last pull: that was me
  const when = agoFromMs(m.at);
  return { by: m.by, text: `${Household.nameOf(m.by)} markerade ${UserState.STATUS_LABELS[status]}${when ? ` ${when}` : ''}` };
}

/** Average of everyone's stars in the household (me included) when someone else has rated. */
export function householdAverage(id) {
  if (!Household.isShared()) return null;
  const others = Household.householdRatings(id).filter((r) => r.rating);
  if (!others.length) return null;
  const mine = UserState.get(id).rating;
  const all = others.map((r) => r.rating).concat(mine ? [mine] : []);
  return { avg: all.reduce((a, b) => a + b, 0) / all.length, n: all.length };
}

/** Which control has its ▾ menu open (only one at a time). */
let openMenu = null; // { id, newList: bool }
/** Recipe ids whose date list is expanded in the översikt. */
const logOpen = new Set();
/** Every root bound with bindStatusControls, so menu/journal changes refresh them all. */
const roots = new Set();

/** Mark a recipe as cooked by the user: status Lagad + today's cook-log entry (once per day). */
export function markCooked(id, opts = {}) {
  if (!id) return;
  UserState.setStatus(id, 'cooked');
  Journal.ensureCookToday(id, opts);
}

/** Apply a status pick from the button/menu. Picking the active one clears it. */
function pickStatus(id, s) {
  const cur = UserState.get(id).status;
  if (s === 'nfu') {
    const on = !Journal.isNotForUs(id);
    Journal.setNotForUs(id, on);
    if (on && cur === 'want') UserState.setStatus(id, null);
    return;
  }
  if (cur === s) { UserState.setStatus(id, null); return; }
  if (s === 'cooked') markCooked(id);
  else UserState.setStatus(id, s);
  if (s === 'want') Journal.setNotForUs(id, false);
}

function menuHtml(id) {
  const { status } = UserState.get(id);
  const nfu = Journal.isNotForUs(id);
  const item = (act, label, on, extra = '') => `<button type="button" class="rs-menu-item${on ? ' is-on' : ''}" role="menuitemradio" aria-checked="${on}" data-act="${act}" data-k="m-${act}"${extra}><span class="rs-menu-check" aria-hidden="true">${on ? '✓' : ''}</span>${escapeHtml(label)}</button>`;
  let html = `<div class="rs-menu" role="menu" aria-label="Spara receptet">`;
  if (Household.isShared()) html += '<div class="rs-menu-label rs-menu-shared" aria-hidden="true">👥 Gäller hela hushållet</div>';
  html += item('want', 'Vill laga', status === 'want');
  html += item('cooked', 'Lagad', status === 'cooked');
  html += item('nfu', 'Inte för oss', nfu, ' title="Döljs i receptlistan"');
  html += '<div class="rs-menu-sep" role="separator"></div><div class="rs-menu-label" aria-hidden="true">Mina listor</div>';
  for (const l of Journal.lists()) {
    const on = l.recipeIds.includes(id);
    const lock = Journal.isPrivateList(l) ? '<span class="ls-lock" title="Bara för mig"> 🔒</span>' : '';
    html += `<button type="button" class="rs-menu-item rs-menu-list${on ? ' is-on' : ''}" role="menuitemcheckbox" aria-checked="${on}" data-act="list" data-list="${escapeAttr(l.id)}" data-k="l-${escapeAttr(l.id)}"><span class="rs-menu-box" aria-hidden="true">${on ? '✓' : ''}</span>${escapeHtml(l.name)}${lock}</button>`;
  }
  if (openMenu && openMenu.newList) {
    html += `<form class="rs-newlist" data-k="newlist-form"><input type="text" class="rs-newlist-input" data-k="newlist" maxlength="${Journal.MAX_LIST_NAME}" placeholder="T.ex. Vardag" aria-label="Namn på ny lista" autocomplete="off"><button type="submit" class="rs-newlist-ok">Skapa</button></form>`;
  } else {
    html += '<button type="button" class="rs-menu-item rs-menu-new" role="menuitem" data-act="newlist" data-k="m-newlist"><span class="rs-menu-check" aria-hidden="true">+</span>Ny lista</button>';
  }
  html += '</div>';
  return html;
}

/**
 * Full control for the overview modal and cook page header.
 * Returns exactly one element (.rs-control); the catalog Godkänd seal is rendered
 * separately via kitchenMarkHtml() so in-place refreshes never duplicate it.
 */
export function statusControlHtml(id, opts = {}) {
  if (!id) return '';
  const { status, rating } = UserState.get(id);
  const nfu = Journal.isNotForUs(id);
  const open = !!(openMenu && openMenu.id === id);
  // Main part: toggles Vill laga; when the recipe is Lagad / Inte för oss it opens the menu instead
  let cls = 'is-none';
  let label = 'Vill laga';
  let title = 'Spara som Vill laga';
  if (status === 'want') { cls = 'is-want'; label = '✓ Vill laga'; title = 'Ta bort ”Vill laga”'; }
  else if (status === 'cooked') { cls = 'is-cooked'; label = '✓ Lagad'; title = 'Ändra status'; }
  else if (nfu) { cls = 'is-nfu'; label = 'Inte för oss'; title = 'Ändra status'; }
  const who = statusBy(id);
  if (who) title = `${who.text}. ${title}`;
  const main = `<button type="button" class="rs-main" data-act="main" data-k="main" title="${escapeAttr(title)}"${status === 'want' ? ' aria-pressed="true"' : (cls === 'is-none' ? ' aria-pressed="false"' : ' aria-haspopup="menu"')}>${escapeHtml(label)}</button>`;
  const caret = `<button type="button" class="rs-caret" data-act="caret" data-k="caret" aria-haspopup="menu" aria-expanded="${open}" aria-label="Fler val: Lagad, Inte för oss, listor" title="Fler val"><span aria-hidden="true">▾</span></button>`;

  let stars = '';
  for (let i = 1; i <= 5; i++) {
    const on = rating != null && i <= rating;
    const isCur = rating === i;
    const l = isCur ? `Ta bort mitt betyg (${i} av 5)` : `Mitt betyg: ${i} av 5`;
    stars += `<button type="button" class="rs-star${on ? ' is-on' : ''}" data-rating="${i}" data-k="r${i}" aria-label="${escapeAttr(l)}" title="${escapeAttr(l)}" aria-pressed="${isCur}">★</button>`;
  }
  const done = opts.allDone && status !== 'cooked'
    ? '<button type="button" class="rs-mark-done" data-act="done" data-k="done">✓ Markera som lagad</button>'
    : '';
  return `<div class="rs-control" data-id="${escapeAttr(id)}"${opts.allDone ? ' data-all-done="1"' : ''}>
    <div class="rs-split ${cls}${open ? ' is-open' : ''}" role="group" aria-label="Min status">${main}${caret}${open ? menuHtml(id) : ''}</div>
    ${who ? `<span class="rs-by" title="${escapeAttr(who.text)}">${Household.avatarHtml(who.by, 'hh-av-sm')}<span>${escapeHtml(who.text)}</span></span>` : ''}
    <div class="rs-stars" role="group" aria-label="Mitt betyg">${stars}${rating ? `<span class="rs-stars-value">${rating}/5</span>` : ''}</div>
    ${done}
  </div>`;
}

/** Godkänd seal: round stamp with the Yessy face plus the word; the check only shows at `lg` (översikt) size. */
export function sealHtml(opts = {}) {
  const { lg = false, title = '' } = opts;
  const t = title ? ` title="${escapeAttr(title)}"` : '';
  return `<span class="gk-badge${lg ? ' gk-badge-lg' : ''}"${t}><span class="gk-seal" aria-hidden="true"><span class="gk-check">✓</span></span><span class="gk-word">${escapeHtml(UserState.TESTED_LABEL)}</span></span>`;
}

function sealTitle(m) {
  return `Godkänd: lagad och godkänd i Yessys kök${m && m.score ? `, kökets betyg ${m.score}` : ''}`;
}

/** Catalog marker line (Godkänd seal, kitchen score), separate from personal state. */
export function kitchenMarkHtml(id) {
  const m = UserState.catalogMark(id);
  if (!m || (!m.tested && !m.score)) return '';
  return `<p class="rs-kitchen">${m.tested ? sealHtml({ lg: true, title: sealTitle(m) }) : ''}${m.score ? `<span class="rs-kitchen-score" title="Kökets betyg, inte ditt">Kökets betyg ${escapeHtml(m.score)}</span>` : ''}</p>`;
}

/**
 * Cook log line for the översikt: a disclosure "Lagad 3 gånger ▾" (collapsed by default);
 * expanding it shows the exact dates with edit (date input), ✕ and + Lägg till datum.
 * Always returns one .cl-log element (empty and hidden when there is nothing to show).
 */
export function cookLogHtml(id) {
  if (!id) return '';
  const entries = Journal.cookEntries(id);
  const cooked = UserState.get(id).status === 'cooked';
  const attr = `class="cl-log" data-id="${escapeAttr(id)}"`;
  if (!entries.length && !cooked) return `<div ${attr} hidden></div>`;
  const open = logOpen.has(id);
  let summary;
  if (entries.length) {
    summary = `<button type="button" class="cl-toggle" data-k="cl-toggle" aria-expanded="${open}" title="${open ? 'Dölj datumen' : 'Visa och ändra datumen'}">`
      + `<span class="cl-icon" aria-hidden="true">🗓</span><span>Lagad <strong>${timesLabel(entries.length)}</strong></span><span class="cl-chev" aria-hidden="true">▾</span></button>`;
  } else {
    summary = '<span class="cl-summary"><span class="cl-icon" aria-hidden="true">🗓</span>Lagad · inget datum än</span>'
      + '<button type="button" class="cl-add" data-k="cl-add">+ Lägg till datum</button>';
  }
  let list = '';
  if (open && entries.length) {
    const max = Journal.todayIso();
    list = `<ul class="cl-dates">${entries.map((e) => `
      <li data-entry="${escapeAttr(e.id)}">
        <input type="date" class="cl-date" value="${escapeAttr(e.date)}" max="${max}" data-k="d-${escapeAttr(e.id)}" aria-label="Datum lagad">
        ${Household.isShared() && e.by ? `<span class="cl-who">${Household.avatarHtml(e.by, 'hh-av-sm')}${escapeHtml(Household.nameOf(e.by))}</span>` : ''}
        ${e.cooks === 2 ? '<span class="cl-cooks">2 kockar</span>' : ''}
        <button type="button" class="cl-del" data-k="x-${escapeAttr(e.id)}" aria-label="Ta bort ${escapeAttr(fmtCookDate(e.date))}" title="Ta bort datumet">✕</button>
      </li>`).join('')}</ul>
      <button type="button" class="cl-add" data-k="cl-add">+ Lägg till datum</button>`;
  }
  return `<div ${attr}${open ? ' data-open="1"' : ''}><div class="cl-head">${summary}</div>${list}</div>`;
}

/** Badge + own stars for a recipe card, plus the catalog Godkänd seal (empty string when nothing is set). */
export function cardStateHtml(id, stats = null) {
  const { status, rating } = UserState.get(id);
  const m = UserState.catalogMark(id);
  const tested = m && m.tested;
  const n = stats ? stats.count : Journal.cookStats(id).count;
  const nfu = Journal.isNotForUs(id);
  const hhAvg = householdAverage(id);
  if (!status && !rating && !tested && !n && !nfu && !hhAvg) return '';
  let html = '<div class="rs-card">';
  if (tested) html += sealHtml({ title: sealTitle(m) });
  if (status && STATUS_ICON[status]) {
    const times = status === 'cooked' && n > 1 ? ` ${n}×` : '';
    const who = statusBy(id);
    const t = [who ? who.text : '', times ? `Lagad ${timesLabel(n)}` : ''].filter(Boolean).join(' · ');
    html += `<span class="rs-badge rs-${status}"${t ? ` title="${escapeAttr(t)}"` : ''}>${who ? Household.avatarHtml(who.by, 'hh-av-sm') : ''}${STATUS_ICON[status]} ${escapeHtml(UserState.STATUS_LABELS[status])}${times}</span>`;
  }
  if (n && status !== 'cooked') html += `<span class="rs-card-times" title="Lagad ${timesLabel(n)}">Lagad ${n}×</span>`;
  if (nfu) html += '<span class="rs-badge rs-nfu">Inte för oss</span>';
  if (rating) html += `<span class="rs-card-stars" title="Mitt betyg ${rating} av 5" aria-label="Mitt betyg ${rating} av 5">${'★'.repeat(rating)}<span class="rs-card-stars-off">${'★'.repeat(5 - rating)}</span></span>`;
  if (hhAvg) { const a = hhAvg.avg.toFixed(1).replace('.', ','); html += `<span class="rs-card-hh" title="Hushållets snitt: ${a} av 5 (${hhAvg.n} betyg)">Hushållet ★ ${a}</span>`; }
  return html + '</div>';
}

function refreshAll(id) {
  for (const $r of roots) refreshStatusControls($r, id);
}
function setMenu(next) {
  const prev = openMenu && openMenu.id;
  openMenu = next;
  if (prev) refreshAll(prev);
  if (next && next.id !== prev) refreshAll(next.id);
}

let globalBound = false;
function bindGlobal() {
  if (globalBound) return;
  globalBound = true;
  // Click outside an open menu closes it (capture: dialogs stop propagation)
  document.addEventListener('click', (e) => {
    if (!openMenu) return;
    const t = e.target;
    if (t.closest && t.closest('.rs-split')) return;
    if (t.isConnected === false) return; // re-rendered under the pointer
    // After this click is handled, so e.g. a star click still lands before the re-render
    setTimeout(() => { if (openMenu) setMenu(null); }, 0);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openMenu) return;
    const split = document.activeElement && document.activeElement.closest && document.activeElement.closest('.rs-split');
    if (e.key === 'Escape') {
      const id = openMenu.id;
      setMenu(null);
      e.stopPropagation();
      e.preventDefault();
      for (const $r of roots) $r.find(`.rs-control[data-id="${CSS.escape(id)}"] .rs-caret`).trigger('focus');
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && split) {
      const items = [...split.querySelectorAll('.rs-menu-item, .rs-menu input')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    }
  }, true);
  window.addEventListener('journalchange', () => refreshAll(null));
}

/**
 * Delegated click handling for every .rs-control / .cl-log inside $root.
 * Clicking the active status or the current star clears it.
 */
export function bindStatusControls($root) {
  roots.add($root);
  bindGlobal();
  const idOf = (el) => $(el).closest('[data-id]').attr('data-id');
  $root.on('click', '.rs-control [data-act]', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const id = idOf(el);
    const act = el.getAttribute('data-act');
    const { status } = UserState.get(id);
    if (act === 'caret') { setMenu(openMenu && openMenu.id === id ? null : { id }); focusKey($root, id, 'm-want'); return; }
    if (act === 'main') {
      if (status === 'cooked' || (!status && Journal.isNotForUs(id))) { setMenu({ id }); focusKey($root, id, 'm-want'); return; }
      pickStatus(id, 'want');
      return;
    }
    if (act === 'done') { markCooked(id); return; }
    if (act === 'want' || act === 'cooked' || act === 'nfu') { pickStatus(id, act); setMenu(null); focusKey($root, id, 'caret'); return; }
    if (act === 'list') {
      const listId = el.getAttribute('data-list');
      const l = Journal.getList(listId);
      if (l) Journal.setInList(listId, id, !l.recipeIds.includes(id)); // menu stays open (journalchange re-renders it)
      focusKey($root, id, `l-${listId}`);
      return;
    }
    if (act === 'newlist') { setMenu({ id, newList: true }); focusKey($root, id, 'newlist'); }
  });
  $root.on('submit', '.rs-control .rs-newlist', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = idOf(e.currentTarget);
    const input = e.currentTarget.querySelector('input');
    const name = input ? input.value : '';
    if (!name.trim()) { input?.focus(); return; }
    const l = Journal.createList(name, [id]);
    setMenu({ id });
    focusKey($root, id, l ? `l-${l.id}` : 'm-newlist');
  });
  $root.on('click', '.rs-control .rs-newlist', (e) => e.stopPropagation());
  $root.on('click', '.rs-control .rs-star', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const $btn = $(e.currentTarget);
    const id = idOf(e.currentTarget);
    const r = Number($btn.attr('data-rating'));
    UserState.setRating(id, UserState.get(id).rating === r ? null : r);
  });
  // Cook log (översikt)
  $root.on('click', '.cl-log .cl-toggle', (e) => {
    const id = idOf(e.currentTarget);
    if (logOpen.has(id)) logOpen.delete(id); else logOpen.add(id);
    refreshCookLog($root, id, 'cl-toggle');
  });
  $root.on('click', '.cl-log .cl-add', (e) => {
    const id = idOf(e.currentTarget);
    logOpen.add(id);
    const entry = Journal.addCook(id);
    if (UserState.get(id).status !== 'cooked') UserState.setStatus(id, 'cooked');
    refreshCookLog($root, id, entry ? `d-${entry.id}` : 'cl-add');
  });
  $root.on('click', '.cl-log .cl-del', (e) => {
    const id = idOf(e.currentTarget);
    const entryId = $(e.currentTarget).closest('[data-entry]').attr('data-entry');
    Journal.removeCook(entryId);
    if (!Journal.cookEntries(id).length) logOpen.delete(id);
    refreshCookLog($root, id, 'cl-add');
  });
  $root.on('change', '.cl-log .cl-date', (e) => {
    const entryId = $(e.currentTarget).closest('[data-entry]').attr('data-entry');
    const v = e.currentTarget.value;
    if (v && v <= Journal.todayIso()) Journal.updateCook(entryId, { date: v });
    else refreshCookLog($root, idOf(e.currentTarget));
  });
}

function focusKey($root, id, key) {
  for (const $r of roots) {
    const el = $r.find(`.rs-control[data-id="${CSS.escape(id)}"] [data-k="${key}"]`)[0];
    if (el && el.offsetParent !== null) { el.focus(); return; }
  }
}

/** Re-render the cook-log line(s) for id (all ids when null), optionally focusing a data-k. */
export function refreshCookLog($root, id, focus = null) {
  $root.find('.cl-log').each((_, el) => {
    const cid = el.getAttribute('data-id');
    if (id && cid !== id) return;
    const active = el.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    // Never yank a date input the user is editing
    if (active && document.activeElement.matches('input') && !focus) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = cookLogHtml(cid);
    const next = tmp.firstElementChild;
    if (!next) return;
    el.replaceWith(next);
    const key = focus || active;
    if (key) (next.querySelector(`[data-k="${key}"]`) || next.querySelector('button, input'))?.focus();
  });
}

/** Re-render controls for id in place (keeps focus on the same button). */
export function refreshStatusControls($root, id, opts = null) {
  $root.find('.rs-control').each((_, el) => {
    const cid = el.getAttribute('data-id');
    if (id && cid !== id) return;
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const key = focused ? focused.getAttribute('data-k') : null;
    const o = typeof opts === 'function' ? opts(cid) : (opts || { allDone: el.getAttribute('data-all-done') === '1' });
    const tmp = document.createElement('div');
    tmp.innerHTML = statusControlHtml(cid, o);
    const next = tmp.querySelector('.rs-control');
    if (!next) return;
    el.replaceWith(next);
    if (key) (next.querySelector(`[data-k="${CSS.escape(key)}"]`) || next.querySelector('.rs-caret'))?.focus();
  });
  refreshCookLog($root, id);
}
