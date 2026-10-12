import { RecipeGraph } from '../core/recipe-graph.js?v=20261012e';
import { formatNiceAmount } from '../utils/helpers.js';

/**
 * Precook view - gantt chart + base ingredients list.
 */
export class PrecookView {
  constructor(state, ganttChart) {
    this.state = state;
    this.ganttChart = ganttChart;
    this.$ingredients = $('#precook-ingredients');
  }

  /**
   * @param {object} rootRecipe
   * @param {Array} subtreeRecipes
   * @param {import('../core/recipe-graph.js?v=20261012e').RecipeGraph} graph - scaled graph
   * @param {Array} baseIngredients - pantry ingredients only
   * @param {object} options
   * @param {number} portionScale
   */
  render(rootRecipe, subtreeRecipes, graph, baseIngredients, options, portionScale) {
    this.ganttChart.render(rootRecipe, subtreeRecipes, options);

    const baseIngs = RecipeGraph.getBaseIngredients(baseIngredients, subtreeRecipes);
    const { totals, units } = graph.computeBaseIngredientTotals(rootRecipe);

    let html = '<h3>Ingredienser</h3><ul class="ingredient-list">';
    let any = false;
    for (const ing of baseIngs) {
      const total = totals[ing.id] || 0;
      const unitAbbr = units[ing.id] || '';
      if (total > 0) {
        html += `<li><span class="ing-amount">${formatNiceAmount(total, unitAbbr)}</span><span class="ing-name">${ing.name}</span></li>`;
        any = true;
      }
    }
    if (!any) html += '<li>Inga ingredienser</li>';
    html += '</ul>';
    this.$ingredients.html(html);
  }
}
