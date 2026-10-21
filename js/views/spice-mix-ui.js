/**
 * "Kryddmixar" box: one row per spice mix in the recipe with a
 * "Har inte mixen" switch (stored per mix in localStorage via spice-prefs).
 */
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g6';

const fmtG = (g) => {
  const r = g < 10 ? Math.round(g * 10) / 10 : Math.round(g);
  return `${String(r).replace('.', ',')} g`;
};

/**
 * @param {Array<{ingredientId:string,name:string,grams:number,hasRecipe:boolean,missing:boolean}>} mixes
 * @param {number} [scale=1] portion scale
 */
export function spiceMixTogglesHtml(mixes, scale = 1) {
  if (!mixes || !mixes.length) return '';
  const rows = mixes.map((m) => {
    const id = escapeAttr(m.ingredientId);
    const sub = m.missing ? 'Blandas av kryddor i skåpet' : 'Färdig mix';
    return `<li class="spice-mix-row${m.missing ? ' is-missing' : ''}">
      <span class="spice-mix-info">
        <span class="spice-mix-name">${escapeHtml(m.name)}</span>
        <span class="spice-mix-sub">${fmtG(m.grams * scale)} · ${sub}</span>
      </span>
      <label class="spice-mix-switch"${m.hasRecipe ? '' : ' title="Recept saknas"'}>
        <input type="checkbox" class="spice-mix-missing" data-mix="${id}" ${m.missing ? 'checked' : ''} ${m.hasRecipe ? '' : 'disabled'}>
        <span>Har inte mixen</span>
      </label>
    </li>`;
  }).join('');
  return `<div class="spice-mix-box"><h3 class="spice-mix-heading">Kryddmixar</h3><ul class="spice-mix-list">${rows}</ul></div>`;
}
