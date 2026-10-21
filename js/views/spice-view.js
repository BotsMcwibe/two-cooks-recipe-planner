/**
 * Kryddskåpet (#kryddor): tap the spices you have (tile grid with images) and
 * see which blends you can mix. Owned set lives in core/spices-owned.js
 * (localStorage + Supabase prefs.spicesOwned).
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g4';
import { ownedSpices, setSpiceOwned, clearSpicesOwned } from '../core/spices-owned.js?v=20261021g4';

const DATA_URL = 'data/spice-blends.json?v=20261021g4';

export class SpiceView {
  constructor(container) {
    this.el = container;
    this.data = null;
    this._loading = null;
    this._prevMakeable = null;
    window.addEventListener('spicesownedchange', () => this._renderAll());
  }

  async _load() {
    if (this.data) return this.data;
    if (!this._loading) {
      this._loading = fetch(DATA_URL).then((r) => {
        if (!r.ok) throw new Error(`Kunde inte ladda kryddblandningar (${r.status})`);
        return r.json();
      }).catch((e) => { this._loading = null; throw e; });
    }
    const data = await this._loading;
    data.spices.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    this.nameById = Object.fromEntries(data.spices.map((s) => [s.id, s.name]));
    this.data = data;
    return data;
  }

  async render() {
    if (this._rendered) return;
    try {
      await this._load();
    } catch (err) {
      console.error(err);
      this.el.innerHTML = `<p class="spice-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    this._rendered = true;
    this.el.innerHTML = `
      <div class="spice-page spice-page-v2">
        <div class="spice-head">
          <h1>Kryddskåpet</h1>
          <p class="spice-lede">Fyll i kryddorna och se vilka mixar du kan skapa</p>
        </div>
        <div class="spice-card-head">
          <h2>Mina kryddor <span class="pantry-n spice-own-n"></span></h2>
          <button type="button" class="spice-clear spice-clear-all" hidden>Rensa</button>
        </div>
        <div class="pantry-tiles spice-tiles"></div>
        <section class="kmixes" aria-labelledby="kmixes-h">
          <h2 id="kmixes-h">Mixar <span class="pantry-n kmix-n"></span></h2>
          <ul class="kmix-list" aria-live="polite"></ul>
        </section>
      </div>`;
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.spice-clear-all')) { clearSpicesOwned(); return; }
      const t = e.target.closest('.spice-tile');
      if (!t) return;
      setSpiceOwned(t.dataset.spice, t.getAttribute('aria-pressed') !== 'true');
    });
    this._renderAll();
  }

  _tile(s, owned) {
    const media = s.image
      ? `<img src="${escapeAttr(s.image)}" alt="" loading="lazy" decoding="async">`
      : `<span class="pantry-tile-ph" aria-hidden="true">${escapeHtml(s.name.charAt(0))}</span>`;
    return `<button type="button" class="pantry-tile spice-tile${owned ? ' is-owned' : ''}" data-spice="${escapeAttr(s.id)}"
        aria-pressed="${owned}" aria-label="${escapeAttr(s.name)}">
        <span class="spice-check" aria-hidden="true">✓</span>
        <span class="pantry-tile-img">${media}</span>
        <span class="pantry-tile-name">${escapeHtml(s.name)}</span>
        ${s.jarNote ? `<span class="pantry-tile-size">${escapeHtml(s.jarNote)}</span>` : ''}
      </button>`;
  }

  _renderAll() {
    if (!this.data || !this._rendered) return;
    const owned = ownedSpices();
    const tiles = this.el.querySelector('.spice-tiles');
    const prevOwned = new Set([...tiles.querySelectorAll('.is-owned')].map((t) => t.dataset.spice));
    if (tiles.children.length) {
      // update in place so the press transition plays
      tiles.querySelectorAll('.spice-tile').forEach((t) => {
        const on = owned.has(t.dataset.spice);
        t.classList.toggle('is-owned', on);
        t.setAttribute('aria-pressed', String(on));
        if (on && !prevOwned.has(t.dataset.spice)) {
          t.classList.remove('just-owned'); void t.offsetWidth; t.classList.add('just-owned');
        }
      });
    } else {
      tiles.innerHTML = this.data.spices.map((s) => this._tile(s, owned.has(s.id))).join('');
    }
    const known = this.data.spices.filter((s) => owned.has(s.id)).length;
    this.el.querySelector('.spice-own-n').textContent = String(known);
    this.el.querySelector('.spice-clear-all').hidden = !known;

    const rows = this.data.blends.map((b) => {
      const ids = Object.keys(b.spices);
      const missing = ids.filter((id) => !owned.has(id));
      return { b, ids, missing };
    }).sort((x, y) => x.missing.length - y.missing.length || x.b.name.localeCompare(y.b.name, 'sv'));
    const makeable = new Set(rows.filter((r) => !r.missing.length).map((r) => r.b.id));
    const fresh = this._prevMakeable ? [...makeable].filter((id) => !this._prevMakeable.has(id)) : [];
    this._prevMakeable = makeable;
    this.el.querySelector('.kmix-n').textContent = `${makeable.size}/${rows.length}`;
    const names = (list) => list.map((id) => this.nameById[id] || id).join(', ').toLowerCase();
    this.el.querySelector('.kmix-list').innerHTML = rows.map(({ b, ids, missing }) => {
      const ok = !missing.length;
      const chips = ids.map((id) => `<span class="kchip${owned.has(id) ? ' have' : ''}">${escapeHtml(this.nameById[id] || id)}</span>`).join('');
      return `<li class="kmix ${ok ? 'is-ready' : 'is-missing'}${fresh.includes(b.id) ? ' just-ready' : ''}" data-blend="${escapeAttr(b.id)}">
          <div class="kmix-top">
            <span class="kmix-icon" aria-hidden="true">${ok ? '✨' : '🫙'}</span>
            <span class="kmix-name">${escapeHtml(b.name)}</span>
            ${ok ? '<span class="kmix-badge">Kan göras</span>' : ''}
          </div>
          <p class="kmix-sub">${ok ? 'Du har allt som behövs' : `Saknar: ${escapeHtml(names(missing))}`}</p>
          <div class="kchips">${chips}</div>
        </li>`;
    }).join('');
  }
}
