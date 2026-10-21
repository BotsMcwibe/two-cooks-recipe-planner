/**
 * Inköpslista as a page.
 *   #inkop          the user's own list (editable: portions, remove, Dela, Kopiera, Rensa)
 *   #inkop/<code>   a shared list (read-only; Spara som min inköpslista / Lägg till i min)
 * Shows the recipes (links to the översikt) and the aggregated ingredients
 * with, per ingredient, which recipes it comes from (amount per recipe when
 * split). Items can be checked off; that is kept locally per list.
 */
import { ShoppingListAggregator } from '../core/shopping-list.js?v=20261021g13';
import { formatNiceAmount } from '../utils/helpers.js';
import { escapeAttr, escapeHtml, isPantryIngredient, isScalable } from '../utils/catalog-ui.js?v=20261021g13';
import { encodeShoppingList, decodeShoppingList, shareUrl, checkedItems, setChecked, clearChecked } from '../core/shopping-link.js?v=20261021g13';

const SHARE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.8 7.4-4.4M8.3 13.2l7.4 4.4"/></g></svg>';

/** Copy payload: recipe names + ingredients (same JSON shape as the sidebar). */
export function shoppingCopyPayload(recipes, groups) {
  const payload = { recept: recipes.map((r) => ({ namn: r.name, portioner: r.portions })), ingredienser: [], skafferi: [] };
  for (const entries of Object.values(groups)) {
    for (const entry of entries) {
      const unit = entry.unit?.abbreviation || '';
      const item = { name: entry.ingredient ? entry.ingredient.name : entry.ingredientId, amount: formatNiceAmount(entry.amount, unit), unit };
      if (entry.recipes && entry.recipes.length) item.recept = entry.recipes.map((s) => s.name);
      (isPantryIngredient(entry.ingredient) ? payload.skafferi : payload.ingredienser).push(item);
    }
  }
  return payload;
}

export class ShoppingPage {
  constructor(container, { state, catalog, unitMap, baseIngredientMap, tagsData, repository, onOpenOverview }) {
    this.el = container;
    this.state = state;
    this.catalogById = Object.fromEntries(catalog.map((c) => [c.id, c]));
    this.unitMap = unitMap;
    this.baseIngredientMap = baseIngredientMap;
    this.tagsData = tagsData;
    this.repository = repository;
    this.onOpenOverview = onOpenOverview;
    this.code = null; // null = own list
    this.visible = false;
    this._token = 0;
    this._payload = null;
    this._bind();
    state.on('shoppingChange', () => { if (this.visible && this.code == null) this.render(null); });
  }

  hide() { this.visible = false; }

  /** Recipe ids on the page, in order (översikt prev/next). */
  recipeIds() { return (this._items || []).map((it) => it.id); }

  /** Items of the current list: [{ id, portions }] with catalog defaults applied. */
  _itemsFor(code) {
    if (code == null) {
      return [...this.state.shoppingSelections].filter((id) => this.catalogById[id]).map((id) => {
        const c = this.catalogById[id];
        this.state.ensureShoppingPortions(id, c.basePortions || 4);
        return { id, portions: isScalable(c) ? this.state.getShoppingPortions(id) : (c.basePortions || 4) };
      });
    }
    return decodeShoppingList(code).filter((it) => this.catalogById[it.id]).map((it) => {
      const c = this.catalogById[it.id];
      return { id: it.id, portions: isScalable(c) ? (it.portions || c.basePortions || 4) : (c.basePortions || 4) };
    });
  }

  async render(code) {
    this.visible = true;
    const changed = code !== this.code;
    this.code = code;
    const token = ++this._token;
    const items = this._itemsFor(code);
    this._items = items;
    const listKey = code == null ? 'mine' : code;
    const own = code == null;

    // Aggregate: one total aggregator + one per recipe for "which recipe needs how much"
    const total = new ShoppingListAggregator(this.unitMap, this.baseIngredientMap, this.tagsData);
    const perRecipe = [];
    for (const it of items) {
      const c = this.catalogById[it.id];
      const scale = isScalable(c) ? it.portions / (c.basePortions || 4) : 1;
      try {
        const loaded = await this.repository.loadMaster(it.id);
        const g = loaded.graph.scaleAll(scale);
        const root = g.get(it.id);
        total.addRecipe(root, g, 1.0);
        const one = new ShoppingListAggregator(this.unitMap, this.baseIngredientMap, this.tagsData);
        one.addRecipe(root, g, 1.0);
        perRecipe.push({ id: it.id, name: c.name, entries: [...one.aggregated.values()] });
      } catch (err) {
        console.error('[inkop] could not load', it.id, err);
      }
    }
    if (token !== this._token) return;
    const groups = total.getByTag();
    for (const entries of Object.values(groups)) {
      for (const e of entries) {
        e.recipes = [];
        for (const r of perRecipe) {
          const mine = r.entries.filter((x) => x.ingredientId === e.ingredientId && x.unit.type === e.unit.type);
          if (mine.length) e.recipes.push({ id: r.id, name: r.name, amount: mine.map((x) => formatNiceAmount(x.amount, x.unit.abbreviation)).join(' + ') });
        }
      }
    }
    const recipes = items.map((it) => ({ id: it.id, name: this.catalogById[it.id].name, portions: it.portions }));
    this._payload = shoppingCopyPayload(recipes, groups);
    this._shareCode = encodeShoppingList(items);
    const checked = checkedItems(listKey);
    const itemKey = (e) => `${e.ingredientId}|${e.unit.type}`;
    const allKeys = Object.values(groups).flat().map(itemKey);
    const nChecked = allKeys.filter((k) => checked.has(k)).length;

    const recipeRows = recipes.map((r) => {
      const c = this.catalogById[r.id];
      const scal = isScalable(c);
      const controls = own && scal
        ? `<span class="shop-portion-controls inkop-portions">
            <button type="button" data-inkop-portions="-2" data-id="${escapeAttr(r.id)}" aria-label="Färre portioner" ${r.portions <= 2 ? 'disabled' : ''}>−</button>
            <span class="shop-portion-display">${r.portions} port.</span>
            <button type="button" data-inkop-portions="2" data-id="${escapeAttr(r.id)}" aria-label="Fler portioner" ${r.portions >= 24 ? 'disabled' : ''}>+</button></span>`
        : `<span class="inkop-port">${r.portions} port.</span>`;
      return `<li class="inkop-recipe">
        <a class="inkop-recipe-link" href="#overview/${encodeURIComponent(r.id)}" data-open="${escapeAttr(r.id)}">${escapeHtml(r.name)} <span aria-hidden="true">›</span></a>
        <span class="inkop-recipe-right">${controls}${own ? `<button type="button" class="shop-remove-btn inkop-remove" data-inkop-remove="${escapeAttr(r.id)}" aria-label="Ta bort ${escapeAttr(r.name)}">×</button>` : ''}</span>
      </li>`;
    }).join('');

    const multi = recipes.length > 1;
    const groupHtml = Object.entries(groups).map(([name, entries]) => `
      <section class="inkop-group">
        <h3>${escapeHtml(name)}</h3>
        <ul class="inkop-items">${entries.map((e) => {
          const k = itemKey(e);
          const on = checked.has(k);
          const ingName = e.ingredient ? e.ingredient.name : e.ingredientId;
          const src = !e.recipes.length ? '' : (multi && e.recipes.length > 1
            ? e.recipes.map((s) => `${escapeHtml(s.name)} <span class="inkop-src-amt">${escapeHtml(s.amount)}</span>`).join(' · ')
            : e.recipes.map((s) => escapeHtml(s.name)).join(', '));
          return `<li class="inkop-item${on ? ' is-checked' : ''}">
            <label>
              <input type="checkbox" class="inkop-cb" data-key="${escapeAttr(k)}" ${on ? 'checked' : ''}>
              <span class="inkop-box" aria-hidden="true"></span>
              <span class="inkop-text">
                <span class="inkop-line"><span class="inkop-amt">${escapeHtml(formatNiceAmount(e.amount, e.unit.abbreviation))}</span> <span class="inkop-name">${escapeHtml(ingName)}</span></span>
                ${src ? `<span class="inkop-src">${src}</span>` : ''}
              </span>
            </label>
          </li>`;
        }).join('')}</ul>
      </section>`).join('');

    const actions = own
      ? `<button type="button" class="acc-btn acc-btn-primary inkop-share" ${items.length ? '' : 'disabled'}>${SHARE_SVG}<span>Dela</span></button>
         <button type="button" class="acc-btn inkop-copy" data-default-label="Kopiera" ${items.length ? '' : 'disabled'}>Kopiera</button>
         <button type="button" class="acc-btn inkop-clear" data-default-label="Rensa" ${items.length ? '' : 'disabled'}>Rensa</button>`
      : `<button type="button" class="acc-btn acc-btn-primary inkop-save" ${items.length ? '' : 'disabled'}>Spara som min inköpslista</button>
         <button type="button" class="acc-btn inkop-merge" ${items.length ? '' : 'disabled'}>Lägg till i min</button>
         <button type="button" class="acc-btn inkop-copy" data-default-label="Kopiera" ${items.length ? '' : 'disabled'}>Kopiera</button>`;

    const empty = own
      ? '<p class="acc-empty">Inköpslistan är tom. Kryssa i recept i <a href="#browse">receptlistan</a> eller använd <a href="#vecka">Veckoplaneraren</a>.</p>'
      : '<p class="acc-empty">Länken innehåller inga recept vi känner igen.</p>';

    const prevY = window.scrollY;
    const act = document.activeElement;
    const focusSel = act && this.el.contains(act) ? this._focusSelector(act) : null;
    this.el.innerHTML = `
      <div class="spice-page inkop-page">
        <div class="spice-head">
          <h1>${own ? 'Inköpslista' : 'Delad inköpslista'}</h1>
          <p class="spice-lede">${own
            ? 'Allt du behöver handla till recepten, med vilka recept varje vara är till. Dela listan med en länk.'
            : 'Någon har delat den här listan med dig. Spara den som din egen eller lägg till recepten i din lista.'}</p>
        </div>
        <div class="inkop-actions">${actions}<span class="inkop-flash" role="status" aria-live="polite"></span></div>
        ${items.length ? `
        <section class="inkop-card" aria-labelledby="inkop-rec-h">
          <h2 id="inkop-rec-h" class="week-h2">Recept <span class="pantry-n acc-count">${recipes.length}</span></h2>
          <ul class="inkop-recipes">${recipeRows}</ul>
        </section>
        <section class="inkop-card" aria-labelledby="inkop-ing-h">
          <div class="inkop-ing-head">
            <h2 id="inkop-ing-h" class="week-h2">Att handla</h2>
            <span class="inkop-progress">${nChecked} av ${allKeys.length} avbockade</span>
            ${nChecked ? '<button type="button" class="acc-link-btn inkop-uncheck">Avmarkera alla</button>' : ''}
          </div>
          <div class="inkop-groups">${groupHtml}</div>
        </section>` : empty}
      </div>`;
    if (this._pendingFlash && own) { this._flash(this._pendingFlash); this._pendingFlash = null; }
    else if (this._flashState && this._flashState.until > Date.now() && this._flashState.code === code) {
      const f = this.el.querySelector('.inkop-flash'); if (f) f.innerHTML = this._flashState.html; // survive re-renders
    }
    if (!changed) {
      window.scrollTo(0, prevY);
      if (focusSel) this.el.querySelector(focusSel)?.focus({ preventScroll: true });
    }
  }

  _focusSelector(el) {
    if (el.dataset.key) return `.inkop-cb[data-key="${CSS.escape(el.dataset.key)}"]`;
    if (el.dataset.inkopPortions) return `[data-inkop-portions="${el.dataset.inkopPortions}"][data-id="${CSS.escape(el.dataset.id)}"]`;
    const cls = [...el.classList].find((c) => c.startsWith('inkop-'));
    return cls ? `.${cls}` : null;
  }

  _flash(text) {
    const f = this.el.querySelector('.inkop-flash');
    if (!f) return;
    f.innerHTML = text;
    this._flashState = { html: text, until: Date.now() + 4000, code: this.code };
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { const g = this.el.querySelector('.inkop-flash'); if (g) g.textContent = ''; }, 4000);
  }

  async _copy(btn) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this._payload, null, 2));
      btn.textContent = '✓ Kopierad';
    } catch (err) {
      console.warn('[inkop] copy failed', err);
      btn.textContent = 'Kunde inte kopiera';
    }
    setTimeout(() => { if (btn.isConnected) btn.textContent = btn.dataset.defaultLabel || 'Kopiera'; }, 1500);
  }

  async _share() {
    const url = shareUrl(this._shareCode);
    const n = this._items.length;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Inköpslista', text: `Inköpslista för ${n} recept`, url });
        this._flash('Delad ✓');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this._flash(`✓ Länken är kopierad. <a href="#inkop/${escapeAttr(this._shareCode)}">Öppna den</a>`);
    } catch {
      this._flash(`Kopiera länken: <input class="inkop-url" readonly value="${escapeAttr(url)}" aria-label="Länk till inköpslistan">`);
      this.el.querySelector('.inkop-url')?.select();
    }
  }

  _takeOver(replace) {
    const items = this._items || [];
    if (replace) this.state.clearShoppingList();
    let added = 0;
    for (const it of items) {
      this.state.ensureShoppingPortions(it.id, it.portions);
      if (replace || !this.state.isShoppingRecipeSelected(it.id)) this.state.setShoppingPortions(it.id, it.portions);
      if (!this.state.isShoppingRecipeSelected(it.id)) { this.state.toggleShoppingRecipe(it.id); added++; }
    }
    // Carry the check marks over when the whole list becomes mine
    if (replace) {
      clearChecked('mine');
      for (const k of checkedItems(this.code)) setChecked('mine', k, true);
    }
    this._pendingFlash = replace ? '✓ Sparad som din inköpslista' : (added ? `✓ ${added} recept tillagda i din lista` : 'Allt fanns redan i din lista');
    location.hash = '#inkop';
    return added;
  }

  _bind() {
    this.el.addEventListener('change', (e) => {
      const cb = e.target.closest('.inkop-cb');
      if (!cb) return;
      setChecked(this.code == null ? 'mine' : this.code, cb.dataset.key, cb.checked);
      cb.closest('.inkop-item')?.classList.toggle('is-checked', cb.checked);
      const all = this.el.querySelectorAll('.inkop-cb').length;
      const on = this.el.querySelectorAll('.inkop-cb:checked').length;
      const p = this.el.querySelector('.inkop-progress');
      if (p) p.textContent = `${on} av ${all} avbockade`;
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target;
      const open = t.closest('[data-open]');
      if (open && this.onOpenOverview) { e.preventDefault(); this.onOpenOverview(open.dataset.open); return; }
      const port = t.closest('[data-inkop-portions]');
      if (port) {
        const id = port.dataset.id;
        const n = this.state.getShoppingPortions(id) + Number(port.dataset.inkopPortions);
        if (n >= 2 && n <= 24) this.state.setShoppingPortions(id, n);
        return;
      }
      const rm = t.closest('[data-inkop-remove]');
      if (rm) { const id = rm.dataset.inkopRemove; if (this.state.isShoppingRecipeSelected(id)) this.state.toggleShoppingRecipe(id); return; }
      if (t.closest('.inkop-copy')) { this._copy(t.closest('.inkop-copy')); return; }
      if (t.closest('.inkop-share')) { this._share(); return; }
      const clr = t.closest('.inkop-clear');
      if (clr) {
        if (!clr.classList.contains('is-confirming')) {
          clr.classList.add('is-confirming'); clr.textContent = 'Säker?';
          setTimeout(() => { if (clr.isConnected) { clr.classList.remove('is-confirming'); clr.textContent = 'Rensa'; } }, 2000);
          return;
        }
        this.state.clearShoppingList(); clearChecked('mine');
        return;
      }
      if (t.closest('.inkop-uncheck')) { clearChecked(this.code == null ? 'mine' : this.code); this.render(this.code); return; }
      if (t.closest('.inkop-save')) { this._takeOver(true); return; }
      if (t.closest('.inkop-merge')) { this._takeOver(false); }
    });
  }
}
