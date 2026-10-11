/**
 * Floating "back to top" button, shown only on the cook page after scrolling down.
 */
export function initBackToTop() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Till toppen');
  btn.title = 'Till toppen';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 5l-7 7m7-7l7 7M12 5v14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(btn);

  const cooking = document.getElementById('view-cooking');
  let ticking = false;
  const update = () => {
    ticking = false;
    const onCook = !!cooking && cooking.style.display !== 'none' && cooking.offsetParent !== null;
    btn.classList.toggle('is-visible', onCook && window.scrollY > 500);
  };
  const queue = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('hashchange', () => setTimeout(update, 50));
  if (cooking) new MutationObserver(queue).observe(cooking, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });

  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  update();
}
