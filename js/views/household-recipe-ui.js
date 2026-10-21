/**
 * Översikt, signed in: the household's stars + reviews ("Hushållet") and my own
 * Recension (per person, visible to the household). Mina anteckningar stay
 * private (journal-ui.js). Always returns one .hh-rev element so it can be
 * refreshed in place.
 */
import * as Household from '../core/household.js?v=20261021g17';
import * as UserState from '../core/user-recipe-state.js?v=20261021g17';
import { saveReview } from '../core/table-sync.js?v=20261021g17';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g17';

const fmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
const day = (iso) => { const t = Date.parse(iso || ''); return t > 0 ? fmt.format(new Date(t)) : ''; };
const starsTxt = (n) => `${'★'.repeat(n)}<span class="hh-stars-off">${'★'.repeat(5 - n)}</span>`;
const status = new Map(); // recipeId -> 'Sparar…' | 'Sparat' | error

export function householdReviewsHtml(id) {
  const attr = `class="hh-rev" data-id="${escapeAttr(id)}"`;
  if (!id || !Household.isTables()) return `<div ${attr} hidden></div>`;
  const shared = Household.isShared();
  const others = shared ? Household.householdRatings(id) : [];
  const mine = Household.myReview(id);
  const myStars = UserState.get(id).rating;
  let html = `<div ${attr}>`;
  if (others.length) {
    html += `<h3 class="hh-rev-h"><span aria-hidden="true">👥</span> Hushållet</h3><ul class="hh-rev-list">${others.map((r) => `
      <li class="hh-rev-item">
        <div class="hh-rev-who">${Household.avatarHtml(r.user_id)}<span class="hh-rev-name">${escapeHtml(Household.nameOf(r.user_id))}</span>
          ${r.rating ? `<span class="hh-stars" aria-label="${r.rating} av 5">${starsTxt(r.rating)}</span>` : '<span class="acc-meta">inget betyg</span>'}</div>
        ${r.review ? `<p class="hh-rev-text">${escapeHtml(r.review)}</p><p class="hh-rev-date">${escapeHtml(day(r.review_at))}</p>` : ''}
      </li>`).join('')}</ul>`;
  }
  const st = status.get(id) || '';
  html += `<details class="hh-rev-mine"${mine ? ' open' : ''}>
      <summary><span class="nt-title"><span aria-hidden="true">✍️</span> Min recension</span><span class="hh-rev-vis">${shared ? '👥 Syns för hushållet' : '👥 Syns för ditt hushåll'}</span></summary>
      <textarea class="hh-rev-input" rows="3" maxlength="4000" placeholder="T.ex. Perfekt med extra citron" aria-label="Min recension">${escapeHtml(mine)}</textarea>
      <div class="hh-inline"><button type="button" class="acc-btn hh-rev-save">Spara recension</button><span class="hh-msg" role="status" aria-live="polite">${escapeHtml(st)}</span></div>
      ${!myStars && shared ? '<p class="acc-hint">Dina stjärnor sätter du ovanför. De syns också för hushållet.</p>' : ''}
    </details></div>`;
  return html;
}

export function refreshHouseholdReviews($root, id = null) {
  $root.find('.hh-rev').each((_, el) => {
    const cid = el.getAttribute('data-id');
    if (id && cid !== id) return;
    const ta = el.querySelector('.hh-rev-input');
    if (ta && (ta === document.activeElement || ta.value !== ta.defaultValue)) return; // don't yank what the user is typing
    const tmp = document.createElement('div');
    tmp.innerHTML = householdReviewsHtml(cid);
    const next = tmp.firstElementChild;
    const wasOpen = el.querySelector('details') && el.querySelector('details').open;
    el.replaceWith(next);
    if (wasOpen && next.querySelector('details')) next.querySelector('details').open = true;
  });
}

export function bindHouseholdReviews($root) {
  $root.on('click', '.hh-rev-save', async (e) => {
    const box = e.currentTarget.closest('.hh-rev');
    const id = box.getAttribute('data-id');
    const ta = box.querySelector('.hh-rev-input');
    const msg = box.querySelector('.hh-msg');
    if (msg) msg.textContent = 'Sparar…';
    try {
      await saveReview(id, ta.value);
      ta.defaultValue = ta.value;
      status.set(id, 'Sparat');
    } catch (err) {
      console.warn('[recension]', err);
      status.set(id, Household.errorText(err));
    }
    if (msg) msg.textContent = status.get(id);
    refreshHouseholdReviews($root, id);
  });
  window.addEventListener('householdchange', (e) => {
    const w = e.detail && e.detail.what;
    if (w === 'feed' || w === 'profile') return;
    refreshHouseholdReviews($root);
  });
}
