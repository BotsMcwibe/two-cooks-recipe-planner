/**
 * Header account button + small popover.
 * Logged out: email field → magic link. Logged in: avatar/initial, email, "Logga ut".
 * Hidden entirely if Supabase could not be loaded (app stays local-only).
 */
import { onAuthChange, signInWithEmail, signOut, isAvailable, syncStatus, onSyncStatus } from '../core/sync.js?v=20261021g5';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g5';
import { accountLinkHtml, menuExtrasHtml } from './menu-items.js?v=20261021g5';

const USER_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20.2c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></g></svg>';

export function initAuthUi(root) {
  if (!root) return;
  const btn = root.querySelector('.auth-btn');
  const pop = root.querySelector('.auth-pop');
  let user = null;
  let sent = null;

  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    render();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    pop.querySelector('input, button')?.focus();
  };

  function renderButton() {
    root.hidden = false;
    if (user) {
      const meta = user.user_metadata || {};
      const avatar = meta.avatar_url || meta.picture;
      const initial = (user.email || '?').trim().charAt(0).toUpperCase();
      btn.innerHTML = avatar
        ? `<img class="auth-avatar" src="${escapeAttr(avatar)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="auth-avatar auth-initial" aria-hidden="true">${escapeHtml(initial)}</span>`;
      btn.insertAdjacentHTML('beforeend', `<span class="acc-status-dot is-${syncStatus()}" aria-hidden="true"></span>`);
      btn.setAttribute('aria-label', `Konto: ${user.email || ''}`);
      btn.title = user.email || 'Konto';
      btn.classList.add('is-signed-in');
    } else {
      btn.innerHTML = USER_SVG;
      btn.setAttribute('aria-label', isAvailable() ? 'Logga in, Kryddskåpet och Skafferiet' : 'Meny');
      btn.title = isAvailable() ? 'Logga in' : 'Meny';
      btn.classList.remove('is-signed-in');
    }
  }

  function render() {
    if (user) {
      pop.innerHTML = `
        <p class="auth-email" title="${escapeAttr(user.email || '')}">${escapeHtml(user.email || '')}</p>
        <p class="auth-note">Dina recept, betyg och val synkas mellan enheter.</p>
        <div class="menu-rows">
          ${accountLinkHtml()}
          ${menuExtrasHtml()}
          <button type="button" class="auth-action auth-logout">Logga ut</button>
        </div>`;
    } else if (sent) {
      pop.innerHTML = `
        <p class="auth-title">Kolla din mejl</p>
        <p class="auth-note">Vi skickade en inloggningslänk till <strong>${escapeHtml(sent)}</strong>. Öppna den på den här enheten.</p>
        <button type="button" class="auth-action auth-again">Använd en annan adress</button>
        <div class="menu-rows menu-rows-sep">${menuExtrasHtml()}</div>`;
    } else if (!isAvailable()) {
      pop.innerHTML = `<div class="menu-rows">${menuExtrasHtml()}</div>`;
    } else {
      pop.innerHTML = `
        <form class="auth-form" novalidate>
          <p class="auth-title">Logga in</p>
          <p class="auth-note">Få en inloggningslänk på mejlen. Utan konto sparas allt bara i den här webbläsaren.</p>
          <label class="visually-hidden" for="auth-email">E-post</label>
          <input id="auth-email" class="auth-input" type="email" inputmode="email" autocomplete="email" placeholder="din@mejl.se" required>
          <button type="submit" class="auth-action auth-send">Skicka länk</button>
          <p class="auth-error" role="alert" hidden></p>
        </form>
        <div class="menu-rows menu-rows-sep">${menuExtrasHtml()}</div>`;
    }
  }

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  // Close on navigation (Mitt konto, Kryddskåpet, or any route change)
  window.addEventListener('hashchange', close);
  document.addEventListener('click', (e) => { if (!pop.hidden && e.target.isConnected && !root.contains(e.target)) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });

  pop.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = pop.querySelector('.auth-input');
    const err = pop.querySelector('.auth-error');
    const send = pop.querySelector('.auth-send');
    const email = (input.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = 'Skriv en giltig e-postadress.';
      err.hidden = false;
      input.focus();
      return;
    }
    send.disabled = true;
    send.textContent = 'Skickar…';
    try {
      await signInWithEmail(email);
      sent = email;
      render();
      pop.querySelector('button')?.focus();
    } catch (ex) {
      err.textContent = `Kunde inte skicka länken: ${ex.message || ex}`;
      err.hidden = false;
      send.disabled = false;
      send.textContent = 'Skicka länk';
    }
  });
  pop.addEventListener('click', async (e) => {
    if (e.target.closest('.auth-account-link, .menu-spice-link, .menu-pantry-link')) {
      close();
    } else if (e.target.closest('.auth-logout')) {
      await signOut();
      close();
    } else if (e.target.closest('.auth-again')) {
      sent = null;
      render();
      pop.querySelector('input')?.focus();
    }
  });

  onSyncStatus?.((st) => {
    const d = btn.querySelector('.acc-status-dot');
    if (d) d.className = `acc-status-dot is-${st || syncStatus()}`;
  });
  onAuthChange((u) => {
    user = u;
    if (u) sent = null;
    renderButton();
    if (!pop.hidden) render();
  });
}

/** Open the header sign-in popover (used by the account page's logged-out prompt). */
export function openSignIn() {
  const btn = document.querySelector('#auth .auth-btn');
  const pop = document.querySelector('#auth .auth-pop');
  if (!btn || !pop) return false;
  // Defer so the click that triggered this doesn't reach the outside-click closer
  setTimeout(() => { if (pop.hidden) btn.click(); }, 0);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}
