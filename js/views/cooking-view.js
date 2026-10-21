import { Scheduler } from '../models/scheduler.js?v=20261021g9';
import { RecipeGraph } from '../core/recipe-graph.js?v=20261021g9';
import { equipmentItemName, equipmentSummary, isResource, nodeEquipmentHtml, servingItems, stepHeatHtml } from '../core/equipment.js?v=20261021g9';
import { kitchenProfile } from '../core/kitchen-prefs.js?v=20261021g9';
import { formatNiceAmount } from '../utils/helpers.js';
import { formatStepInputText, producerMap } from '../utils/derived-inputs.js?v=20261021g9';
import {
  allergenLabel,
  difficultyLabel,
  displayTags,
  escapeAttr,
  escapeHtml,
  starHtml,
} from '../utils/catalog-ui.js?v=20261021g9';
import { imgFailed, isPhotoMissing, recordPhotoFailure, recordPhotoSuccess } from '../utils/photo-fallback.js?v=20261021g9';
import * as UserState from '../core/user-recipe-state.js?v=20261021g9';
import { bindStatusControls, kitchenMarkHtml, refreshStatusControls, statusControlHtml } from './recipe-status-ui.js?v=20261021g9';
import { joinStepParts, sentenceCase } from '../utils/text.js?v=20261021g9';

/**
 * Cooking view - rich recipe page with hero, meta, ingredients, nutrition,
 * and ordered steps with timers. Step photos from images.byNode when present.
 *
 * Soft updates (step checkbox changes) patch the DOM in place so images/timers
 * are not destroyed. Full rebuilds (scheduler/portion) adopt existing <img>
 * nodes when the src is unchanged to avoid flicker.
 */
export class CookingView {
  constructor(state) {
    this.state = state;
    this.$hero = $('#cooking-hero');
    this.$header = $('#cooking-header');
    this.$nutrition = $('#cooking-nutrition');
    this.$steps = $('#cooking-steps');
    this.$ingredients = $('#cooking-ingredients');
    this.$layout = $('#cooking-layout');
    /** @type {string|null} last hero src we rendered */
    this._heroSrc = null;
    /** True when every step is checked (offers "Markera som lagad"). */
    this._allDone = false;
    this._bindEvents();
    bindStatusControls(this.$header);
    UserState.subscribe((id) => {
      refreshStatusControls(this.$header, id, { allDone: this._allDone });
    });
  }

  /**
   * @param {object} [meta]
   * @param {object|null} [meta.images]
   * @param {object|null} [meta.nutrition]
   * @param {string} [meta.recipeName]
   * @param {number} [meta.portionScale]
   * @param {number} [meta.currentPortions]
   * @param {object|null} [meta.catalogEntry]
   * @param {boolean} [meta.softUpdate] — patch step DOM in place when possible
   * @param {boolean} [meta.autoScroll] — scroll to current step (default false)
   * @returns {{ schedule: object|null, progress: { doneIds: Set<string>, activeId: string|null, counts: Map<string,{done:number,total:number}> } }}
   */
  render(rootRecipe, subtreeRecipes, graph, baseIngredients, options, meta = {}) {
    this._byNode = (meta.images && meta.images.byNode) || {};
    this._kitchen = kitchenProfile();
    this._portions = meta.currentPortions || null;
    // Same scheduler the flow graph uses. Header minutes follow this makespan
    // (prep-first / 2 cooks / kitchen profile included), not catalog totalMinutes.
    const schedule = rootRecipe
      ? new Scheduler(rootRecipe, subtreeRecipes, { ...options, kitchen: this._kitchen }).getSchedule()
      : null;
    const stepsModel = this._buildStepsModel(schedule);
    this._allDone = stepsModel.length > 0 && stepsModel.every(s => s.completed);
    this._renderHero(meta.images, meta.recipeName || rootRecipe?.name || '');
    this._renderHeader(meta, schedule);
    this._renderNutrition(meta.nutrition, meta.portionScale ?? 1, meta.currentPortions);
    this._renderIngredients(rootRecipe, subtreeRecipes, graph, baseIngredients);

    const soft = meta.softUpdate === true;
    if (soft && this._canPatchSteps(stepsModel)) {
      this._patchSteps(stepsModel);
    } else {
      this._renderStepsFull(stepsModel);
    }

    if (meta.autoScroll) {
      this._scrollToCurrent();
    }

    return { schedule, progress: this._progressFrom(stepsModel) };
  }

  /**
   * Per-node progress for the flow graph: done = every step checked,
   * active = node holding the current (first unchecked, enabled) step.
   */
  _progressFrom(steps) {
    const counts = new Map();
    for (const s of steps) {
      const c = counts.get(s.recipeId) || { done: 0, total: 0 };
      c.total += 1;
      if (s.completed) c.done += 1;
      counts.set(s.recipeId, c);
    }
    const doneIds = new Set();
    for (const [id, c] of counts) if (c.total && c.done === c.total) doneIds.add(id);
    const cur = steps.find(s => !s.completed && s.enabled);
    return { doneIds, activeId: cur ? String(cur.recipeId) : null, counts };
  }

  /**
   * Scroll to the next unchecked step (page order) whose node uses this base ingredient
   * directly. Kryddmix components are inputs of the "Blanda …" node, so they land there.
   */
  jumpToIngredient(ingId) {
    const users = new Set();
    for (const r of this._subtree || []) {
      if ((r.inputs || []).some(i => i.ingredient && i.ingredient.id === ingId)) users.add(String(r.outputIngredient.id));
    }
    const items = this.$steps.find('.step-item').toArray();
    const next = items.find(el => users.has(String(el.dataset.recipe)) && !el.querySelector('.step-cb')?.checked);
    if (!next) {
      this._toast(users.size ? 'Redan använd' : 'Används inte i något steg');
      return;
    }
    this.scrollToGroup(next.dataset.recipe);
  }

  _toast(text) {
    let el = document.getElementById('cook-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cook-toast';
      el.className = 'cook-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('is-visible');
    void el.offsetWidth;
    el.classList.add('is-visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1600);
  }

  /** Scroll the page so the step group for a node is in view (flow-graph click). */
  scrollToGroup(recipeId) {
    const $g = this.$steps.find(`.recipe-group[data-recipe="${CSS.escape(String(recipeId))}"]`);
    if (!$g.length) return;
    const top = Math.max($g.offset().top - 16, 0);
    window.scrollTo({ top, behavior: 'smooth' });
    $g.removeClass('flash');
    // restart the highlight animation
    void $g[0].offsetWidth;
    $g.addClass('flash');
    setTimeout(() => $g.removeClass('flash'), 1600);
  }

  _renderHero(images, recipeName) {
    const main = images && typeof images.main === 'string' ? images.main.trim() : '';
    if (!main || this._heroFailed === main || isPhotoMissing(main)) {
      // No photo, or it already failed to load (recipe photos are not deployed): no empty frame
      this._heroSrc = null;
      this.$hero.attr('hidden', true).empty();
      return;
    }
    // Keep existing <img> if src unchanged — avoids reload/flicker on re-render
    if (this._heroSrc === main && this.$hero.find('img.cooking-hero-img').length) {
      this.$hero.removeAttr('hidden');
      return;
    }
    const alt = recipeName ? `Bild: ${recipeName}` : 'Receptbild';
    this._heroSrc = main;
    this.$hero
      .html(`<img class="cooking-hero-img" src="${escapeAttr(main)}" alt="${escapeAttr(alt)}" loading="eager" decoding="async">`)
      .removeAttr('hidden');
    const img = this.$hero.find('img.cooking-hero-img')[0];
    const onFail = () => {
      recordPhotoFailure(main);
      this._heroFailed = main;
      if (this._heroSrc === main) {
        this._heroSrc = null;
        this.$hero.attr('hidden', true).empty();
      }
    };
    if (img) {
      img.addEventListener('error', onFail, { once: true });
      img.addEventListener('load', () => recordPhotoSuccess(main), { once: true });
      if (imgFailed(img)) onFail();
    }
  }

  /**
   * @param {object|null} [schedule] Scheduler.getSchedule() for the current options
   */
  _renderHeader(meta, schedule) {
    if (!this.$header.length) return;
    const entry = meta.catalogEntry || {};
    const name = meta.recipeName || entry.name || '';
    const makespan = schedule && Number.isFinite(schedule.totalTime)
      ? Math.round(schedule.totalTime)
      : null;
    const mins = makespan != null
      ? `${makespan} min`
      : (entry.totalMinutes != null ? `${entry.totalMinutes} min` : '');
    const diff = difficultyLabel(entry.difficulty);
    const rating = starHtml(entry.ratingAverage, entry.ratingCount);
    const tags = displayTags(entry, 4).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');
    const allergens = (entry.allergens || [])
      .map(a => `<span class="allergen-chip">${escapeHtml(allergenLabel(a))}</span>`)
      .join('');

    let kcal = '';
    const pp = meta.nutrition?.perPortion;
    if (pp && typeof pp.energyKcal === 'number') {
      kcal = `${Math.round(pp.energyKcal)} kcal`;
    }

    let html = `<h2 class="cooking-title">${escapeHtml(name)}</h2>`;
    html += '<div class="cooking-meta-bar">';
    if (rating) html += `<span class="overview-rating">${rating}</span>`;
    if (mins) html += `<span class="meta-item">${escapeHtml(mins)}</span>`;
    if (kcal) html += `<span class="meta-item">${escapeHtml(kcal)}</span>`;
    if (diff) html += `<span class="meta-item">${escapeHtml(diff)}</span>`;
    if (meta.currentPortions) {
      html += `<span class="meta-item">${meta.currentPortions} portioner</span>`;
    }
    html += '</div>';
    if (tags) html += `<div class="overview-tags">${tags}</div>`;
    const statusId = entry.id || this.state.selectedRecipeId;
    if (statusId) html += kitchenMarkHtml(statusId) + statusControlHtml(statusId, { allDone: this._allDone });
    if (allergens) {
      html += `<div class="overview-allergens"><span class="allergens-label">Allergener:</span> ${allergens}</div>`;
    }
    this.$header.html(html).removeAttr('hidden');
  }

  _renderNutrition(nutrition, portionScale, currentPortions) {
    const pp = nutrition && nutrition.perPortion;
    if (!pp || typeof pp !== 'object') {
      // No nutrition data → do not render the block at all
      this.$nutrition.attr('hidden', true).empty();
      return;
    }

    const fmtKcal = (v) => String(Math.round(v));
    const fmtG = (v) => {
      const rounded = Math.round(v * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };

    const items = [];
    if (typeof pp.energyKcal === 'number') {
      items.push({ label: 'kcal', value: fmtKcal(pp.energyKcal), key: 'kcal' });
    }
    if (typeof pp.proteinG === 'number') {
      items.push({ label: 'Protein', value: `${fmtG(pp.proteinG)} g`, key: 'protein' });
    }
    if (typeof pp.fatG === 'number') {
      items.push({ label: 'Fett', value: `${fmtG(pp.fatG)} g`, key: 'fat' });
    }
    if (typeof pp.carbsG === 'number') {
      items.push({ label: 'Kolhydrater', value: `${fmtG(pp.carbsG)} g`, key: 'carbs' });
    }
    if (typeof pp.fiberG === 'number') {
      items.push({ label: 'Fiber', value: `${fmtG(pp.fiberG)} g`, key: 'fiber' });
    }
    if (typeof pp.saltG === 'number') {
      items.push({ label: 'Salt', value: `${fmtG(pp.saltG)} g`, key: 'salt' });
    }

    if (!items.length) {
      this.$nutrition.attr('hidden', true).empty();
      return;
    }

    const portionsNote = ' · per portion';
    let html = `<div class="nutrition-strip-header">Näringsvärde${portionsNote}</div>`;
    html += '<ul class="nutrition-strip">';
    for (const it of items) {
      html += `<li class="nutrition-item nutrition-${it.key}"><span class="nutrition-value">${it.value}</span><span class="nutrition-label">${it.label}</span></li>`;
    }
    html += '</ul>';
    this.$nutrition.html(html).removeAttr('hidden');
  }

  /**
   * Build flat step list in schedule order. With Preppa först the Scheduler already
   * puts cold prep first wherever that does not delay the meal; steps that must start
   * early (oven preheat before a long roast, boiling water…) keep their early slot, so
   * the list and the current step simply follow schedule start times.
   * @returns {Array<object>}
   */
  _buildStepsModel(schedule) {
    const nodes = schedule?.nodes || [];
    const sorted = [...nodes].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const aPrep = a.recipe.hasTag && a.recipe.hasTag('prep');
      const bPrep = b.recipe.hasTag && b.recipe.hasTag('prep');
      return (bPrep ? 1 : 0) - (aPrep ? 1 : 0);
    });

    const checkedIds = this.state.checkedIngredients;
    const steps = [];

    sorted.forEach(node => {
      const recipe = node.recipe;
      const inputsReady = recipe.inputs.every(input => {
        const isBase = !nodes.some(n => n.recipe.outputIngredient.id === input.ingredient.id);
        return isBase || checkedIds.includes(input.ingredient.id);
      }) && (node.eqDeps || []).every(id => checkedIds.includes(id)); // preheated oven, previous pan user

      recipe.steps.forEach((step, idx) => {
        const prevDone = idx === 0 || Array.from({ length: idx }, (_, i) => i)
          .every(i => this.state.isStepCompleted(recipe.outputIngredient.id, i));
        steps.push({
          recipeId: recipe.outputIngredient.id,
          recipeName: recipe.name,
          recipe,
          stepIndex: idx,
          step,
          completed: this.state.isStepCompleted(recipe.outputIngredient.id, idx),
          enabled: inputsReady && prevDone,
          hasTimer: (recipe.wait || 0) > 0 && idx === recipe.steps.length - 1 && !(recipe.hasTag && recipe.hasTag('no-timer')),
          wait: recipe.wait || 0,
          totalSteps: recipe.steps.length,
          assignedCook: node.assignedCook || null,
        });
      });
    });

    return steps;
  }

  /** Group steps by recipeId preserving first-seen order. */
  _groupSteps(steps) {
    const order = [];
    const map = new Map();
    for (const s of steps) {
      if (!map.has(s.recipeId)) {
        map.set(s.recipeId, []);
        order.push(s.recipeId);
      }
      map.get(s.recipeId).push(s);
    }
    return { order, map };
  }

  /**
   * True when a recipe group has no incomplete+enabled steps
   * (all done, or nothing actionable left).
   */
  _groupNoStartable(groupSteps) {
    if (!groupSteps.length) return true;
    return !groupSteps.some(s => !s.completed && s.enabled);
  }

  _canPatchSteps(steps) {
    const $groups = this.$steps.find('.recipe-group');
    if (!$groups.length) return false;
    const { order, map } = this._groupSteps(steps);
    if ($groups.length !== order.length) return false;
    for (let i = 0; i < order.length; i++) {
      const $g = $($groups[i]);
      if (String($g.data('recipe')) !== String(order[i])) return false;
      const groupSteps = map.get(order[i]);
      const $items = $g.find('.step-item');
      if ($items.length !== groupSteps.length) return false;
      for (let j = 0; j < groupSteps.length; j++) {
        const $it = $($items[j]);
        if (String($it.data('recipe')) !== String(groupSteps[j].recipeId)) return false;
        if (String($it.data('step')) !== String(groupSteps[j].stepIndex)) return false;
      }
    }
    return true;
  }

  /**
   * In-place update of checkboxes / enabled / current / grayscale.
   * Leaves <img> and timer rows untouched.
   */
  _patchSteps(steps) {
    const firstCurrent = steps.findIndex(s => !s.completed && s.enabled);
    const { order, map } = this._groupSteps(steps);

    for (const recipeId of order) {
      const groupSteps = map.get(recipeId);
      const $g = this.$steps.find(`.recipe-group[data-recipe="${CSS.escape(String(recipeId))}"]`);
      if (!$g.length) continue;

      const noStartable = this._groupNoStartable(groupSteps);
      $g.toggleClass('no-startable', noStartable);

      for (const s of groupSteps) {
        const $item = $g.find(`.step-item[data-step="${s.stepIndex}"]`);
        if (!$item.length) continue;
        const $cb = $item.find('.step-cb');
        $cb.prop('checked', !!s.completed);
        $cb.prop('disabled', !s.enabled);
        $item.toggleClass('disabled', !s.enabled);
        const idx = steps.indexOf(s);
        $item.toggleClass('current-step', idx === firstCurrent);
      }
    }
  }

  _renderStepsFull(steps) {
    // Adopt existing images before wipe so same-src photos don't reload
    const savedImgs = new Map();
    this.$steps.find('.recipe-group').each((_, el) => {
      const id = String($(el).data('recipe') || '');
      const img = $(el).find('.step-node-photo img')[0];
      if (id && img) savedImgs.set(id, img);
    });

    const firstCurrent = steps.findIndex(s => !s.completed && s.enabled);
    let html = '<h3>Gör så här</h3><ol class="steps-list cooking-steps-numbered">';
    let globalNum = 0;

    const { order, map } = this._groupSteps(steps);

    for (const recipeId of order) {
      const groupSteps = map.get(recipeId);
      const first = groupSteps[0];
      const nodeImg = this._byNode[recipeId];
      const noStartable = this._groupNoStartable(groupSteps);
      const groupClass = noStartable ? 'recipe-group no-startable' : 'recipe-group';

      const cook = first.assignedCook === 'P1' || first.assignedCook === 'P2' ? first.assignedCook : '';
      html += `<li class="${groupClass}" data-recipe="${escapeAttr(recipeId)}">`;
      if (nodeImg && !isPhotoMissing(nodeImg)) {
        html += `<div class="step-node-photo"><img src="${escapeAttr(nodeImg)}" alt="" loading="lazy" decoding="async" data-node-src="${escapeAttr(nodeImg)}"></div>`;
      }
      html += `<div class="recipe-group-header${cook ? ' has-cook-badge' : ''}">`;
      html += `<strong>${escapeHtml(sentenceCase(first.recipeName))}</strong>`;
      const needs = this._formatStepInputs(first.recipe.inputs, steps);
      if (needs) {
        html += `<span class="recipe-needs">${needs}</span>`;
      }
      const eqHtml = nodeEquipmentHtml(first.recipe, this._kitchen);
      if (eqHtml) html += eqHtml;
      if (cook) {
        const cookClass = cook === 'P1' ? 'cook-p1' : 'cook-p2';
        const cookTitle = cook === 'P1' ? 'Kock 1' : 'Kock 2';
        html += `<span class="cook-badge ${cookClass}" title="${cookTitle}">${cook}</span>`;
      }
      html += '</div><div class="recipe-steps">';

      for (const s of groupSteps) {
        globalNum += 1;
        const i = steps.indexOf(s);
        const disClass = s.enabled ? '' : 'disabled';
        const curClass = i === firstCurrent ? 'current-step' : '';
        html += `<div class="step-item ${disClass} ${curClass}" data-recipe="${escapeAttr(s.recipeId)}" data-step="${s.stepIndex}">`;
        html += `<label class="step-label">`;
        html += `<span class="step-number">${globalNum}</span>`;
        html += `<input type="checkbox" class="step-cb" data-recipe="${escapeAttr(s.recipeId)}" data-step="${s.stepIndex}" ${s.completed ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}>`;
        html += `<span class="step-text">${this._stringifyStep(s.step)}${stepHeatHtml(s.recipe, s.stepIndex)}</span>`;
        html += `</label>`;

        if (s.hasTimer) {
          const mins = Math.floor(s.wait);
          const secs = Math.floor((s.wait - mins) * 60);
          const dur = `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
          html += `<div class="timer-row">`;
          html += `<button type="button" class="timer-minus">−</button>`;
          html += `<span class="timer-display">${dur}</span>`;
          html += `<button type="button" class="timer-plus">+</button>`;
          html += `<button type="button" class="timer-start">Starta timer</button>`;
          html += `<button type="button" class="timer-reset" style="display:none">Återställ</button>`;
          html += `</div>`;
        }
        html += '</div>';
      }
      html += '</div></li>';
    }

    html += '</ol>';
    this.$steps.html(html);

    // Step photos that already failed (cached 404) before the error listener saw them
    this.$steps.find('.step-node-photo img').each((_, img) => {
      if (imgFailed(img)) {
        recordPhotoFailure(img.getAttribute('data-node-src') || img.getAttribute('src'));
        img.closest('.step-node-photo').remove();
      }
    });

    // Reuse previous <img> elements when src matches (avoids decode/layout jump)
    this.$steps.find('.recipe-group').each((_, el) => {
      const id = String($(el).data('recipe') || '');
      const old = savedImgs.get(id);
      const $slot = $(el).find('.step-node-photo img');
      if (!old || !$slot.length) return;
      const intended = $slot.attr('data-node-src') || $slot.attr('src');
      const oldIntended = old.getAttribute('data-node-src') || old.getAttribute('src');
      // Compare intended paths; also accept if browser-resolved src ends with same path
      if (intended && oldIntended && (intended === oldIntended || old.src.endsWith(intended.replace(/^\.\//, '')))) {
        $slot.replaceWith(old);
      }
    });
  }

  _scrollToCurrent() {
    const $cur = this.$steps.find('.current-step').first();
    if (!$cur.length) return;
    const top = $cur.offset().top - 140;
    $('html, body').stop(true).scrollTop(Math.max(top, 0));
  }

  /**
   * Ingredient list for a step title. No "Behöver"/"Skapar" labels.
   * Derived inputs hide their amount unless split (see utils/derived-inputs.js).
   */
  _formatStepInputs(inputs, steps) {
    const producers = producerMap(steps);
    // A resource (preheated oven) is equipment, shown as a chip, never as an ingredient
    return inputs
      .filter(inp => !isResource(producers.get(inp.ingredient?.id)))
      .map(inp => escapeHtml(formatStepInputText(inp, producers))).join(', ');
  }

  _stringifyStep(step) {
    if (!Array.isArray(step)) return escapeHtml(step);
    const texts = [];
    const isText = [];
    for (const part of step) {
      if (part && typeof part === 'object') {
        if (part.type === 'equipment') {
          // Equipment: italic + dotted underline (not colour), distinct from bold ingredients
          texts.push(`<em class="step-eq">${escapeHtml(part.text || part.key || '')}</em>`);
          isText.push(false);
          continue;
        }
        if (part.type === 'ingredient' && part.ingredient?.json?.name) {
          texts.push(`<strong>${escapeHtml(part.ingredient.json.name)}</strong>`);
        } else if (part.name) {
          texts.push(`<strong>${escapeHtml(part.name)}</strong>`);
        } else {
          texts.push(escapeHtml(JSON.stringify(part)));
        }
        isText.push(false);
      } else {
        texts.push(escapeHtml(part));
        isText.push(true);
      }
    }
    return joinStepParts(texts, isText);
  }

  _renderIngredients(rootRecipe, subtreeRecipes, graph, baseIngredients) {
    this._subtree = [...subtreeRecipes];
    const baseIngs = RecipeGraph.getBaseIngredients(baseIngredients, subtreeRecipes);
    const { totals, units } = graph.computeBaseIngredientTotals(rootRecipe);
    const checked = RecipeGraph.getCheckedBaseIngredientTotals(subtreeRecipes, this.state.checkedIngredients);

    let html = '<h3>Ingredienser kvar</h3><ul class="ingredient-list">';
    let any = false;
    for (const ing of baseIngs) {
      const total = totals[ing.id] || 0;
      const used = checked.amounts[ing.id] || 0;
      const remaining = Math.max(total - used, 0);
      const unitAbbr = units[ing.id] || '';
      if (remaining > 0) {
        html += `<li class="ing-jump" role="button" tabindex="0" data-ing="${escapeAttr(ing.id)}" title="Visa nästa steg med ${escapeAttr(ing.name)}"><span class="ing-amount">${formatNiceAmount(remaining, unitAbbr)}</span><span class="ing-name">${escapeHtml(ing.name)}</span></li>`;
        any = true;
      }
    }
    if (!any) html += '<li>Alla ingredienser förbrukade</li>';
    html += '</ul>';
    const eq = this._equipmentRowsHtml(this._subtree, this._kitchen || kitchenProfile());
    if (eq) html += `<div class="eq-section"><h3>Utrustning</h3>${eq}</div>`;
    const serving = this._servingRowsHtml(rootRecipe);
    if (serving) html += `<div class="eq-section eq-serving-section"><h3>Servering</h3>${serving}</div>`;
    this.$ingredients.html(html);
  }

  /** Utrustning as rows in the same style as Ingredienser kvar (amount column + name). */
  _equipmentRowsHtml(recipes, kitchen) {
    const items = equipmentSummary(recipes, kitchen);
    if (!items.length) return '';
    const guess = ''; // guessed sizes are not shown to users
    const rows = items.map(it => {
      let amount = `${it.count} st`;
      let name = escapeHtml(it.label);
      if (it.kind === 'oven') {
        const m = /^Ugn (ca )?(\d+) °C( varmluft)?(.*)$/.exec(it.label);
        if (m) {
          amount = `${m[1] || ''}${m[2]} °C`;
          name = escapeHtml(`Ugn${m[3] ? ', varmluft' : ''}${m[4] || ''}`);
        } else {
          amount = '';
        }
      } else {
        name = escapeHtml(equipmentItemName(it));
        if (it.optional) name += ' <span class="eq-optional">(valfritt)</span>';
        if (it.guess) name += guess;
      }
      return `<li class="eq-row eq-${it.kind}"><span class="ing-amount">${amount}</span><span class="ing-name">${name}</span></li>`;
    }).join('');
    return `<ul class="ingredient-list eq-rows">${rows}</ul>`;
  }

  /** Servering (master `serving`): "4 st Tallrikar", scaled with the chosen portions. */
  _servingRowsHtml(rootRecipe) {
    const items = servingItems(rootRecipe, this._portions || rootRecipe?.basePortions);
    if (!items.length) return '';
    const rows = items.map(it => `<li class="eq-row eq-serving-row"><span class="ing-amount">${it.count} st</span><span class="ing-name">${escapeHtml(it.label)}</span></li>`).join('');
    return `<ul class="ingredient-list eq-rows">${rows}</ul>`;
  }

  _bindEvents() {
    // Step photos that fail to load: drop the frame (no broken-image icon)
    const stepsEl = this.$steps[0];
    if (stepsEl) {
      stepsEl.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.closest('.step-node-photo')) return;
        recordPhotoFailure(img.getAttribute('data-node-src') || img.getAttribute('src'));
        img.closest('.step-node-photo').remove();
      }, true);
    }
    // Tap an ingredient → next unchecked step that uses it (same scroll + flash as the flow graph)
    this.$ingredients.on('click', '.ing-jump', (e) => this.jumpToIngredient(String(e.currentTarget.dataset.ing)));
    this.$ingredients.on('keydown', '.ing-jump', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.jumpToIngredient(String(e.currentTarget.dataset.ing));
      }
    });
    this.$steps.on('change', '.step-cb', (e) => {
      const $cb = $(e.target);
      const recipeId = $cb.data('recipe');
      const stepIdx = String($cb.data('step'));
      this._handleStepChange(recipeId, stepIdx, $cb.prop('checked'));
    });

    this.$steps.on('click', '.step-item', (e) => {
      if ($(e.target).closest('.timer-row').length) return;
      // Clicks inside the <label> already toggle the checkbox natively;
      // toggling again here would undo it (tap = flash, no change).
      if ($(e.target).is('.step-cb') || $(e.target).closest('.step-label').length) return;
      const $item = $(e.currentTarget);
      if ($item.hasClass('disabled')) return;
      const $cb = $item.find('.step-cb');
      if ($cb.length && !$cb.prop('disabled')) {
        $cb.prop('checked', !$cb.prop('checked')).trigger('change');
      }
    });
  }

  _handleStepChange(recipeId, stepIndex, checked) {
    if (checked) {
      this.state.completeStep(recipeId, parseInt(stepIndex));
    } else {
      this.state.uncompleteStep(recipeId, parseInt(stepIndex));
    }
    this.state.bus.emit('stepChange', recipeId, stepIndex, checked);
  }
}
