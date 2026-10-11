/**
 * Small text helpers for display (no DOM).
 */

/**
 * Sentence case for Title Case node names: "Hacka Lök och Vitlök" → "Hacka lök och vitlök".
 * Only lowercases words that look like plain capitalised words (Ab…); acronyms (BBQ),
 * words with digits or internal capitals (McDonald) are left as they are.
 */
export function sentenceCase(name) {
  const s = String(name ?? '').trim();
  if (!s) return s;
  const words = s.split(/(\s+)/);
  let seenFirst = false;
  return words.map(w => {
    if (!w || /^\s+$/.test(w)) return w;
    if (!seenFirst) {
      seenFirst = true;
      return w.charAt(0).toLocaleUpperCase('sv') + w.slice(1);
    }
    if (/^\p{Lu}\p{Ll}+$/u.test(w)) return w.charAt(0).toLocaleLowerCase('sv') + w.slice(1);
    return w;
  }).join('');
}

/**
 * Join step template parts without stray spaces before punctuation.
 * Template text already carries its own spacing ("Skala ", {onion}, " och ", {garlic}, ".");
 * a separator space is only inserted when neither side has whitespace and the next part
 * does not start with punctuation (covers legacy token arrays like ["Koka", {pasta}, ","]).
 * @param {string[]} texts already-rendered HTML fragments, in order
 * @param {boolean[]} isText whether each fragment came from a plain string part
 */
export function joinStepParts(texts, isText) {
  let out = '';
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t) continue;
    if (out) {
      const prevSpace = /\s$/.test(out);
      const nextSpace = isText[i] && /^\s/.test(t);
      const nextPunct = isText[i] && /^[.,;:!?)\]…]/.test(t);
      const prevOpen = /[(\[]$/.test(out);
      if (!prevSpace && !nextSpace && !nextPunct && !prevOpen) out += ' ';
    }
    out += t;
  }
  return out.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
