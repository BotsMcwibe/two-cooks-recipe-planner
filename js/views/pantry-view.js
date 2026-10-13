/**
 * Skafferiet (#skafferi): a tile grid of shelf-stable staples with their
 * ingredient images. Tapping a tile buries it in "Gravplatsen": every recipe
 * using a buried ingredient is hidden in #browse. Tap a grave tile to revive it.
 * The set lives in core/pantry-exclude.js (localStorage + Supabase prefs).
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';
import { excludedPantry, setPantryExcluded, clearPantryExcluded, loadPantry } from '../core/pantry-exclude.js?v=20261013px';

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
        <section class="pantry-grave" aria-labelledby="pantry-grave-h" hidden>
          <div class="spice-card-head">
            <h2 id="pantry-grave-h">🪦 Gravplatsen <span class="pantry-n"></span></h2>
            <button type="button" class="spice-clear pantry-revive-all">Väck alla</button>
          </div>
          <p class="pantry-grave-sub"></p>
          <div class="pantry-tiles pantry-tiles-grave"></div>
        </section>
        <div class="pantry-tiles pantry-tiles-live"></div>
      </div>`;

    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.pantry-revive-all')) { clearPantryExcluded(); return; }
      const t = e.target.closest('.pantry-tile');
      if (!t) return;
      setPantryExcluded(t.dataset.item, t.getAttribute('aria-pressed') !== 'true');
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

  _renderGrids() {
    if (!this.data) return;
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
  }
}
