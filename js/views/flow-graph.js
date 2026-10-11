import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261011p';
import { sentenceCase } from '../utils/text.js?v=20261011';
import { prepPhaseIds, isPrepTagged } from '../utils/prep-phase.js?v=20261011b';

/**
 * Flow graph for the cook page: a left-to-right dependency graph of the recipe's
 * cooking nodes (replaces the old Gantt timeline).
 *
 * Layout follows tools/graph-viewer.html: column = maxDepth − longest path to the
 * master node (so the master is the last column, "steg 1 … master"), then a tidy-tree
 * pass where leaves take sequential slots and parents centre on their inputs, then
 * per-column overlap resolution. Cards are HTML (so names wrap and are never
 * truncated); their measured heights feed the layout; edges are an SVG layer.
 *
 * Progress: render() is called on every UI update with { doneIds, activeId,
 * progress }. When the structure is unchanged only state classes are patched;
 * when the active node changes the scroll container scrolls it into view.
 */

const GAP_Y = 14;
const TOP_PAD = 26; // room for the column captions

const KNIFE_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.2 3.6c2.6 2 4 5 3.5 8.4L8.4 20.2a1.8 1.8 0 0 1-2.6-.1l-.5-.5a1.8 1.8 0 0 1 .1-2.5L14.6 6.2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3.8 20.6h5.2"/></svg>`;

const FLAME_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.1 2.4c.3 2.4-.7 4-1.8 5.2 1.5.2 3.2 1.3 4 3-1.1-.4-2-.1-2.6-1.8-.2 2.2 1.1 3.9 3 4.8 1.6 2.6 2.8 4.2 2.8 5.6 0 1.7-2.4 2.8-5.2 2.8s-5-1.1-5-2.8c0-2.4 1.5-4 2.4-5.7.5-1 .7-2 .4-3.1-1.1 1.3-1.5 2.8-1.3 4.1C7.2 13 6.8 11 7.9 8.8c1.3-2.6 3.1-4.3 4.2-6.4z"/></svg>`;

export class FlowGraph {
  /**
   * @param {object} hooks
   * @param {(recipeId: string) => void} [hooks.onNodeClick]
   */
  constructor(hooks = {}) {
    this.$container = $('#cook-graph');
    this.hooks = hooks;
    this._structureKey = null;
    this._activeId = null;
    this._layoutInfo = null;
    this._lastScrollerW = 0;
    this._raf = 0;

    this.$container.on('click', '.flow-node', (e) => {
      const id = String($(e.currentTarget).data('recipe') || '');
      if (id && this.hooks.onNodeClick) this.hooks.onNodeClick(id);
    });

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._scheduleRelayout());
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this._scheduleRelayout()).catch(() => {});
    }
  }

  clear() {
    this._structureKey = null;
    this._activeId = null;
    this.$container.empty();
  }

  /**
   * @param {object} rootRecipe
   * @param {object} schedule Scheduler.getSchedule() result (nodes with deps/assignedCook)
   * @param {object} options scheduler options { prepFirst, cooks }
   * @param {object} progress
   * @param {Set<string>} progress.doneIds node ids whose steps are all checked
   * @param {string|null} progress.activeId node containing the current step
   * @param {Map<string,{done:number,total:number}>} progress.counts per-node step counts
   */
  render(rootRecipe, schedule, options, progress) {
    if (!rootRecipe || !schedule || !schedule.nodes?.length) {
      this.clear();
      return;
    }
    const rootId = rootRecipe.outputIngredient.id;
    const twoCooks = options.cooks === 2;
    const prepFirst = !!options.prepFirst;
    const key = JSON.stringify([
      rootId, twoCooks, prepFirst,
      schedule.nodes.map(n => [n.id, n.deps, twoCooks ? n.assignedCook : '', n.activeDuration, n.totalDuration]),
    ]);

    if (key !== this._structureKey || !this.$container.find('.flow-canvas').length) {
      const prevScroll = this.$container.find('.flow-scroll').scrollLeft() || 0;
      this._build(rootId, schedule, { twoCooks, prepFirst });
      this._structureKey = key;
      this.$container.find('.flow-scroll').scrollLeft(prevScroll);
      this._activeId = null; // force a scroll-into-view after rebuild
    }

    this._applyProgress(progress);

    const target = progress.activeId || (progress.doneIds.has(rootId) ? rootId : null);
    if (target && target !== this._activeId) {
      const smooth = this._activeId !== null;
      this._activeId = target;
      this._scrolledOnce = false;
      this._scrollToNode(target, smooth);
    }
  }

  // ---------- build + layout ----------

  _build(rootId, schedule, { twoCooks, prepFirst }) {
    const nodes = schedule.nodes;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const consumers = new Map(nodes.map(n => [n.id, []]));
    for (const n of nodes) for (const d of n.deps) if (consumers.has(d)) consumers.get(d).push(n.id);

    // Longest path (in edges) from each node to the master
    const toMaster = new Map();
    const visiting = new Set();
    const dist = (id) => {
      if (toMaster.has(id)) return toMaster.get(id);
      if (id === rootId) { toMaster.set(id, 0); return 0; }
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const cs = consumers.get(id) || [];
      const v = cs.length ? 1 + Math.max(...cs.map(dist)) : 0;
      visiting.delete(id);
      toMaster.set(id, v);
      return v;
    };
    nodes.forEach(n => dist(n.id));
    // Preppa först: prep phase in the first column(s), cooking after (left → right).
    const prepIds = prepFirst ? prepPhaseIds(nodes, rootId) : new Set();
    const phased = prepIds.size > 0;
    const colOf = new Map();
    let maxDepth;
    let prepCols = 0;
    if (!phased) {
      maxDepth = Math.max(0, ...toMaster.values());
      for (const n of nodes) colOf.set(n.id, maxDepth - toMaster.get(n.id));
    } else {
      // prep: right-aligned against the divider (longest path to a cook consumer)
      const toSink = new Map();
      const sinkDist = (id) => {
        if (toSink.has(id)) return toSink.get(id);
        toSink.set(id, 0); // cycle guard
        const pc = (consumers.get(id) || []).filter(c => prepIds.has(c));
        const v = pc.length ? 1 + Math.max(...pc.map(sinkDist)) : 0;
        toSink.set(id, v);
        return v;
      };
      const prepMax = Math.max(0, ...[...prepIds].map(sinkDist));
      prepCols = prepMax + 1;
      // cook: consumers of cook nodes are always cook nodes, so toMaster stays within the phase
      const cookIds = nodes.map(n => n.id).filter(id => !prepIds.has(id));
      const cookMax = Math.max(0, ...cookIds.map(id => toMaster.get(id)));
      for (const id of prepIds) colOf.set(id, prepMax - toSink.get(id));
      for (const id of cookIds) colOf.set(id, prepCols + cookMax - toMaster.get(id));
      maxDepth = prepCols + cookMax;
    }

    const items = new Map();
    for (const n of nodes) {
      items.set(n.id, {
        id: n.id,
        node: n,
        col: colOf.get(n.id),
        children: n.deps.filter(d => byId.has(d)),
        consumers: consumers.get(n.id) || [],
        x: 0, y: 0, w: 0, h: 0,
      });
    }

    let html = '<div class="flow-scroll" tabindex="-1"><div class="flow-canvas">';
    if (phased) {
      // Phase captions + divider. Minutes follow the schedule: prep ends when the
      // last prep-phase node's active work ends (same split the Gantt showed).
      const prepEnd = Math.max(0, ...nodes.filter(n => prepIds.has(n.id)).map(n => n.start + n.activeDuration));
      const totalTime = schedule.totalTime || 0;
      const prepMin = Math.round(prepEnd);
      const cookMin = Math.round(Math.max(totalTime - prepEnd, 0));
      html += `<div class="flow-phase flow-phase-prep" data-from="0" data-to="${prepCols - 1}" title="Förberedelser">${KNIFE_SVG}<span>Prep</span><span class="flow-phase-min">${prepMin} min</span></div>`;
      html += `<div class="flow-phase flow-phase-cook" data-from="${prepCols}" data-to="${maxDepth}" title="Tillagning">${FLAME_SVG}<span>Tillagning</span><span class="flow-phase-min">${cookMin} min</span></div>`;
      html += `<div class="flow-divider" data-after="${prepCols - 1}" aria-hidden="true"></div>`;
    } else {
      for (let c = 0; c <= maxDepth; c++) {
        const label = c === maxDepth ? 'klart' : `steg ${c + 1}`;
        html += `<div class="flow-level" data-col="${c}">${label}</div>`;
      }
    }
    html += '<svg class="flow-edges" aria-hidden="true"></svg>';

    for (const it of items.values()) {
      const n = it.node;
      const r = n.recipe;
      const isMaster = n.id === rootId;
      const cook = twoCooks && (n.assignedCook === 'P1' || n.assignedCook === 'P2') ? n.assignedCook : '';
      const isPrep = prepFirst && isPrepTagged(r);
      const latePrep = isPrep && !prepIds.has(n.id);
      const active = Math.round(n.activeDuration);
      const wait = Math.round((n.totalDuration || 0) - (n.activeDuration || 0));
      const time = wait > 0 ? `${active} min + ${wait} vänta` : `${active} min`;
      const cls = ['flow-node'];
      if (isMaster) cls.push('is-master');
      if (cook) cls.push(cook === 'P2' ? 'cook-p2' : 'cook-p1', 'has-cook');
      if (isPrep) cls.push('is-prep');
      if (prepIds.has(n.id)) cls.push('in-prep-phase');
      const name = sentenceCase(r.name);
      html += `<button type="button" class="${cls.join(' ')}" data-recipe="${escapeAttr(n.id)}" title="${escapeAttr(name)} – visa stegen">`;
      if (cook) {
        html += `<span class="flow-cook cook-badge ${cook === 'P2' ? 'cook-p2' : 'cook-p1'}" title="${cook === 'P2' ? 'Kock 2' : 'Kock 1'}">${cook}</span>`;
      }
      html += `<span class="flow-name"><span class="flow-check" aria-hidden="true">✓</span>${escapeHtml(name)}</span>`;
      html += `<span class="flow-meta"><span class="flow-time">${escapeHtml(time)}</span>`;
      // In the prep phase the column caption already says Prep; the pill only marks prep-tagged
      // nodes that need cooked input and therefore sit in the cook phase.
      if (latePrep) html += `<span class="flow-prep" title="Förberedelse som kräver något tillagat, görs under tillagningen">${KNIFE_SVG}prep</span>`;
      html += '</span>';
      html += '<span class="flow-progress" aria-hidden="true"><span class="flow-progress-bar"></span></span>';
      html += '</button>';
    }
    html += '</div></div>';

    this.$container.html(html);
    this._items = items;
    this._maxDepth = maxDepth;
    this._prepCols = prepCols;
    this._twoCooks = twoCooks;
    this._rootId = rootId;

    const scrollEl = this.$container.find('.flow-scroll')[0];
    if (this._ro) {
      this._ro.disconnect();
      if (scrollEl) this._ro.observe(scrollEl);
    }
    this._layout();
  }

  _scheduleRelayout() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._items || !this.$container.find('.flow-canvas').length) return;
      const sc = this.$container.find('.flow-scroll')[0];
      const w = sc ? sc.clientWidth : 0;
      const needs = !this._layoutInfo || !this._layoutInfo.measured || w !== this._lastScrollerW;
      if (needs) {
        this._layout();
        if (this._activeId) this._scrollToNode(this._activeId, false);
      } else if (this._activeId && this._layoutInfo.measured && !this._scrolledOnce) {
        this._scrollToNode(this._activeId, false);
      }
    });
  }

  _layout() {
    const items = this._items;
    const $canvas = this.$container.find('.flow-canvas');
    const canvas = $canvas[0];
    if (!items || !canvas) return;
    const cards = new Map();
    $canvas.find('.flow-node').each((_, el) => cards.set(String(el.getAttribute('data-recipe')), el));

    let measured = true;
    // Fit wide screens without scrolling where possible: shrink column gaps first,
    // then card width (down to a readable minimum). Narrow screens keep CSS sizes and scroll.
    canvas.style.removeProperty('--flow-card-w');
    canvas.style.removeProperty('--flow-col-gap');
    const style = getComputedStyle(canvas);
    let colGap = parseFloat(style.getPropertyValue('--flow-col-gap')) || 56;
    const baseCardW = parseFloat(style.getPropertyValue('--flow-card-w')) || 176;
    const scroller = this.$container.find('.flow-scroll')[0];
    const avail = scroller ? scroller.clientWidth - 12 : 0;
    const ncols = this._maxDepth + 1;
    if (avail > 600 && ncols > 1) {
      const MIN_GAP = 28, MIN_CARD = 150;
      if (ncols * baseCardW + (ncols - 1) * colGap > avail) {
        colGap = Math.max(MIN_GAP, Math.floor((avail - ncols * baseCardW) / (ncols - 1)));
        let cardW = baseCardW;
        if (ncols * cardW + (ncols - 1) * colGap > avail) {
          cardW = Math.max(MIN_CARD, Math.floor((avail - (ncols - 1) * colGap) / ncols));
        }
        canvas.style.setProperty('--flow-col-gap', `${colGap}px`);
        if (cardW !== baseCardW) canvas.style.setProperty('--flow-card-w', `${cardW}px`);
      }
    }
    for (const it of items.values()) {
      const el = cards.get(it.id);
      it.w = el ? el.offsetWidth : 0;
      it.h = el ? el.offsetHeight : 0;
      if (!it.w || !it.h) {
        measured = false;
        it.w = it.w || 176;
        it.h = it.h || 56;
      }
    }

    // tidy-tree pass: leaves take sequential slots, parents centre on their inputs
    const placed = new Set();
    let cursor = 0;
    const place = (id) => {
      const it = items.get(id);
      if (placed.has(id)) return it.y;
      placed.add(id);
      const ys = it.children.filter(c => !placed.has(c)).map(place);
      if (!ys.length) { it.y = cursor + it.h / 2; cursor += it.h + GAP_Y; }
      else it.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      return it.y;
    };
    if (items.has(this._rootId)) place(this._rootId);
    for (const id of items.keys()) if (!placed.has(id)) place(id);

    const cols = {};
    for (const it of items.values()) (cols[it.col] ||= []).push(it);
    const resolve = () => {
      for (const list of Object.values(cols)) {
        list.sort((a, b) => a.y - b.y);
        for (let i = 1; i < list.length; i++) {
          const min = list[i - 1].y + list[i - 1].h / 2 + GAP_Y + list[i].h / 2;
          if (list[i].y < min) list[i].y = min;
        }
      }
    };
    resolve();
    // one re-centre pass (left → right) so consumers sit beside pushed-down inputs
    const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
    for (const c of colKeys) {
      for (const it of cols[c]) {
        const ys = it.children.map(id => items.get(id)?.y).filter(Number.isFinite);
        if (ys.length) it.y = Math.max(it.y, (Math.min(...ys) + Math.max(...ys)) / 2);
      }
      resolve();
    }

    // x positions
    const colX = {};
    let x = 0;
    for (let c = 0; c <= this._maxDepth; c++) {
      const w = cols[c] ? Math.max(...cols[c].map(it => it.w)) : 176;
      colX[c] = { x, w };
      x += w + colGap;
    }
    const width = Math.max(0, x - colGap);
    let top = Infinity, bottom = -Infinity;
    for (const it of items.values()) {
      it.x = colX[it.col].x;
      top = Math.min(top, it.y - it.h / 2);
      bottom = Math.max(bottom, it.y + it.h / 2);
    }
    const offY = TOP_PAD - top;
    for (const it of items.values()) {
      it.y += offY;
      const el = cards.get(it.id);
      if (el) {
        el.style.left = `${it.x}px`;
        el.style.top = `${it.y - it.h / 2}px`;
      }
    }
    const height = bottom - top + TOP_PAD + 4;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    $canvas.find('.flow-phase').each((_, el) => {
      const a = colX[Number(el.getAttribute('data-from'))];
      const b = colX[Number(el.getAttribute('data-to'))];
      if (!a || !b) return;
      el.style.left = `${a.x}px`;
      el.style.width = `${b.x + b.w - a.x}px`;
    });
    $canvas.find('.flow-divider').each((_, el) => {
      const a = colX[Number(el.getAttribute('data-after'))];
      if (!a) return;
      el.style.left = `${Math.round(a.x + a.w + colGap / 2)}px`;
      el.style.height = `${height}px`;
    });
    $canvas.find('.flow-level').each((_, el) => {
      const c = Number(el.getAttribute('data-col'));
      if (!colX[c]) return;
      el.style.left = `${colX[c].x}px`;
      el.style.width = `${colX[c].w}px`;
    });

    // edges
    let paths = '';
    for (const it of items.values()) {
      for (const cid of it.consumers) {
        const b = items.get(cid);
        if (!b) continue;
        const x1 = it.x + it.w, y1 = it.y, x2 = b.x, y2 = b.y;
        const dx = Math.max(18, (x2 - x1) / 2);
        paths += `<path class="flow-edge" data-from="${escapeAttr(it.id)}" data-to="${escapeAttr(cid)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
      }
    }
    const svg = $canvas.find('.flow-edges')[0];
    if (svg) {
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.innerHTML = paths;
    }

    this._layoutInfo = { measured, width, height };
    this._lastScrollerW = scroller ? scroller.clientWidth : 0;
    if (this._doneIds) this._applyEdgeState();
  }

  // ---------- progress ----------

  _applyProgress(progress) {
    const { doneIds, activeId, counts } = progress;
    this._doneIds = doneIds;
    this.$container.find('.flow-node').each((_, el) => {
      const id = String(el.getAttribute('data-recipe'));
      const done = doneIds.has(id);
      const active = !done && id === activeId;
      const c = counts && counts.get(id);
      const frac = c && c.total ? c.done / c.total : 0;
      el.classList.toggle('is-done', done);
      el.classList.toggle('is-active', active);
      el.classList.toggle('is-partial', !done && frac > 0);
      el.setAttribute('aria-current', active ? 'step' : 'false');
      const bar = el.querySelector('.flow-progress-bar');
      if (bar) bar.style.width = `${Math.round((done ? 1 : frac) * 100)}%`;
      const base = el.getAttribute('title')?.replace(/ \((klar|pågår)\)$/, '') || '';
      el.setAttribute('title', done ? `${base} (klar)` : active ? `${base} (pågår)` : base);
    });
    this._applyEdgeState();
    // Done cards gain a ✓ which can wrap a name onto another line; re-layout if any height changed
    if (this._items && this._layoutInfo && this._layoutInfo.measured) {
      let changed = false;
      this.$container.find('.flow-node').each((_, el) => {
        const it = this._items.get(String(el.getAttribute('data-recipe')));
        if (it && Math.abs(el.offsetHeight - it.h) > 0.5) changed = true;
      });
      if (changed) this._layout();
    }
  }

  _applyEdgeState() {
    const doneIds = this._doneIds || new Set();
    this.$container.find('.flow-edge').each((_, el) => {
      const from = el.getAttribute('data-from');
      const done = doneIds.has(from);
      const src = this._items && this._items.get(from);
      el.classList.toggle('is-done', done);
      el.classList.toggle('cook-p2', done && !!this._twoCooks && src?.node?.assignedCook === 'P2');
    });
  }

  _scrollToNode(id, smooth) {
    const scroller = this.$container.find('.flow-scroll')[0];
    const it = this._items && this._items.get(id);
    if (!scroller || !it) return;
    if (!scroller.clientWidth) return; // hidden; ResizeObserver will retry
    this._scrolledOnce = true;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const left = Math.max(0, Math.min(
      it.x + it.w / 2 - scroller.clientWidth / 2,
      scroller.scrollWidth - scroller.clientWidth,
    ));
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      scroller.scrollLeft = left;
    }
  }
}
