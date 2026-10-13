/**
 * Shared account-menu rows: Kryddskåpet + Skafferiet links + Tema switch (Ljust / Mörkt / System).
 * Used by the header account popover and the #konto rail menu.
 */
import { themeChoice, setThemeChoice } from '../utils/theme.js?v=20261013b';

const SPICE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><rect x="6.5" y="2.8" width="11" height="3.6" rx="1"/><path d="M7.2 6.4h9.6l.9 2.4v10.6a1.8 1.8 0 0 1-1.8 1.8H8.1a1.8 1.8 0 0 1-1.8-1.8V8.8z"/><path d="M6.3 11.5h11.4M6.3 17h11.4"/></g></svg>';
const PANTRY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><rect x="3.5" y="3" width="17" height="18" rx="1.8"/><path d="M3.5 12h17M12 3v18M9.5 7.5v1.5M14.5 7.5v1.5M9.5 15v1.5M14.5 15v1.5"/></g></svg>';
const USER_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20.2c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></g></svg>';
const THEME_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
const CHOICES = [['light', 'Ljust'], ['dark', 'Mörkt'], ['system', 'System']];

const onRoute = (prefix) => (location.hash || '').startsWith(prefix);

export function accountLinkHtml(cls = '') {
  const cur = onRoute('#konto');
  return `<a class="menu-row menu-row-primary auth-account-link ${cls}" href="#konto"${cur ? ' aria-current="page"' : ''}>${USER_SVG}<span>Mitt konto</span></a>`;
}

export function menuExtrasHtml() {
  const cur = onRoute('#kryddor');
  const curP = onRoute('#skafferi');
  const choice = themeChoice();
  const seg = CHOICES.map(([v, l]) => `<button type="button" class="theme-seg-btn${choice === v ? ' is-on' : ''}" data-theme-choice="${v}" aria-pressed="${choice === v}">${l}</button>`).join('');
  return `<a class="menu-row menu-spice-link${cur ? ' is-active' : ''}" href="#kryddor"${cur ? ' aria-current="page"' : ''}>${SPICE_SVG}<span>Kryddskåpet</span></a>
    <a class="menu-row menu-pantry-link${curP ? ' is-active' : ''}" href="#skafferi"${curP ? ' aria-current="page"' : ''}>${PANTRY_SVG}<span>Skafferiet</span></a>
    <div class="menu-theme" role="group" aria-label="Tema"><span class="menu-theme-label">${THEME_SVG}<span>Tema</span></span><div class="theme-seg">${seg}</div></div>`;
}

/** Delegated handler for the theme switch inside root; re-renders via rerender(). */
export function bindMenuExtras(root, rerender) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-choice]');
    if (!b || !root.contains(b)) return;
    e.preventDefault();
    setThemeChoice(b.getAttribute('data-theme-choice'));
    rerender?.();
    root.querySelector(`[data-theme-choice="${b.getAttribute('data-theme-choice')}"]`)?.focus();
  });
}
