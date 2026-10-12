/**
 * Kryddskåpet (#kryddor): type grams of each single spice on hand and see how
 * many packets of each homemade blend you could make, one blend at a time.
 * Amounts are intentionally not saved; the page starts empty every visit.
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011u';
import { allCapacities, parseGrams } from '../models/spice-calc.js?v=20261012a';

const DATA_URL = 'data/spice-blends.json?v=20261012a';

const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

export class SpiceView {
  constructor(container) {
    this.el = container;
    this.data = null;
    this.have = {};
    this._loading = null;
  }

  async _load() {
    if (this.data) return this.data;
    if (!this._loading) {
      this._loading = fetch(DATA_URL).then((r) => {
        if (!r.ok) throw new Error(`Kunde inte ladda kryddblandningar (${r.status})`);
        return r.json();
      });
    }
    const data = await this._loading;
    data.spices.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    this.nameById = Object.fromEntries(data.spices.map((s) => [s.id, s.name]));
    this.data = data;
    return data;
  }

  /** Build the page once; later visits keep whatever was typed this session. */
  async render() {
    if (this._rendered) return;
    let data;
    try {
      data = await this._load();
    } catch (err) {
      console.error(err);
      this.el.innerHTML = `<p class="spice-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    this._rendered = true;

    const rows = data.spices.map((s) => {
      const hint = s.jarGrams ? `burk ${fmt(s.jarGrams)} g${s.jarNote ? `, ${s.jarNote}` : ''}` : '';
      return `
        <label class="spice-row" for="spice-${escapeAttr(s.id)}">
          <span class="spice-name">${escapeHtml(s.name)}${hint ? `<span class="spice-hint">${escapeHtml(hint)}</span>` : ''}</span>
          <span class="spice-input-wrap">
            <input id="spice-${escapeAttr(s.id)}" class="spice-input" data-spice="${escapeAttr(s.id)}"
              type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="${escapeAttr(s.name)} i gram">
            <span class="spice-unit" aria-hidden="true">g</span>
          </span>
        </label>`;
    }).join('');

    this.el.innerHTML = `
      <div class="spice-page">
        <div class="spice-head">
          <h1>Kryddskåpet</h1>
          <p class="spice-lede">Skriv hur många gram du har av varje krydda. Siffrorna visar hur många påsar du kan blanda av <em>en</em> blandning i taget.</p>
        </div>
        <div class="spice-layout">
          <section class="spice-card spice-pantry" aria-labelledby="spice-pantry-h">
            <div class="spice-card-head">
              <h2 id="spice-pantry-h">Mina kryddor</h2>
              <button type="button" class="spice-clear" hidden>Rensa</button>
            </div>
            <div class="spice-rows">${rows}</div>
          </section>
          <section class="spice-card spice-results" aria-labelledby="spice-results-h">
            <h2 id="spice-results-h">Blandningar</h2>
            <ul class="spice-blends" aria-live="polite"></ul>
            ${data.note ? `<p class="spice-note">${escapeHtml(data.note)}</p>` : ''}
          </section>
        </div>
      </div>`;

    this.$clear = this.el.querySelector('.spice-clear');
    this.el.addEventListener('input', (e) => {
      const input = e.target.closest?.('.spice-input');
      if (!input) return;
      this.have[input.dataset.spice] = parseGrams(input.value);
      input.classList.toggle('is-invalid', input.value.trim() !== '' && !/^\s*\d*[.,]?\d*\s*(g)?\s*$/i.test(input.value));
      this._renderResults();
    });
    this.$clear.addEventListener('click', () => {
      this.el.querySelectorAll('.spice-input').forEach((i) => { i.value = ''; i.classList.remove('is-invalid'); });
      this.have = {};
      this._renderResults();
      this.el.querySelector('.spice-input')?.focus();
    });
    this._renderResults();
  }

  _names(ids) {
    return ids.map((id) => this.nameById[id] || id).join(', ').toLowerCase();
  }

  _renderResults() {
    const list = this.el.querySelector('.spice-blends');
    if (!list) return;
    const any = Object.values(this.have).some((v) => v > 0);
    this.$clear.hidden = !any;
    const open = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.blend));
    list.innerHTML = allCapacities(this.data.blends, this.have).map(({ blend, packets, limiting, short }) => {
      let why;
      if (packets > 0) {
        why = `begränsas av: ${this._names(limiting)}`;
      } else if (!any) {
        why = `${Object.keys(blend.spices).length} kryddor`;
      } else {
        why = `räcker inte: ${this._names(short)}`;
      }
      const recipe = Object.entries(blend.spices)
        .map(([id, g]) => {
          const have = this.have[id] || 0;
          const low = have + 1e-9 < g;
          return `<li class="${low ? 'is-short' : ''}"><span>${escapeHtml(this.nameById[id] || id)}</span><span>${fmt(g)} g</span></li>`;
        }).join('');
      return `
        <li class="spice-blend ${packets > 0 ? 'can-make' : 'cannot-make'}">
          <div class="spice-blend-main">
            <span class="spice-count" aria-hidden="true">${packets}</span>
            <span class="spice-blend-text">
              <span class="spice-blend-name">${escapeHtml(blend.name)}</span>
              <span class="spice-blend-sub">${packets === 1 ? '1 påse' : `${packets} påsar`} à ${fmt(blend.packetGrams)} g · ${escapeHtml(why)}</span>
            </span>
          </div>
          <details class="spice-blend-recipe" data-blend="${escapeAttr(blend.name)}"${open.has(blend.name) ? ' open' : ''}>
            <summary>Per påse</summary>
            <ul>${recipe}</ul>
          </details>
        </li>`;
    }).join('');
  }
}
