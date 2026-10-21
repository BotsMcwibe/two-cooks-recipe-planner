/**
 * Veckoplaneraren (#vecka): picks recipes for the week, by default one per
 * category (Kyckling, Fläsk, Skaldjur, Snabbt). Snabbt and the other non-protein
 * categories prefer a protein the week doesn't have yet, for variety. Categories are the
 * browse filter categories (catalog-ui.js categoryChips). Per recipe: Byt,
 * Lås, Översikt and portions; Slumpa om rerolls every unlocked pick and
 * "Lägg allt i inköpslistan" uses the shopping selection + portions API.
 *
 * Slots fill from Vill laga first. Rerolls (Slumpa om, Byt) pick from the
 * chosen source: 'Inte lagade än' (default) or 'Redan lagade' (status Lagad or
 * a cook-log entry), Vill laga first within it, the whole pool if it's empty.
 * Picks respect Skafferiet (buried ingredients), "Inte för oss" and, by default,
 * only Godkända recipes; no duplicates, and recipes cooked in the last 14 days
 * are only used when nothing else is left. Protein/other categories pick main
 * courses (no breakfast, dessert or sides) unless the category itself is a meal.
 * Settings + picks live in core/week-plan.js (localStorage + Supabase prefs).
 */
import { categoryChips, isMainCourse, escapeAttr, escapeHtml, recipeVisual, isScalable, difficultyLabel } from '../utils/catalog-ui.js?v=20261021g16';
import * as WeekPlan from '../core/week-plan.js?v=20261021g16';
import * as UserState from '../core/user-recipe-state.js?v=20261021g16';
import * as Journal from '../core/recipe-journal.js?v=20261021g16';
import { excludedPantry, loadPantry } from '../core/pantry-exclude.js?v=20261021g16';
import { isPhotoMissing, imgFailed } from '../utils/photo-fallback.js?v=20261021g16';

const RECENT_DAYS = 14;
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></g></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8"/></g></svg>';
const SHUFFLE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3.5c2 0 3.2.9 4.3 2.6l2.4 4.8c1.1 1.7 2.3 2.6 4.3 2.6H20"/><path d="M4 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4c.8-.9 1.8-1.4 3.2-1.4H20"/><path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/></g></svg>';
const SWAP_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></g></svg>';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const recipesWord = (n) => (n === 1 ? 'recept' : 'recept');

export class WeekView {
  /**
   * @param {HTMLElement} container
   * @param {{ state: import('../core/state.js').AppState, catalog: object[], onOpenOverview: (id: string) => void }} opts
   */
  constructor(container, { state, catalog, onOpenOverview }) {
    this.el = container;
    this.state = state;
    this.catalog = catalog;
    this.byId = Object.fromEntries(catalog.map((c) => [c.id, c]));
    this.cats = categoryChips(catalog);
    this.catById = Object.fromEntries(this.cats.map((c) => [c.id, c]));
    this.onOpenOverview = onOpenOverview;
    this.pantryById = null;
    this.visible = false;
    this.flash = '';
    this._bind();
    const rerender = () => { if (this.visible) this._renderAll(); };
    window.addEventListener('weekplanchange', rerender);
    window.addEventListener('pantryexcludechange', () => { if (this.visible) this._reconcile(); });
    window.addEventListener('journalchange', (e) => { const k = e.detail && e.detail.key; if (!k || k === 'notForUs') { if (this.visible) this._reconcile(); } });
    state.on('shoppingChange', () => { if (this.visible) this._renderActions(); });
  }

  async render() {
    this.visible = true;
    if (!this.pantryById) {
      try {
        const d = await loadPantry();
        this.pantryById = new Map(d.recipes.map((r) => [r.id, r.pantry]));
      } catch (err) {
        console.warn('[vecka] pantry data', err);
        this.pantryById = new Map();
      }
    }
    if (!this.el.querySelector('.week-page')) {
      this.el.innerHTML = `
        <div class="spice-page week-page">
          <div class="spice-head">
            <h1>Veckoplaneraren</h1>
            <p class="spice-lede">Vi väljer recept till veckan från kategorierna du vill ha. Byt det du inte gillar, lås det du vill behålla och slumpa om resten.</p>
          </div>
          <section class="week-settings" aria-labelledby="week-set-h">
            <h2 id="week-set-h" class="week-h2">Kategorier</h2>
            <ul class="week-cats"></ul>
            <div class="week-add" role="group" aria-label="Lägg till kategori"></div>
            <div class="kitchen-row week-gk-row">
              <div class="kitchen-text" id="week-gk-label"><span class="kitchen-label">Visa även ej godkända</span>
                <span class="kitchen-help">Av: bara recept med Godkänd-stämpeln.</span></div>
              <div class="kitchen-seg week-gk-seg" role="group" aria-labelledby="week-gk-label"></div>
            </div>
          </section>
          <div class="week-actions"></div>
          <div class="week-notes" aria-live="polite"></div>
          <div class="week-groups"></div>
        </div>`;
    }
    this._reconcile();
  }

  hide() { this.visible = false; }

  /** Recipe ids in the plan, in display order (översikt prev/next). */
  pickIds() {
    return WeekPlan.plan().picks.map((p) => p.recipeId).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------
  _recentIds() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
    const iso = Journal.todayIso(cutoff);
    const s = new Set();
    for (const [id, st] of Journal.cookStatsAll()) if (st.last && st.last >= iso) s.add(id);
    return s;
  }

  /** Every recipe allowed in category `catId` under the current settings. */
  _pool(catId, settings) {
    const cat = this.catById[catId];
    if (!cat) return [];
    const excluded = excludedPantry();
    const nfu = Journal.notForUsIds();
    const isMeal = cat.group === 'meal';
    return this.catalog.filter((e) => {
      if (!cat.match(e)) return false;
      if (!isMeal && !isMainCourse(e)) return false;
      if (nfu.has(e.id)) return false;
      if (excluded.size && this.pantryById) { const p = this.pantryById.get(e.id); if (p && p.some((x) => excluded.has(x))) return false; }
      if (settings.godkandOnly) { const m = UserState.catalogMark(e.id); if (!m || !m.tested) return false; }
      return true;
    }).map((e) => e.id);
  }

  /** Protein tags of a recipe ('protein:chicken', …). */
  _proteins(id) {
    const e = this.byId[id];
    return e ? (e.tags || []).filter((t) => t.startsWith('protein:')) : [];
  }

  /** Recipes the user has cooked: status Lagad or any cook-log entry. */
  _cookedIds() {
    const s = new Set(Journal.cookStatsAll().keys());
    for (const e of this.catalog) if (UserState.get(e.id).status === 'cooked') s.add(e.id);
    return s;
  }

  /**
   * Pick one id from pool, skipping `taken`. Order of preference:
   * reroll source (Redan lagade / Inte lagade än, rerolls only; falls back to
   * the whole pool when the source is empty), then Vill laga, then not cooked
   * in the last 14 days. Returns { id, fallback } (fallback: source was empty).
   */
  _pickFrom(pool, taken, ctx, avoid = null, source = null) {
    const free = pool.filter((id) => !taken.has(id) && id !== avoid);
    let fallback = false;
    let base = free;
    if (source) {
      const inSource = free.filter((id) => (source === 'cooked') === ctx.cooked.has(id));
      if (inSource.length) base = inSource; else fallback = true;
    }
    const tiers = [
      base.filter((id) => ctx.want.has(id) && !ctx.recent.has(id)),
      base.filter((id) => ctx.want.has(id)),
      base.filter((id) => !ctx.recent.has(id)),
      base,
    ];
    let list = tiers.find((t) => t.length) || [];
    // Snabbt, Familj, Pasta…: within the chosen tier, prefer a protein the week doesn't have yet
    if (ctx.variety && list.length > 1) {
      const used = new Set();
      for (const t of taken) for (const pt of this._proteins(t)) used.add(pt);
      const fresh = list.filter((id) => !this._proteins(id).some((pt) => used.has(pt)));
      if (fresh.length) list = fresh;
    }
    if (!list.length && avoid && pool.includes(avoid) && !taken.has(avoid)) return { id: avoid, fallback: false }; // nothing else to swap to
    return { id: list.length ? shuffle(list)[0] : null, fallback };
  }

  /**
   * Bring the plan in line with the settings: one slot per category × count,
   * keep valid picks (locked ones always), fill empty or invalid slots.
   * @param {{ reroll?: boolean, rerollSlot?: string }} [opts]
   */
  _reconcile(opts = {}) {
    const settings = WeekPlan.settings();
    const old = WeekPlan.plan();
    const week = WeekPlan.weekKey();
    const newWeek = old.week !== week;
    const bySlot = new Map(old.picks.map((p) => [p.slot, p]));
    const ctx = {
      recent: this._recentIds(),
      cooked: this._cookedIds(),
      want: new Set(this.catalog.filter((e) => UserState.get(e.id).status === 'want').map((e) => e.id)),
    };
    const rerolling = !!(opts.reroll || opts.rerollSlot);
    this.sourceFallback = rerolling ? new Set() : (this.sourceFallback || new Set());
    const pools = {};
    const picks = [];
    const taken = new Set();
    // Slots in display order; first pass keeps what may stay, second fills the rest
    const slots = [];
    for (const c of settings.cats) {
      if (!this.catById[c.id]) continue;
      pools[c.id] = new Set(this._pool(c.id, settings));
      for (let i = 0; i < c.count; i++) slots.push({ slot: `${c.id}#${i}`, cat: c.id });
    }
    for (const s of slots) {
      const prev = bySlot.get(s.slot);
      let keep = null;
      if (prev && prev.recipeId && this.byId[prev.recipeId]) {
        const valid = pools[s.cat].has(prev.recipeId) && !taken.has(prev.recipeId);
        const rerollThis = opts.rerollSlot === s.slot || ((opts.reroll || newWeek) && !prev.locked);
        if (prev.locked && !taken.has(prev.recipeId)) keep = prev;
        else if (valid && !rerollThis) keep = prev;
      }
      if (keep) taken.add(keep.recipeId);
      picks.push({ slot: s.slot, cat: s.cat, recipeId: keep ? keep.recipeId : null, locked: keep ? keep.locked : false, portions: keep ? keep.portions : null, _prev: prev ? prev.recipeId : null });
    }
    for (const p of picks) {
      if (p.recipeId) continue;
      // Byt / Slumpa om: avoid handing back the same recipe when there is another
      const avoid = opts.rerollSlot === p.slot || opts.reroll ? p._prev : null;
      // Rerolls use the chosen source (Redan lagade / Inte lagade än); first fills take any recipe
      const isReroll = opts.reroll || opts.rerollSlot === p.slot;
      const cat = this.catById[p.cat];
      const { id, fallback } = this._pickFrom([...pools[p.cat]], taken, { ...ctx, variety: cat && cat.group === 'other' }, avoid, isReroll ? settings.rerollSource : null);
      if (id) { taken.add(id); p.recipeId = id; }
      if (fallback) { this.sourceFallback.add(p.cat); this.sourceFallbackSrc = settings.rerollSource; }
    }
    const next = { week, picks: picks.map(({ _prev, ...p }) => p) };
    this.shortage = {};
    for (const c of settings.cats) {
      if (!this.catById[c.id]) continue;
      const got = next.picks.filter((p) => p.cat === c.id && p.recipeId).length;
      if (got < c.count) this.shortage[c.id] = { got, want: c.count, pool: pools[c.id].size };
    }
    const same = JSON.stringify(next) === JSON.stringify(old);
    if (!same) WeekPlan.savePlan(next); // fires weekplanchange → _renderAll
    if (same || !this.visible) this._renderAll();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  _renderAll() {
    if (!this.el.querySelector('.week-page')) return;
    const settings = WeekPlan.settings();
    this._renderSettings(settings);
    this._renderActions();
    this._renderNotes(settings);
    this._renderGroups(settings);
  }

  _renderSettings(settings) {
    const rows = settings.cats.filter((c) => this.catById[c.id]).map((c) => {
      const cat = this.catById[c.id];
      const lid = `week-cat-${c.id.replace(/[^a-z0-9]/gi, '-')}`;
      return `<li class="week-cat" data-cat="${escapeAttr(c.id)}">
        <span class="week-cat-name" id="${lid}">${escapeHtml(cat.label)}</span>
        <span class="portion-controls kitchen-stepper week-stepper" role="group" aria-labelledby="${lid}">
          <button type="button" data-count="-1" aria-label="Färre ${escapeAttr(cat.label.toLowerCase())}" ${c.count <= 1 ? 'disabled' : ''}>−</button>
          <span class="week-count" aria-live="polite">${c.count}</span>
          <button type="button" data-count="1" aria-label="Fler ${escapeAttr(cat.label.toLowerCase())}" ${c.count >= WeekPlan.MAX_PER_CAT ? 'disabled' : ''}>+</button>
        </span>
        <button type="button" class="week-cat-remove" data-remove aria-label="Ta bort ${escapeAttr(cat.label)}" title="Ta bort kategori">✕</button>
      </li>`;
    }).join('');
    this.el.querySelector('.week-cats').innerHTML = rows || '<li class="week-empty-cats">Inga kategorier. Lägg till en nedan.</li>';
    const used = new Set(settings.cats.map((c) => c.id));
    const rest = this.cats.filter((c) => !used.has(c.id));
    this.el.querySelector('.week-add').innerHTML = rest.length
      ? `<span class="week-add-label">Lägg till:</span>${rest.map((c) => `<button type="button" class="filter-chip week-add-chip" data-add="${escapeAttr(c.id)}">+ ${escapeHtml(c.label)}</button>`).join('')}`
      : '';
    this.el.querySelector('.week-gk-seg').innerHTML = `
      <button type="button" data-gk="0" aria-pressed="${!settings.godkandOnly}">Ja</button>
      <button type="button" data-gk="1" aria-pressed="${settings.godkandOnly}">Nej</button>`;
  }

  _renderActions() {
    const picks = WeekPlan.plan().picks.filter((p) => p.recipeId);
    const unlocked = picks.filter((p) => !p.locked).length;
    const inList = picks.length && picks.every((p) => this.state.isShoppingRecipeSelected(p.recipeId)
      && this.state.getShoppingPortions(p.recipeId) === this._portions(p));
    const $a = this.el.querySelector('.week-actions');
    if (!$a) return;
    const src = WeekPlan.settings().rerollSource;
    $a.innerHTML = `
      <span class="week-src">
        <span class="week-src-label" id="week-src-label">Slumpa bland</span>
        <span class="kitchen-seg week-src-seg" role="group" aria-labelledby="week-src-label">
          <button type="button" data-src="new" aria-pressed="${src === 'new'}">Inte lagade än</button>
          <button type="button" data-src="cooked" aria-pressed="${src === 'cooked'}">Redan lagade</button>
        </span>
      </span>
      <button type="button" class="acc-btn week-reroll" ${unlocked ? '' : 'disabled'} title="${unlocked ? 'Slumpa om alla olåsta recept' : 'Alla recept är låsta'}">${SHUFFLE_SVG}<span>Slumpa om</span></button>
      <button type="button" class="acc-btn acc-btn-primary week-shop" ${picks.length ? '' : 'disabled'}>${inList ? '✓ Allt finns i inköpslistan' : `Lägg allt i inköpslistan (${picks.length})`}</button>
      ${this.flash ? `<span class="week-flash" role="status">${this.flash}</span>` : ''}`;
  }

  _renderNotes(settings) {
    const notes = [];
    for (const [catId, s] of Object.entries(this.shortage || {})) {
      const label = this.catById[catId].label;
      const what = settings.godkandOnly ? 'godkända ' : '';
      notes.push(s.got === 0
        ? `Det finns inga ${what}recept i ${label} som passar just nu.`
        : `Det finns bara ${s.got} ${what}${recipesWord(s.got)} i ${label}, så du får ${s.got} av ${s.want}.`);
    }
    const srcLabel = this.sourceFallbackSrc === 'cooked' ? 'redan lagade' : 'ej lagade';
    const fb = [...(this.sourceFallback || [])].filter((id) => this.catById[id]).map((id) => this.catById[id].label);
    const fbNote = fb.length ? `<p class="week-note-sub">Inga ${srcLabel} recept kvar i ${fb.join(', ')}, så vi valde bland alla.</p>` : '';
    const anyShort = notes.length > 0;
    const $n = this.el.querySelector('.week-notes');
    if (!anyShort) { $n.innerHTML = fbNote ? `<div class="week-note"><span class="week-note-icon" aria-hidden="true">ℹ︎</span><div>${fbNote}</div></div>` : ''; return; }
    $n.innerHTML = anyShort ? `<div class="week-note"><span class="week-note-icon" aria-hidden="true">ℹ︎</span><div>${notes.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}
      ${settings.godkandOnly ? '<button type="button" class="acc-link-btn week-gk-off">Visa även ej godkända</button>' : '<p class="week-note-sub">Skafferiet och Inte för oss kan också ta bort recept.</p>'}${fbNote}</div></div>` : '';
  }

  _portions(p) {
    const e = this.byId[p.recipeId];
    if (!e) return 4;
    if (!isScalable(e)) return e.basePortions || 4;
    return p.portions || e.basePortions || 4;
  }

  _cardHtml(p, catLabel = '') {
    const e = this.byId[p.recipeId];
    const vis = recipeVisual(e);
    const noPhoto = isPhotoMissing(e.image);
    const media = noPhoto
      ? `<span class="week-ph" aria-hidden="true">${vis.emoji}</span>`
      : `<img src="${escapeAttr(e.image)}" alt="" loading="lazy" decoding="async">`;
    const m = UserState.catalogMark(e.id);
    const gk = m && m.tested ? `<span class="gk-badge week-gk" title="Godkänd"><span class="gk-seal" aria-hidden="true"></span>Godkänd</span>` : '';
    const mins = e.totalMinutes != null ? `<span>${e.totalMinutes} min</span>` : '';
    const diff = e.difficulty ? `<span>${escapeHtml(difficultyLabel(e.difficulty))}</span>` : '';
    const scal = isScalable(e);
    const n = this._portions(p);
    const portions = scal
      ? `<span class="portion-controls kitchen-stepper week-portions" role="group" aria-label="Portioner för ${escapeAttr(e.name)}">
          <button type="button" data-portions="-1" aria-label="Färre portioner" ${n <= 1 ? 'disabled' : ''}>−</button>
          <span class="week-portion-n">${n} port.</span>
          <button type="button" data-portions="1" aria-label="Fler portioner" ${n >= 12 ? 'disabled' : ''}>+</button>
        </span>`
      : `<span class="week-portion-fixed">${n} port.</span>`;
    return `<article class="week-card${p.locked ? ' is-locked' : ''}" data-slot="${escapeAttr(p.slot)}" data-id="${escapeAttr(e.id)}" style="--ph-h:${vis.hue}">
      <a class="week-card-media${noPhoto ? ' is-nophoto' : ''}" href="#overview/${encodeURIComponent(e.id)}" data-open tabindex="-1" aria-hidden="true" data-ph-emoji="${escapeAttr(vis.emoji)}">${media}</a>
      <div class="week-card-body">
        ${catLabel ? `<span class="week-eyebrow">${escapeHtml(catLabel)}</span>` : ''}
        <a class="week-card-title" href="#overview/${encodeURIComponent(e.id)}" data-open>${escapeHtml(e.name)}</a>
        <div class="week-card-meta">${gk}${mins}${diff}${p.locked ? `<span class="week-locked-tag">${LOCK_SVG}Låst</span>` : ''}</div>
        <div class="week-card-actions">
          ${portions}
          <span class="week-card-btns">
            <button type="button" class="week-btn" data-swap ${p.locked ? 'disabled title="Lås upp för att byta"' : 'title="Byt till ett annat recept"'}>${SWAP_SVG}<span>Byt</span></button>
            <button type="button" class="week-btn week-lock" data-lock aria-pressed="${p.locked}" title="${p.locked ? 'Lås upp' : 'Behåll vid Slumpa om'}">${p.locked ? LOCK_SVG : UNLOCK_SVG}<span>${p.locked ? 'Låst' : 'Lås'}</span></button>
            <a class="week-btn week-open" href="#overview/${encodeURIComponent(e.id)}" data-open>Översikt ›</a>
          </span>
        </div>
      </div>
    </article>`;
  }

  _renderGroups(settings) {
    // One grid in category order; each card names its category (compact on wide screens)
    const plan = WeekPlan.plan();
    let html = '';
    for (const c of settings.cats.filter((x) => this.catById[x.id])) {
      const cat = this.catById[c.id];
      const picks = plan.picks.filter((p) => p.cat === c.id && p.recipeId && this.byId[p.recipeId]);
      for (const p of picks) html += this._cardHtml(p, cat.label);
      for (let i = picks.length; i < c.count; i++) {
        html += `<div class="week-card week-card-missing"><span class="week-eyebrow">${escapeHtml(cat.label)}</span><span>Inget recept att välja</span></div>`;
      }
    }
    html = `<div class="week-cards">${html}</div>`;
    const $g = this.el.querySelector('.week-groups');
    $g.innerHTML = html;
    $g.querySelectorAll('.week-card-media img').forEach((img) => {
      const fail = () => {
        const a = img.closest('.week-card-media');
        if (!a) return;
        a.classList.add('is-nophoto');
        img.outerHTML = `<span class="week-ph" aria-hidden="true">${a.getAttribute('data-ph-emoji') || '🍽️'}</span>`;
      };
      if (imgFailed(img)) fail(); else img.addEventListener('error', fail, { once: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  _updateSettings(fn) {
    const s = WeekPlan.settings();
    fn(s);
    WeekPlan.saveSettings(s);
    this._reconcile();
  }

  _updatePick(slot, fn) {
    const pl = WeekPlan.plan();
    const p = pl.picks.find((x) => x.slot === slot);
    if (!p) return;
    fn(p);
    WeekPlan.savePlan(pl);
  }

  _focus(sel) {
    const el = this.el.querySelector(sel);
    if (el && !el.disabled) el.focus();
  }

  _bind() {
    this.el.addEventListener('click', (e) => {
      const t = e.target;
      const open = t.closest('[data-open]');
      if (open) {
        const id = open.closest('.week-card')?.dataset.id;
        if (id && this.onOpenOverview) { e.preventDefault(); this.onOpenOverview(id); }
        return;
      }
      const catRow = t.closest('.week-cat');
      if (catRow) {
        const id = catRow.dataset.cat;
        const cnt = t.closest('[data-count]');
        if (cnt) {
          const d = Number(cnt.dataset.count);
          this._updateSettings((s) => { const c = s.cats.find((x) => x.id === id); if (c) c.count = Math.min(WeekPlan.MAX_PER_CAT, Math.max(1, c.count + d)); });
          this._focus(`.week-cat[data-cat="${CSS.escape(id)}"] [data-count="${d}"]`);
          return;
        }
        if (t.closest('[data-remove]')) {
          this._updateSettings((s) => { s.cats = s.cats.filter((x) => x.id !== id); });
          this._focus('.week-add-chip');
          return;
        }
      }
      const add = t.closest('[data-add]');
      if (add) {
        const id = add.dataset.add;
        this._updateSettings((s) => { if (!s.cats.some((x) => x.id === id)) s.cats.push({ id, count: 1 }); });
        this._focus(`.week-cat[data-cat="${CSS.escape(id)}"] [data-count="1"]`);
        return;
      }
      const gk = t.closest('[data-gk]');
      if (gk) {
        const on = gk.dataset.gk === '1';
        this._updateSettings((s) => { s.godkandOnly = on; });
        this._focus(`[data-gk="${on ? 1 : 0}"]`);
        return;
      }
      const src = t.closest('[data-src]');
      if (src) {
        const v = src.dataset.src;
        this.sourceFallback = new Set();
        const s = WeekPlan.settings(); s.rerollSource = v; WeekPlan.saveSettings(s);
        this._renderActions();
        this._focus(`[data-src="${v}"]`);
        return;
      }
      if (t.closest('.week-gk-off')) { this._updateSettings((s) => { s.godkandOnly = false; }); return; }
      if (t.closest('.week-reroll')) { this.flash = ''; this._reconcile({ reroll: true }); this._focus('.week-reroll'); return; }
      if (t.closest('.week-shop')) { this._addAllToShopping(); this._focus('.week-shop'); return; }
      const card = t.closest('.week-card');
      if (!card) return;
      const slot = card.dataset.slot;
      if (t.closest('[data-swap]')) {
        this._reconcile({ rerollSlot: slot });
        this._focus(`.week-card[data-slot="${CSS.escape(slot)}"] [data-swap]`);
        return;
      }
      if (t.closest('[data-lock]')) {
        this._updatePick(slot, (p) => { p.locked = !p.locked; });
        this._focus(`.week-card[data-slot="${CSS.escape(slot)}"] [data-lock]`);
        return;
      }
      const port = t.closest('[data-portions]');
      if (port) {
        const d = Number(port.dataset.portions);
        this._updatePick(slot, (p) => { p.portions = Math.min(12, Math.max(1, this._portions(p) + d)); });
        this._focus(`.week-card[data-slot="${CSS.escape(slot)}"] [data-portions="${d}"]`);
      }
    });
  }

  _addAllToShopping() {
    const picks = WeekPlan.plan().picks.filter((p) => p.recipeId && this.byId[p.recipeId]);
    let added = 0;
    for (const p of picks) {
      const n = this._portions(p);
      this.state.ensureShoppingPortions(p.recipeId, n);
      if (this.state.getShoppingPortions(p.recipeId) !== n) this.state.setShoppingPortions(p.recipeId, n);
      if (!this.state.isShoppingRecipeSelected(p.recipeId)) { this.state.toggleShoppingRecipe(p.recipeId); added++; }
    }
    this.flash = added
      ? `${added} ${recipesWord(added)} tillagda. <a href="#inkop" class="week-flash-link">Visa inköpslistan</a>`
      : 'Allt fanns redan i inköpslistan. <a href="#inkop" class="week-flash-link">Visa inköpslistan</a>';
    this._renderActions();
  }
}
