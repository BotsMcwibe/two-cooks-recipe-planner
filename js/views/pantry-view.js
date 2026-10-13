/**
 * Skafferiet (#skafferi): tick the shelf-stable staples you have at home and see
 * which recipes the pantry already covers, and which are one or two packages
 * away (with a normal store package size). Like Kryddskåpet nothing is saved;
 * the page starts empty every visit.
 *
 * Why tick-boxes instead of amounts: recipes measure staples in msk, dl, burk,
 * förp and g, so amounts can't be compared reliably. "Har hemma" answers the
 * question that matters ("can I cook this without shopping staples?").
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';

const DATA_URL = 'data/pantry.json?v=20261013a';
const ORDER = ['Pasta, ris & gryn', 'Nudlar & bröd', 'Konserver', 'Baljväxter', 'Buljong & fond',
  'Asiatiskt', 'Oljor & vinäger', 'Såser & dressing', 'Bakning & sött', 'Nötter & frön'];

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
    this.have = new Set();
  }

  async render() {
    if (this._rendered) return;
    let data;
    try {
      const r = await fetch(DATA_URL);
      if (!r.ok) throw new Error(`Kunde inte ladda skafferiet (${r.status})`);
      data = await r.json();
    } catch (err) {
      console.error(err);
      this.el.innerHTML = `<p class="spice-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    this._rendered = true;
    this.data = data;
    this.byId = Object.fromEntries(data.items.map((i) => [i.id, i]));
    const uses = {};
    data.recipes.forEach((r) => r.pantry.forEach((p) => { uses[p] = (uses[p] || 0) + 1; }));

    const groups = ORDER.map((cat) => {
      const items = data.items.filter((i) => i.category === cat)
        .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      if (!items.length) return '';
      const rows = items.map((i) => {
        const size = prettySize(i.size);
        const hint = [size && `förp ${size}`, `${uses[i.id] || 0} recept`].filter(Boolean).join(' · ');
        return `<label class="pantry-item">
            <input type="checkbox" class="pantry-check" data-item="${escapeAttr(i.id)}">
            <span class="pantry-item-text"><span class="pantry-item-name">${escapeHtml(i.name)}</span><span class="spice-hint">${escapeHtml(hint)}</span></span>
          </label>`;
      }).join('');
      return `<fieldset class="pantry-group"><legend>${escapeHtml(cat)}</legend><div class="pantry-items">${rows}</div></fieldset>`;
    }).join('');

    this.el.innerHTML = `
      <div class="spice-page pantry-page">
        <div class="spice-head">
          <h1>Skafferiet</h1>
          <p class="spice-lede">Bocka för det du har hemma. Då ser du vilka recept skafferiet räcker till och vad som saknas. Färskvaror, mejeri och kryddor räknas inte med här.</p>
        </div>
        <div class="spice-layout">
          <section class="spice-card" aria-labelledby="pantry-have-h">
            <div class="spice-card-head">
              <h2 id="pantry-have-h">Har hemma</h2>
              <button type="button" class="spice-clear" hidden>Rensa</button>
            </div>
            ${groups}
          </section>
          <section class="spice-card" aria-labelledby="pantry-res-h">
            <h2 id="pantry-res-h">Recept</h2>
            <div class="pantry-results" aria-live="polite"></div>
          </section>
        </div>
      </div>`;

    this.$clear = this.el.querySelector('.spice-clear');
    this.el.addEventListener('change', (e) => {
      const c = e.target.closest?.('.pantry-check');
      if (!c) return;
      if (c.checked) this.have.add(c.dataset.item); else this.have.delete(c.dataset.item);
      this._renderResults();
    });
    this.$clear.addEventListener('click', () => {
      this.el.querySelectorAll('.pantry-check').forEach((c) => { c.checked = false; });
      this.have.clear();
      this._renderResults();
    });
    this._renderResults();
  }

  _recipeLi(r, missing) {
    const buy = missing.map((id) => {
      const i = this.byId[id];
      const size = prettySize(i.size);
      return `${escapeHtml(i.name)}${size ? ` <span class="pantry-size">(${escapeHtml(size)})</span>` : ''}`;
    }).join(', ');
    return `<li class="pantry-recipe">
        <a href="#overview/${encodeURIComponent(r.id)}" class="pantry-recipe-name">${escapeHtml(r.name)}</a>
        <span class="spice-blend-sub">${missing.length ? `Köp: ${buy}` : `${r.pantry.length} ${r.pantry.length === 1 ? "skafferivara" : "skafferivaror"}`}</span>
      </li>`;
  }

  _renderResults() {
    const box = this.el.querySelector('.pantry-results');
    if (!box) return;
    this.$clear.hidden = this.have.size === 0;
    if (!this.have.size) {
      box.innerHTML = '<p class="pantry-empty">Bocka för några varor så visas recepten här.</p>';
      return;
    }
    const rows = this.data.recipes.map((r) => ({ r, missing: r.pantry.filter((p) => !this.have.has(p)) }));
    const ready = rows.filter((x) => !x.missing.length);
    const near = rows.filter((x) => x.missing.length > 0 && x.missing.length <= 2)
      .sort((a, b) => a.missing.length - b.missing.length || a.r.name.localeCompare(b.r.name, 'sv'));
    const section = (title, list, empty) => `
      <h3 class="pantry-sub">${title} <span class="pantry-n">${list.length}</span></h3>
      ${list.length ? `<ul class="pantry-list">${list.map((x) => this._recipeLi(x.r, x.missing)).join('')}</ul>` : `<p class="pantry-empty">${empty}</p>`}`;
    box.innerHTML = section('Skafferiet räcker', ready, 'Inget recept ännu.')
      + section('Saknar 1–2 varor', near, 'Inga recept är nära.');
  }
}
