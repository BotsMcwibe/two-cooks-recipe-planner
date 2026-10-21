/**
 * Mitt konto: Profil (display name + avatar emoji), Hushåll (invite by link/code,
 * join with preview + merge, members, leave/remove, what is shared) and the
 * invite panel for #join/CODE. Rendering returns HTML strings; AccountView
 * forwards clicks/submits/changes to handle*() and re-renders on householdchange.
 */
import * as Household from '../core/household.js?v=20261021g18';
import { syncNow, currentUser } from '../core/sync.js?v=20261021g18';
import { openSignIn } from './auth-ui.js?v=20261021g18';
import { escapeAttr, escapeHtml } from '../utils/catalog-ui.js?v=20261021g18';

const fmtDay = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
/** 'Anna', 'Anna och Bo', 'Anna, Bo och Cia' */
export function joinNames(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} och ${n[n.length - 1]}`;
}

/** Emoji choices for the avatar (food, so it fits the app). */
export const AVATAR_EMOJI = ['🍋', '🧄', '🌶️', '🥕', '🍅', '🧀', '🍳', '🥑', '🐟', '🍝', '🥐', '🫐', '🍄', '🥦', '🍪', '☕'];

const ui = {
  profileMsg: '', hhMsg: '', joinMsg: '', renaming: false, leaving: false, leaveCopy: true,
  lastCode: null, copied: '', frMsg: '',
  /** #join / #friend panel: { kind, code, preview, state: 'loading'|'ready'|'error'|'done', error, merge, busy } */
  invite: null,
};
export function hasInvite() { return !!ui.invite; }

function setMsg(key, text) { ui[key] = text; }

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------
export function profileSectionBody() {
  const p = Household.profile();
  if (!p) {
    return `<p class="acc-empty">${Household.mode() === 'local' ? 'Logga in för att välja namn och bild.' : 'Hämtar din profil…'}</p>`;
  }
  const me = Household.myId();
  const cur = p.avatar_emoji || '';
  const emojiBtns = AVATAR_EMOJI.map((e) => `<button type="button" class="hh-emoji" data-hh-emoji="${escapeAttr(e)}" aria-pressed="${cur === e}" aria-label="Välj ${escapeAttr(e)}">${e}</button>`).join('');
  return `<div class="hh-profile">
      <div class="hh-profile-preview">${Household.avatarHtml(me, 'hh-av-lg')}<span class="hh-profile-name">${escapeHtml(p.display_name || 'Inget namn än')}</span></div>
      <form class="hh-name-form">
        <label class="hh-label" for="hh-name">Namn</label>
        <div class="hh-inline">
          <input id="hh-name" class="hh-input" type="text" maxlength="${Household.MAX_NAME}" value="${escapeAttr(p.display_name || '')}" placeholder="T.ex. Anna" autocomplete="nickname">
          <button type="submit" class="acc-btn">Spara</button>
        </div>
        <p class="acc-hint">Visas för ditt hushåll och dina vänner, till exempel ”Anna lagade Kyckling Kiev”.</p>
      </form>
      <div class="hh-emoji-wrap" role="group" aria-labelledby="hh-emoji-label">
        <span class="hh-label" id="hh-emoji-label">Bild</span>
        <div class="hh-emoji-grid">${emojiBtns}<button type="button" class="hh-emoji hh-emoji-none" data-hh-emoji="" aria-pressed="${!cur}">Bokstav</button></div>
      </div>
      <p class="hh-msg" role="status" aria-live="polite">${escapeHtml(ui.profileMsg)}</p>
    </div>`;
}

async function saveProfile(patch, view) {
  setMsg('profileMsg', 'Sparar…');
  view.render();
  try {
    await Household.updateProfile(patch);
    setMsg('profileMsg', 'Sparat');
  } catch (err) {
    console.warn('[profil]', err);
    setMsg('profileMsg', Household.errorText(err));
  }
  view.render();
}

/** Click inside Mitt konto. Returns true when handled. */
export function handleClick(t, view) {
  if (handleHouseholdClick(t, view)) return true;
  if (handleFriendClick(t, view)) return true;
  const em = t.closest('[data-hh-emoji]');
  if (em) {
    const v = em.getAttribute('data-hh-emoji') || null;
    saveProfile({ avatar_emoji: v }, view).then(() => view.el.querySelector(`[data-hh-emoji="${CSS.escape(v || '')}"]`)?.focus());
    return true;
  }
  return false;
}

/** Form submit inside Mitt konto. Returns true when handled. */
export function handleSubmit(f, view) {
  if (handleHouseholdSubmit(f, view)) return true;
  if (handleFriendSubmit(f, view)) return true;
  if (f.matches('.hh-name-form')) {
    const v = f.querySelector('input').value;
    saveProfile({ display_name: v }, view).then(() => view.el.querySelector('#hh-name')?.focus());
    return true;
  }
  return false;
}


// ---------------------------------------------------------------------------
// Hushåll
// ---------------------------------------------------------------------------
const SHARED_WHAT = 'Vill laga, Lagad, Inte för oss, kockloggen och listor';

export function householdSectionBody() {
  if (!Household.isTables()) {
    return `<p class="acc-empty">${Household.mode() === 'local' ? 'Logga in för att laga tillsammans med ditt hushåll.' : 'Hämtar ditt hushåll…'}</p>`;
  }
  const hh = Household.household();
  const me = Household.myId();
  const mem = Household.members();
  const shared = mem.length > 1;
  const owner = Household.isOwner();
  const noName = !(Household.profile() && Household.profile().display_name);
  let html = '';
  if (!shared) {
    html += `<p class="hh-lede">Du lagar själv just nu. Bjud in den du lagar med så delar ni ${SHARED_WHAT}.</p>`;
  } else {
    html += ui.renaming
      ? `<form class="hh-rename-form"><label class="hh-label" for="hh-hname">Hushållets namn</label><div class="hh-inline"><input id="hh-hname" class="hh-input" type="text" maxlength="60" value="${escapeAttr(hh ? hh.name : '')}"><button type="submit" class="acc-btn">Spara</button><button type="button" class="acc-link-btn" data-hh-rename-cancel>Avbryt</button></div></form>`
      : `<div class="hh-name-row"><span class="hh-hname">${escapeHtml(hh ? hh.name : 'Vårt kök')}</span><button type="button" class="acc-link-btn" data-hh-rename>Byt namn</button></div>`;
    html += `<ul class="hh-members" aria-label="Medlemmar">${mem.map((m) => {
      const isMe = m.user_id === me;
      const tags = [isMe ? 'du' : '', m.role === 'owner' ? 'ägare' : ''].filter(Boolean).map((t) => `<span class="hh-tag">${t}</span>`).join('');
      const rm = owner && !isMe ? `<button type="button" class="acc-link-btn" data-hh-remove="${escapeAttr(m.user_id)}">Ta bort</button>` : '';
      return `<li class="hh-member">${Household.avatarHtml(m.user_id)}<span class="hh-member-name">${escapeHtml(Household.nameOf(m.user_id, { me: false }))}</span>${tags}<span class="hh-member-act">${rm}</span></li>`;
    }).join('')}</ul>`;
  }
  // Invites
  const inv = Household.invites();
  const full = mem.length >= Household.MAX_MEMBERS;
  const card = ui.lastCode && inv.some((i) => i.code === ui.lastCode) ? inviteCardHtml(ui.lastCode) : '';
  html += card;
  if (full) html += `<p class="acc-hint">Hushållet är fullt (${Household.MAX_MEMBERS} personer).</p>`;
  else if (!card) html += `<button type="button" class="acc-btn acc-btn-primary hh-invite-btn" data-hh-invite>${shared ? 'Bjud in fler' : 'Bjud in'}</button>`;
  if (noName && !full) html += '<p class="acc-hint">Tips: skriv ditt namn under Profil, så ser de vem som bjuder in.</p>';
  const others = inv.filter((i) => i.code !== ui.lastCode);
  if (others.length) {
    html += `<details class="hh-invites"><summary>Aktiva inbjudningar (${others.length})</summary><ul class="acc-list">${others.map((i) => `<li class="acc-recipe"><span><span class="hh-code">${escapeHtml(Household.prettyCode(i.code))}</span> <span class="acc-meta">gäller till ${escapeHtml(fmtDay.format(new Date(i.expires_at)))} · ${i.uses}/${i.max_uses} använda</span></span><button type="button" class="acc-link-btn" data-hh-revoke="${escapeAttr(i.code)}">Återkalla</button></li>`).join('')}</ul></details>`;
  }
  // Join by code (only while alone, or always? joining moves you: allow always)
  html += `<form class="hh-join-form"><label class="hh-label" for="hh-join-code">Har du en kod?</label><div class="hh-inline"><input id="hh-join-code" class="hh-input hh-code-input" type="text" maxlength="12" placeholder="K7QM-2XRA" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="submit" class="acc-btn">Gå med</button></div></form>`;
  if (ui.joinMsg) html += `<p class="hh-msg" role="alert">${escapeHtml(ui.joinMsg)}</p>`;
  // What is shared
  html += sharingLegendHtml(shared);
  // Leave
  if (shared) {
    html += ui.leaving
      ? `<div class="hh-leave" role="group" aria-label="Lämna hushållet">
          <p><strong>Lämna ${escapeHtml(hh ? hh.name : 'hushållet')}?</strong> Det ni delat stannar kvar hos hushållet. Du får ett eget kök igen.</p>
          <label class="hh-check"><input type="checkbox" data-hh-leave-copy ${ui.leaveCopy ? 'checked' : ''}> Ta med en kopia av det jag loggat</label>
          <div class="hh-inline"><button type="button" class="acc-btn acc-btn-danger" data-hh-leave-confirm>Lämna hushållet</button><button type="button" class="acc-btn" data-hh-leave-cancel>Avbryt</button></div>
        </div>`
      : '<button type="button" class="acc-link-btn hh-leave-btn" data-hh-leave>Lämna hushållet</button>';
  }
  if (ui.hhMsg) html += `<p class="hh-msg" role="status" aria-live="polite">${escapeHtml(ui.hhMsg)}</p>`;
  return html;
}

function sharingLegendHtml(shared) {
  return `<div class="hh-legend">
      <p class="hh-legend-row"><span class="hh-legend-icon" aria-hidden="true">👥</span><span><strong>${shared ? 'Delas med hushållet' : 'Delas när ni är fler'}:</strong> ${SHARED_WHAT}. Betyg och recensioner är dina men syns för hushållet.</span></p>
      <p class="hh-legend-row"><span class="hh-legend-icon" aria-hidden="true">🔒</span><span><strong>Bara du:</strong> Mina anteckningar, årets mål och listor märkta ”Bara för mig”.</span></p>
    </div>`;
}

function inviteCardHtml(code) {
  const link = Household.joinLink(code);
  const hh = Household.household();
  const who = Household.profile() && Household.profile().display_name;
  const subject = `Gå med i ${hh && !hh.is_personal ? hh.name : 'mitt kök'} på Yessy`;
  const body = `Hej!\n\n${who ? `${who} vill` : 'Jag vill'} laga tillsammans på Yessy. Öppna länken så delar vi Vill laga, Lagad, listor och loggen:\n${link}\n\nEller skriv in koden ${Household.prettyCode(code)} under Mitt konto → Hushåll.\nKoden gäller i 7 dagar.`;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `<div class="hh-invite-card" aria-label="Inbjudan">
      <p class="hh-label">Skicka länken eller koden</p>
      <input class="hh-input hh-link" type="text" readonly value="${escapeAttr(link)}" aria-label="Inbjudningslänk">
      <p class="hh-code-big" aria-label="Kod ${escapeAttr(Household.prettyCode(code))}">${escapeHtml(Household.prettyCode(code))}</p>
      <div class="hh-inline hh-share-row">
        <button type="button" class="acc-btn" data-hh-copy="${escapeAttr(link)}">${ui.copied === link ? '✓ Kopierad' : 'Kopiera länk'}</button>
        <button type="button" class="acc-btn" data-hh-share="${escapeAttr(code)}">Dela…</button>
        <a class="acc-btn" href="${escapeAttr(mailto)}">Skicka e-post</a>
      </div>
      <p class="acc-hint">Gäller i 7 dagar · upp till 5 personer · <button type="button" class="acc-link-btn" data-hh-revoke="${escapeAttr(code)}">Återkalla</button></p>
    </div>`;
}

// ---------------------------------------------------------------------------
// #join/CODE panel (and #friend/CODE, phase 4)
// ---------------------------------------------------------------------------
export function openInvite(kind, code) {
  const c = Household.normCode(code);
  if (ui.invite && ui.invite.kind === kind && ui.invite.code === c && ui.invite.state !== 'error') return;
  ui.invite = { kind, code: c, preview: null, state: 'loading', error: '', merge: true, busy: false };
  if (!currentUser()) Household.setPending(kind, c);
}
export function closeInvite() { ui.invite = null; }

/** Load the preview once signed in and the tables are ready. */
export function ensureInvitePreview(view) {
  const inv = ui.invite;
  if (!inv || inv.kind !== 'join' || inv.state !== 'loading' || inv.busy || !Household.isTables()) return;
  inv.busy = true;
  Household.previewInvite(inv.code).then((p) => {
    inv.busy = false;
    if (ui.invite !== inv) return;
    if (!p) { inv.state = 'error'; inv.error = 'Koden gäller inte längre. Be om en ny.'; }
    else { inv.preview = p; inv.state = 'ready'; }
    view.render();
  }).catch((err) => {
    inv.busy = false;
    if (ui.invite !== inv) return;
    inv.state = 'error'; inv.error = Household.errorText(err);
    view.render();
  });
}

export function invitePanelHtml() {
  const inv = ui.invite;
  if (inv && inv.kind === 'friend') return friendPanelHtml(inv);
  if (!inv || inv.kind !== 'join') return '';
  const code = Household.prettyCode(inv.code);
  let body;
  if (!currentUser()) {
    body = `<p>Du har fått en inbjudan till ett kök på Yessy (kod <span class="hh-code">${escapeHtml(code)}</span>).</p>
      <p class="acc-hint">Logga in för att gå med. Länken i mejlet tar dig tillbaka hit.</p>
      <div class="hh-inline"><button type="button" class="acc-btn acc-btn-primary" data-hh-signin>Logga in för att gå med</button><button type="button" class="acc-btn" data-hh-invite-close>Inte nu</button></div>`;
  } else if (inv.state === 'done') {
    body = `<p><strong>Välkommen till ${escapeHtml(inv.preview ? inv.preview.household_name : 'hushållet')}!</strong> Nu delar ni ${SHARED_WHAT}.</p>
      <div class="hh-inline"><a class="acc-btn acc-btn-primary" href="#browse">Till recepten</a><button type="button" class="acc-btn" data-hh-invite-close>Stäng</button></div>`;
  } else if (inv.state === 'error') {
    body = `<p role="alert">${escapeHtml(inv.error)}</p><div class="hh-inline"><button type="button" class="acc-btn" data-hh-invite-close>Stäng</button></div>`;
  } else if (inv.state === 'loading' || !inv.preview) {
    body = '<p>Hämtar inbjudan…</p>';
  } else {
    const p = inv.preview;
    const names = (p.member_names || []);
    const hh = Household.household();
    const alreadyHere = hh && hh.name === p.household_name && Household.members().length > 1 && names.length === Household.members().length;
    const isShared = Household.members().length > 1;
    const who = names.length ? `${joinNames(names)} ${names.length === 1 ? 'lagar' : 'lagar'} här.` : '';
    body = `<p class="hh-invite-q">Gå med i <strong>${escapeHtml(p.household_name)}</strong>? ${escapeHtml(who)}</p>
      ${alreadyHere ? '<p class="acc-hint">Det verkar vara ditt nuvarande hushåll.</p>' : ''}
      ${isShared ? `<p class="acc-hint">Du lämnar ${escapeHtml(hh ? hh.name : 'ditt hushåll')}. Det ni delat där stannar kvar hos dem.</p>` : `
      <label class="hh-check"><input type="checkbox" data-hh-merge ${inv.merge ? 'checked' : ''}> Ta med mina recept, betyg och logg</label>
      <p class="acc-hint">${inv.merge ? 'Det du sparat i Mitt kök slås ihop med deras. Om ni båda ändrat samma recept gäller den senaste ändringen.' : 'Din Vill laga, Lagad, logg och dina listor i Mitt kök tas bort. Betyg och anteckningar finns kvar.'}</p>`}
      <div class="hh-inline"><button type="button" class="acc-btn acc-btn-primary" data-hh-accept ${inv.busy ? 'disabled' : ''}>${inv.busy ? 'Går med…' : 'Gå med'}</button><button type="button" class="acc-btn" data-hh-invite-close>Avbryt</button></div>`;
  }
  return `<section class="acc-section hh-invite-panel" id="acc-inbjudan" aria-labelledby="acc-h-inbjudan">
      <div class="acc-section-head"><h2 id="acc-h-inbjudan"><span aria-hidden="true">👥</span> Inbjudan till ett hushåll</h2></div>
      ${body}
    </section>`;
}

async function acceptInvite(view) {
  const inv = ui.invite;
  if (!inv || !inv.preview || inv.busy) return;
  inv.busy = true; view.render();
  try {
    await syncNow(); // flush anything not yet written, so a merge takes it along
    await Household.acceptInvite(inv.code, Household.members().length > 1 ? false : inv.merge);
    await syncNow(); // new household: local shared data is replaced by theirs
    inv.state = 'done';
  } catch (err) {
    inv.state = 'error'; inv.error = Household.errorText(err);
  }
  inv.busy = false;
  view.render();
  view.el.querySelector('#acc-inbjudan .acc-btn')?.focus();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

async function run(view, key, fn, okText = '') {
  ui[key] = '';
  try { await fn(); if (okText) ui[key] = okText; } catch (err) { console.warn('[hushåll]', err); ui[key] = Household.errorText(err); }
  view.render();
}

/** Clicks for the household section + invite panel. Returns true when handled. */
export function handleHouseholdClick(t, view) {
  if (t.closest('[data-hh-signin]')) { openSignIn(); return true; }
  if (t.closest('[data-hh-invite-close]')) { closeInvite(); view.render(); return true; }
  if (t.closest('[data-hh-accept]')) { acceptInvite(view); return true; }
  if (t.closest('[data-hh-invite]')) {
    run(view, 'hhMsg', async () => { ui.lastCode = await Household.createInvite(); }).then(() => view.el.querySelector('[data-hh-copy]')?.focus());
    return true;
  }
  const cp = t.closest('[data-hh-copy]');
  if (cp) {
    const link = cp.getAttribute('data-hh-copy');
    copyText(link).then((ok) => {
      if (ok) { ui.copied = link; view.render(); view.el.querySelector('[data-hh-copy]')?.focus(); setTimeout(() => { ui.copied = ''; }, 3000); }
      else { const i = view.el.querySelector('.hh-link'); if (i) { i.focus(); i.select(); } }
    });
    return true;
  }
  const sh = t.closest('[data-hh-share]');
  if (sh) {
    const code = sh.getAttribute('data-hh-share');
    const url = Household.joinLink(code);
    if (navigator.share) navigator.share({ title: 'Yessy', text: `Gå med i mitt kök på Yessy (kod ${Household.prettyCode(code)})`, url }).catch(() => {});
    else copyText(url).then((ok) => { if (ok) { ui.copied = url; view.render(); } });
    return true;
  }
  const rv = t.closest('[data-hh-revoke]');
  if (rv) {
    const code = rv.getAttribute('data-hh-revoke');
    run(view, 'hhMsg', async () => { await Household.revokeInvite(code); if (ui.lastCode === code) ui.lastCode = null; }, 'Inbjudan återkallad.');
    return true;
  }
  if (t.closest('[data-hh-rename]')) { ui.renaming = true; view.render(); view.el.querySelector('#hh-hname')?.focus(); return true; }
  if (t.closest('[data-hh-rename-cancel]')) { ui.renaming = false; view.render(); view.el.querySelector('[data-hh-rename]')?.focus(); return true; }
  if (t.closest('[data-hh-leave]')) { ui.leaving = true; view.render(); view.el.querySelector('[data-hh-leave-confirm]')?.focus(); return true; }
  if (t.closest('[data-hh-leave-cancel]')) { ui.leaving = false; view.render(); view.el.querySelector('[data-hh-leave]')?.focus(); return true; }
  if (t.closest('[data-hh-leave-confirm]')) {
    const copy = ui.leaveCopy;
    run(view, 'hhMsg', async () => { await syncNow(); await Household.leave(copy); ui.leaving = false; ui.lastCode = null; await syncNow(); }, 'Du har lämnat hushållet och lagar själv igen.');
    return true;
  }
  const rm = t.closest('[data-hh-remove]');
  if (rm) {
    const id = rm.getAttribute('data-hh-remove');
    if (window.confirm(`Ta bort ${Household.nameOf(id, { me: false })} från hushållet? Det ni delat stannar kvar här.`)) {
      run(view, 'hhMsg', () => Household.removeMember(id), 'Borttagen ur hushållet.');
    }
    return true;
  }
  return false;
}

export function handleHouseholdSubmit(f, view) {
  if (f.matches('.hh-rename-form')) {
    const v = f.querySelector('input').value;
    run(view, 'hhMsg', async () => { await Household.renameHousehold(v); ui.renaming = false; }).then(() => view.el.querySelector('[data-hh-rename]')?.focus());
    return true;
  }
  if (f.matches('.hh-join-form')) {
    const code = Household.normCode(f.querySelector('input').value);
    if (code.length < 6) { ui.joinMsg = 'Skriv koden du fått, till exempel K7QM-2XRA.'; view.render(); view.el.querySelector('#hh-join-code')?.focus(); return true; }
    ui.joinMsg = '';
    openInvite('join', code);
    view.render();
    ensureInvitePreview(view);
    view.el.querySelector('#acc-inbjudan')?.scrollIntoView({ block: 'start' });
    return true;
  }
  return false;
}

export function handleHouseholdChange(t, view) {
  if (t.matches('[data-hh-merge]')) { if (ui.invite) ui.invite.merge = t.checked; view.render(); view.el.querySelector('[data-hh-merge]')?.focus(); return true; }
  if (t.matches('[data-hh-leave-copy]')) { ui.leaveCopy = t.checked; return true; }
  return false;
}

export function handleChange(t, view) { return handleHouseholdChange(t, view) || handleFriendChange(t, view); }

// ---------------------------------------------------------------------------
// Vänner (phase 4): friend code/link, requests, list, share toggle
// ---------------------------------------------------------------------------
const FRIEND_SEES = 'vad du lagat och dina stjärnor';

export function friendsCount() { return Household.friends().filter((f) => f.status === 'accepted').length; }

export function friendsSectionBody() {
  const p = Household.profile();
  if (!Household.isTables() || !p) return `<p class="acc-empty">${Household.mode() === 'local' ? 'Logga in för att lägga till vänner.' : 'Hämtar…'}</p>`;
  const me = Household.myId();
  const all = Household.friends();
  const incoming = all.filter((f) => f.status === 'pending' && f.requested_by !== me);
  const sent = all.filter((f) => f.status === 'pending' && f.requested_by === me);
  const friends = all.filter((f) => f.status === 'accepted');
  const name = (f) => escapeHtml(f.display_name || 'Någon');
  let html = `<p class="hh-lede">Vänner ser ${FRIEND_SEES} i ”Senast i köket”. Aldrig anteckningar, listor eller hushållets Vill laga.</p>`;
  if (incoming.length) {
    html += `<h3 class="hh-sub">Vill bli din vän</h3><ul class="hh-members">${incoming.map((f) => `<li class="hh-member">${Household.avatarHtml(f.user_id)}<span class="hh-member-name">${name(f)}</span><span class="hh-member-act"><button type="button" class="acc-btn acc-btn-primary" data-fr-accept="${escapeAttr(f.user_id)}">Godkänn</button> <button type="button" class="acc-btn" data-fr-decline="${escapeAttr(f.user_id)}">Avböj</button></span></li>`).join('')}</ul>`;
  }
  html += friends.length
    ? `<h3 class="hh-sub">Dina vänner (${friends.length})</h3><ul class="hh-members">${friends.map((f) => `<li class="hh-member">${Household.avatarHtml(f.user_id)}<span class="hh-member-name">${name(f)}</span>${f.share ? '' : '<span class="hh-tag">visar inte sin matlagning</span>'}<span class="hh-member-act"><button type="button" class="acc-link-btn" data-fr-remove="${escapeAttr(f.user_id)}">Ta bort</button></span></li>`).join('')}</ul>`
    : '<p class="acc-empty">Inga vänner än. Skicka din vänkod till någon, eller skriv in deras.</p>';
  if (sent.length) {
    html += `<details class="hh-invites"><summary>Skickade förfrågningar (${sent.length})</summary><ul class="acc-list">${sent.map((f) => `<li class="acc-recipe"><span>${Household.avatarHtml(f.user_id, 'hh-av-sm')} ${name(f)} <span class="acc-meta">väntar på svar</span></span><button type="button" class="acc-link-btn" data-fr-remove="${escapeAttr(f.user_id)}">Ångra</button></li>`).join('')}</ul></details>`;
  }
  // My code
  const code = p.friend_code || '';
  const link = code ? Household.friendLink(code) : '';
  if (code) {
    html += `<div class="hh-invite-card"><p class="hh-label">Din vänkod</p>
        <p class="hh-code-big" aria-label="Vänkod ${escapeAttr(Household.prettyCode(code))}">${escapeHtml(Household.prettyCode(code))}</p>
        <input class="hh-input hh-link" type="text" readonly value="${escapeAttr(link)}" aria-label="Vänlänk">
        <div class="hh-inline hh-share-row">
          <button type="button" class="acc-btn" data-hh-copy="${escapeAttr(link)}">${ui.copied === link ? '✓ Kopierad' : 'Kopiera länk'}</button>
          <button type="button" class="acc-btn" data-fr-share="${escapeAttr(code)}">Dela…</button>
        </div></div>`;
  }
  html += `<form class="fr-add-form"><label class="hh-label" for="fr-code">Lägg till med deras vänkod</label><div class="hh-inline"><input id="fr-code" class="hh-input hh-code-input" type="text" maxlength="12" placeholder="K7QM-2XRA" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="submit" class="acc-btn">Skicka förfrågan</button></div></form>`;
  if (ui.frMsg) html += `<p class="hh-msg" role="status" aria-live="polite">${escapeHtml(ui.frMsg)}</p>`;
  html += `<label class="hh-check fr-share"><input type="checkbox" data-fr-share-toggle ${p.share_with_friends !== false ? 'checked' : ''}> Visa vad jag lagar för mina vänner</label>
    <p class="acc-hint">${p.share_with_friends !== false ? `Dina vänner ser ${FRIEND_SEES}.` : 'Av: dina vänner ser inget av det du lagar. Du ser fortfarande deras.'}</p>`;
  return html;
}

function friendPanelHtml(inv) {
  const code = Household.prettyCode(inv.code);
  const p = Household.profile();
  let body;
  if (!currentUser()) {
    body = `<p>Någon vill bli vän med dig på Yessy (vänkod <span class="hh-code">${escapeHtml(code)}</span>). Ni ser vad den andra lagar.</p>
      <div class="hh-inline"><button type="button" class="acc-btn acc-btn-primary" data-hh-signin>Logga in för att svara</button><button type="button" class="acc-btn" data-hh-invite-close>Inte nu</button></div>`;
  } else if (p && Household.normCode(p.friend_code) === inv.code) {
    body = `<p>Det här är din egen vänkod. Skicka länken till någon du vill följa.</p><div class="hh-inline"><button type="button" class="acc-btn" data-hh-invite-close>Stäng</button></div>`;
  } else if (inv.state === 'done') {
    body = `<p role="status"><strong>${escapeHtml(inv.result === 'accepted' ? 'Ni är vänner nu!' : 'Förfrågan skickad.')}</strong> ${inv.result === 'accepted' ? 'Ni ser vad den andra lagar i ”Senast i köket”.' : 'När de godkänner ser ni vad den andra lagar.'}</p>
      <div class="hh-inline"><button type="button" class="acc-btn" data-hh-invite-close>Stäng</button></div>`;
  } else if (inv.state === 'error') {
    body = `<p role="alert">${escapeHtml(inv.error)}</p><div class="hh-inline"><button type="button" class="acc-btn" data-hh-invite-close>Stäng</button></div>`;
  } else {
    body = `<p class="hh-invite-q">Bli vän med den som delade vänkoden <span class="hh-code">${escapeHtml(code)}</span>?</p>
      <p class="acc-hint">Ni ser ${FRIEND_SEES.replace('du', 'den andra').replace('dina', 'deras')} i ”Senast i köket”. Anteckningar och listor syns aldrig.</p>
      <div class="hh-inline"><button type="button" class="acc-btn acc-btn-primary" data-fr-request="${escapeAttr(inv.code)}" ${inv.busy ? 'disabled' : ''}>${inv.busy ? 'Skickar…' : 'Skicka vänförfrågan'}</button><button type="button" class="acc-btn" data-hh-invite-close>Avbryt</button></div>`;
  }
  return `<section class="acc-section hh-invite-panel" id="acc-inbjudan" aria-labelledby="acc-h-inbjudan">
      <div class="acc-section-head"><h2 id="acc-h-inbjudan"><span aria-hidden="true">🤝</span> Vänförfrågan</h2></div>
      ${body}
    </section>`;
}

const FR_RESULT = { pending: 'Förfrågan skickad.', accepted: 'Ni är vänner nu!' };

export function handleFriendClick(t, view) {
  const rq = t.closest('[data-fr-request]');
  if (rq) {
    const inv = ui.invite;
    if (!inv || inv.busy) return true;
    inv.busy = true; view.render();
    Household.requestFriend(inv.code).then((res) => { inv.state = 'done'; inv.result = res; })
      .catch((err) => { inv.state = 'error'; inv.error = Household.errorText(err); })
      .finally(() => { inv.busy = false; view.render(); view.el.querySelector('#acc-inbjudan .acc-btn')?.focus(); });
    return true;
  }
  const ac = t.closest('[data-fr-accept]');
  if (ac) { run(view, 'frMsg', () => Household.respondFriend(ac.getAttribute('data-fr-accept'), true).then(() => Household.loadFeed()), 'Ni är vänner nu!'); return true; }
  const de = t.closest('[data-fr-decline]');
  if (de) { run(view, 'frMsg', () => Household.respondFriend(de.getAttribute('data-fr-decline'), false), 'Förfrågan avböjd.'); return true; }
  const rm = t.closest('[data-fr-remove]');
  if (rm) {
    const id = rm.getAttribute('data-fr-remove');
    const f = Household.friends().find((x) => x.user_id === id);
    const pending = f && f.status === 'pending';
    if (pending || window.confirm(`Ta bort ${(f && f.display_name) || 'vännen'} som vän? Ni slutar se vad den andra lagar.`)) {
      run(view, 'frMsg', () => Household.removeFriend(id).then(() => Household.loadFeed()), pending ? 'Förfrågan borttagen.' : 'Borttagen som vän.');
    }
    return true;
  }
  const sh = t.closest('[data-fr-share]');
  if (sh) {
    const code = sh.getAttribute('data-fr-share');
    const url = Household.friendLink(code);
    if (navigator.share) navigator.share({ title: 'Yessy', text: `Bli min vän på Yessy (vänkod ${Household.prettyCode(code)})`, url }).catch(() => {});
    else copyText(url).then((ok) => { if (ok) { ui.copied = url; view.render(); } });
    return true;
  }
  return false;
}

export function handleFriendSubmit(f, view) {
  if (!f.matches('.fr-add-form')) return false;
  const code = Household.normCode(f.querySelector('input').value);
  const p = Household.profile();
  if (code.length < 6) { ui.frMsg = 'Skriv deras vänkod, till exempel K7QM-2XRA.'; view.render(); view.el.querySelector('#fr-code')?.focus(); return true; }
  if (p && Household.normCode(p.friend_code) === code) { ui.frMsg = 'Det är din egen vänkod.'; view.render(); view.el.querySelector('#fr-code')?.focus(); return true; }
  run(view, 'frMsg', async () => { const res = await Household.requestFriend(code); ui.frMsg = FR_RESULT[res] || 'Klart.'; if (res === 'accepted') await Household.loadFeed(); })
    .then(() => view.el.querySelector('#fr-code')?.focus());
  return true;
}

export function handleFriendChange(t, view) {
  if (!t.matches('[data-fr-share-toggle]')) return false;
  const on = t.checked;
  run(view, 'frMsg', () => Household.updateProfile({ share_with_friends: on }), on ? 'Dina vänner ser vad du lagar.' : 'Dina vänner ser inte längre vad du lagar.')
    .then(() => view.el.querySelector('[data-fr-share-toggle]')?.focus());
  return true;
}
