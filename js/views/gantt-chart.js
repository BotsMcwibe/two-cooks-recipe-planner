import { Scheduler } from '../models/scheduler.js?v=20261021g17';
import { isResource } from '../core/equipment.js?v=20261021g17';
import { kitchenProfile } from '../core/kitchen-prefs.js?v=20261021g17';

/**
 * Gantt chart view - renders the process visualization as positioned DOM divs.
 * (Legacy: not mounted at runtime; the cook page uses flow-graph.js.)
 * Resource bars (preheat oven) are dashed, and bars that wait for equipment
 * (equipment[].after) carry a dashed left edge, the Gantt form of an equipment edge.
 */
export class GanttChart {
  constructor() {
    this.$container = $('#gantt-chart');
  }

  render(rootRecipe, subtreeRecipes, options) {
    const sched = new Scheduler(rootRecipe, subtreeRecipes, { ...options, kitchen: kitchenProfile() });
    const { nodes, rows, totalTime } = sched.getSchedule();
    const rowHeight = 40;
    const THRESHOLD_PCT = 2;

    const $chart = $('<div>').addClass('gantt-chart').css({
      position: 'relative',
      height: `${rows.length * rowHeight}px`
    });

    // Prep completion line
    let prepEnd = null;
    if (options.prepFirst) {
      prepEnd = this._calcPrepEnd(nodes);
    }

    // Render bars
    nodes.forEach(node => {
      const leftPct = (node.start / totalTime) * 100;
      const activePct = (node.activeDuration / totalTime) * 100;
      const totalPct = (node.totalDuration / totalTime) * 100;
      const waitPct = totalPct - activePct;

      const cookClass = node.assignedCook
        ? (node.assignedCook === 'P1' ? 'cook-p1' : 'cook-p2')
        : '';

      const barGap = 6;
      const eqClass = `${isResource(node.recipe) ? ' gantt-resource' : ''}${(node.eqDeps || []).length ? ' gantt-after-equipment' : ''}`;
      const $bar = $('<div>').addClass(`gantt-bar ${cookClass}${eqClass}`).css({
        position: 'absolute',
        left: `${leftPct}%`,
        top: `${node.row * rowHeight + barGap / 2}px`,
        width: `${totalPct}%`,
        height: `${rowHeight - barGap}px`
      });

      $('<div>').addClass('gantt-active').css({
        width: `${(activePct / totalPct) * 100}%`
      }).appendTo($bar);

      if (waitPct >= THRESHOLD_PCT) {
        $('<div>').addClass('gantt-wait').css({
          position: 'absolute',
          left: `${(activePct / totalPct) * 100}%`,
          width: `${(waitPct / totalPct) * 100}%`,
          height: '100%'
        }).appendTo($bar);
      }

      const titleText = node.assignedCook
        ? `${node.assignedCook}: ${node.recipe.name}`
        : node.recipe.name;

      $('<span>').addClass('gantt-label gantt-title').text(titleText).appendTo($bar);

      const durText = waitPct >= THRESHOLD_PCT
        ? `${node.activeDuration} + ${node.totalDuration - node.activeDuration} min`
        : `${node.activeDuration} min`;
      $('<span>').addClass('gantt-label gantt-duration').text(durText).appendTo($bar);

      $chart.append($bar);
    });

    // Prep completion line
    if (prepEnd !== null && prepEnd > 0) {
      const pct = (prepEnd / totalTime) * 100;
      $('<div>').addClass('gantt-marker gantt-prep-line').css({
        left: `${pct}%`, height: `${rows.length * rowHeight}px`
      }).appendTo($chart);
      $('<div>').addClass('gantt-marker-label gantt-prep-label')
        .text(`Förb. klar (${Math.round(prepEnd)} min)`)
        .css({ left: `${pct}%`, top: `${rows.length * rowHeight + 5}px` })
        .appendTo($chart);
    }

    // Total time line
    $('<div>').addClass('gantt-marker gantt-total-line').css({
      left: '100%', height: `${rows.length * rowHeight}px`
    }).appendTo($chart);
    $('<div>').addClass('gantt-marker-label gantt-total-label')
      .text(`Total tid (${Math.round(totalTime)} min)`)
      .css({ left: '100%', top: `${rows.length * rowHeight + 5}px` })
      .appendTo($chart);

    // Time axis
    const $axis = $('<div>').addClass('gantt-axis');
    const interval = 5;
    const ticks = Math.floor(totalTime / interval);
    for (let i = 0; i <= ticks; i++) {
      const t = Math.round(i * interval);
      const left = (t / totalTime) * 100;
      $('<div>').addClass('gantt-tick').css({ left: `${left}%` }).appendTo($axis);
      $('<div>').addClass('gantt-tick-label').css({ left: `${left}%` }).text(`${t} min`).appendTo($axis);
    }
    if (totalTime % interval !== 0) {
      $('<div>').addClass('gantt-tick gantt-tick-end').css({ left: '100%' }).appendTo($axis);
      $('<div>').addClass('gantt-tick-label').css({ left: '100%' }).text(`${Math.round(totalTime)} min`).appendTo($axis);
    }

    // Prep / cook times as icons (no "Flödesdiagram" or cook-count heading).
    // Times only exist when prep-first produced a prep end, same as before.
    this.$container.empty();
    if (prepEnd !== null && prepEnd > 0) {
      const prepMin = Math.round(prepEnd);
      const cookMin = Math.round(Math.max(totalTime - prepEnd, 0));
      const $times = $(`
        <div class="gantt-times">
          <span class="gantt-time">
            <span class="gantt-time-icon" title="Förberedelser">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14.2 3.6c2.6 2 4 5 3.5 8.4L8.4 20.2a1.8 1.8 0 0 1-2.6-.1l-.5-.5a1.8 1.8 0 0 1 .1-2.5L14.6 6.2"/>
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3.8 20.6h5.2"/>
              </svg>
            </span>
            <span>${prepMin} min</span>
          </span>
          <span class="gantt-time">
            <span class="gantt-time-icon" title="Tillagning">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12.1 2.4c.3 2.4-.7 4-1.8 5.2 1.5.2 3.2 1.3 4 3-1.1-.4-2-.1-2.6-1.8-.2 2.2 1.1 3.9 3 4.8 1.6 2.6 2.8 4.2 2.8 5.6 0 1.7-2.4 2.8-5.2 2.8s-5-1.1-5-2.8c0-2.4 1.5-4 2.4-5.7.5-1 .7-2 .4-3.1-1.1 1.3-1.5 2.8-1.3 4.1C7.2 13 6.8 11 7.9 8.8c1.3-2.6 3.1-4.3 4.2-6.4z"/>
              </svg>
            </span>
            <span>${cookMin} min</span>
          </span>
        </div>
      `);
      this.$container.append($times);
    }
    this.$container.append($chart, $axis);
  }

  _calcPrepEnd(nodes) {
    let max = 0;
    const prepWords = ['skär', 'hacka', 'skala', 'rensa', 'marinera', 'mät', 'väg'];
    nodes.forEach(n => {
      const isPrep = n.recipe.hasTag && n.recipe.hasTag('prep');
      const hasPrep = n.recipe.steps && n.recipe.steps.some(s => {
        const txt = (typeof s === 'string' ? s : '').toLowerCase();
        return prepWords.some(w => txt.includes(w));
      });
      if (isPrep || hasPrep) {
        max = Math.max(max, n.start + n.activeDuration);
      }
    });
    return max;
  }
}
