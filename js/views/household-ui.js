/**
 * Mitt konto: Profil (display name + avatar emoji). Later phases add Hushåll,
 * Vänner and Senast i köket here. Rendering returns HTML strings; AccountView
 * forwards clicks/submits/changes to handle*() and re-renders on householdchange.
 */
import * as Household from '../core/household.js?v=20261021g15';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g15';

/** Emoji choices for the avatar (food, so it fits the app). */
export const AVATAR_EMOJI = ['🍋', '🧄', '🌶️', '🥕', '🍅', '🧀', '🍳', '🥑', '🐟', '🍝', '🥐', '🫐', '🍄', '🥦', '🍪', '☕'];

const ui = { profileMsg: '', profileBusy: false };

function setMsg(key, text) { ui[key] = text; }

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------
export function profileSectionBody() {
  const p = Household.profile();
  if (!p) {
    return `<p class="acc-empty">${Household.mode() === 'local' ? 'Logga in för att välja namn och bild.' : 'Hämtar din profil…'}</p>`;
  }
  const me = Household.myId();
  const cur = p.avatar_emoji || '';
  const emojiBtns = AVATAR_EMOJI.map((e) => `<button type="button" class="hh-emoji" data-hh-emoji="${escapeAttr(e)}" aria-pressed="${cur === e}" aria-label="Välj ${escapeAttr(e)}">${e}</button>`).join('');
  return `<div class="hh-profile">
      <div class="hh-profile-preview">${Household.avatarHtml(me, 'hh-av-lg')}<span class="hh-profile-name">${escapeHtml(p.display_name || 'Inget namn än')}</span></div>
      <form class="hh-name-form">
        <label class="hh-label" for="hh-name">Namn</label>
        <div class="hh-inline">
          <input id="hh-name" class="hh-input" type="text" maxlength="${Household.MAX_NAME}" value="${escapeAttr(p.display_name || '')}" placeholder="T.ex. Anna" autocomplete="nickname">
          <button type="submit" class="acc-btn">Spara</button>
        </div>
        <p class="acc-hint">Visas för ditt hushåll och dina vänner, till exempel ”Anna lagade Kyckling Kiev”.</p>
      </form>
      <div class="hh-emoji-wrap" role="group" aria-labelledby="hh-emoji-label">
        <span class="hh-label" id="hh-emoji-label">Bild</span>
        <div class="hh-emoji-grid">${emojiBtns}<button type="button" class="hh-emoji hh-emoji-none" data-hh-emoji="" aria-pressed="${!cur}">Bokstav</button></div>
      </div>
      <p class="hh-msg" role="status" aria-live="polite">${escapeHtml(ui.profileMsg)}</p>
    </div>`;
}

async function saveProfile(patch, view) {
  setMsg('profileMsg', 'Sparar…');
  view.render();
  try {
    await Household.updateProfile(patch);
    setMsg('profileMsg', 'Sparat');
  } catch (err) {
    console.warn('[profil]', err);
    setMsg('profileMsg', Household.errorText(err));
  }
  view.render();
}

/** Click inside Mitt konto. Returns true when handled. */
export function handleClick(t, view) {
  const em = t.closest('[data-hh-emoji]');
  if (em) {
    const v = em.getAttribute('data-hh-emoji') || null;
    saveProfile({ avatar_emoji: v }, view).then(() => view.el.querySelector(`[data-hh-emoji="${CSS.escape(v || '')}"]`)?.focus());
    return true;
  }
  return false;
}

/** Form submit inside Mitt konto. Returns true when handled. */
export function handleSubmit(f, view) {
  if (f.matches('.hh-name-form')) {
    const v = f.querySelector('input').value;
    saveProfile({ display_name: v }, view).then(() => view.el.querySelector('#hh-name')?.focus());
    return true;
  }
  return false;
}
