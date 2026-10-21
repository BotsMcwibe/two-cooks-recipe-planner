/**
 * Journal UI pieces outside the status control: private notes (översikt + cook
 * banner), the "Klart! Logga som lagad" block at the end of the cook page and the
 * yearly challenge ring (Mitt konto).
 */
import * as Journal from '../core/recipe-journal.js?v=20261021g11';
import * as UserState from '../core/user-recipe-state.js?v=20261021g11';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g11';
import { timesLabel } from './recipe-status-ui.js?v=20261021g11';

// ---------------------------------------------------------------------------
// Mina anteckningar
// ---------------------------------------------------------------------------
export function notesHtml(id) {
  if (!id) return '';
  const text = Journal.noteText(id);
  return `<details class="nt-notes" data-id="${escapeAttr(id)}"${text ? ' open' : ''}>
    <summary><span class="nt-title"><span aria-hidden="true">📝</span> Mina anteckningar</span><span class="nt-status" aria-live="polite"></span></summary>
    <textarea class="nt-text" rows="3" maxlength="4000" placeholder="T.ex. dubbla vitlöken, 5 min kortare i ugnen" aria-label="Mina anteckningar">${escapeHtml(text)}</textarea>
    <p class="nt-hint">Bara du ser dina anteckningar. De sparas automatiskt och visas när du lagar receptet.</p>
  </details>`;
}

/** Autosave notes typed inside $root (debounced, flushed on blur). */
export function bindNotes($root) {
  const timers = new Map();
  const save = (ta) => {
    const box = ta.closest('.nt-notes');
    if (!box) return;
    const id = box.getAttribute('data-id');
    clearTimeout(timers.get(id));
    timers.delete(id);
    Journal.setNote(id, ta.value);
    const st = box.querySelector('.nt-status');
    if (st) st.textContent = 'Sparat';
  };
  $root.on('input', '.nt-text', (e) => {
    const ta = e.currentTarget;
    const box = ta.closest('.nt-notes');
    const id = box.getAttribute('data-id');
    const st = box.querySelector('.nt-status');
    if (st) st.textContent = 'Sparar…';
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => save(ta), 600));
  });
  $root.on('blur', '.nt-text', (e) => save(e.currentTarget));
  // A note changed on another device / tab: update the box unless the user is typing in it
  window.addEventListener('journalchange', (e) => {
    if (e.detail && e.detail.key !== 'recipeNotes') return;
    $root.find('.nt-notes').each((_, box) => {
      const ta = box.querySelector('.nt-text');
      if (!ta || ta === document.activeElement || timers.has(box.getAttribute('data-id'))) return;
      const v = Journal.noteText(box.getAttribute('data-id'));
      if (ta.value !== v) ta.value = v;
    });
  });
}

// ---------------------------------------------------------------------------
// Cook page: note banner + "Klart! Logga som lagad"
// ---------------------------------------------------------------------------
let lastLogged = null; // { recipeId, entryId, prevStatus } for Ångra

export function cookNoteHtml(id) {
  const text = Journal.noteText(id);
  if (!text) return '';
  return `<div class="cook-note" role="note"><span class="cook-note-icon" aria-hidden="true">📝</span><div class="cook-note-body"><strong>Min anteckning</strong><p>${escapeHtml(text)}</p></div></div>`;
}

export function cookFinishHtml(id) {
  if (!id) return '';
  const entries = Journal.cookEntries(id);
  const today = Journal.todayIso();
  const loggedToday = entries.some((e) => e.date === today);
  const stats = entries.length ? `<span class="cook-finish-stats">Lagad ${timesLabel(entries.length)}</span>` : '';
  if (loggedToday) {
    const undo = lastLogged && lastLogged.recipeId === id ? '<button type="button" class="cook-finish-undo">Ångra</button>' : '';
    return `<div class="cook-finish is-done"><p class="cook-finish-title"><span class="cook-finish-check" aria-hidden="true">✓</span> Loggad som lagad i dag</p>${stats}${undo}</div>`;
  }
  return `<div class="cook-finish"><button type="button" class="btn-primary cook-finish-btn">Klart! Logga som lagad</button>${stats || '<span class="cook-finish-stats">Sparar dagens datum i din logg och markerar receptet som Lagad.</span>'}</div>`;
}

/** Render the note banner + finish block for the cook page. */
export function renderCookExtras(id, { cooks = 1 } = {}) {
  const note = document.getElementById('cook-note');
  const fin = document.getElementById('cook-finish');
  if (note) { const h = id ? cookNoteHtml(id) : ''; note.innerHTML = h; note.hidden = !h; }
  if (fin) {
    fin.innerHTML = cookFinishHtml(id);
    fin.dataset.id = id || '';
    fin.dataset.cooks = String(cooks);
  }
}

let cookBound = false;
export function bindCookExtras() {
  if (cookBound) return;
  cookBound = true;
  document.addEventListener('click', (e) => {
    const fin = e.target.closest && e.target.closest('#cook-finish');
    if (!fin) return;
    const id = fin.dataset.id;
    if (!id) return;
    if (e.target.closest('.cook-finish-btn')) {
      const prevStatus = UserState.get(id).status;
      const cooks = Number(fin.dataset.cooks) === 2 ? 2 : 1;
      UserState.setStatus(id, 'cooked');
      const entry = Journal.ensureCookToday(id, { cooks });
      lastLogged = entry ? { recipeId: id, entryId: entry.id, prevStatus } : null;
      renderCookExtras(id, { cooks });
      fin.querySelector('.cook-finish-undo, .cook-finish-title')?.focus?.();
    } else if (e.target.closest('.cook-finish-undo') && lastLogged && lastLogged.recipeId === id) {
      Journal.removeCook(lastLogged.entryId);
      UserState.setStatus(id, lastLogged.prevStatus);
      lastLogged = null;
      renderCookExtras(id, { cooks: Number(fin.dataset.cooks) || 1 });
      fin.querySelector('.cook-finish-btn')?.focus();
    }
  });
  const rerender = () => {
    const fin = document.getElementById('cook-finish');
    if (fin && fin.dataset.id) renderCookExtras(fin.dataset.id, { cooks: Number(fin.dataset.cooks) || 1 });
  };
  window.addEventListener('journalchange', rerender);
}

// ---------------------------------------------------------------------------
// Årets matutmaning
// ---------------------------------------------------------------------------
/** Progress ring (SVG). Shape + numbers carry the meaning; one colour, no red/green. */
export function ringHtml(done, goal, size = 112) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const frac = goal ? Math.min(1, done / goal) : 0;
  return `<svg class="ch-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ch-ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="10"/>
    <circle class="ch-ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"${frac === 0 ? ' stroke-opacity="0"' : ''}/>
  </svg>`;
}

/** { expected, diff, text } for done/goal at `date` (pace = goal spread evenly over the year). */
export function challengePace(done, goal, date = new Date()) {
  const y = date.getFullYear();
  const start = new Date(y, 0, 1);
  const days = (new Date(y + 1, 0, 1) - start) / 864e5;
  const day = Math.floor((date - start) / 864e5) + 1;
  const expected = Math.floor((goal * day) / days);
  const diff = done - expected;
  const n = (k) => `${k} ${k === 1 ? 'recept' : 'recept'}`;
  let text;
  if (done >= goal) text = 'Målet är nått! Allt nu är bonus.';
  else if (diff > 0) text = `${n(diff)} före schemat`;
  else if (diff < 0) text = `${n(-diff)} efter schemat`;
  else text = 'Precis enligt schemat';
  return { expected, diff, text };
}
