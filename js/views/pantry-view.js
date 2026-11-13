/**
 * Skafferiet (#skafferi), two parts:
 *  1. "Har hemma": basics the household usually has (salt, olja, smör ...). Ranked
 *     suggestions from js/data/pantry-staples.js (Linas/HelloFresh pantry flags +
 *     our own recipes), one tap to add, "Lägg till alla vanliga", or any other
 *     ingredient by name. Those rows are dimmed as "hemma" in the översikt, the
 *     cook page and the shopping list. Set: core/pantry-have.js.
 *  2. "Tål inte": a tile grid of shelf-stable staples with their ingredient
 *     images. Tapping a tile buries it in "Gravplatsen": every recipe using a
 *     buried ingredient is hidden in #browse. Tap a grave tile to revive it.
 *     Set: core/pantry-exclude.js.
 * Both live in localStorage and sync per account via Supabase prefs.
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261113g25';
import { excludedPantry, setPantryExcluded, clearPantryExcluded, loadPantry } from '../core/pantry-exclude.js?v=20261113g25';
import { havePantry, setPantryHave, addPantryHave, clearPantryHave, spiceHaveIds, onLikelyHaveChange } from '../core/pantry-have.js?v=20261113g25';
import { PANTRY_STAPLES, IMPLICIT_HAVE } from '../data/pantry-staples.js?v=20261113g25';

/** "380/230g" -> "380 g", "1,5kg" -> "1,5 kg", "6p/3l" -> "6 st". */
export function prettySize(s) {
  if (!s) return '';
  let m = s.match(/^(\d+)p\//);
  if (m) return `${m[1]} st`;
  m = s.match(/^([\d,]+)\/[\d,]+\s*(g|kg)$/);
  if (m) return `${m[1]} ${m[2]}`;
  return s.replace(/^([\d,]+)\s*(g|kg|ml|cl|l)$/i, '$1 $2');
}

export class PantryView {
  /** @param {{ ingredients?: Record<string, import('../models/ingredient.js').Ingredient> }} [opts] */
  constructor(container, { ingredients = {} } = {}) {
    this.el = container;
    this.data = null;
    this.ingredients = ingredients;
    window.addEventListener('pantryexcludechange', () => this._renderGrids());
    onLikelyHaveChange(() => this._renderHave());
  }

  async render() {
    if (this._rendered) return;
    let data;
    try {
      data = await loadPantry();
    } catch (err) {
      console.error(err);
      this.el.innerHTML = `<p class="spice-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    this._rendered = true;
    this.data = data;
    this.uses = {};
    data.recipes.forEach((r) => r.pantry.forEach((p) => { this.uses[p] = (this.uses[p] || 0) + 1; }));
    this.items = [...data.items].sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    const ingOptions = Object.values(this.ingredients)
      .filter((i) => i && i.name && !i.json.blendId && !IMPLICIT_HAVE.includes(i.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map((i) => `<option value="${escapeAttr(i.name)}"></option>`).join('');

    this.el.innerHTML = `
      <div class="spice-page pantry-page">
        <div class="spice-head">
          <h1>Skafferiet</h1>
          <p class="spice-lede">Markera det du brukar ha hemma så tonar vi ned det i recepten och inköpslistan. Längre ner kan du begrava det du inte tål.</p>
        </div>
        <section class="have-card" aria-labelledby="have-h">
          <div class="spice-card-head">
            <h2 id="have-h">Har hemma <span class="pantry-n have-n">0</span></h2>
            <button type="button" class="spice-clear have-clear" hidden>Rensa</button>
          </div>
          <p class="have-sub"></p>
          <ul class="have-chips" aria-label="Har hemma"></ul>
          <form class="have-add" autocomplete="off">
            <label class="sr-only" for="have-add-input">Lägg till en vara du har hemma</label>
            <input id="have-add-input" class="have-add-input" type="text" list="have-add-options" placeholder="Lägg till annan vara, t.ex. sojasås" enterkeyhint="done">
            <datalist id="have-add-options">${ingOptions}</datalist>
            <button type="submit" class="acc-btn have-add-btn">Lägg till</button>
            <span class="have-add-msg" role="status" aria-live="polite"></span>
          </form>
        </section>
        <section class="have-suggest" aria-labelledby="have-sugg-h">
          <div class="spice-card-head">
            <h2 id="have-sugg-h">Föreslagna basvaror</h2>
            <button type="button" class="acc-btn acc-btn-primary have-add-common">Lägg till alla vanliga</button>
          </div>
          <p class="have-sub">De basvaror som används mest och som är vanligt att man redan har hemma.</p>
          <h3 class="have-h3">Vanligast</h3>
          <div class="pantry-tiles have-tiles have-tiles-common"></div>
          <h3 class="have-h3">Fler vanliga i skafferiet</h3>
          <div class="pantry-tiles have-tiles have-tiles-extra"></div>
        </section>
        <div class="spice-card-head pantry-avoid-head">
          <h2>Tål inte</h2>
        </div>
        <p class="have-sub">Tryck på ingredienser du inte tål så tar vi bort recepten med dem.</p>
        <div class="pantry-tiles pantry-tiles-live"></div>
        <section class="pantry-grave" aria-labelledby="pantry-grave-h" hidden>
          <div class="spice-card-head">
            <h2 id="pantry-grave-h">🪦 Gravplatsen <span class="pantry-n"></span></h2>
            <button type="button" class="spice-clear pantry-revive-all">Väck alla</button>
          </div>
          <p class="pantry-grave-sub"></p>
          <div class="pantry-tiles pantry-tiles-grave"></div>
        </section>
      </div>`;

    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.pantry-revive-all')) { clearPantryExcluded(); return; }
      if (e.target.closest('.have-clear')) { this._confirmClear(e.target.closest('.have-clear')); return; }
      if (e.target.closest('.have-add-common')) { this._addCommon(); return; }
      const chip = e.target.closest('[data-have-remove]');
      if (chip) { setPantryHave(chip.dataset.haveRemove, false); return; }
      const ht = e.target.closest('.have-tile');
      if (ht) { setPantryHave(ht.dataset.have, ht.getAttribute('aria-pressed') !== 'true'); return; }
      const t = e.target.closest('.pantry-tiles-live .pantry-tile, .pantry-tiles-grave .pantry-tile');
      if (!t) return;
      const bury = t.getAttribute('aria-pressed') !== 'true';
      this._pending = { id: t.dataset.item, bury, rect: t.getBoundingClientRect(), node: t };
      setPantryExcluded(t.dataset.item, bury);
    });
    this.el.querySelector('.have-add').addEventListener('submit', (e) => { e.preventDefault(); this._addTyped(); });
    this._renderGrids();
    this._renderHave();
  }

  // ---------------------------------------------------------------- Har hemma
  _ing(id) { return this.ingredients[id] || null; }

  _commonIds() {
    return PANTRY_STAPLES.filter((s) => s.tier === 'common' && !s.perishable && this._ing(s.id)).map((s) => s.id);
  }

  _addCommon() {
    const n = addPantryHave(this._commonIds());
    this._msg(n ? `✓ ${n} ${n === 1 ? 'vara tillagd' : 'varor tillagda'}` : 'Alla vanliga finns redan');
  }

  _addTyped() {
    const input = this.el.querySelector('.have-add-input');
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const all = Object.values(this.ingredients).filter((i) => i && i.name && !i.json.blendId);
    const hit = all.find((i) => i.name.toLowerCase() === q) || all.find((i) => i.id === q)
      || (all.filter((i) => i.name.toLowerCase().startsWith(q)).length === 1 ? all.find((i) => i.name.toLowerCase().startsWith(q)) : null);
    if (!hit) { this._msg('Hittade ingen sådan vara. Välj ett namn i listan.'); return; }
    setPantryHave(hit.id, true);
    input.value = '';
    this._msg(`✓ ${hit.name} tillagd`);
  }

  _msg(text) {
    const m = this.el.querySelector('.have-add-msg');
    if (!m) return;
    m.textContent = text;
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { if (m.isConnected) m.textContent = ''; }, 3500);
  }

  _confirmClear(btn) {
    if (!btn.classList.contains('is-confirming')) {
      btn.classList.add('is-confirming'); btn.textContent = 'Säker?';
      clearTimeout(this._clrT);
      this._clrT = setTimeout(() => { if (btn.isConnected) { btn.classList.remove('is-confirming'); btn.textContent = 'Rensa'; } }, 2000);
      return;
    }
    clearTimeout(this._clrT);
    btn.classList.remove('is-confirming'); btn.textContent = 'Rensa';
    clearPantryHave();
  }

  _haveTile(s, on) {
    const i = this._ing(s.id);
    const media = i.image
      ? `<img src="${escapeAttr(i.image)}" alt="" loading="lazy" decoding="async">`
      : `<span class="pantry-tile-ph" aria-hidden="true">${escapeHtml(i.name.charAt(0))}</span>`;
    const share = Math.round(Math.max(s.linas || 0, s.hellofresh || 0, s.ours || 0));
    const note = s.perishable ? 'färskvara' : (share ? `i ${share} % av recepten` : '');
    return `<button type="button" class="pantry-tile spice-tile have-tile${on ? ' is-owned' : ''}" data-have="${escapeAttr(s.id)}"
        aria-pressed="${on}" aria-label="${escapeAttr(i.name)}">
        <span class="spice-check" aria-hidden="true">✓</span>
        <span class="pantry-tile-img">${media}</span>
        <span class="pantry-tile-name">${escapeHtml(i.name)}</span>
        ${note ? `<span class="pantry-tile-size">${escapeHtml(note)}</span>` : ''}
      </button>`;
  }

  _renderHave() {
    if (!this._rendered) return;
    const have = havePantry();
    const staples = PANTRY_STAPLES.filter((s) => this._ing(s.id));
    for (const [tier, sel] of [['common', '.have-tiles-common'], ['extra', '.have-tiles-extra']]) {
      const box = this.el.querySelector(sel);
      const list = staples.filter((s) => s.tier === tier);
      if (box.children.length === list.length) {
        box.querySelectorAll('.have-tile').forEach((t) => {
          const on = have.has(t.dataset.have);
          if (on && !t.classList.contains('is-owned')) { t.classList.remove('just-owned'); void t.offsetWidth; t.classList.add('just-owned'); }
          t.classList.toggle('is-owned', on);
          t.setAttribute('aria-pressed', String(on));
        });
      } else {
        box.innerHTML = list.map((s) => this._haveTile(s, have.has(s.id))).join('');
      }
    }
    const ids = [...have].filter((id) => this._ing(id)).sort((a, b) => this._ing(a).name.localeCompare(this._ing(b).name, 'sv'));
    this.el.querySelector('.have-n').textContent = String(ids.length);
    this.el.querySelector('.have-clear').hidden = !ids.length;
    this.el.querySelector('.have-chips').innerHTML = ids.length
      ? ids.map((id) => `<li><button type="button" class="have-chip" data-have-remove="${escapeAttr(id)}" aria-label="Ta bort ${escapeAttr(this._ing(id).name)}">${escapeHtml(this._ing(id).name)} <span aria-hidden="true">×</span></button></li>`).join('')
      : '<li class="have-empty">Inget markerat än. Börja med <strong>Lägg till alla vanliga</strong> nedan.</li>';
    const spices = [...spiceHaveIds()].filter((id) => !have.has(id) && this._ing(id)).length;
    this.el.querySelector('.have-card .have-sub').innerHTML = `Visas som <span class="have-badge">hemma</span> och tonas ned i recepten och inköpslistan. Vatten räknas alltid som hemma${spices ? `, och ${spices} ${spices === 1 ? 'krydda' : 'kryddor'} från <a href="#kryddor">Kryddskåpet</a> räknas också` : '. Kryddor du markerar i <a href="#kryddor">Kryddskåpet</a> räknas också'}.`;
    const missingCommon = this._commonIds().filter((id) => !have.has(id)).length;
    const addAll = this.el.querySelector('.have-add-common');
    addAll.disabled = !missingCommon;
    addAll.textContent = missingCommon ? 'Lägg till alla vanliga' : '✓ Alla vanliga tillagda';
  }

  _tile(i, buried) {
    const size = prettySize(i.size);
    const media = i.image
      ? `<img src="${escapeAttr(i.image)}" alt="" loading="lazy" decoding="async">`
      : `<span class="pantry-tile-ph" aria-hidden="true">${escapeHtml(i.name.charAt(0))}</span>`;
    const label = buried ? `Väck ${i.name}` : `Begrav ${i.name}`;
    return `<button type="button" class="pantry-tile${buried ? ' is-buried' : ''}" data-item="${escapeAttr(i.id)}"
        aria-pressed="${buried}" aria-label="${escapeAttr(label)}" title="${escapeAttr(i.product || i.name)}">
        <span class="pantry-tile-img">${media}</span>
        <span class="pantry-tile-name">${escapeHtml(i.name)}</span>
        ${size ? `<span class="pantry-tile-size">${escapeHtml(size)}</span>` : ''}
      </button>`;
  }

  /** Snapshot tile positions for FLIP, keyed by grid + item id. */
  _rects() {
    const m = new Map();
    this.el.querySelectorAll('.pantry-tiles-live .pantry-tile, .pantry-tiles-grave .pantry-tile').forEach((t) => {
      m.set(t.dataset.item + (t.classList.contains('is-buried') ? ':g' : ':l'), t.getBoundingClientRect());
    });
    return m;
  }

  /** Clone the tapped tile into a fixed ghost that snaps out and falls off screen. */
  _fall(node, r, reduced) {
    const g = node.cloneNode(true);
    g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1;
    g.classList.add('pantry-ghost');
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(g);
    let a;
    if (reduced) {
      a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
    } else {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const drop = window.innerHeight - r.top + r.height;
      a = g.animate([
        { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(0,-6px) rotate(${-4 * dir}deg) scale(1.12)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${-3 * dir}px,-8px) rotate(${6 * dir}deg) scale(1.12)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${3 * dir}px,-10px) rotate(${-3 * dir}deg) scale(1.1)`, opacity: 1, offset: 0.28, easing: 'cubic-bezier(.45,0,.9,.6)' },
        { transform: `translate(${40 * dir}px,${drop}px) rotate(${70 * dir}deg) scale(.85)`, opacity: 0, offset: 1 },
      ], { duration: 900, fill: 'forwards' });
    }
    a.onfinish = a.oncancel = () => g.remove();
  }

  _renderGrids() {
    if (!this.data) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = this._rects();
    const pend = this._pending; this._pending = null;
    if (pend && pend.bury && pend.node.isConnected) this._fall(pend.node, pend.rect, reduced);
    const ex = excludedPantry();
    const live = this.items.filter((i) => !ex.has(i.id));
    const dead = this.items.filter((i) => ex.has(i.id));
    this.el.querySelector('.pantry-tiles-live').innerHTML = live.map((i) => this._tile(i, false)).join('');
    const grave = this.el.querySelector('.pantry-grave');
    grave.hidden = !dead.length;
    grave.querySelector('.pantry-n').textContent = String(dead.length);
    const hidden = this.data.recipes.filter((r) => r.pantry.some((p) => ex.has(p))).length;
    grave.querySelector('.pantry-grave-sub').textContent = `${hidden} ${hidden === 1 ? 'recept döljs' : 'recept döljs'} bland recepten.`;
    grave.querySelector('.pantry-tiles-grave').innerHTML = dead.map((i) => this._tile(i, true)).join('');
    if (pend) this._animate(before, pend, reduced);
  }

  _animate(before, pend, reduced) {
    this.el.querySelectorAll('.pantry-tiles-live .pantry-tile, .pantry-tiles-grave .pantry-tile').forEach((t) => {
      const buried = t.classList.contains('is-buried');
      const key = t.dataset.item + (buried ? ':g' : ':l');
      const isNew = t.dataset.item === pend.id;
      if (isNew) {
        if (pend.bury) {
          // lands in the grave after the fall
          t.animate(reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, transform: 'translateY(-14px) scale(.8)' }, { opacity: 1, transform: 'none' }],
          { duration: reduced ? 200 : 380, delay: reduced ? 0 : 520, easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'backwards' });
        } else {
          // revive: rises from below and pops back in
          const from = pend.rect, to = t.getBoundingClientRect();
          const dy = Math.max(-260, Math.min(260, from.top - to.top));
          t.animate(reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
              { opacity: 0, transform: `translate(${from.left - to.left}px,${dy}px) scale(.6)` },
              { opacity: 1, transform: 'translate(0,-6px) scale(1.1)', offset: 0.7 },
              { opacity: 1, transform: 'none' },
            ], { duration: reduced ? 200 : 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
        }
        return;
      }
      if (reduced) return;
      const b = before.get(key);
      if (!b) return;
      const a = t.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (!dx && !dy) return;
      t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }],
        { duration: 340, delay: pend.bury ? 120 : 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }
}
