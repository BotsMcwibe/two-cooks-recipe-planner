/**
 * Receptinkorgen (#inkorg): tipsa om ett recept genom att klistra in en länk, och
 * se "Mina inskick" med status (Ny / Granskad / Tillagd / Avvisad / Spärrad).
 * Unreviewed links are shown as plain text only; once a recipe is added the row
 * links to the in-app översikt (#overview/<id>), and duplicates link to the
 * recipe that already exists. Signed out: a sign-in prompt instead of the form.
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261113g26';
import { onAuthChange, currentUser, isAvailable } from '../core/sync.js?v=20261113g26';
import { openSignIn } from './auth-ui.js?v=20261113g26';
import * as Inbox from '../core/recipe-inbox.js?v=20261113g26';
import { checkRecipeUrl, displayUrl, URL_REASON_SV, NOTE_MAX } from '../core/recipe-url.js?v=20261113g26';

/** Icon + word for every status (never colour alone). */
export const STATUS_SV = {
  new: { icon: '🕓', label: 'Ny', hint: 'Väntar på granskning i morgon bitti.' },
  reviewed: { icon: '🔎', label: 'Granskad', hint: 'Granskad, väntar på beslut om receptet ska läggas in.' },
  added: { icon: '✓', label: 'Tillagd', hint: '' },
  rejected: { icon: '✕', label: 'Avvisad', hint: '' },
  blocked: { icon: '⛔', label: 'Spärrad', hint: 'Spärrad som skräp.' },
};
const SUGGESTION_SV = {
  import: 'Förslag: lägg in receptet',
  skip: 'Förslag: hoppa över',
  needs_data: 'Behöver kompletteras innan det kan läggas in',
  wrong_site: 'Den här sajten stöds inte än',
  spam: 'Inte ett recept',
};
const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
const fmt = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? dateFmt.format(d) : ''; };

export class InboxView {
  /** @param {HTMLElement} el @param {{ catalog: Array<object> }} deps */
  constructor(el, { catalog }) {
    this.el = el;
    this.byId = Object.fromEntries((catalog || []).map((c) => [c.id, c]));
    this.active = false;
    this.flash = null; // row id to highlight once
    this.msg = null; // { kind: 'ok'|'error', text }
    this.draft = { url: '', note: '' };
    window.addEventListener('recipeinboxchange', () => { if (this.active) this._renderList(); });
    onAuthChange(() => { if (this.active) { this.render(); Inbox.refresh(); } });
    this._bind();
  }

  show() {
    this.active = true;
    this.render();
    Inbox.refresh();
  }
  hide() { this.active = false; }

  _recipeLink(id) {
    const c = this.byId[id];
    const name = c ? c.name : id;
    return `<a class="ink-recipe-link" href="#overview/${encodeURIComponent(id)}">${escapeHtml(name)}</a>`;
  }

  render() {
    const user = currentUser();
    const form = user ? `
      <section class="ink-card" aria-labelledby="ink-h-form">
        <h2 id="ink-h-form">Tipsa om ett recept</h2>
        <form class="ink-form" novalidate>
          <label class="hh-label" for="ink-url">Länk till receptet</label>
          <input id="ink-url" class="hh-input ink-input" type="url" inputmode="url" autocomplete="off" spellcheck="false"
            placeholder="https://www.ica.se/recept/…" maxlength="2000" value="${escapeAttr(this.draft.url)}" aria-describedby="ink-url-err">
          <p class="ink-field-err" id="ink-url-err" hidden></p>
          <label class="hh-label" for="ink-note">Anteckning <span class="ink-opt">(valfri)</span></label>
          <textarea id="ink-note" class="hh-input ink-input ink-note-input" rows="2" maxlength="${NOTE_MAX}"
            placeholder="T.ex. ”Testa med kyckling i stället för fläsk”">${escapeHtml(this.draft.note)}</textarea>
          <div class="ink-form-foot">
            <span class="ink-counter" aria-live="polite">${[...this.draft.note].length}/${NOTE_MAX}</span>
            <button type="submit" class="acc-btn acc-btn-primary ink-send">Skicka till inkorgen</button>
          </div>
          <p class="ink-msg${this.msg ? ` is-${this.msg.kind}` : ''}" role="${this.msg && this.msg.kind === 'error' ? 'alert' : 'status'}"${this.msg ? '' : ' hidden'}>${this.msg ? `<span aria-hidden="true">${this.msg.kind === 'error' ? '⚠️' : '✓'}</span> ${escapeHtml(this.msg.text)}` : ''}</p>
        </form>
        <p class="acc-hint">Länkarna granskas varje morgon. Bara du ser dina inskick, och länken visas som text tills receptet är tillagt.</p>
      </section>` : `
      <section class="ink-card ink-signin" aria-labelledby="ink-h-signin">
        <h2 id="ink-h-signin">Logga in för att tipsa om recept</h2>
        <p class="acc-empty">Med ett konto kan du klistra in länkar till recept du hittat. Vi granskar dem och lägger in de som passar, direkt på din Vill laga-lista. Dina inskick syns bara för dig.</p>
        ${isAvailable() ? '<button type="button" class="acc-btn acc-btn-primary ink-signin-btn">Logga in med e-postlänk</button>' : '<p class="acc-hint">Inloggning är inte tillgänglig just nu.</p>'}
      </section>`;

    this.el.innerHTML = `
      <div class="spice-page ink-page">
        <div class="spice-head">
          <h1>Receptinkorgen</h1>
          <p class="spice-lede">Hittat ett recept på nätet? Klistra in länken. Bra recept läggs in i Yessy och hamnar på er Vill laga-lista.</p>
        </div>
        ${form}
        ${user ? '<section class="ink-card ink-list-card" aria-labelledby="ink-h-list"></section>' : ''}
      </div>`;
    this._renderList();
  }

  _renderList() {
    const box = this.el.querySelector('.ink-list-card');
    if (!box) return;
    const list = Inbox.items();
    const err = Inbox.loadError();
    let body;
    if (!Inbox.isLoaded() && err) body = `<p class="acc-empty">${escapeHtml(Inbox.ERROR_SV[err] || Inbox.ERROR_SV.unknown)}</p>`;
    else if (!Inbox.isLoaded()) body = '<p class="acc-empty">Hämtar dina inskick…</p>';
    else if (!list.length) body = '<p class="acc-empty">Inga inskick än. Klistra in en länk ovan så dyker den upp här.</p>';
    else body = `<ul class="ink-list">${list.map((r) => this._rowHtml(r)).join('')}</ul>`;
    box.innerHTML = `
      <div class="spice-card-head"><h2 id="ink-h-list">Mina inskick${Inbox.isLoaded() && list.length ? ` <span class="acc-count">${list.length}</span>` : ''}</h2></div>
      ${body}`;
    if (this.flash) {
      const row = box.querySelector(`[data-ink-id="${CSS.escape(this.flash)}"]`);
      if (row) { row.classList.add('is-flash'); row.scrollIntoView({ block: 'nearest' }); }
      this.flash = null;
    }
  }

  _rowHtml(r) {
    const st = STATUS_SV[r.status] || STATUS_SV.new;
    const accepted = r.status === 'added';
    // Before acceptance the raw URL is plain text only (no href), never a link.
    const url = accepted && /^https:\/\//i.test(r.url)
      ? `<a class="ink-url" href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">${escapeHtml(displayUrl(r.url))}</a>`
      : `<span class="ink-url ink-url-text" title="${escapeAttr(r.url)}">${escapeHtml(displayUrl(r.url))}</span>`;
    let outcome = '';
    if (accepted && r.recipe_id) outcome = `<p class="ink-outcome">Tillagd i Yessy och på Vill laga: ${this._recipeLink(r.recipe_id)}</p>`;
    else if (r.suggestion === 'duplicate' && r.duplicate_of) outcome = `<p class="ink-outcome">Receptet finns redan i Yessy: ${this._recipeLink(r.duplicate_of)}</p>`;
    else if (r.status === 'reviewed' && r.suggestion && SUGGESTION_SV[r.suggestion]) outcome = `<p class="ink-outcome">${escapeHtml(SUGGESTION_SV[r.suggestion])}</p>`;
    else if (st.hint) outcome = `<p class="ink-outcome ink-muted">${escapeHtml(st.hint)}</p>`;
    const notes = r.review_notes ? `<div class="ink-review"><span class="ink-review-h">Granskning${r.reviewed_at ? ` ${escapeHtml(fmt(r.reviewed_at))}` : ''}</span><p>${escapeHtml(r.review_notes)}</p></div>` : '';
    return `
      <li class="ink-item is-${escapeAttr(r.status)}" data-ink-id="${escapeAttr(r.id)}">
        <div class="ink-item-top">
          <span class="ink-badge is-${escapeAttr(r.status)}"><span aria-hidden="true">${st.icon}</span> ${st.label}</span>
          <span class="ink-date">Skickad ${escapeHtml(fmt(r.created_at))}</span>
        </div>
        ${url}
        ${r.note ? `<p class="ink-note">”${escapeHtml(r.note)}”</p>` : ''}
        ${outcome}
        ${notes}
        ${r.status === 'new' ? `<div class="ink-actions"><button type="button" class="acc-link-btn ink-withdraw" data-ink-withdraw="${escapeAttr(r.id)}" aria-label="Ta bort länken ${escapeAttr(displayUrl(r.url, 40))}">Ta bort</button></div>` : ''}
      </li>`;
  }

  _setMsg(kind, text) {
    this.msg = kind ? { kind, text } : null;
    const p = this.el.querySelector('.ink-msg');
    if (!p) return;
    p.hidden = !kind;
    p.className = `ink-msg${kind ? ` is-${kind}` : ''}`;
    p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    p.innerHTML = kind ? `<span aria-hidden="true">${kind === 'error' ? '⚠️' : '✓'}</span> ${escapeHtml(text)}` : '';
  }

  _fieldErr(text) {
    const p = this.el.querySelector('#ink-url-err');
    const input = this.el.querySelector('#ink-url');
    if (!p || !input) return;
    p.hidden = !text;
    p.textContent = text ? `⚠️ ${text}` : '';
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  _bind() {
    this.el.addEventListener('click', async (e) => {
      if (e.target.closest('.ink-signin-btn')) { openSignIn(); return; }
      const w = e.target.closest('[data-ink-withdraw]');
      if (w) {
        w.disabled = true;
        const ok = await Inbox.withdraw(w.getAttribute('data-ink-withdraw'));
        if (!ok) { w.disabled = false; this._setMsg('error', 'Kunde inte ta bort länken. Försök igen.'); }
      }
    });
    this.el.addEventListener('input', (e) => {
      if (e.target.id === 'ink-url') {
        this.draft.url = e.target.value;
        if (e.target.getAttribute('aria-invalid') === 'true') {
          const c = checkRecipeUrl(e.target.value);
          this._fieldErr(c.ok ? '' : URL_REASON_SV[c.reason]);
        }
      } else if (e.target.id === 'ink-note') {
        this.draft.note = e.target.value;
        const n = this.el.querySelector('.ink-counter');
        if (n) n.textContent = `${[...e.target.value].length}/${NOTE_MAX}`;
      }
    });
    this.el.addEventListener('focusout', (e) => {
      if (e.target.id !== 'ink-url' || !e.target.value.trim()) return;
      const c = checkRecipeUrl(e.target.value);
      this._fieldErr(c.ok ? '' : URL_REASON_SV[c.reason]);
    });
    this.el.addEventListener('submit', async (e) => {
      if (!e.target.closest('.ink-form')) return;
      e.preventDefault();
      const input = this.el.querySelector('#ink-url');
      const note = this.el.querySelector('#ink-note');
      const btn = this.el.querySelector('.ink-send');
      const c = checkRecipeUrl(input.value);
      if (!c.ok) { this._fieldErr(URL_REASON_SV[c.reason]); this._setMsg(null); input.focus(); return; }
      this._fieldErr('');
      btn.disabled = true;
      btn.textContent = 'Skickar…';
      const res = await Inbox.submit(input.value, note.value);
      btn.disabled = false;
      btn.textContent = 'Skicka till inkorgen';
      if (!res.ok) {
        if (['empty', 'length', 'chars', 'https', 'host', 'userinfo', 'port', 'ip', 'local', 'invalid_url'].includes(res.error)) this._fieldErr(res.message);
        else this._setMsg('error', res.message);
        return;
      }
      this.flash = res.id;
      if (res.created) {
        this.draft = { url: '', note: '' };
        input.value = ''; note.value = '';
        const n = this.el.querySelector('.ink-counter');
        if (n) n.textContent = `0/${NOTE_MAX}`;
        this._setMsg('ok', 'Tack! Länken ligger i din inkorg och granskas i morgon bitti.');
      } else {
        this._setMsg('ok', 'Du har redan skickat den länken. Den finns i listan nedan.');
      }
      this._renderList();
    });
  }
}
