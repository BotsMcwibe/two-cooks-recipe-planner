/**
 * "Senast i köket": what the household (and friends, phase 4) cooked lately,
 * from the kitchen_feed RPC (Household.feed()). Used as a slim collapsible row
 * on the recipe list and as the full list in Mitt konto. Who and where are
 * always in words (name + "Hushållet" / "Vän"), never colour alone.
 */
import * as Household from '../core/household.js?v=20261021g18';
import * as UserState from '../core/user-recipe-state.js?v=20261021g18';
import { agoLabel } from './recipe-status-ui.js?v=20261021g18';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g18';

const OPEN_KEY = 'yessy.feedOpen.v1';
const esc = (s) => escapeHtml(String(s ?? ''));

function avatar(item) {
  if (item.user_id === Household.myId()) return Household.avatarHtml(item.user_id);
  const ch = item.avatar_emoji || (item.display_name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="hh-av${item.avatar_emoji ? ' is-emoji' : ''}" aria-hidden="true">${esc(ch)}</span>`;
}
const whoName = (item) => (item.user_id === Household.myId() ? 'Du' : item.display_name || 'Någon');

/** Entries worth showing: known recipes; optionally without my own. */
export function feedItems({ titleOf, mine = true, days = 0 } = {}) {
  const me = Household.myId();
  const since = days ? Date.now() - days * 864e5 : 0;
  return Household.feed().filter((f) => titleOf(f.recipe_id) && (mine || f.user_id !== me) && (!since || Date.parse(f.logged_at) >= since));
}

export function feedRowHtml(item, titleOf) {
  const title = titleOf(item.recipe_id);
  const friend = item.source === 'friend';
  const when = item.cooked_on ? agoLabel(item.cooked_on) : '';
  const stars = item.rating ? `<span class="fd-stars" aria-label="${item.rating} av 5 stjärnor">★ ${item.rating}</span>` : '';
  const st = UserState.get(item.recipe_id).status;
  const want = friend && !st
    ? `<button type="button" class="acc-link-btn fd-want" data-fd-want="${escapeAttr(item.recipe_id)}">+ Vill laga</button>`
    : (friend && st === 'want' ? '<span class="fd-saved">✓ Vill laga</span>' : '');
  return `<li class="fd-item">${avatar(item)}
      <span class="fd-text"><strong>${esc(whoName(item))}</strong> lagade <a href="#overview/${escapeAttr(item.recipe_id)}" class="fd-link">${esc(title)}</a>${when ? ` <span class="fd-when">${esc(when)}</span>` : ''}</span>
      ${stars}<span class="fd-tag">${friend ? 'Vän' : 'Hushållet'}</span>${want}
    </li>`;
}

/** Slim row on the recipe list (others only, last 3 weeks). '' when there is nothing. */
export function feedStripHtml(titleOf) {
  if (!Household.isTables() || !Household.feedLoaded()) return '';
  const items = feedItems({ titleOf, mine: false, days: 21 }).slice(0, 5);
  if (!items.length) return '';
  const first = items[0];
  const open = localStorage.getItem(OPEN_KEY) === '1';
  return `<details class="fd-strip"${open ? ' open' : ''}>
      <summary><span class="fd-h">Senast i köket</span>
        <span class="fd-peek">${avatar(first)}<span><strong>${esc(whoName(first))}</strong> lagade ${esc(titleOf(first.recipe_id))}</span></span>
        ${items.length > 1 ? `<span class="fd-more-n">+${items.length - 1}</span>` : ''}<span class="cl-chev" aria-hidden="true">▾</span></summary>
      <ul class="fd-list">${items.map((i) => feedRowHtml(i, titleOf)).join('')}</ul>
      <a href="#konto" class="acc-link-btn fd-all" data-acc-target="acc-koket">Visa allt i Mitt konto</a>
    </details>`;
}

/** Full list for Mitt konto. */
export function feedSectionBody(titleOf) {
  if (!Household.feedLoaded()) return '<p class="acc-empty">Hämtar…</p>';
  const items = feedItems({ titleOf });
  if (!items.length) {
    return `<p class="acc-empty">${Household.isShared() ? 'Här syns det ni lagar. Tryck ”Klart! Logga som lagad” när ni lagat klart.' : 'Här syns det du och ditt hushåll lagar. Bjud in någon under Hushåll.'}</p>`;
  }
  return `<ul class="fd-list fd-list-full">${items.map((i) => feedRowHtml(i, titleOf)).join('')}</ul>
    ${Household.feedHasMore() ? '<button type="button" class="acc-btn fd-load-more" data-fd-more>Visa fler</button>' : ''}`;
}

/** Shared click handling (Vill laga from a friend's row, Visa fler, open state). Returns true when handled. */
export function handleFeedClick(t) {
  const w = t.closest('[data-fd-want]');
  if (w) { UserState.set(w.getAttribute('data-fd-want'), { status: 'want' }); return true; }
  if (t.closest('[data-fd-more]')) {
    const b = t.closest('[data-fd-more]'); b.disabled = true; b.textContent = 'Hämtar…';
    Household.loadFeed({ more: true }).catch((e) => { console.warn('[flöde]', e); b.disabled = false; b.textContent = 'Försök igen'; });
    return true;
  }
  return false;
}
export function rememberStripOpen(open) { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch {} }
