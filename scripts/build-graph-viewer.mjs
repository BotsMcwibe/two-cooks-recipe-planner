#!/usr/bin/env node
/**
 * Build tools/graph-viewer.html: a self-contained recipe-graph viewer (no server, no CDN).
 * Reads data/ via scripts/graph-stats.mjs and inlines all graphs + stats into
 * tools/graph-viewer.src.html (placeholder: the DATA line). Read-only on recipe data.
 *
 * Usage: node scripts/build-graph-viewer.mjs [outFile]
 * Then open tools/graph-viewer.html (file://). Hash routes:
 *   #r=norska_kottbullar            recipe view
 *   #r=norska_kottbullar&pantry=1   recipe view with pantry ingredients as leaf nodes
 *   #overview                       depth vs node-count scatter + histograms
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, analyzeAll } from './graph-stats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const src = join(ROOT, 'tools', 'graph-viewer.src.html');
const out = process.argv[2] || join(ROOT, 'tools', 'graph-viewer.html');

const all = analyzeAll(loadAll());
const payload = { builtAt: new Date().toISOString(), recipes: all };
const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
const tpl = readFileSync(src, 'utf8');
const marker = 'const DATA = null; /*__DATA__*/';
if (!tpl.includes(marker)) throw new Error(`placeholder not found in ${src}`);
writeFileSync(out, tpl.replace(marker, () => `const DATA = ${json};`));
console.log(`wrote ${out} (${Object.keys(all).length} recipes, ${(json.length / 1024).toFixed(0)} KB data)`);
