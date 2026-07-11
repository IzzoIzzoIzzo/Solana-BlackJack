/**
 * story-mode.js — SHADDAI ROYALE Story Mode Engine
 * Reads window.STORY for all content.
 * Exposes window.StoryMode for hooks called by ui.js.
 *
 * Systems:
 *   1. Intro cinematic
 *   2. Underground venue picker
 *   3. LORE persistence + tier system
 *   4. Sidekick phone (contacts / messages / bank)
 *   5. The Invite (SMS chain at lore 75)
 *   6. Circuit map (5 city pins, Def Jam style)
 *   7. Cutscenes (arrival + victory beats)
 *   8. In-table dialog bubbles (rival agent speech)
 *   9. Drinks / Dizzy system
 *  10. Companions
 */

'use strict';

// ── Safe STORY reference ─────────────────────────────────────
const S = (() => {
  if (window.STORY) return window.STORY;
  console.warn('story.js not loaded — StoryMode will use fallback data');
  return {
    intro: [{ beat:1, title:'The Bottom', lines:['You got nothing. Yet.'] }],
    lore: { tiers:[{name:'Nobody',threshold:0,blurb:'No one knows you.'}] },
    underground: [],
    invite: { unlockAtLore:75, sender:'Unknown', messages:[{id:'i1',from:'unknown',text:"You've been noticed.",delay:0}] },
    cities: [],
    dialog: { blackjack:[],doubleWin:[],doubleLoss:[],bigWin:[],bigLoss:[],bust:[],push:[],dealerTaunt:[],winStreak:[],drunk:[] },
    companions: { roster:[], presetTexts:[], giftMessages:[] },
    phone: { bankName:'ROYALE BANK', invitesFrom:'Unknown', contacts:[], sampleTexts:[] },
    shop: { cars:[], houses:[], clothes:[], gifts:[] },
  };
})();

// ── Persistent story state ───────────────────────────────────
const SState = (() => {
  const KEY = 'shaddai_royale_story_v1';
  const DEFAULTS = {
    started: false,
    introSeen: false,
    lore: 0,
    inviteSeen: false,
    circuitUnlocked: false,
    beatCities: [],              // city ids beaten
    currentVenueId: null,
    currentCityId: null,
    selectedCompanionId: null,
    drinksDizzy: 0,              // 0–5 scale
    messageThreads: {},          // { contactId: [{from,text,ts}] }
    shopOwned: { cars:[], houses:[], clothes:[] },
    sessionLore: 0,              // lore earned this session (reset on venue entry)
    handWins: 0,
    handStreak: 0,
    phase: 'underground',        // 'underground' | 'circuit'
  };

  let _state = JSON.parse(JSON.stringify(DEFAULTS));

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        _state = Object.assign({}, DEFAULTS, saved);
      }
    } catch(e) { _state = JSON.parse(JSON.stringify(DEFAULTS)); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch(e) {}
  }

  function get(k) { return k ? _state[k] : _state; }
  function set(k, v) { _state[k] = v; save(); }

  load();
  return { get, set, save };
})();

// ── Utility ──────────────────────────────────────────────────
const smWait = ms => new Promise(r => setTimeout(r, ms));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function smFmt(n) { return Number(n).toLocaleString('en-US'); }

function currentLoreTier() {
  const lore = SState.get('lore');
  const tiers = S.lore.tiers;
  let tier = tiers[0];
  for (const t of tiers) {
    if (lore >= t.threshold) tier = t;
    else break;
  }
  return tier;
}

function nextLoreTier() {
  const lore = SState.get('lore');
  const tiers = S.lore.tiers;
  for (const t of tiers) {
    if (lore < t.threshold) return t;
  }
  return null;
}

function loreBarPercent() {
  const lore = SState.get('lore');
  const tier = currentLoreTier();
  const next = nextLoreTier();
  if (!next) return 100;
  const range = next.threshold - tier.threshold;
  const progress = lore - tier.threshold;
  return Math.min(100, Math.round((progress / range) * 100));
}

function getCompanion(id) {
  return (S.companions.roster || []).find(c => c.id === id);
}

function getCity(id) {
  return (S.cities || []).find(c => c.id === id);
}

// ── LORE earnings ────────────────────────────────────────────
function earnLore(amount, reason) {
  const was = SState.get('lore');
  SState.set('lore', was + amount);
  checkInviteUnlock();
  // Update any visible lore bars
  renderLoreBar();
  renderCircuitLore();
  showLoreToast('+' + amount + ' LORE' + (reason ? ' · ' + reason : ''));
}

function showLoreToast(text) {
  let toast = document.getElementById('lore-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lore-toast';
    toast.style.cssText = `
      position:fixed;bottom:6rem;right:1rem;z-index:5000;
      font-family:'Cinzel',serif;font-size:0.65rem;letter-spacing:0.15em;
      color:var(--gold);background:rgba(4,13,26,0.92);
      border:1px solid rgba(201,168,76,0.4);padding:0.4rem 0.8rem;border-radius:2px;
      opacity:0;transition:opacity 0.3s;pointer-events:none;
      box-shadow:0 0 16px rgba(201,168,76,0.2);text-transform:uppercase;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

function renderLoreBar() {
  const tier = currentLoreTier();
  const next = nextLoreTier();
  const pct = loreBarPercent();
  const lore = SState.get('lore');

  const nameEl = document.getElementById('lore-tier-name');
  const ptsEl = document.getElementById('lore-pts');
  const fillEl = document.getElementById('lore-bar-fill');
  const blurbEl = document.getElementById('lore-tier-blurb');
  const markerEl = document.getElementById('lore-next-marker');

  if (nameEl) nameEl.textContent = tier.name.toUpperCase();
  if (ptsEl) ptsEl.textContent = lore + ' LORE';
  if (fillEl) fillEl.style.width = pct + '%';
  if (blurbEl) blurbEl.textContent = tier.blurb;
  if (markerEl) markerEl.title = next ? 'Next: ' + next.name + ' at ' + next.threshold : 'MAX';
}

function renderCircuitLore() {
  const tier = currentLoreTier();
  const lore = SState.get('lore');
  const nameEl = document.getElementById('circuit-tier-name');
  const loreEl = document.getElementById('circuit-lore-display');
  if (nameEl) nameEl.textContent = tier.name.toUpperCase();
  if (loreEl) loreEl.textContent = lore + ' LORE';
}

// ── Invite unlock ────────────────────────────────────────────
function checkInviteUnlock() {
  const lore = SState.get('lore');
  const threshold = S.invite.unlockAtLore || 75;
  if (lore >= threshold && !SState.get('inviteSeen')) {
    SState.set('inviteSeen', true);
    SState.set('circuitUnlocked', true);
    setTimeout(() => showInviteSequence(), 800);
  }

  // Show circuit button once unlocked
  const circuitBtn = document.getElementById('btn-open-circuit');
  if (circuitBtn && SState.get('circuitUnlocked')) {
    circuitBtn.style.display = 'flex';
  }

  // Phone notification badge
  const notif = document.getElementById('phone-notif');
  if (notif && SState.get('inviteSeen') && lore >= threshold) {
    notif.style.display = 'inline-block';
    notif.textContent = '1';
  }
}

function showInviteSequence() {
  const overlay = document.getElementById('invite-overlay');
  const msgContainer = document.getElementById('invite-messages');
  if (!overlay || !msgContainer) return;

  msgContainer.innerHTML = '';
  overlay.style.display = 'flex';
  overlay.style.opacity = '0';
  requestAnimationFrame(() => { overlay.style.transition = 'opacity 0.5s'; overlay.style.opacity = '1'; });

  const messages = S.invite.messages || [];
  messages.forEach((msg, i) => {
    setTimeout(() => {
      const bubble = document.createElement('div');
      bubble.className = 'invite-bubble ' + (msg.from === 'unknown' ? 'from-them' : 'from-me');
      bubble.textContent = msg.text;
      bubble.style.opacity = '0';
      bubble.style.transform = 'translateY(8px)';
      msgContainer.appendChild(bubble);
      requestAnimationFrame(() => {
        bubble.style.transition = 'all 0.4s ease';
        bubble.style.opacity = '1';
        bubble.style.transform = 'translateY(0)';
      });
      msgContainer.scrollTop = msgContainer.scrollHeight;

      // Add to message thread
      const threads = SState.get('messageThreads');
      if (!threads['unknown']) threads['unknown'] = [];
      threads['unknown'].push({ from: msg.from === 'unknown' ? S.invite.sender : 'Me', text: msg.text, ts: Date.now() + i });
      SState.set('messageThreads', threads);
    }, msg.delay || i * 1200);
  });

  document.getElementById('btn-invite-dismiss').onclick = () => {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 400);
    // Refresh circuit button
    const circBtn = document.getElementById('btn-open-circuit');
    if (circBtn) circBtn.style.display = 'flex';
  };
}

// ══════════════════════════════════════════════════
// SCREEN: INTRO CINEMATIC
// ══════════════════════════════════════════════════

let _introBeat = 0;

function showIntro() {
  _introBeat = 0;
  Router.go('screen-story-intro');
  renderIntroBeat();

  document.getElementById('btn-story-intro-next').onclick = () => {
    _introBeat++;
    if (_introBeat >= S.intro.length) {
      SState.set('introSeen', true);
      showUnderground();
    } else {
      renderIntroBeat();
    }
  };
}

function renderIntroBeat() {
  const beats = S.intro;
  if (!beats || !beats.length) { showUnderground(); return; }
  const beat = beats[_introBeat];
  if (!beat) { showUnderground(); return; }

  const labelEl = document.getElementById('story-intro-beat-label');
  const linesEl = document.getElementById('story-intro-lines');
  const progressEl = document.getElementById('story-intro-progress');
  const bg = document.getElementById('story-intro-bg');

  if (labelEl) { labelEl.textContent = beat.title || ''; labelEl.style.animation = 'none'; requestAnimationFrame(() => { labelEl.style.animation = ''; }); }
  if (linesEl) {
    linesEl.innerHTML = '';
    (beat.lines || []).forEach((line, i) => {
      const p = document.createElement('p');
      p.textContent = line;
      p.style.cssText = `opacity:0;transform:translateY(14px);transition:all 0.6s ${i * 0.18 + 0.1}s ease;`;
      linesEl.appendChild(p);
      requestAnimationFrame(() => requestAnimationFrame(() => { p.style.opacity = '1'; p.style.transform = 'translateY(0)'; }));
    });
  }
  if (progressEl) {
    progressEl.innerHTML = beats.map((_, i) => `<div class="intro-dot ${i === _introBeat ? 'active' : i < _introBeat ? 'done' : ''}"></div>`).join('');
  }

  // Shift background gradient per beat
  const gradients = [
    'radial-gradient(ellipse at 30% 60%, #1a0800 0%, #080300 60%, #020100 100%)',
    'radial-gradient(ellipse at 60% 40%, #0a0018 0%, #040008 60%, #010005 100%)',
    'radial-gradient(ellipse at 20% 70%, #001208 0%, #000806 60%, #000302 100%)',
    'radial-gradient(ellipse at 70% 50%, #080010 0%, #040008 60%, #010005 100%)',
    'radial-gradient(ellipse at 50% 30%, #0c0400 0%, #060200 60%, #020100 100%)',
  ];
  if (bg) bg.style.background = gradients[_introBeat % gradients.length];
}

// ══════════════════════════════════════════════════
// SCREEN: UNDERGROUND
// ══════════════════════════════════════════════════

function showUnderground() {
  Router.go('screen-underground');
  renderLoreBar();
  checkInviteUnlock();
  renderVenueCards();
  renderCompanionBtn();
  renderDrinksBar(false);

  // Circuit button visibility
  const circBtn = document.getElementById('btn-open-circuit');
  if (circBtn) circBtn.style.display = SState.get('circuitUnlocked') ? 'flex' : 'none';

  document.getElementById('btn-open-phone').onclick = () => showPhone();
  document.getElementById('btn-pick-companion').onclick = () => showCompanionPicker();
  if (circBtn) circBtn.onclick = () => showCircuit();
  document.getElementById('btn-underground-back').onclick = () => {
    if (typeof Router !== 'undefined') Router.go('screen-mode');
  };
}

function renderVenueCards() {
  const container = document.getElementById('venue-cards');
  if (!container) return;
  container.innerHTML = '';

  const lore = SState.get('lore');
  const venues = S.underground || [];

  venues.forEach((venue, idx) => {
    const locked = lore < (venue.unlockThreshold || 0);
    const card = document.createElement('div');
    card.className = 'venue-card' + (locked ? ' locked' : '');

    const typeIcon = { bar:'🍺', club:'🎵', 'house party':'🏠' }[venue.type] || '🃏';

    card.innerHTML = `
      <div class="venue-card-overlay" style="background:${venueGradient(idx)}"></div>
      <div class="venue-card-noise"></div>
      <div class="venue-type-tag">${typeIcon} ${venue.type || 'venue'}</div>
      ${locked ? '<div class="venue-lock-badge">🔒 ' + (venue.unlockThreshold || 0) + ' LORE</div>' : ''}
      <div class="venue-card-content">
        <div class="venue-name">${venue.name}</div>
        <div class="venue-vibe">${venue.vibe || ''}</div>
        <div class="venue-note handwritten">"${venue.note || ''}"</div>
        <div class="venue-footer">
          <div class="venue-buyin">Buy-in: <strong>$${smFmt(venue.buyIn || 0)}</strong></div>
          <div class="venue-lore-reward">+${venue.loreReward || 0} LORE</div>
        </div>
      </div>
    `;

    if (!locked) {
      card.addEventListener('click', () => enterVenue(venue));
    }
    container.appendChild(card);
  });
}

function venueGradient(idx) {
  const gs = [
    'linear-gradient(160deg, rgba(30,6,2,0.9) 0%, rgba(10,2,1,0.95) 100%)',
    'linear-gradient(160deg, rgba(6,2,20,0.9) 0%, rgba(2,1,10,0.95) 100%)',
    'linear-gradient(160deg, rgba(2,10,4,0.9) 0%, rgba(1,4,2,0.95) 100%)',
    'linear-gradient(160deg, rgba(10,2,16,0.9) 0%, rgba(4,1,8,0.95) 100%)',
    'linear-gradient(160deg, rgba(10,7,2,0.9) 0%, rgba(6,4,1,0.95) 100%)',
  ];
  return gs[idx % gs.length];
}

function renderCompanionBtn() {
  const btn = document.getElementById('btn-pick-companion');
  if (!btn) return;
  const compId = SState.get('selectedCompanionId');
  const comp = compId ? getCompanion(compId) : null;
  const lbl = document.getElementById('companion-label');
  if (lbl) lbl.textContent = comp ? comp.name + ' (+' + comp.loreBonus + ' LORE)' : 'Bring Someone';
}

// P2: Boss/Agent mapping for underground venues and cities
// Underground venue bosses (each venue has a boss agent seated prominently)
const VENUE_BOSS_MAP = {
  default: { agentId: 'SHADDAI', name: 'SHADDAI', title: 'House Operator', taunt: 'Welcome to the bottom rung.' },
};
// City boss map (used in enterCity and table setup)
const CITY_BOSS_MAP = {
  phoenix:  { agentId: 'NEXUS',   name: 'NEXUS',   title: 'The Architect', taunt: "Your math ain't right." },
  vegas:    { agentId: 'ZEROX',   name: 'ZEROX',   title: 'The Vault', taunt: "Money talks. Yours just whispers." },
  miami:    { agentId: 'ORACLE',  name: 'ORACLE',  title: 'The All-Seeing', taunt: "I knew you were coming." },
  texas:    { agentId: 'PIKADON', name: 'PIKADON', title: 'Iron House', taunt: "There's no easy out here." },
  new_york: { agentId: 'VILLAIN', name: 'THE VILLAIN', title: 'End of the Line', taunt: "You made it this far. That ends now." },
};

function enterVenue(venue) {
  SState.set('currentVenueId', venue.id);
  SState.set('currentCityId', null);
  SState.set('sessionLore', 0);

  // Apply companion lore bonus for the session
  const compId = SState.get('selectedCompanionId');
  const comp = compId ? getCompanion(compId) : null;
  if (comp) {
    showLoreToast(comp.name + ' is with you tonight. +' + comp.loreBonus + ' LORE on arrival');
    earnLore(comp.loreBonus, comp.name);
  }

  // P2: Determine boss for this venue (from STORY data or fallback)
  const boss = (venue.boss) ? venue.boss : (VENUE_BOSS_MAP[venue.id] || VENUE_BOSS_MAP.default);

  // Set up table for this venue
  if (typeof State !== 'undefined') {
    State.set('mode', 'story');
    State.set('bet', venue.buyIn || 100);
    State.set('city', 'Vegas'); // underground uses generic table
    State.set('agentId', boss.agentId || 'SHADDAI');
    State.set('players', Math.min(4, 3 + Math.floor(Math.random() * 2))); // 3-4 players for underground
  }

  // Show drinks bar on table
  _currentVenue = venue;
  renderDrinksBar(true);

  // P2: Show companion portrait at table if one is selected
  renderCompanionAtTable();

  Router.go('screen-table');
  if (typeof initTable !== 'undefined') initTable();

  // Show boss arrival dialog after table loads
  if (boss.taunt) {
    setTimeout(() => showDialogBubble(boss.name, boss.agentId, boss.taunt), 900);
  }
}

let _currentVenue = null;
let _currentCity = null;

// P2: Show companion portrait at the game table (small badge in corner)
function renderCompanionAtTable() {
  const compId = SState.get('selectedCompanionId');
  let el = document.getElementById('companion-table-portrait');

  if (!compId) {
    if (el) el.style.display = 'none';
    return;
  }

  const comp = getCompanion(compId);
  if (!comp) return;

  if (!el) {
    el = document.createElement('div');
    el.id = 'companion-table-portrait';
    el.style.cssText = `
      position:fixed;bottom:9.5rem;left:0.7rem;z-index:600;
      display:flex;flex-direction:column;align-items:center;gap:0.2rem;
      pointer-events:none;
    `;
    document.body.appendChild(el);
  }

  const knownCompanions = ['jade','nova','soleil','reign','cassidy'];
  const isKnown = knownCompanions.includes((comp.id || '').toLowerCase());
  const imgSrc = isKnown ? `assets/companions/${comp.id.toLowerCase()}.png` : `assets/companions/${comp.id}.png`;
  const initials = (comp.name || '?')[0].toUpperCase();

  el.style.display = 'flex';
  el.innerHTML = `
    <div style="width:2.8rem;height:3.2rem;border-radius:4px;overflow:hidden;border:1px solid rgba(201,168,76,0.35);box-shadow:0 0 12px rgba(201,168,76,0.2);background:#0a0a14">
      <img src="${imgSrc}" alt="${comp.name}"
        style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-family:'Cinzel Decorative',serif;font-size:1rem;color:var(--gold)">${initials}</span>
    </div>
    <div style="font-family:'Cinzel',serif;font-size:0.38rem;letter-spacing:0.12em;color:var(--gold-dim);text-transform:uppercase;text-align:center;max-width:2.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${comp.name}</div>
  `;
}

// ══════════════════════════════════════════════════
// SCREEN: CIRCUIT MAP
// ══════════════════════════════════════════════════

function showCircuit() {
  Router.go('screen-circuit');
  renderCircuitLore();
  renderCircuitMap();

  document.getElementById('btn-circuit-back').onclick = () => showUnderground();
  document.getElementById('btn-circuit-phone').onclick = () => showPhone();
}

function renderCircuitMap() {
  const container = document.getElementById('circuit-map');
  if (!container) return;
  container.innerHTML = '';

  const cities = S.cities || [];
  const beaten = SState.get('beatCities') || [];

  cities.forEach((city, i) => {
    const isBeat = beaten.includes(city.id);
    const isNext = !isBeat && (i === 0 || beaten.includes(cities[i-1]?.id));
    const isLocked = !isBeat && !isNext;

    const pin = document.createElement('div');
    pin.className = 'circuit-pin' + (isBeat ? ' beaten' : '') + (isNext ? ' active' : '') + (isLocked ? ' locked' : '');

    // Polaroid card
    pin.innerHTML = `
      <div class="circuit-pin-num">${i + 1}</div>
      <div class="polaroid ${isLocked ? 'polaroid-gray' : ''}">
        <div class="polaroid-img-wrap">
          <img src="assets/cities/${city.id === 'texas' ? 'Texas' : city.id === 'phoenix' ? 'Phoenix' : city.id === 'vegas' ? 'Vegas' : city.id === 'miami' ? 'Miami' : 'NewYork'}.jpg"
               alt="${city.name}"
               onerror="this.parentElement.style.background='${circuitCityGradient(i)}'">
          ${isBeat ? '<div class="polaroid-beat-stamp">CLEARED</div>' : ''}
          ${isNext ? '<div class="polaroid-active-glow"></div>' : ''}
        </div>
        <div class="polaroid-caption">
          <div class="polaroid-city">${city.name}</div>
          <div class="polaroid-tag handwritten">${city.tagline || ''}</div>
        </div>
      </div>
      <div class="circuit-pin-meta">
        <span class="circuit-pin-rival">${city.rival?.name || ''}</span>
        <span class="circuit-pin-target">Target: $${smFmt(city.chipTarget || 0)}</span>
      </div>
      ${i < cities.length - 1 ? '<div class="circuit-connector' + (isBeat ? ' lit' : '') + '"></div>' : ''}
    `;

    if (!isLocked) {
      pin.addEventListener('click', () => enterCity(city));
    }
    container.appendChild(pin);
  });
}

function circuitCityGradient(i) {
  const gs = [
    'linear-gradient(160deg,#2a0800,#100300)',
    'linear-gradient(160deg,#080020,#020008)',
    'linear-gradient(160deg,#001a10,#000808)',
    'linear-gradient(160deg,#100020,#040008)',
    'linear-gradient(160deg,#001020,#000408)',
  ];
  return gs[i % gs.length];
}

function enterCity(city) {
  _currentCity = city;
  _currentVenue = null;
  SState.set('currentCityId', city.id);
  SState.set('currentVenueId', null);

  // P2: Resolve boss for this city
  const boss = CITY_BOSS_MAP[city.id] || { agentId: city.rival?.agent || 'SHADDAI', name: city.rival?.name || 'SHADDAI', title: city.rival?.title || 'Dealer' };

  showCutscene('arrival', city, () => {
    // Set up table for circuit
    if (typeof State !== 'undefined') {
      State.set('mode', 'story');
      State.set('bet', city.buyIn || 500);
      const cityKey = city.id === 'new_york' ? 'NewYork' : city.id.charAt(0).toUpperCase() + city.id.slice(1);
      State.set('city', cityKey);
      // P2: Boss is the dealer/agent at the table
      State.set('agentId', boss.agentId);
      // P2: Seat up to 6 agents at the circuit table
      State.set('players', Math.min(6, 4 + Math.floor(Math.random() * 3)));
    }

    renderDrinksBar(true);
    renderCompanionAtTable();
    Router.go('screen-table');
    if (typeof initTable !== 'undefined') initTable();

    // P2: Villain gets special menacing entrance for New York
    if (city.id === 'new_york' || boss.agentId === 'VILLAIN') {
      setTimeout(() => {
        showDialogBubble('THE VILLAIN', 'VILLAIN', "So you made it. Good. I'd hate for this to be too easy.");
      }, 1200);
    } else if (boss.taunt || city.rival?.taunt) {
      setTimeout(() => {
        showDialogBubble(boss.name, boss.agentId, boss.taunt || city.rival?.taunt || '...');
      }, 900);
    }
  });
}

// ══════════════════════════════════════════════════
// SCREEN: CUTSCENE
// ══════════════════════════════════════════════════

let _cutsceneBeats = [];
let _cutsceneBeatIdx = 0;
let _cutsceneCallback = null;

function showCutscene(type, city, callback) {
  _cutsceneCallback = callback;
  _cutsceneBeatIdx = 0;

  const beats = type === 'arrival' ? (city.arrivalBeats || []) : (city.victoryBeats || []);
  _cutsceneBeats = beats;

  // Set rival image + name
  const rival = city.rival || {};
  const img = document.getElementById('cutscene-rival-img');
  const nameEl = document.getElementById('cutscene-rival-name');
  const titleEl = document.getElementById('cutscene-rival-title');
  const cityLabel = document.getElementById('cutscene-city-label');
  const bg = document.getElementById('cutscene-bg');

  if (img) {
    img.src = 'assets/agents/' + (rival.agent || 'SHADDAI') + '.png';
    img.onerror = () => { img.style.display = 'none'; };
  }
  if (nameEl) nameEl.textContent = rival.name || '';
  if (titleEl) titleEl.textContent = rival.title || '';
  if (cityLabel) cityLabel.textContent = city.name.toUpperCase();
  if (bg) bg.style.background = circuitCityGradient(['phoenix','vegas','miami','texas','new_york'].indexOf(city.id));

  Router.go('screen-cutscene');
  renderCutsceneBeat();

  document.getElementById('btn-cutscene-next').onclick = advanceCutscene;
}

function renderCutsceneBeat() {
  const lineEl = document.getElementById('cutscene-line');
  const dotsEl = document.getElementById('cutscene-dots');

  if (lineEl) {
    const line = _cutsceneBeats[_cutsceneBeatIdx] || '';
    lineEl.style.opacity = '0';
    lineEl.style.transform = 'translateY(10px)';
    lineEl.textContent = line;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      lineEl.style.transition = 'all 0.5s ease';
      lineEl.style.opacity = '1';
      lineEl.style.transform = 'translateY(0)';
    }));
  }

  if (dotsEl) {
    dotsEl.innerHTML = _cutsceneBeats.map((_, i) =>
      `<div class="cutscene-dot ${i === _cutsceneBeatIdx ? 'active' : i < _cutsceneBeatIdx ? 'done' : ''}"></div>`
    ).join('');
  }

  const btn = document.getElementById('btn-cutscene-next');
  if (btn) btn.textContent = _cutsceneBeatIdx >= _cutsceneBeats.length - 1 ? 'Let\'s Go →' : 'Continue';
}

function advanceCutscene() {
  _cutsceneBeatIdx++;
  if (_cutsceneBeatIdx >= _cutsceneBeats.length) {
    if (_cutsceneCallback) _cutsceneCallback();
    _cutsceneCallback = null;
  } else {
    renderCutsceneBeat();
  }
}

// ══════════════════════════════════════════════════
// SCREEN: PHONE (Sidekick)
// ══════════════════════════════════════════════════

let _phoneReturnScreen = 'screen-underground';
let _activePhoneTab = 'contacts';

function showPhone(returnScreen) {
  _phoneReturnScreen = returnScreen || (SState.get('phase') === 'circuit' ? 'screen-circuit' : 'screen-underground');
  _activePhoneTab = 'contacts';
  Router.go('screen-phone');
  updatePhoneTime();
  switchPhoneTab('contacts');

  document.getElementById('btn-close-phone').onclick = () => {
    Router.go(_phoneReturnScreen);
    // Refresh whatever screen we came from
    if (_phoneReturnScreen === 'screen-underground') renderLoreBar();
    if (_phoneReturnScreen === 'screen-circuit') renderCircuitLore();
  };
}

function updatePhoneTime() {
  const el = document.getElementById('phone-time');
  if (!el) return;
  const now = new Date();
  el.textContent = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
}

window.switchPhoneTab = function(tab, btn) {
  _activePhoneTab = tab;
  document.querySelectorAll('.phone-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const tabBtn = document.querySelector(`.phone-tab[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.classList.add('active');
  }
  renderPhoneContent(tab);
};

// P2: Companion avatar helper — image with initial fallback
function companionAvatarHTML(id, name, size) {
  const s = size || '2rem';
  const initials = (name || id || '?')[0].toUpperCase();
  // Check if this is one of the known companion IDs for assets/companions/
  const knownCompanions = ['jade','nova','soleil','reign','cassidy'];
  const isComp = knownCompanions.includes((id || '').toLowerCase());
  const imgSrc = isComp ? `assets/companions/${id.toLowerCase()}.png` : `assets/agents/${id}.png`;
  return `<div class="phone-contact-avatar" style="position:relative;overflow:hidden;width:${s};height:${s}">
    <img src="${imgSrc}" alt="${initials}"
      style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:50%;display:block"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <span style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:0.7rem;color:var(--gold)">${initials}</span>
  </div>`;
}

function renderPhoneContent(tab) {
  const content = document.getElementById('phone-content');
  if (!content) return;

  if (tab === 'contacts') {
    const contacts = S.phone.contacts || [];
    // Also include companions as contacts
    const roster = S.companions.roster || [];
    content.innerHTML = `
      <div class="phone-section-title">Contacts</div>
      ${contacts.map(c => `
        <div class="phone-contact" onclick="openPhoneChat('${c.id}')">
          ${companionAvatarHTML(c.id, c.name)}
          <div class="phone-contact-info">
            <div class="phone-contact-name">${c.name}</div>
            <div class="phone-contact-num">${c.number}</div>
          </div>
          <div class="phone-contact-note">${c.note || ''}</div>
        </div>
      `).join('')}
      ${roster.length ? '<div class="phone-section-title" style="margin-top:0.5rem">Companions</div>' : ''}
      ${roster.map(c => `
        <div class="phone-contact" onclick="openPhoneChat('${c.id}')">
          ${companionAvatarHTML(c.id, c.name)}
          <div class="phone-contact-info">
            <div class="phone-contact-name">${c.name}</div>
            <div class="phone-contact-num" style="color:var(--cyan)">+${c.loreBonus} LORE / session</div>
          </div>
          <div class="phone-contact-note">${c.aesthetic || ''}</div>
        </div>
      `).join('')}
    `;

  } else if (tab === 'circuit') {
    // P2: Circuit as phone app
    renderPhoneCircuitApp(content);
    return;

  } else if (tab === 'messages') {
    const threads = SState.get('messageThreads');
    const contacts = S.phone.contacts || [];
    const hasThreads = Object.keys(threads).length > 0;

    if (!hasThreads) {
      content.innerHTML = '<div class="phone-empty">No messages yet.</div>';
      return;
    }

    let html = '<div class="phone-section-title">Messages</div>';
    const rosterAll = S.companions.roster || [];
    for (const [cid, msgs] of Object.entries(threads)) {
      const contact = contacts.find(c => c.id === cid);
      const comp = rosterAll.find(c => c.id === cid);
      const agentTaunt = _AGENT_TAUNTS.find(t => t.agentId === cid);
      const cname = contact ? contact.name : (comp ? comp.name : (agentTaunt ? agentTaunt.name : cid));
      const last = msgs[msgs.length - 1];
      html += `
        <div class="phone-thread-row" onclick="openPhoneChat('${cid}')">
          ${companionAvatarHTML(cid, cname)}
          <div class="phone-thread-info">
            <div class="phone-contact-name">${cname}</div>
            <div class="phone-thread-preview">${last?.text || ''}</div>
          </div>
          <div class="phone-thread-count">${msgs.length}</div>
        </div>
      `;
    }
    content.innerHTML = html;

  } else if (tab === 'bank') {
    const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
    const lore = SState.get('lore');
    const tier = currentLoreTier();
    content.innerHTML = `
      <div class="phone-bank">
        <div class="phone-bank-header">${S.phone.bankName || 'ROYALE BANK'}</div>
        <div class="phone-bank-balance">
          <div class="phone-bank-label">Chip Balance</div>
          <div class="phone-bank-amount">$${smFmt(bankroll)}</div>
        </div>
        <div class="phone-bank-divider"></div>
        <div class="phone-bank-row">
          <span>Street Rep</span>
          <span style="color:var(--gold)">${tier.name.toUpperCase()}</span>
        </div>
        <div class="phone-bank-row">
          <span>Lore Points</span>
          <span style="color:var(--cyan)">${lore}</span>
        </div>
        <div class="phone-bank-row">
          <span>Cities Cleared</span>
          <span style="color:#4ade80">${(SState.get('beatCities') || []).length} / 5</span>
        </div>
        <div class="phone-bank-row">
          <span>Hand Wins</span>
          <span>${SState.get('handWins') || 0}</span>
        </div>
      </div>
    `;
  }
}

window.openPhoneChat = function(contactId) {
  const contacts = S.phone.contacts || [];
  const contact = contacts.find(c => c.id === contactId);
  const roster = S.companions.roster || [];
  const compObj = roster.find(c => c.id === contactId);
  const agentTauntObj = _AGENT_TAUNTS.find(t => t.agentId === contactId);
  const cname = contact ? contact.name : (compObj ? compObj.name : (agentTauntObj ? agentTauntObj.name : contactId));
  const threads = SState.get('messageThreads');
  const msgs = threads[contactId] || [];

  // Seed sample texts if thread is empty and contact has samples
  if (!msgs.length) {
    const samples = (S.phone.sampleTexts || []).filter(t => t.from === cname);
    if (samples.length) {
      const seeded = [samples[0]];
      const thread = SState.get('messageThreads');
      thread[contactId] = [{ from: cname, text: seeded[0].text, ts: Date.now() }];
      SState.set('messageThreads', thread);
    }
  }

  const content = document.getElementById('phone-content');
  if (!content) return;

  // Check if this is a companion
  const comp = getCompanion(contactId);
  const presets = comp ? (S.companions.presetTexts || []) : [];

  // P2: Avatar in chat header
  const avatarHtml = companionAvatarHTML(contactId, cname, '1.8rem');

  const thread = (SState.get('messageThreads')[contactId] || []);
  content.innerHTML = `
    <div class="phone-chat-header" style="gap:0.5rem">
      <button class="phone-chat-back" onclick="switchPhoneTab('messages')">← Back</button>
      ${avatarHtml}
      <span class="phone-chat-name">${cname}</span>
    </div>
    <div class="phone-chat-messages" id="phone-chat-msgs">
      ${thread.map(m => `
        <div class="phone-chat-bubble ${m.from === 'Me' ? 'mine' : 'theirs'}">
          ${m.text}
        </div>
      `).join('')}
    </div>
    ${presets.length ? `
    <div class="phone-chat-presets">
      ${presets.slice(0, 4).map((t, i) => `
        <button class="phone-preset-btn" onclick="sendPresetText('${contactId}', ${i})">${t}</button>
      `).join('')}
    </div>` : ''}
  `;
  const chatEl = document.getElementById('phone-chat-msgs');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
};

window.sendPresetText = function(contactId, presetIdx) {
  const text = (S.companions.presetTexts || [])[presetIdx];
  if (!text) return;

  const threads = SState.get('messageThreads');
  if (!threads[contactId]) threads[contactId] = [];
  threads[contactId].push({ from: 'Me', text, ts: Date.now() });

  // Companion replies after a beat
  const comp = getCompanion(contactId);
  if (comp) {
    const replies = S.companions.giftMessages || [];
    const reply = pick(replies) || '...';
    setTimeout(() => {
      const t2 = SState.get('messageThreads');
      if (!t2[contactId]) t2[contactId] = [];
      t2[contactId].push({ from: comp.name, text: reply, ts: Date.now() + 100 });
      SState.set('messageThreads', t2);
      window.openPhoneChat(contactId);
    }, 1200);
  }

  SState.set('messageThreads', threads);
  window.openPhoneChat(contactId);
};

// P2: Circuit app inside the phone
function renderPhoneCircuitApp(content) {
  const cities = S.cities || [];
  const beaten = SState.get('beatCities') || [];
  const lore = SState.get('lore');
  const circuitUnlocked = SState.get('circuitUnlocked');

  if (!circuitUnlocked) {
    content.innerHTML = `
      <div style="padding:1.5rem 0.8rem;text-align:center">
        <div style="font-size:1.5rem;margin-bottom:0.6rem">🔒</div>
        <div style="font-family:'Cinzel',serif;font-size:0.6rem;letter-spacing:0.15em;color:var(--gold-dim);text-transform:uppercase;margin-bottom:0.4rem">The Circuit</div>
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.75rem;color:rgba(245,240,232,0.3)">Build your lore in the underground.<br>The invitation will come.</div>
      </div>`;
    return;
  }

  const cityBossMap = {
    phoenix:  { agentId: 'NEXUS',   bossName: 'NEXUS',   title: 'The Architect' },
    vegas:    { agentId: 'ZEROX',   bossName: 'ZEROX',   title: 'The Wealth Engine' },
    miami:    { agentId: 'ORACLE',  bossName: 'ORACLE',  title: 'The All-Seeing' },
    texas:    { agentId: 'PIKADON', bossName: 'PIKADON', title: 'The Iron Guard' },
    new_york: { agentId: 'VILLAIN', bossName: 'THE VILLAIN', title: 'End of the Line' },
  };

  content.innerHTML = `
    <div class="phone-section-title" style="font-size:0.5rem;letter-spacing:0.25em">Grand Tour — ${beaten.length}/5 Cleared</div>
    <div style="padding:0.3rem 0.2rem">
      ${cities.map((city, i) => {
        const isBeat = beaten.includes(city.id);
        const isNext = !isBeat && (i === 0 || beaten.includes(cities[i-1]?.id));
        const isLocked = !isBeat && !isNext;
        const boss = cityBossMap[city.id] || { agentId: 'SHADDAI', bossName: 'SHADDAI', title: 'Dealer' };
        const stateLabel = isBeat ? '✓ CLEARED' : isNext ? '▶ PLAY' : '🔒 LOCKED';
        const stateColor = isBeat ? 'var(--cyan)' : isNext ? 'var(--gold)' : 'rgba(245,240,232,0.2)';
        return `
          <div class="phone-circuit-city-row ${isLocked ? 'locked' : ''}" onclick="${!isLocked ? `window.phoneCircuitEnter('${city.id}')` : ''}">
            <div style="display:flex;align-items:center;gap:0.5rem;padding:0.55rem 0.4rem;border-bottom:1px solid rgba(201,168,76,0.06);cursor:${isLocked?'default':'pointer'}">
              <div style="width:1.8rem;height:1.8rem;border-radius:50%;overflow:hidden;border:1px solid rgba(201,168,76,0.2);flex-shrink:0">
                <img src="assets/agents/${boss.agentId}.png" alt="${boss.bossName}"
                  style="width:100%;height:100%;object-fit:cover;object-position:top"
                  onerror="this.style.display='none'">
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-family:'Cinzel',serif;font-size:0.58rem;letter-spacing:0.06em;color:${isLocked ? 'rgba(245,240,232,0.25)' : 'var(--white)'};text-transform:uppercase">${city.name}</div>
                <div style="font-family:'Share Tech Mono',monospace;font-size:0.48rem;color:rgba(245,240,232,0.3);margin-top:1px">Buy-in: $${smFmt(city.buyIn || 0)} · Pot: $${smFmt(city.chipTarget || 0)}</div>
                <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.55rem;color:rgba(245,240,232,0.25);margin-top:1px">Boss: ${boss.bossName} — ${boss.title}</div>
              </div>
              <div style="font-family:'Cinzel',serif;font-size:0.42rem;letter-spacing:0.08em;color:${stateColor};text-transform:uppercase;flex-shrink:0">${stateLabel}</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

window.phoneCircuitEnter = function(cityId) {
  // Close phone and enter city from circuit
  Router.go(_phoneReturnScreen);
  if (_phoneReturnScreen === 'screen-circuit') {
    setTimeout(() => {
      const city = getCity(cityId);
      if (city) enterCity(city);
    }, 100);
  } else {
    showCircuit();
    setTimeout(() => {
      const city = getCity(cityId);
      if (city) enterCity(city);
    }, 200);
  }
};

// P2: Random agent trash-talk taunts between matches
const _AGENT_TAUNTS = [
  { agentId: 'NEXUS',   name: 'NEXUS',   text: "I\'ll be waiting for you in Vegas 😏" },
  { agentId: 'ZEROX',   name: 'ZEROX',   text: "Your stack ain\'t ready for me." },
  { agentId: 'ORACLE',  name: 'ORACLE',  text: "I already know how this ends for you." },
  { agentId: 'PIKADON', name: 'PIKADON', text: "Security at my table doesn\'t play nice." },
  { agentId: 'TURTLE',  name: 'TURTLE',  text: "You really think you can run with us? 😂" },
  { agentId: 'QUILL',   name: 'QUILL',   text: "The story of your loss will be legendary." },
  { agentId: 'VILLAIN', name: 'The Villain', text: "I don\'t lose. Ever. See you at the top." },
];

let _tauntTimer = null;
function scheduleTaunt() {
  clearTimeout(_tauntTimer);
  if (typeof State === 'undefined' || State.get('mode') !== 'story') return;
  // Fire a taunt 20-45s after each round (random)
  const delay = 20000 + Math.random() * 25000;
  _tauntTimer = setTimeout(() => {
    const taunt = pick(_AGENT_TAUNTS);
    if (!taunt) return;
    // Add to message threads
    const threads = SState.get('messageThreads');
    if (!threads[taunt.agentId]) threads[taunt.agentId] = [];
    threads[taunt.agentId].push({ from: taunt.name, text: taunt.text, ts: Date.now() });
    SState.set('messageThreads', threads);
    // Show phone notification badge
    const notif = document.getElementById('phone-notif');
    if (notif) {
      const current = parseInt(notif.textContent || '0') || 0;
      notif.textContent = String(current + 1);
      notif.style.display = 'inline-block';
    }
    showLoreToast('📱 New message from ' + taunt.name);
  }, delay);
}

// ══════════════════════════════════════════════════
// SCREEN: COMPANION PICKER
// ══════════════════════════════════════════════════

let _companionReturnFn = null;

function showCompanionPicker(returnFn) {
  _companionReturnFn = returnFn;
  Router.go('screen-companion');
  renderCompanionGrid();

  document.getElementById('btn-companion-back').onclick = () => { Router.go('screen-underground'); showUnderground(); };
  document.getElementById('btn-companion-solo').onclick = () => {
    SState.set('selectedCompanionId', null);
    Router.go('screen-underground');
    showUnderground();
  };
}

function renderCompanionGrid() {
  const grid = document.getElementById('companion-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const roster = S.companions.roster || [];
  const selected = SState.get('selectedCompanionId');

  roster.forEach(comp => {
    const card = document.createElement('div');
    card.className = 'companion-card' + (selected === comp.id ? ' selected' : '');
    // P2: Use companion portrait image with initial fallback
    const knownCompanions = ['jade','nova','soleil','reign','cassidy'];
    const isKnown = knownCompanions.includes((comp.id || '').toLowerCase());
    const imgSrc = isKnown ? `assets/companions/${comp.id.toLowerCase()}.png` : `assets/companions/${comp.id}.png`;
    const initials = (comp.name || '?')[0].toUpperCase();

    card.innerHTML = `
      <div class="companion-card-inner">
        <div class="companion-avatar" style="padding:0;overflow:hidden;background:linear-gradient(135deg,rgba(40,20,10,0.8),rgba(10,5,20,0.8))">
          <img src="${imgSrc}" alt="${initials}"
            style="width:100%;height:100%;object-fit:cover;object-position:top"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-family:'Cinzel Decorative',serif;font-size:1.2rem;color:var(--gold)">${initials}</span>
        </div>
        <div class="companion-info">
          <div class="companion-name">${comp.name}</div>
          <div class="companion-aesthetic">${comp.aesthetic}</div>
          <div class="companion-lore-bonus">+${comp.loreBonus} LORE / session</div>
          <div class="companion-intro">"${comp.intro}"</div>
        </div>
        ${selected === comp.id ? '<div class="companion-check">✓ With You</div>' : ''}
      </div>
    `;
    card.addEventListener('click', () => {
      SState.set('selectedCompanionId', comp.id);
      renderCompanionGrid();
      renderCompanionBtn();
      // Auto-seed message thread
      const threads = SState.get('messageThreads');
      if (!threads[comp.id]) {
        threads[comp.id] = [{ from: comp.name, text: comp.intro, ts: Date.now() }];
        SState.set('messageThreads', threads);
      }
    });
    grid.appendChild(card);
  });
}

// ══════════════════════════════════════════════════
// DRINKS + DIZZY SYSTEM
// ══════════════════════════════════════════════════

let _dizzyDecayTimer = null;

function renderDrinksBar(show) {
  const bar = document.getElementById('drinks-bar');
  if (!bar) return;
  bar.style.display = show ? 'flex' : 'none';
  if (!show) return;

  const dizzy = SState.get('drinksDizzy');
  const labels = ['Sober', 'Warm', 'Buzzing', 'Lit', 'Blurry', 'Gone'];
  const fillEl = document.getElementById('dizzy-fill');
  const labelEl = document.getElementById('dizzy-label');
  if (fillEl) fillEl.style.width = (dizzy / 5 * 100) + '%';
  if (labelEl) labelEl.textContent = labels[Math.min(dizzy, 5)];

  const buyBtn = document.getElementById('btn-buy-drink');
  if (buyBtn) buyBtn.onclick = buyDrink;

  // P1 FIX: Wire drink-water button
  const waterBtn = document.getElementById('btn-drink-water');
  if (waterBtn) waterBtn.onclick = drinkWater;

  applyDizzyEffect(dizzy);
}

function buyDrink() {
  if (typeof State === 'undefined') return;
  const bankroll = State.get('bankroll');
  if (bankroll < 50) { if (typeof setHint !== 'undefined') setHint('Not enough to buy a round.'); return; }
  State.set('bankroll', bankroll - 50);
  if (typeof renderBankroll !== 'undefined') renderBankroll();

  const dizzy = Math.min(5, SState.get('drinksDizzy') + 1);
  SState.set('drinksDizzy', dizzy);
  renderDrinksBar(true);

  // Show drunk dialog line
  if (dizzy >= 2) {
    const line = pick(S.dialog.drunk || ['The world\'s a little softer right now.']);
    showDialogBubble('The Table', '', line);
  }

  // Start decay timer
  clearTimeout(_dizzyDecayTimer);
  _dizzyDecayTimer = setTimeout(soberUp, 45000); // 45s per drink
}

// P1 NEW: Drink Water — sobers up one level immediately, faster timer
function drinkWater() {
  const dizzy = SState.get('drinksDizzy');
  if (dizzy <= 0) {
    showLoreToast('Already clear-headed 💧');
    return;
  }
  const newDizzy = Math.max(0, dizzy - 1);
  SState.set('drinksDizzy', newDizzy);
  renderDrinksBar(true);
  if (typeof setHint !== 'undefined') setHint('Drank water. Clearing up…');
  clearTimeout(_dizzyDecayTimer);
  if (newDizzy > 0) _dizzyDecayTimer = setTimeout(soberUp, 25000);
}

function soberUp() {
  const dizzy = SState.get('drinksDizzy');
  if (dizzy > 0) {
    SState.set('drinksDizzy', dizzy - 1);
    renderDrinksBar(true);
    if (dizzy - 1 > 0) {
      _dizzyDecayTimer = setTimeout(soberUp, 45000);
    }
  }
}

function applyDizzyEffect(dizzy) {
  const table = document.querySelector('.table-viewport');
  if (!table) return;
  const blurs = [0, 0.5, 1.5, 3, 5, 8];
  const rotates = [0, 0.3, 0.8, 1.5, 2.5, 4];
  const hues = [0, 5, 15, 25, 40, 60];
  const blur = blurs[Math.min(dizzy, 5)];
  const rot = rotates[Math.min(dizzy, 5)];
  const hue = hues[Math.min(dizzy, 5)];
  table.style.filter = `blur(${blur}px) hue-rotate(${hue}deg)`;
  table.style.transform = `rotateX(18deg) rotate(${rot}deg)`;
  table.style.transition = 'filter 1.5s ease, transform 1.5s ease';
}

// ══════════════════════════════════════════════════
// DIALOG BUBBLE (rival speech on table)
// P1 FIX: Dialog placement + OFF setting
// ══════════════════════════════════════════════════

let _dialogHideTimer = null;

// Apply dialog bubble positioning based on settings
// Called from ui.js window.applyDialogPosition and internally
function applyDialogPosition(pos, isOff) {
  const bubble = document.getElementById('story-dialog-bubble');
  if (!bubble) return;
  if (isOff) { bubble.dataset.bubbleOff = 'true'; return; }
  bubble.dataset.bubbleOff = 'false';
  // Reset all positional insets
  bubble.style.top = '';
  bubble.style.bottom = '';
  bubble.style.left = '';
  bubble.style.right = '';
  bubble.style.transform = '';

  const p = pos || 'bottom-center';
  if (p === 'top-left')      { bubble.style.top = '4.5rem'; bubble.style.left = '0.8rem'; }
  else if (p === 'top-right'){ bubble.style.top = '4.5rem'; bubble.style.right = '0.8rem'; }
  else if (p === 'bottom-left') { bubble.style.bottom = '9rem'; bubble.style.left = '0.8rem'; }
  else if (p === 'bottom-right'){ bubble.style.bottom = '9rem'; bubble.style.right = '0.8rem'; }
  else {
    // bottom-center (default)
    bubble.style.bottom = '9rem';
    bubble.style.left = '50%';
    bubble.style.transform = 'translateX(-50%)';
  }
}

// Expose to ui.js
window.applyDialogPosition = applyDialogPosition;

function showDialogBubble(name, agentId, text) {
  const bubble = document.getElementById('story-dialog-bubble');
  const nameEl = document.getElementById('sdb-name');
  const textEl = document.getElementById('sdb-text');
  const imgEl = document.getElementById('sdb-rival-img');

  if (!bubble) return;

  // P1 FIX: Respect dialog-off setting
  const dialogOff = typeof State !== 'undefined' && State.getNested('settings.dialogOff');
  if (dialogOff) return;

  // P1 FIX: Apply current position setting before showing
  const dialogPos = typeof State !== 'undefined' ? (State.getNested('settings.dialogPosition') || 'bottom-center') : 'bottom-center';
  applyDialogPosition(dialogPos, false);

  if (nameEl) nameEl.textContent = name;
  if (textEl) { textEl.textContent = ''; textEl.style.opacity = '0'; }
  if (imgEl) {
    if (agentId) { imgEl.src = 'assets/agents/' + agentId + '.png'; imgEl.style.display = ''; imgEl.onerror = () => { imgEl.style.display = 'none'; }; }
    else imgEl.style.display = 'none';
  }

  bubble.style.display = 'flex';
  bubble.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bubble.style.transition = 'opacity 0.35s ease';
    bubble.style.opacity = '1';
    if (textEl) {
      textEl.style.opacity = '1';
      textEl.style.transition = 'opacity 0.3s 0.15s ease';
      textEl.textContent = text;
    }
  }));

  clearTimeout(_dialogHideTimer);
  _dialogHideTimer = setTimeout(() => {
    bubble.style.opacity = '0';
    setTimeout(() => { bubble.style.display = 'none'; }, 350);
  }, 5000);
}

// ══════════════════════════════════════════════════
// PUBLIC HOOK: called by ui.js after each round
// ══════════════════════════════════════════════════

function onRoundEnd(outcome, payout, bet) {
  const mode = typeof State !== 'undefined' ? State.get('mode') : null;
  if (mode !== 'story') return;

  const dizzy = SState.get('drinksDizzy');

  if (outcome === 'win' || outcome === 'bj') {
    // Lore from win
    earnLore(1, 'win');
    SState.set('handWins', (SState.get('handWins') || 0) + 1);
    const streak = (SState.get('handStreak') || 0) + 1;
    SState.set('handStreak', streak);

    // Big win dialog
    if (payout >= (bet || 100) * 3) {
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || (typeof State !== 'undefined' ? State.get('agentId') : 'SHADDAI');
      const line = pick(S.dialog.bigWin || ['Stack it.']);
      showDialogBubble(agentId, agentId, line);
    }

    // Win streak dialog
    if (streak >= 3 && streak % 3 === 0) {
      const line = pick(S.dialog.winStreak || ["Can't cool down right now."]);
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || 'SHADDAI';
      showDialogBubble(agentId, agentId, line);
    }

    // Check circuit city victory condition
    checkCityVictory(payout);

    // Check underground venue session end
    checkVenueSessionEnd(outcome);

  } else if (outcome === 'lose') {
    SState.set('handStreak', 0);
    if (payout === 0 && bet >= 200) {
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || 'SHADDAI';
      const line = pick(S.dialog.bigLoss || ["Reload. Regroup. Return."]);
      showDialogBubble(agentId, agentId, line);
    }
  } else if (outcome === 'push') {
    const line = pick(S.dialog.push || ['Push. Nobody wins, nobody bleeds.']);
    const cityId = SState.get('currentCityId');
    const city = cityId ? getCity(cityId) : null;
    showDialogBubble(city?.rival?.name || 'Dealer', city?.rival?.agent || '', line);
  }

  // Drunk dialog
  if (dizzy >= 3 && Math.random() < 0.35) {
    const line = pick(S.dialog.drunk || ['Hazy but focused.']);
    showDialogBubble('The Table', '', line);
  }

  // Dealer taunt (random, low chance)
  if (Math.random() < 0.12) {
    const cityId = SState.get('currentCityId');
    const city = cityId ? getCity(cityId) : null;
    const boss = cityId ? (CITY_BOSS_MAP[cityId] || {}) : {};
    const taunt = city?.rival?.taunt || boss.taunt || pick(S.dialog.dealerTaunt || ['The house has something to say.']);
    const dealerName = city?.rival?.name || boss.name || 'Dealer';
    const dealerAgent = city?.rival?.agent || boss.agentId || (typeof State !== 'undefined' ? State.get('agentId') : '');
    showDialogBubble(dealerName, dealerAgent, taunt);
  }

  // Update drinks bar dizzy
  renderDrinksBar(true);

  // P2: Schedule random agent trash-talk between matches
  scheduleTaunt();

  // P2 / P8: Auto-save on every round end
  SState.save();
}

function showDialog(moment) {
  // Called by ui.js for explicit moments (e.g. blackjack)
  const lines = S.dialog[moment] || [];
  if (!lines.length) return;
  const line = pick(lines);
  const cityId = SState.get('currentCityId');
  const city = cityId ? getCity(cityId) : null;
  const agentId = city?.rival?.agent || (typeof State !== 'undefined' ? State.get('agentId') : '');
  showDialogBubble(city?.rival?.name || 'Dealer', agentId, line);
}

function checkVenueSessionEnd(outcome) {
  const venue = _currentVenue;
  if (!venue) return;
  const wins = (SState.get('handWins') || 0);
  // Every 5 wins at the venue, award session lore
  if (wins > 0 && wins % 5 === 0) {
    earnLore(venue.loreReward || 3, venue.name);
    showLoreToast('Session lore: +' + (venue.loreReward || 3) + ' at ' + venue.name);
  }
}

function checkCityVictory(payout) {
  const cityId = SState.get('currentCityId');
  if (!cityId) return;
  const city = getCity(cityId);
  if (!city) return;

  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  if (bankroll >= city.chipTarget) {
    const beaten = SState.get('beatCities') || [];
    if (!beaten.includes(cityId)) {
      beaten.push(cityId);
      SState.set('beatCities', beaten);
      earnLore(25, city.name + ' cleared');
      // Victory cutscene after short delay
      setTimeout(() => {
        showCutscene('victory', city, () => {
          _currentCity = null;
          SState.set('currentCityId', null);
          showCircuit();
        });
      }, 1500);
    }
  }
}

// ══════════════════════════════════════════════════
// WIRE INTO STORY MODE SELECT
// ══════════════════════════════════════════════════

// Override the story mode click handler from ui.js
// We smWait for DOMContentLoaded to ensure ui.js has run
document.addEventListener('DOMContentLoaded', () => {
  // Patch mode card click for 'story' to launch our intro
  setTimeout(() => {
    const modeCards = document.querySelectorAll('.mode-card[data-mode="story"]');
    modeCards.forEach(card => {
      // Replace the listener by cloning
      const fresh = card.cloneNode(true);
      card.parentNode.replaceChild(fresh, card);
      fresh.addEventListener('click', () => {
        if (typeof window.Audio_SR !== 'undefined') window.Audio_SR.chip();
        if (typeof State !== 'undefined') State.set('mode', 'story');

        if (!SState.get('introSeen')) {
          showIntro();
        } else {
          showUnderground();
        }
      });
    });

    // Also re-wire btn-story-back from old story screen (if someone hits it)
    const oldBack = document.getElementById('btn-story-back');
    if (oldBack) {
      const f = oldBack.cloneNode(true);
      oldBack.parentNode.replaceChild(f, oldBack);
      f.addEventListener('click', () => Router.go('screen-mode'));
    }
  }, 50);
});

// ══════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════
window.StoryMode = {
  onRoundEnd,
  showDialog,
  showUnderground,
  showCircuit,
  showIntro,
  showPhone,
  earnLore,
  SState,
  drinkWater,
  renderCompanionAtTable,
  applyDialogPosition,
};
