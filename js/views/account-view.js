/**
 * Mitt konto (#konto). ChatGPT-style layout on desktop: a narrow left rail with
 * section links and the account block pinned to the bottom-left (opens a small
 * menu with Medlem sedan, senast inloggad, inloggningssätt, Logga ut). The main
 * area lists what the app stores: statuses, ratings, own spice mixes, theme,
 * Inköpslista and a Data section. Works logged out (local data only).
 */
import * as UserState from '../core/user-recipe-state.js?v=20261021g17';
import { menuExtrasHtml, themeSegHtml, bindThemeSeg } from './menu-items.js?v=20261021g17';
import { onAuthChange, onSyncStatus, syncStatus, lastSyncTime, signOut, currentUser, isAvailable } from '../core/sync.js?v=20261021g17';
import { openSignIn } from './auth-ui.js?v=20261021g17';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g17';
import { kitchenProfile, setKitchen, MAX_OVEN_TRAYS } from '../core/kitchen-prefs.js?v=20261021g17';
import * as Journal from '../core/recipe-journal.js?v=20261021g17';
import { agoLabel, fmtCookDate, timesLabel } from './recipe-status-ui.js?v=20261021g17';
import { ringHtml, challengePace } from './journal-ui.js?v=20261021g17';
import * as Household from '../core/household.js?v=20261021g17';
import * as HouseholdUI from './household-ui.js?v=20261021g17';
import { feedSectionBody, handleFeedClick } from './feed-ui.js?v=20261021g17';

const LOCAL_KEYS = [
  'jesse.recipeState.v1', 'yessy.spiceMixMissing.v1', 'jesse-theme',
  'recipeApp.state.v3', 'yessy.pantryExcluded.v1', 'yessy.spicesOwned.v1', 'yessy.prefsMeta.v1', 'yessy.photoAvailability.v1',
  'yessy.kitchen.v1', 'yessy.weekPlanSettings.v1', 'yessy.weekPlan.v1', ...Object.values(Journal.JOURNAL_KEYS),
];
/** Quick-create suggestions for Mina listor. */
const LIST_IDEAS = ['Vardag', 'Gästmiddag', 'Matlåda'];
const DEFAULT_GOAL = 30;
/** "Laga igen?": rated 4–5 and last cooked at least this many days ago. */
const AGAIN_DAYS = 60;

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
    window.addEventListener('kitchenchange', rerender);
    window.addEventListener('householdchange', () => {
      if (!this.active) return;
      HouseholdUI.ensureInvitePreview(this);
      if (!this._typingInAccount()) this.render();
    });
    window.addEventListener('journalchange', (e) => { if (!(e.detail && e.detail.key === 'recipeNotes')) rerender(); });
    /** Lists whose recipes are shown / which list is being renamed (kept across re-renders). */
    this.openLists = new Set();
    this.renaming = null;
    // "Ändra" links (Utrustning → Ditt kök) jump to a section once #konto is shown
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-acc-target]');
      if (a) this._pendingTarget = a.getAttribute('data-acc-target');
    }, true); // capture: the overview dialog stops click propagation
    this._bind();
  }

  show() {
    this.active = true; this.menuOpen = false; this.render();
    const target = this._pendingTarget;
    this._pendingTarget = null;
    if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'auto', block: 'start' }), 60);
  }
  hide() { this.active = false; }

  /** #join/CODE or #friend/CODE: show the invite on top of Mitt konto. */
  showInvite(kind, code) {
    HouseholdUI.openInvite(kind, code);
    this.show();
    HouseholdUI.ensureInvitePreview(this);
  }

  /** The rail is re-rendered on toggle; replay the outline→filled transition on the new circle. */
  _animateCircle() {
    const b = this.el.querySelector('.acc-me-btn');
    if (!b) return;
    b.setAttribute('aria-expanded', String(!this.menuOpen));
    void b.offsetWidth;
    b.setAttribute('aria-expanded', String(this.menuOpen));
  }

  _bind() {
    bindThemeSeg(this.el, () => this.render());
    this.el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('.acc-signin')) { openSignIn(); return; }
      const tray = t.closest('[data-kitchen-trays]');
      if (tray) {
        const k = kitchenProfile();
        const next = Math.max(1, Math.min(MAX_OVEN_TRAYS, k.ovenTrays + Number(tray.getAttribute('data-kitchen-trays'))));
        if (next !== k.ovenTrays) setKitchen({ ovenTrays: next });
        this.el.querySelector(`[data-kitchen-trays="${tray.getAttribute('data-kitchen-trays')}"]`)?.focus();
        return;
      }
      const fan = t.closest('[data-kitchen-fan]');
      if (fan) {
        const on = fan.getAttribute('data-kitchen-fan') === '1';
        if (on !== kitchenProfile().ovenFan) setKitchen({ ovenFan: on });
        this.el.querySelector(`[data-kitchen-fan="${on ? 1 : 0}"]`)?.focus();
        return;
      }
      if (this._journalClick(t)) return;
      if (HouseholdUI.handleClick(t, this)) return;
      if (handleFeedClick(t)) return;
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
    this.el.addEventListener('submit', (e) => {
      const f = e.target;
      if (HouseholdUI.handleSubmit(f, this)) { e.preventDefault(); return; }
      if (f.matches('.ls-new')) {
        e.preventDefault();
        const input = f.querySelector('input[type="text"]');
        const priv = f.querySelector('[data-ls-private-new]');
        const l = Journal.createList(input.value, [], { private: !!(priv && priv.checked) });
        if (!l) { input.focus(); return; }
        this.openLists.add(l.id);
        this._focus('.ls-new input');
      } else if (f.matches('.ls-rename')) {
        e.preventDefault();
        const id = f.getAttribute('data-list');
        const v = f.querySelector('input').value;
        this.renaming = null;
        if (v.trim()) Journal.renameList(id, v);
        this.render();
        this._focus(`[data-ls-rename="${CSS.escape(id)}"]`);
      }
    });
    this.el.addEventListener('change', (e) => {
      const t = e.target;
      if (HouseholdUI.handleChange(t, this)) return;
      if (t.matches('[data-ch-scope]')) { Journal.setChallengeScope(new Date().getFullYear(), t.checked ? 'household' : 'mine'); this._focus('[data-ch-scope]'); return; }
      if (t.matches('.ch-goal-input')) {
        const v = Math.round(Number(t.value));
        if (Number.isFinite(v) && v >= 1) Journal.setChallengeGoal(new Date().getFullYear(), v);
        else this.render();
        this._focus('.ch-goal-input');
      }
    });
    this.el.addEventListener('toggle', (e) => {
      const d = e.target;
      if (!d.matches || !d.matches('.ls-item')) return;
      const id = d.getAttribute('data-list');
      if (d.open) this.openLists.add(id); else this.openLists.delete(id);
    }, true);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.renaming && e.target.closest('.ls-rename')) {
        const id = this.renaming; this.renaming = null; this.render(); this._focus(`[data-ls-rename="${CSS.escape(id)}"]`); return;
      }
      if (e.key === 'Escape' && this.menuOpen) { this.menuOpen = false; this.render(); this.el.querySelector('.acc-me-btn')?.focus(); }
    });
  }

  _focus(sel) { const el = this.el.querySelector(sel); if (el) el.focus(); }

  /** Don't re-render under the user's fingers while they type in a field. */
  _typingInAccount() {
    const a = document.activeElement;
    return !!(a && this.el.contains(a) && (a.matches('input[type="text"], input:not([type]), textarea') && a.value !== a.defaultValue));
  }

  /** Clicks for challenge, lists and Inte för oss. Returns true when handled. */
  _journalClick(t) {
    const year = new Date().getFullYear();
    if (t.closest('[data-ch-start]')) { Journal.setChallengeGoal(year, DEFAULT_GOAL); this._focus('.ch-goal-input'); return true; }
    const step = t.closest('[data-ch-step]');
    if (step) {
      const g = Journal.challengeGoal(year) || DEFAULT_GOAL;
      Journal.setChallengeGoal(year, g + Number(step.getAttribute('data-ch-step')));
      this._focus(`[data-ch-step="${step.getAttribute('data-ch-step')}"]`);
      return true;
    }
    if (t.closest('[data-ch-clear]')) {
      if (window.confirm(`Ta bort målet för ${year}? Din logg finns kvar.`)) { Journal.setChallengeGoal(year, null); this._focus('[data-ch-start]'); }
      return true;
    }
    const idea = t.closest('[data-ls-idea]');
    if (idea) { const l = Journal.createList(idea.getAttribute('data-ls-idea')); if (l) this.openLists.add(l.id); this._focus('.ls-new input'); return true; }
    const ren = t.closest('[data-ls-rename]');
    if (ren) { this.renaming = ren.getAttribute('data-ls-rename'); this.render(); const i = this.el.querySelector('.ls-rename input'); if (i) { i.focus(); i.select(); } return true; }
    const del = t.closest('[data-ls-delete]');
    if (del) {
      const l = Journal.getList(del.getAttribute('data-ls-delete'));
      if (l && window.confirm(`Ta bort listan ”${l.name}”? Recepten finns kvar.`)) Journal.deleteList(l.id);
      return true;
    }
    const vis = t.closest('[data-ls-private]');
    if (vis) { const id = vis.getAttribute('data-ls-private'); Journal.setListPrivate(id, vis.getAttribute('data-on') === '1'); this._focus(`[data-ls-private="${CSS.escape(id)}"]`); return true; }
    const out = t.closest('[data-ls-out]');
    if (out) { Journal.setInList(out.getAttribute('data-ls-out'), out.getAttribute('data-recipe'), false); return true; }
    const nfu = t.closest('[data-nfu-undo]');
    if (nfu) { Journal.setNotForUs(nfu.getAttribute('data-nfu-undo'), false); return true; }
    return false;
  }

  _challengeHtml() {
    const year = new Date().getFullYear();
    const goal = Journal.challengeGoal(year);
    const done = Journal.recipesCookedIn(year);
    if (!goal) {
      return `<p class="acc-empty">Sätt ett mål för hur många olika recept du vill laga i år. Varje recept du loggar som lagat räknas, en gång per recept.</p>
        <button type="button" class="acc-btn acc-btn-primary ch-start" data-ch-start>Laga ${DEFAULT_GOAL} olika recept ${year}</button>
        ${done.length ? `<p class="acc-hint">Du har redan lagat ${done.length} olika recept i år.</p>` : ''}`;
    }
    const n = done.length;
    const pace = challengePace(n, goal);
    const icon = n >= goal ? '★' : pace.diff > 0 ? '▲' : pace.diff < 0 ? '▼' : '●';
    const pct = Math.min(100, Math.round((n / goal) * 100));
    const left = Math.max(0, goal - n);
    return `<div class="ch-wrap">
        <div class="ch-ring-wrap" role="img" aria-label="${n} av ${goal} recept">${ringHtml(n, goal)}
          <div class="ch-ring-text" aria-hidden="true"><span class="ch-num">${n}</span><span class="ch-of">av ${goal}</span></div></div>
        <div class="ch-info">
          <p class="ch-title">Laga ${goal} olika recept ${year}</p>
          <p class="ch-pace"><span class="ch-pace-icon" aria-hidden="true">${icon}</span>${escapeHtml(pace.text)}</p>
          <p class="ch-sub">${pct} % klart${left ? ` · ${left} kvar` : ''}</p>
          <div class="ch-edit">
            <span class="ch-edit-label" id="ch-goal-label">Mål</span>
            <div class="portion-controls kitchen-stepper ch-stepper" role="group" aria-labelledby="ch-goal-label">
              <button type="button" data-ch-step="-1" aria-label="Lägre mål" ${goal <= 1 ? 'disabled' : ''}>−</button>
              <input type="number" class="ch-goal-input" min="1" max="${Journal.MAX_GOAL}" value="${goal}" aria-label="Antal recept i år">
              <button type="button" data-ch-step="1" aria-label="Högre mål" ${goal >= Journal.MAX_GOAL ? 'disabled' : ''}>+</button>
            </div>
            <button type="button" class="acc-link-btn" data-ch-clear>Ta bort mål</button>
          </div>
          ${Household.isShared() ? `<label class="hh-check ch-scope"><input type="checkbox" data-ch-scope ${Journal.challengeScope(year) === 'household' ? 'checked' : ''}> Räkna hela hushållets lagningar</label>` : ''}
        </div>
      </div>
      ${n ? `<details class="ch-done"><summary>Lagade i år (${n})</summary><ul class="acc-list">${done.map((id) => this._recipeLink(id, (() => { const st = Journal.cookStats(id); return st.count > 1 ? `<span class="acc-meta" title="Lagad ${timesLabel(st.count)}">${st.count}×</span>` : ''; })())).join('')}</ul></details>` : ''}`;
  }

  _listsHtml() {
    const all = Journal.lists();
    const ideas = LIST_IDEAS.filter((n) => !all.some((l) => l.name.toLowerCase() === n.toLowerCase()));
    const signedIn = Household.isTables();
    const form = `<form class="ls-new"><input type="text" maxlength="${Journal.MAX_LIST_NAME}" placeholder="Ny lista" aria-label="Namn på ny lista" autocomplete="off"><button type="submit" class="acc-btn">Skapa</button>${signedIn ? '<label class="hh-check ls-private-new"><input type="checkbox" data-ls-private-new> 🔒 Bara för mig</label>' : ''}</form>
      ${ideas.length ? `<div class="ls-ideas">${ideas.map((n) => `<button type="button" class="ls-idea" data-ls-idea="${escapeAttr(n)}">+ ${escapeHtml(n)}</button>`).join('')}</div>` : ''}`;
    if (!all.length) {
      return `<p class="acc-empty">Samla recept i egna listor, till exempel Vardag, Gästmiddag eller Matlåda. Lägg till recept från ▾ bredvid ”Vill laga” i översikten. Listorna blir filter i receptlistan.</p>${form}`;
    }
    const items = all.map((l) => {
      const recipes = l.recipeIds.filter((id) => this.byId[id]);
      const head = this.renaming === l.id
        ? `<form class="ls-rename" data-list="${escapeAttr(l.id)}"><input type="text" value="${escapeAttr(l.name)}" maxlength="${Journal.MAX_LIST_NAME}" aria-label="Nytt namn"><button type="submit" class="acc-btn">Spara</button></form>`
        : `<summary><span class="ls-name">${Journal.isPrivateList(l) ? '<span class="ls-lock" title="Bara för mig">🔒</span> ' : ''}${escapeHtml(l.name)}</span>${this._listOwnerHtml(l)}<span class="acc-count">${recipes.length}</span></summary>`;
      const body = recipes.length
        ? `<ul class="acc-list">${recipes.map((id) => this._recipeLink(id, `<button type="button" class="acc-link-btn" data-ls-out="${escapeAttr(l.id)}" data-recipe="${escapeAttr(id)}" aria-label="Ta bort ${escapeAttr(this.byId[id].name)} från ${escapeAttr(l.name)}">Ta bort</button>`)).join('')}</ul>`
        : '<p class="acc-empty">Tom lista. Lägg till recept från ▾ i översikten.</p>';
      const priv = Journal.isPrivateList(l);
      const visBtn = signedIn && Journal.canChangeVisibility(l)
        ? `<button type="button" class="acc-link-btn" data-ls-private="${escapeAttr(l.id)}" data-on="${priv ? 0 : 1}">${priv ? 'Dela med hushållet' : '🔒 Gör till Bara för mig'}</button>` : '';
      const actions = `<div class="ls-actions"><button type="button" class="acc-link-btn" data-ls-rename="${escapeAttr(l.id)}">Byt namn</button>${visBtn}<button type="button" class="acc-link-btn" data-ls-delete="${escapeAttr(l.id)}">Ta bort lista</button></div>`;
      if (this.renaming === l.id) return `<div class="ls-item is-renaming">${head}</div>`;
      return `<details class="ls-item" data-list="${escapeAttr(l.id)}"${this.openLists.has(l.id) ? ' open' : ''}>${head}<div class="ls-body">${body}${actions}</div></details>`;
    }).join('');
    return `<div class="ls-lists">${items}</div>${form}`;
  }

  /** "av Anna" on lists someone else in the household made. */
  _listOwnerHtml(l) {
    if (!Household.isShared() || !l.owner || l.owner === Household.myId()) return '';
    return `<span class="ls-owner">${Household.avatarHtml(l.owner, 'hh-av-sm')}${escapeHtml(Household.nameOf(l.owner))}</span>`;
  }

  /** Tema: Ljust / Mörkt / System (System follows the device). */
  _themeHtml() {
    return `
      <div class="kitchen-row theme-row">
        <div class="kitchen-text" id="theme-label"><span class="kitchen-label">Tema</span>
          <span class="kitchen-help">System följer enhetens inställning.</span></div>
        ${themeSegHtml('theme-label')}
      </div>`;
  }

  /** Ditt kök: how many plåtar the oven takes at once, and varmluft ja/nej. */
  _kitchenHtml() {
    const k = kitchenProfile();
    const t = k.ovenTrays;
    return `
      <h3 class="acc-sub">Ditt kök</h3>
      <div class="kitchen-row">
        <div class="kitchen-text" id="kitchen-trays-label"><span class="kitchen-label">Plåtar i ugnen samtidigt</span>
          <span class="kitchen-help">Så många plåtar eller formar som blir bra på en gång. Fler än så tillagas efter varandra.</span></div>
        <div class="portion-controls kitchen-stepper" role="group" aria-labelledby="kitchen-trays-label">
          <button type="button" data-kitchen-trays="-1" aria-label="Färre plåtar" ${t <= 1 ? 'disabled' : ''}>−</button>
          <span class="kitchen-value" aria-live="polite">${t} ${t === 1 ? 'plåt' : 'plåtar'}</span>
          <button type="button" data-kitchen-trays="1" aria-label="Fler plåtar" ${t >= MAX_OVEN_TRAYS ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <div class="kitchen-row">
        <div class="kitchen-text" id="kitchen-fan-label"><span class="kitchen-label">Varmluft</span>
          <span class="kitchen-help">Oftast 20 grader lägre än vanlig ugn.</span></div>
        <div class="kitchen-seg" role="group" aria-labelledby="kitchen-fan-label">
          <button type="button" data-kitchen-fan="1" aria-pressed="${k.ovenFan}">Ja</button>
          <button type="button" data-kitchen-fan="0" aria-pressed="${!k.ovenFan}">Nej</button>
        </div>
      </div>`;
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
    const prof = Household.profile();
    const initial = prof && prof.avatar_emoji ? prof.avatar_emoji
      : ((prof && prof.display_name) || user.email || '?').trim().charAt(0).toUpperCase();
    const av = avatar && !(prof && prof.avatar_emoji)
      ? `<img class="acc-avatar" src="${escapeAttr(avatar)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="acc-avatar acc-initial${prof && prof.avatar_emoji ? ' is-emoji' : ''}" aria-hidden="true">${escapeHtml(initial)}</span>`;
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
        <span class="acc-me-text"><span class="acc-me-name" title="${escapeAttr(user.email || '')}">${escapeHtml((prof && prof.display_name) || user.email || '')}</span>
        <span class="acc-me-sub">${dot}${SYNC_LABEL[status]}</span></span>
        <span class="acc-me-caret" aria-hidden="true">⋯</span>
      </button>
    </div>`;
  }

  render() {
    const user = currentUser();
    const shared = Household.isShared();
    const where = user ? 'Synkas med ditt konto' : 'Bara på den här enheten';
    const hhName = shared && Household.household() ? Household.household().name : '';
    const whereShared = shared ? `👥 Delas med ${hhName || 'hushållet'}` : where;
    const whereMine = shared ? '🔒 Bara du' : where;
    const whereRatings = shared ? 'Dina, syns för hushållet' : where;

    // Statuses + ratings from the user's own state
    const groups = { want: [], cooked: [] };
    const ratings = [];
    for (const c of this.catalog) {
      const { status, rating } = UserState.get(c.id);
      if (status && groups[status]) groups[status].push({ id: c.id, rating, name: c.name });
      if (rating) ratings.push({ id: c.id, rating, name: c.name });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const stats = Journal.cookStatsAll();
    const cookMeta = (id) => {
      const st = stats.get(id);
      return st && st.count > 1 ? `<span class="acc-meta" title="Lagad ${timesLabel(st.count)}, senast ${escapeAttr(fmtCookDate(st.last))}">${st.count}×</span>` : '';
    };
    const list = (arr, empty, meta = false) => arr.length
      ? `<ul class="acc-list${arr.length > 10 ? ' is-long' : ''}">${arr.map(r => this._recipeLink(r.id, `<span class="acc-right">${meta ? cookMeta(r.id) : ''}${starsHtml(r.rating)}</span>`)).join('')}</ul>`
      : `<p class="acc-empty">${empty}</p>`;
    // Laga igen?: rated 4–5, last cooked AGAIN_DAYS+ days ago, longest ago first
    const cutoff = Journal.todayIso(new Date(Date.now() - AGAIN_DAYS * 864e5));
    const again = ratings.filter(r => r.rating >= 4 && stats.get(r.id) && stats.get(r.id).last <= cutoff)
      .sort((a, b) => stats.get(a.id).last.localeCompare(stats.get(b.id).last));
    const nfuIds = [...Journal.notForUsIds()].filter(id => this.byId[id])
      .sort((a, b) => this.byId[a].name.localeCompare(this.byId[b].name, 'sv'));
    const myLists = Journal.lists();
    const year = new Date().getFullYear();
    const goal = Journal.challengeGoal(year);

    const avg = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;
    const dist = [5, 4, 3, 2, 1].map(n => ({ n, count: ratings.filter(r => r.rating === n).length }));
    const maxCount = Math.max(1, ...dist.map(d => d.count));
    const top = [...ratings].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'sv')).slice(0, 5);

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
      ...(user ? [['profil', 'Profil', null], ['hushall', 'Hushåll', shared ? Household.members().length : null]] : []),
      ...(user && Household.isTables() ? [['koket', 'Senast i köket', null]] : []),
      ['utmaning', 'Årets matutmaning', goal ? `${Journal.recipesCookedIn(year).length}/${goal}` : null],
      ['vill', 'Vill laga', groups.want.length],
      ['lagade', 'Lagade', groups.cooked.length], ['betyg', 'Dina betyg', ratings.length],
      ...(again.length ? [['igen', 'Laga igen?', again.length]] : []),
      ['listor', 'Mina listor', myLists.length], ['inte', 'Inte för oss', nfuIds.length],
      ['skap', 'Kryddor, skafferi och vecka', null], ['installningar', 'Inställningar', null],
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
          ${HouseholdUI.invitePanelHtml()}
          ${user ? section('profil', 'Profil', null, HouseholdUI.profileSectionBody()) : ''}
          ${user ? section('hushall', 'Hushåll', shared ? Household.members().length : null, HouseholdUI.householdSectionBody()) : ''}
          ${user && Household.isTables() ? section('koket', 'Senast i köket', null, feedSectionBody((id) => (this.byId[id] || {}).name || ''), shared ? '👥 Hushållet' : '') : ''}
          ${section('utmaning', `Årets matutmaning ${year}`, null, this._challengeHtml(), whereMine)}
          ${section('vill', 'Vill laga', groups.want.length, list(groups.want, 'Markera recept med ”Vill laga” så hamnar de här.'), whereShared)}
          ${section('lagade', 'Lagade', groups.cooked.length, list(groups.cooked, 'Inga lagade recept än. Tryck ”Klart! Logga som lagad” när du lagat klart, så sparas datumet här.', true), whereShared)}
          ${section('betyg', 'Dina betyg', ratings.length, ratings.length ? `
            <div class="acc-ratings">
              <div class="acc-avg"><span class="acc-avg-num">${avg.toFixed(1).replace('.', ',')}</span><span class="acc-avg-sub">snitt av ${ratings.length} betyg</span></div>
              <ul class="acc-dist">${dist.map(d => `<li><span class="acc-dist-label">${d.n} ★</span><span class="acc-bar"><span style="width:${(d.count / maxCount) * 100}%"></span></span><span class="acc-dist-n">${d.count}</span></li>`).join('')}</ul>
            </div>
            <h3 class="acc-sub">Högst betygsatta</h3>
            <ul class="acc-list">${top.map(r => this._recipeLink(r.id, starsHtml(r.rating))).join('')}</ul>` : '<p class="acc-empty">Du har inte satt några betyg än.</p>', whereRatings)}
          ${again.length ? section('igen', 'Laga igen?', again.length, `<p class="acc-note">Recept du gett 4–5 ★ men inte lagat på minst ${AGAIN_DAYS} dagar.</p>
            <ul class="acc-list">${again.map(r => this._recipeLink(r.id, `<span class="acc-right"><span class="acc-meta" title="Senast lagad ${escapeAttr(fmtCookDate(stats.get(r.id).last))}">${escapeHtml(agoLabel(stats.get(r.id).last))}</span>${starsHtml(r.rating)}</span>`)).join('')}</ul>`, where) : ''}
          ${section('listor', shared ? 'Listor' : 'Mina listor', myLists.length, this._listsHtml(), shared ? '👥 Delas, utom 🔒 Bara för mig' : where)}
          ${section('inte', 'Inte för oss', nfuIds.length, nfuIds.length
            ? `<p class="acc-note">De här visas inte i receptlistan.</p><ul class="acc-list">${nfuIds.map(id => this._recipeLink(id, `<button type="button" class="acc-link-btn" data-nfu-undo="${escapeAttr(id)}" aria-label="Ångra Inte för oss för ${escapeAttr(this.byId[id].name)}">Ångra</button>`)).join('')}</ul>`
            : '<p class="acc-empty">Välj ”Inte för oss” i ▾-menyn i översikten för recept ni inte vill se. De döljs i receptlistan och du kan ångra här.</p>', whereShared)}
          ${section('skap', 'Kryddor, skafferi och vecka', null, `
            <div class="acc-links">
              <a class="acc-link-card" href="#kryddor"><span class="acc-link-title">🧂 Kryddskåpet</span><span class="acc-link-desc">Tryck på kryddorna du har hemma och se vilka kryddmixar du kan blanda själv.</span></a>
              <a class="acc-link-card" href="#skafferi"><span class="acc-link-title">🪦 Skafferiet</span><span class="acc-link-desc">Tryck på ingredienser du inte tål så tar vi bort recepten med dem.</span></a>
              <a class="acc-link-card" href="#vecka"><span class="acc-link-title">📅 Veckoplaneraren</span><span class="acc-link-desc">Få veckans recept, ett per kategori. Byt, lås och lägg allt i inköpslistan.</span></a>
            </div>`)}
          ${section('installningar', 'Inställningar', null, `${this._themeHtml()}
            ${this._kitchenHtml()}`, where)}
          ${section('inkopslista', 'Inköpslista', shopRows.length, shopRows.length
            ? `<ul class="acc-list">${shopRows.join('')}</ul>`
            : '<p class="acc-empty">Inköpslistan är tom. Kryssa i recept i receptlistan.</p>', where)}
          ${section('data', 'Data', null, `
            <ul class="acc-data">
              <li><strong>I den här webbläsaren</strong> (localStorage): statusar, betyg, datum du lagat recepten, anteckningar, listor, Inte för oss, årets mål, kryddval, skafferiet, veckoplaneraren (kategorier och veckans recept), tema, ditt kök, inköpslista och var du är i matlagningen.</li>
              <li><strong>${user ? 'På ditt konto' : 'Med ett konto'}</strong>: allt ovan utom matlagningens bockar synkas${user ? '' : ' när du loggar in'}. Anteckningar är privata och syns bara för dig.</li>
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
