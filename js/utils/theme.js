/**
 * Light/dark theme toggle.
 * The initial theme is applied by an inline script in <head> (before first paint):
 * a saved choice in localStorage wins, otherwise prefers-color-scheme.
 */
import { touchPref } from '../core/prefs-meta.js?v=20261021g9';

export const THEME_KEY = 'jesse-theme';
const THEME_COLORS = { light: '#f4f5f7', dark: '#111418' };

const SUN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/></svg>';

function readSaved() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

export function initThemeToggle(button) {
  const render = () => {
    if (!button) return;
    const dark = currentTheme() === 'dark';
    // Show the theme you switch TO.
    button.innerHTML = dark ? SUN_SVG : MOON_SVG;
    const label = dark ? 'Byt till ljust läge' : 'Byt till mörkt läge';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  applyTheme(readSaved() || systemTheme());
  render();
  button?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    touchPref('theme');
    applyTheme(next);
    render();
  });
  window.addEventListener('yessy:themechange', render);
  // Follow OS changes until the user has made an explicit choice.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (readSaved()) return;
    applyTheme(systemTheme());
    render();
  });
}

/** Menu choice: 'light' | 'dark' | 'system' (no saved choice). */
export function themeChoice() {
  return readSaved() || 'system';
}

/** Set from the menu switch; 'system' clears the saved choice and follows the OS. */
export function setThemeChoice(choice) {
  try {
    if (choice === 'light' || choice === 'dark') localStorage.setItem(THEME_KEY, choice);
    else localStorage.removeItem(THEME_KEY);
  } catch { /* private mode */ }
  touchPref('theme');
  applyTheme(choice === 'light' || choice === 'dark' ? choice : systemTheme());
  window.dispatchEvent(new CustomEvent('yessy:themechange'));
}

/** Saved theme choice ('light' | 'dark' | null) for sync. */
export function savedTheme() {
  return readSaved();
}

/** Apply a theme coming from sync (not marked as a local change). */
export function applySyncedTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent('yessy:themechange'));
}
