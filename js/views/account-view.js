/**
 * Mitt konto (#konto). ChatGPT-style layout on desktop: a narrow left rail with
 * section links and the account block pinned to the bottom-left (opens a small
 * menu with Medlem sedan, senast inloggad, inloggningssätt, Logga ut). The main
 * area lists what the app stores: statuses, ratings, own spice mixes, theme,
 * Inköpslista and a Data section. Works logged out (local data only).
 */
import * as UserState from '../core/user-recipe-state.js?v=20261013b';
import { missingMixes } from '../core/spice-prefs.js?v=20261013a';
import { savedTheme } from '../utils/theme.js?v=20261013b';
import { menuExtrasHtml, bindMenuExtras } from './menu-items.js?v=20261013a';
import { onAuthChange, onSyncStatus, syncStatus, lastSyncTime, signOut, currentUser, isAvailable } from '../core/sync.js?v=20261013d';
import { openSignIn } from './auth-ui.js?v=20261013d';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';

const LOCAL_KEYS = [
  'jesse.recipeState.v1', 'yessy.spiceMixMissing.v1', 'jesse-theme',
  'recipeApp.state.v3', 'yessy.prefsMeta.v1', 'yessy.photoAvailability.v1',
];

const SYNC_LABEL = {
  local: 'Bara på den här enheten',
  synced: 'Synkad',
  offline: 'Offline – synkas när du är online igen',
  pending: 'Väntar på att synka',
};

const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? dateFmt.format(d) : '–'; };
const fmtDateTime = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? dateTimeFmt.format(d) : '–'; };
const METHOD = { email: 'E-postlänk', google: 'Google', github: 'GitHub', apple: 'Apple' };

function starsHtml(n) {
  if (!n) return '';
  return `<span class="acc-stars" aria-label="${n} av 5">${'★'.repeat(n)}<span class="acc-stars-off">${'★'.repeat(5 - n)}</span></span>`;
}

export class AccountView {
  /**
   * @param {HTMLElement} el
   * @param {{ state: object, catalog: Array<object>, mixNames: Record<string,string> }} deps
   */
  constructor(el, { state, catalog, mixNames }) {
    this.el = el;
    this.state = state;
    this.catalog = catalog;
    this.byId = Object.fromEntries(catalog.map(c => [c.id, c]));
    this.mixNames = mixNames || {};
    this.active = false;
    this.menuOpen = false;
    const rerender = () => { if (this.active) this.render(); };
    onAuthChange(rerender);
    onSyncStatus(rerender);
    UserState.subscribe(rerender);
    state.on('shoppingChange', rerender);
    window.addEventListener('spicemixchange', rerender);
    window.addEventListener('yessy:themechange', rerender);
    window.addEventListener('yessy:prefchange', rerender);
    this._bind();
  }

  show() { this.active = true; this.menuOpen = false; this.render(); }
  hide() { this.active = false; }

  /** The rail is re-rendered on toggle; replay the outline→filled transition on the new circle. */
  _animateCircle() {
    const b = this.el.querySelector('.acc-me-btn');
    if (!b) return;
    b.setAttribute('aria-expanded', String(!this.menuOpen));
    void b.offsetWidth;
    b.setAttribute('aria-expanded', String(this.menuOpen));
  }

  _bind() {
    bindMenuExtras(this.el, () => this.render());
    this.el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('.acc-signin')) { openSignIn(); return; }
      if (t.closest('.acc-me-btn')) { this.menuOpen = !this.menuOpen; this.render(); this._animateCircle(); this.el.querySelector(this.menuOpen ? '.acc-menu button, .acc-menu a' : '.acc-me-btn')?.focus(); return; }
      if (t.closest('.acc-logout')) { await signOut(); this.menuOpen = false; this.render(); return; }
      if (t.closest('.acc-clear')) {
        const user = currentUser();
        const msg = user
          ? 'Rensa all data i den här webbläsaren? Det som redan är synkat finns kvar på ditt konto och hämtas igen.'
          : 'Rensa all data i den här webbläsaren? Statusar, betyg, kryddval och inköpslistan försvinner och kan inte återställas.';
        if (!window.confirm(msg)) return;
        for (const k of LOCAL_KEYS) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
        location.hash = '#konto';
        location.reload();
        return;
      }
      if (this.menuOpen && t.isConnected && !t.closest('.acc-me')) { this.menuOpen = false; this.render(); }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.menuOpen) { this.menuOpen = false; this.render(); this.el.querySelector('.acc-me-btn')?.focus(); }
    });
  }

  _recipeLink(id, extra = '') {
    const c = this.byId[id];
    const name = c ? c.name : id;
    return `<li class="acc-recipe"><a href="#overview/${encodeURIComponent(id)}">${escapeHtml(name)}</a>${extra}</li>`;
  }

  _identityHtml(user) {
    const status = syncStatus();
    const dot = `<span class="acc-sync-dot is-${status}" aria-hidden="true"></span>`;
    if (!user) {
      return `<div class="acc-me is-guest">
        <div class="acc-me-row">
          <span class="acc-avatar acc-initial" aria-hidden="true">?</span>
          <span class="acc-me-text"><span class="acc-me-name">Inte inloggad</span>
          <span class="acc-me-sub">${dot}${SYNC_LABEL.local}</span></span>
        </div>
        ${isAvailable() ? '<button type="button" class="acc-btn acc-btn-primary acc-signin">Logga in</button>' : ''}
        <div class="menu-rows acc-guest-extras">${menuExtrasHtml()}</div>
      </div>`;
    }
    const meta = user.user_metadata || {};
    const avatar = meta.avatar_url || meta.picture;
    const initial = (user.email || '?').trim().charAt(0).toUpperCase();
    const av = avatar
      ? `<img class="acc-avatar" src="${escapeAttr(avatar)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="acc-avatar acc-initial" aria-hidden="true">${escapeHtml(initial)}</span>`;
    const provider = (user.app_metadata && user.app_metadata.provider) || 'email';
    const last = lastSyncTime();
    const menu = this.menuOpen ? `
      <div class="acc-menu" role="menu">
        <dl class="acc-facts">
          <div><dt>Konto</dt><dd class="acc-facts-email">${escapeHtml(user.email || '')}</dd></div>
          <div><dt>Medlem sedan</dt><dd>${fmtDate(user.created_at)}</dd></div>
          <div><dt>Senast inloggad</dt><dd>${fmtDateTime(user.last_sign_in_at)}</dd></div>
          <div><dt>Inloggning</dt><dd>${escapeHtml(METHOD[provider] || provider)}</dd></div>
          <div><dt>Synk</dt><dd>${SYNC_LABEL[status]}${last && status === 'synced' ? ` · ${fmtDateTime(last)}` : ''}</dd></div>
        </dl>
        <div class="menu-rows">${menuExtrasHtml()}</div>
        <button type="button" class="acc-btn acc-logout" role="menuitem">Logga ut</button>
      </div>` : '';
    return `<div class="acc-me">
      ${menu}
      <button type="button" class="acc-me-btn" aria-haspopup="menu" aria-expanded="${this.menuOpen}">
        <span class="acc-avatar-wrap">${av}<span class="acc-status-dot is-${status}" aria-hidden="true"></span></span>
        <span class="acc-me-text"><span class="acc-me-name" title="${escapeAttr(user.email || '')}">${escapeHtml(user.email || '')}</span>
        <span class="acc-me-sub">${dot}${SYNC_LABEL[status]}</span></span>
        <span class="acc-me-caret" aria-hidden="true">⋯</span>
      </button>
    </div>`;
  }

  render() {
    const user = currentUser();
    const where = user ? 'Synkas med ditt konto' : 'Bara på den här enheten';

    // Statuses + ratings from the user's own state
    const groups = { cooking: [], want: [], cooked: [] };
    const ratings = [];
    for (const c of this.catalog) {
      const { status, rating } = UserState.get(c.id);
      if (status && groups[status]) groups[status].push({ id: c.id, rating, name: c.name });
      if (rating) ratings.push({ id: c.id, rating, name: c.name });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const list = (arr, empty) => arr.length
      ? `<ul class="acc-list${arr.length > 10 ? ' is-long' : ''}">${arr.map(r => this._recipeLink(r.id, starsHtml(r.rating))).join('')}</ul>`
      : `<p class="acc-empty">${empty}</p>`;

    const avg = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;
    const dist = [5, 4, 3, 2, 1].map(n => ({ n, count: ratings.filter(r => r.rating === n).length }));
    const maxCount = Math.max(1, ...dist.map(d => d.count));
    const top = [...ratings].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'sv')).slice(0, 5);

    const mixes = [...missingMixes()].map(id => this.mixNames[id] || id).sort((a, b) => a.localeCompare(b, 'sv'));
    const theme = savedTheme();
    const themeLabel = theme === 'dark' ? 'Mörkt' : theme === 'light' ? 'Ljust' : 'Följer systemet';
    const shop = this.state.getShoppingData();
    const shopRows = shop.selections.filter(id => this.byId[id]).map(id => {
      const c = this.byId[id];
      const p = c.scalable === false ? '' : `<span class="acc-meta">${shop.portions[id] || c.basePortions || 4} port.</span>`;
      return this._recipeLink(id, p);
    });

    const section = (id, title, count, body, note = '') => `
      <section class="acc-section" id="acc-${id}" aria-labelledby="acc-h-${id}">
        <div class="acc-section-head"><h2 id="acc-h-${id}">${title}${count != null ? ` <span class="acc-count">${count}</span>` : ''}</h2>${note ? `<span class="acc-where">${note}</span>` : ''}</div>
        ${body}
      </section>`;

    const nav = [
      ['lagar', 'Lagar nu', groups.cooking.length], ['vill', 'Vill laga', groups.want.length],
      ['lagade', 'Lagade', groups.cooked.length], ['betyg', 'Dina betyg', ratings.length],
      ['kryddmixar', 'Kryddmixar', mixes.length], ['installningar', 'Inställningar', null],
      ['inkopslista', 'Inköpslista', shopRows.length], ['data', 'Data', null],
    ];

    this.el.innerHTML = `
      <div class="acc-layout">
        <aside class="acc-rail" aria-label="Konto">
          <p class="acc-rail-title">Mitt konto</p>
          <nav class="acc-nav">${nav.map(([id, label, n]) => `<a href="#konto" data-target="acc-${id}">${label}${n != null ? `<span class="acc-nav-count">${n}</span>` : ''}</a>`).join('')}</nav>
          ${this._identityHtml(user)}
        </aside>
        <div class="acc-main">
          <div class="acc-head">
            <h1>Mitt konto</h1>
            <p class="acc-lede">${user ? 'Dina recept, betyg och val, synkade mellan dina enheter.' : 'Du är inte inloggad. Allt nedan sparas bara i den här webbläsaren. Logga in för att få det på alla dina enheter.'}</p>
            ${!user && isAvailable() ? '<button type="button" class="acc-btn acc-btn-primary acc-signin acc-signin-hero">Logga in med e-postlänk</button>' : ''}
          </div>
          ${section('lagar', 'Lagar nu', groups.cooking.length, list(groups.cooking, 'Inget på spisen just nu.'), where)}
          ${section('vill', 'Vill laga', groups.want.length, list(groups.want, 'Markera recept med ”Vill laga” så hamnar de här.'), where)}
          ${section('lagade', 'Lagade', groups.cooked.length, list(groups.cooked, 'Inga lagade recept än.'), where)}
          ${section('betyg', 'Dina betyg', ratings.length, ratings.length ? `
            <div class="acc-ratings">
              <div class="acc-avg"><span class="acc-avg-num">${avg.toFixed(1).replace('.', ',')}</span><span class="acc-avg-sub">snitt av ${ratings.length} betyg</span></div>
              <ul class="acc-dist">${dist.map(d => `<li><span class="acc-dist-label">${d.n} ★</span><span class="acc-bar"><span style="width:${(d.count / maxCount) * 100}%"></span></span><span class="acc-dist-n">${d.count}</span></li>`).join('')}</ul>
            </div>
            <h3 class="acc-sub">Högst betygsatta</h3>
            <ul class="acc-list">${top.map(r => this._recipeLink(r.id, starsHtml(r.rating))).join('')}</ul>` : '<p class="acc-empty">Du har inte satt några betyg än.</p>', where)}
          ${section('kryddmixar', 'Kryddmixar du blandar själv', mixes.length, mixes.length
            ? `<ul class="acc-chips">${mixes.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul><p class="acc-hint">Slå av och på med ”Har inte mixen” i ett recept.</p>`
            : '<p class="acc-empty">Du använder färdiga mixar. Välj ”Har inte mixen” i ett recept för att blanda själv.</p>', where)}
          ${section('installningar', 'Inställningar', null, `<dl class="acc-kv"><div><dt>Tema</dt><dd>${themeLabel}</dd></div></dl>`, where)}
          ${section('inkopslista', 'Inköpslista', shopRows.length, shopRows.length
            ? `<ul class="acc-list">${shopRows.join('')}</ul>`
            : '<p class="acc-empty">Inköpslistan är tom. Kryssa i recept i receptlistan.</p>', where)}
          ${section('data', 'Data', null, `
            <ul class="acc-data">
              <li><strong>I den här webbläsaren</strong> (localStorage): statusar, betyg, kryddval, tema, inköpslista och var du är i matlagningen.</li>
              <li><strong>${user ? 'På ditt konto' : 'Med ett konto'}</strong>: statusar och betyg, kryddval, tema och inköpslista synkas${user ? '' : ' när du loggar in'}. Matlagningens bockar stannar på enheten.</li>
            </ul>
            <button type="button" class="acc-btn acc-btn-danger acc-clear">Rensa lokal data</button>`)}
        </div>
      </div>`;

    for (const a of this.el.querySelectorAll('.acc-nav a')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }
}
