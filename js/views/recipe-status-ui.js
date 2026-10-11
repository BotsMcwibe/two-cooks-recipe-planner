/**
 * Personal status control (Vill laga / Lagar nu / Lagad) + clickable 1–5 stars,
 * and the compact card badge. Backed by core/user-recipe-state.js.
 */
import * as UserState from '../core/user-recipe-state.js?v=20261011u';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';

const STATUS_ICON = { want: '☆', cooking: '◔', cooked: '✓' };

/** Full control for the overview modal and cook page header. */
export function statusControlHtml(id, opts = {}) {
  if (!id) return '';
  const { status, rating } = UserState.get(id);
  const btns = UserState.STATUSES.map((s) => {
    const on = status === s;
    const label = UserState.STATUS_LABELS[s];
    return `<button type="button" class="rs-status-btn rs-${s}${on ? ' is-on' : ''}" data-status="${s}" aria-pressed="${on}"`
      + ` title="${on ? `Ta bort ”${label}”` : label}">${escapeHtml(label)}</button>`;
  }).join('');
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    const on = rating != null && i <= rating;
    const isCur = rating === i;
    const label = isCur ? `Ta bort mitt betyg (${i} av 5)` : `Mitt betyg: ${i} av 5`;
    stars += `<button type="button" class="rs-star${on ? ' is-on' : ''}" data-rating="${i}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" aria-pressed="${isCur}">★</button>`;
  }
  const done = opts.allDone && status !== 'cooked'
    ? '<button type="button" class="rs-mark-done" data-status="cooked">✓ Markera som lagad</button>'
    : '';
  return `<div class="rs-control" data-id="${escapeAttr(id)}">
    <div class="rs-status" role="group" aria-label="Min status">${btns}</div>
    <div class="rs-stars" role="group" aria-label="Mitt betyg">${stars}${rating ? `<span class="rs-stars-value">${rating}/5</span>` : ''}</div>
    ${done}
  </div>`;
}

/** Badge + own stars for a recipe card (empty string when nothing is set). */
export function cardStateHtml(id) {
  const { status, rating } = UserState.get(id);
  if (!status && !rating) return '';
  let html = '<div class="rs-card">';
  if (status) html += `<span class="rs-badge rs-${status}">${STATUS_ICON[status]} ${escapeHtml(UserState.STATUS_LABELS[status])}</span>`;
  if (rating) html += `<span class="rs-card-stars" title="Mitt betyg ${rating} av 5" aria-label="Mitt betyg ${rating} av 5">${'★'.repeat(rating)}<span class="rs-card-stars-off">${'★'.repeat(5 - rating)}</span></span>`;
  return html + '</div>';
}

/**
 * Delegated click handling for every .rs-control inside $root.
 * Clicking the active status or the current star clears it.
 */
export function bindStatusControls($root) {
  $root.on('click', '.rs-control [data-status]', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const $btn = $(e.currentTarget);
    const id = $btn.closest('.rs-control').attr('data-id');
    const s = $btn.attr('data-status');
    const cur = UserState.get(id).status;
    UserState.setStatus(id, $btn.hasClass('rs-mark-done') ? 'cooked' : (cur === s ? null : s));
  });
  $root.on('click', '.rs-control .rs-star', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const $btn = $(e.currentTarget);
    const id = $btn.closest('.rs-control').attr('data-id');
    const r = Number($btn.attr('data-rating'));
    UserState.setRating(id, UserState.get(id).rating === r ? null : r);
  });
}

/** Re-render controls for id in place (keeps focus on the same button). */
export function refreshStatusControls($root, id, opts = {}) {
  $root.find('.rs-control').each((_, el) => {
    const cid = el.getAttribute('data-id');
    if (id && cid !== id) return;
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const key = focused ? (focused.getAttribute('data-status') ? `[data-status="${focused.getAttribute('data-status')}"]` : `[data-rating="${focused.getAttribute('data-rating')}"]`) : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = statusControlHtml(cid, typeof opts === 'function' ? opts(cid) : opts);
    const next = tmp.firstElementChild;
    el.replaceWith(next);
    if (key) (next.querySelector(key) || next.querySelector('button'))?.focus();
  });
}
