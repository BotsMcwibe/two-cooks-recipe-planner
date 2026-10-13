/**
 * Skafferiet (#skafferi): a tile grid of shelf-stable staples with their
 * ingredient images. Tapping a tile buries it in "Gravplatsen": every recipe
 * using a buried ingredient is hidden in #browse. Tap a grave tile to revive it.
 * The set lives in core/pantry-exclude.js (localStorage + Supabase prefs).
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';
import { excludedPantry, setPantryExcluded, clearPantryExcluded, loadPantry } from '../core/pantry-exclude.js?v=20261013gr';

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
  constructor(container) {
    this.el = container;
    this.data = null;
    window.addEventListener('pantryexcludechange', () => this._renderGrids());
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

    this.el.innerHTML = `
      <div class="spice-page pantry-page">
        <div class="spice-head">
          <h1>Skafferiet</h1>
          <p class="spice-lede">Tryck på en ingrediens du inte vill ha så hamnar den på Gravplatsen. Recept med den visas inte längre bland recepten. Tryck på den igen på Gravplatsen för att väcka den till liv.</p>
        </div>
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
      const t = e.target.closest('.pantry-tile');
      if (!t) return;
      const bury = t.getAttribute('aria-pressed') !== 'true';
      this._pending = { id: t.dataset.item, bury, rect: t.getBoundingClientRect(), node: t };
      setPantryExcluded(t.dataset.item, bury);
    });
    this._renderGrids();
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
    this.el.querySelectorAll('.pantry-tile').forEach((t) => {
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
    this.el.querySelectorAll('.pantry-tile').forEach((t) => {
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
