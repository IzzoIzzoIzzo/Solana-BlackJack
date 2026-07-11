/* ============================================================
   SHADDAI ROYALE — ui.js
   Full game logic, screen management, engine bridge
   ============================================================ */

'use strict';

// ── Engine bridge ───────────────────────────────────────────
// Checks for window.BJ; falls back to a minimal built-in implementation
const E = (() => {
  if (window.BJ) return window.BJ;

  // ── Fallback engine ──
  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const SUITS = ['S','H','D','C'];

  function newShoe(decks = 6) {
    const shoe = [];
    for (let d = 0; d < decks; d++) {
      for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
    }
    // Fisher-Yates
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }

  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.rank === 'A') { total += 11; aces++; }
      else if (['J','Q','K'].includes(c.rank)) total += 10;
      else total += parseInt(c.rank);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    const soft = aces > 0 && (total - 10) >= 1 && (total - 10) <= 11;
    return { total, soft };
  }

  function isBlackjack(hand) {
    return hand.length === 2 && handValue(hand).total === 21;
  }

  function basicStrategy(hand, dealerUp, rules) {
    const { total, soft } = handValue(hand);
    const du = dealerUp === 'A' ? 11 : ['J','Q','K'].includes(dealerUp) ? 10 : parseInt(dealerUp);
    // Can split?
    if (hand.length === 2 && hand[0].rank === hand[1].rank) {
      const r = hand[0].rank;
      if (r === 'A' || r === '8') return 'P';
      if ((r === '9') && ![7,10,11].includes(du)) return 'P';
      if (r === '7' && du <= 7) return 'P';
      if (r === '6' && du <= 6) return 'P';
      if ((r === '2' || r === '3') && du <= 7) return 'P';
    }
    if (soft) {
      if (total >= 19) return 'S';
      if (total === 18) return du <= 8 ? 'S' : 'H';
      return 'H';
    }
    if (total >= 17) return 'S';
    if (total >= 13 && du <= 6) return 'S';
    if (total === 12 && du >= 4 && du <= 6) return 'S';
    if (total === 11) return 'D';
    if (total === 10 && du <= 9) return 'D';
    if (total === 9 && du >= 3 && du <= 6) return 'D';
    return 'H';
  }

  return { newShoe, handValue, isBlackjack, basicStrategy };
})();

// ── Audio ───────────────────────────────────────────────────
const Audio = (() => {
  let ctx = null;
  let soundOn = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function beep(freq, dur, vol = 0.06, type = 'sine') {
    if (!soundOn) return;
    try {
      const c = getCtx();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.start(); o.stop(c.currentTime + dur);
    } catch(e) {}
  }

  function card() { beep(520 + Math.random() * 120, 0.06, 0.05, 'triangle'); }
  function win()  { [440,554,659].forEach((f,i)=> setTimeout(()=>beep(f,0.15,0.07,'sine'),i*80)); }
  function lose() { beep(180, 0.25, 0.07, 'sawtooth'); }
  function bj()   { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,0.18,0.08,'sine'),i*70)); }
  function chip() { beep(700, 0.04, 0.04, 'triangle'); }
  function deal() { beep(400, 0.08, 0.05, 'square'); }
  function toggle(on) { soundOn = on; }

  return { card, win, lose, bj, chip, deal, toggle };
})();

// ── Skyline canvas drawing ──────────────────────────────────
const Skyline = (() => {
  const CITY_PALETTES = {
    Phoenix: { sky: ['#1a0a04','#2d1208','#0a0304'], accent: '#ff6633', stars: true },
    Vegas:   { sky: ['#04040e','#080420','#020210'], accent: '#ff00aa', stars: true },
    Miami:   { sky: ['#01080e','#011a20','#02080c'], accent: '#00ffcc', stars: true },
    Texas:   { sky: ['#050308','#0a0510','#020208'], accent: '#6633ff', stars: true },
    NewYork: { sky: ['#020408','#020810','#010206'], accent: '#4488ff', stars: true },
  };

  function draw(canvas, cityName, scrollOffset = 0) {
    const p = CITY_PALETTES[cityName] || CITY_PALETTES.Vegas;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    p.sky.forEach((c, i) => sky.addColorStop(i / (p.sky.length - 1), c));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars
    if (p.stars) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const rng = seededRandom(cityName);
      for (let i = 0; i < 120; i++) {
        const x = rng() * W;
        const y = rng() * H * 0.6;
        const s = rng() * 1.2;
        ctx.globalAlpha = rng() * 0.6 + 0.1;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Building layers (back → front)
    const rng2 = seededRandom(cityName + 'B');
    drawBuildings(ctx, W, H, rng2, p.accent, scrollOffset, 0.6, 0.55, 0.8, 16, 'rgba(8,14,28,0.9)');
    drawBuildings(ctx, W, H, rng2, p.accent, scrollOffset * 1.3, 0.75, 0.45, 1.0, 22, 'rgba(4,10,20,0.95)');
    drawBuildings(ctx, W, H, rng2, p.accent, scrollOffset * 1.6, 0.88, 0.28, 1.0, 14, 'rgba(2,6,14,0.98)');

    // Ground
    const grd = ctx.createLinearGradient(0, H * 0.9, 0, H);
    grd.addColorStop(0, 'rgba(2,6,14,0)');
    grd.addColorStop(1, '#010308');
    ctx.fillStyle = grd;
    ctx.fillRect(0, H * 0.9, W, H * 0.1);
  }

  function drawBuildings(ctx, W, H, rng, accent, scroll, baseY, heightRange, opacity, count, baseColor) {
    ctx.globalAlpha = opacity;
    const baseH = H * baseY;
    const slotW = W / count;

    for (let i = 0; i < count + 2; i++) {
      const bH = H * heightRange * (0.3 + rng() * 0.7);
      const bW = slotW * (0.5 + rng() * 0.4);
      const x = (i - 1) * slotW + (rng() * slotW * 0.3) - (scroll % slotW);
      const y = baseH - bH;

      // Building body
      ctx.fillStyle = baseColor;
      ctx.fillRect(x, y, bW, bH + (H - baseH));

      // Windows
      const cols = Math.floor(bW / 8);
      const rows = Math.floor(bH / 10);
      for (let wy = 0; wy < rows; wy++) {
        for (let wx = 0; wx < cols; wx++) {
          if (rng() > 0.55) {
            ctx.fillStyle = rng() > 0.7 ? accent : 'rgba(255,230,150,0.4)';
            ctx.globalAlpha = opacity * (0.2 + rng() * 0.5);
            ctx.fillRect(x + 3 + wx * 8, y + 4 + wy * 10, 4, 6);
          }
        }
      }
      ctx.globalAlpha = opacity;

      // Antenna / spire on tallest
      if (rng() > 0.7) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = opacity * 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + bW / 2, y);
        ctx.lineTo(x + bW / 2, y - bH * 0.15);
        ctx.stroke();
      }
      ctx.globalAlpha = opacity;
    }
    ctx.globalAlpha = 1;
  }

  function seededRandom(seed) {
    let s = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function animate(canvas, cityName) {
    let offset = 0;
    let last = 0;
    const tick = (t) => {
      if (t - last > 40) { // ~24fps
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        draw(canvas, cityName, offset);
        offset += 0.3;
        last = t;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return { draw, animate };
})();

// ── State ───────────────────────────────────────────────────
const State = (() => {
  const DEFAULTS = {
    bankroll: 5000,
    bet: 100,
    selectedBetChip: 100,
    mode: null,       // 'story' | 'tournament' | 'arcade'
    agentId: 'SHADDAI',
    city: 'Vegas',
    players: 1,
    storyProgress: [false, false, false, false, false], // beaten cities
    stats: { wins: 0, losses: 0, bjs: 0, pushes: 0, streak: 0, bestStreak: 0 },
    settings: { decks: 6, dealerHitsSoft17: true, surrender: true, sound: true, feltColor: '#0b2216' },
  };

  let _state = JSON.parse(JSON.stringify(DEFAULTS));

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem('shaddai_royale_v2') || '{}');
      _state = deepMerge(DEFAULTS, saved);
    } catch(e) { _state = JSON.parse(JSON.stringify(DEFAULTS)); }
  }

  function save() {
    try { localStorage.setItem('shaddai_royale_v2', JSON.stringify(_state)); } catch(e) {}
  }

  function deepMerge(def, saved) {
    const out = JSON.parse(JSON.stringify(def));
    for (const k in saved) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]))
        out[k] = deepMerge(def[k] || {}, saved[k]);
      else if (saved[k] !== undefined) out[k] = saved[k];
    }
    return out;
  }

  function get(key) { return key ? _state[key] : _state; }

  function set(key, val) {
    _state[key] = val;
    save();
  }

  function setNested(path, val) {
    const parts = path.split('.');
    let obj = _state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = val;
    save();
  }

  function getNested(path) {
    return path.split('.').reduce((o, k) => (o || {})[k], _state);
  }

  load();
  return { get, set, setNested, getNested, save };
})();

// ── Screen router ───────────────────────────────────────────
const Router = (() => {
  let current = null;

  function go(id) {
    if (current) {
      const prev = document.getElementById(current);
      if (prev) { prev.classList.remove('active'); prev.classList.add('exit'); setTimeout(() => prev.classList.remove('exit'), 600); }
    }
    current = id;
    const next = document.getElementById(id);
    if (next) { next.classList.add('active'); }
  }

  return { go };
})();

// ── AGENTS config ───────────────────────────────────────────
const AGENTS = [
  { id: 'SHADDAI', name: 'SHADDAI', role: 'Supreme', icon: '♔', color: '#c9a84c', style: 'strategic' },
  { id: 'NEXUS',   name: 'NEXUS',   role: 'Architect', icon: '⚡', color: '#00e5ff', style: 'precise'   },
  { id: 'ZEROX',   name: 'ZEROX',   role: 'Wealth',    icon: '◈', color: '#4ade80', style: 'aggressive' },
  { id: 'ORACLE',  name: 'ORACLE',  role: 'Insight',   icon: '◉', color: '#a855f7', style: 'calculated' },
  { id: 'TURTLE',  name: 'TURTLE',  role: 'Creative',  icon: '◆', color: '#22d3ee', style: 'artistic'   },
  { id: 'QUILL',   name: 'QUILL',   role: 'Scholar',   icon: '✦', color: '#f0c84a', style: 'conservative'},
  { id: 'PIKADON', name: 'PIKADON', role: 'Security',  icon: '⬡', color: '#f87171', style: 'defensive'  },
];

const AGENT_QUIPS = {
  SHADDAI:  { deal: 'A new hand — the empire awaits.', win: 'Victory is our nature.', lose: 'A setback. Recalibrate.', bj: 'BLACKJACK — royale!' },
  NEXUS:    { deal: 'Calculating optimal paths…', win: 'Expected outcome achieved.', lose: 'Variance. Adjust.', bj: 'Perfect hand. Statistically beautiful.' },
  ZEROX:    { deal: 'Chip stacks in motion.', win: 'ROI confirmed. Press harder.', lose: 'Cost of doing business.', bj: 'Maximum payout sequence!' },
  ORACLE:   { deal: 'The cards have a story to tell.', win: 'I saw this coming.', lose: 'An anomaly. Interesting.', bj: 'I had a vision of this.' },
  TURTLE:   { deal: 'Let the design unfold.', win: 'Beautifully played.', lose: 'Aesthetic loss, graceful.', bj: 'Masterpiece of a hand!' },
  QUILL:    { deal: 'This hand writes its own chapter.', win: 'A well-structured outcome.', lose: 'The narrative shifts.', bj: 'The finest of conclusions!' },
  PIKADON:  { deal: 'Threat assessment: minimal.', win: 'Security protocols intact.', lose: 'Breach contained.', bj: 'Maximum threat neutralized!' },
};

// ── CITIES config ───────────────────────────────────────────
const CITIES = [
  { id: 'Phoenix', name: 'Phoenix',  buyIn: 500,   pot: 5000,   gradient: 'linear-gradient(160deg, #3a0800, #1a0400, #0a0200)' },
  { id: 'Vegas',   name: 'Las Vegas', buyIn: 1000,  pot: 15000,  gradient: 'linear-gradient(160deg, #0a0020, #050010, #020008)' },
  { id: 'Miami',   name: 'Miami',    buyIn: 2500,  pot: 35000,  gradient: 'linear-gradient(160deg, #001a10, #000e08, #000502)' },
  { id: 'Texas',   name: 'Texas',    buyIn: 5000,  pot: 75000,  gradient: 'linear-gradient(160deg, #100020, #080010, #020008)' },
  { id: 'NewYork', name: 'New York', buyIn: 10000, pot: 200000, gradient: 'linear-gradient(160deg, #001020, #000810, #000204)' },
];

// ── Card rendering ──────────────────────────────────────────
const Cards = (() => {
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RED_SUITS = ['H', 'D'];

  function makeCard(card, faceDown = false, delay = 0) {
    const el = document.createElement('div');
    el.className = 'playing-card';
    el.style.animationDelay = delay + 's';

    if (faceDown) {
      el.innerHTML = `
        <div class="card-back-face">
          <div class="card-back-pattern"></div>
          <div class="card-back-emblem">SR</div>
        </div>`;
      return el;
    }

    const isRed = RED_SUITS.includes(card.suit);
    el.classList.add(isRed ? 'red-card' : 'black-card');
    const s = SUIT_SYMBOL[card.suit] || card.suit;
    const r = card.rank;

    el.innerHTML = `
      <div class="card-corner">
        <span class="card-rank">${r}</span>
        <span class="card-suit-small">${s}</span>
      </div>
      <span class="card-center">${s}</span>
      <div class="card-corner bottom-right">
        <span class="card-rank">${r}</span>
        <span class="card-suit-small">${s}</span>
      </div>`;
    return el;
  }

  function flip(el, card) {
    el.style.transition = 'transform 0.12s ease-in';
    el.style.transform = 'scaleX(0)';
    setTimeout(() => {
      const isRed = RED_SUITS.includes(card.suit);
      el.className = 'playing-card ' + (isRed ? 'red-card' : 'black-card');
      const s = SUIT_SYMBOL[card.suit] || card.suit;
      const r = card.rank;
      el.innerHTML = `
        <div class="card-corner">
          <span class="card-rank">${r}</span>
          <span class="card-suit-small">${s}</span>
        </div>
        <span class="card-center">${s}</span>
        <div class="card-corner bottom-right">
          <span class="card-rank">${r}</span>
          <span class="card-suit-small">${s}</span>
        </div>`;
      el.style.transform = 'scaleX(1)';
    }, 120);
  }

  return { makeCard, flip };
})();

// ── Chip colors ─────────────────────────────────────────────
function chipColor(val) {
  if (val >= 5000) return ['var(--gold-bright)', '#5a3d0c', 'var(--gold-bright)'];
  if (val >= 1000) return ['var(--cyan)', '#002030', 'var(--cyan)'];
  if (val >= 500)  return ['#a855f7', '#1a0030', '#a855f7'];
  if (val >= 250)  return ['var(--gold)', '#3a2a08', 'var(--gold)'];
  if (val >= 100)  return ['var(--red)', '#2a0408', 'var(--red)'];
  if (val >= 50)   return ['#4ade80', '#062014', '#4ade80'];
  if (val >= 25)   return ['#4a9eff', '#001430', '#4a9eff'];
  return ['#888', '#1a1a1a', '#aaa'];
}

// ── Utility ─────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));
function fmt(n) { return n.toLocaleString('en-US'); }

// ── SCREENS ─────────────────────────────────────────────────

// ╔══════════════════════════════════════════╗
// ║  SPLASH                                  ║
// ╚══════════════════════════════════════════╝
function initSplash() {
  // Animated skyline canvas on splash
  const canvas = document.getElementById('splash-canvas');
  if (canvas) Skyline.animate(canvas, 'Vegas');

  document.getElementById('btn-splash-play').addEventListener('click', () => {
    Audio.chip();
    Router.go('screen-mode');
    initMode();
  });
}

// ╔══════════════════════════════════════════╗
// ║  MODE SELECT                             ║
// ╚══════════════════════════════════════════╝
function initMode() {
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const m = card.dataset.mode;
      Audio.chip();
      State.set('mode', m);
      if (m === 'story') {
        Router.go('screen-story');
        initStory();
      } else {
        Router.go('screen-agent');
        initAgentSelect();
      }
    });
  });
}

// ╔══════════════════════════════════════════╗
// ║  AGENT SELECT                            ║
// ╚══════════════════════════════════════════╝
function initAgentSelect() {
  const grid = document.getElementById('agent-grid');
  grid.innerHTML = '';

  AGENTS.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card' + (State.get('agentId') === agent.id ? ' selected' : '');
    card.dataset.id = agent.id;

    card.innerHTML = `
      <div class="agent-frame">
        <div class="agent-role-bar" style="background:${agent.color};opacity:0.6"></div>
        <img class="agent-portrait"
             src="assets/agents/${agent.id}.png"
             alt="${agent.name}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="agent-silhouette" style="display:none">
          <div class="agent-silhouette-icon">${agent.icon}</div>
        </div>
        <div class="agent-glow" style="background:radial-gradient(ellipse at 50% 100%, ${agent.color}22 0%, transparent 70%)"></div>
        <div class="agent-name-tag">
          <span>${agent.name}</span>
          <small>${agent.role}</small>
        </div>
        <div class="agent-select-check">✓</div>
      </div>`;

    card.addEventListener('click', () => {
      Audio.chip();
      document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      State.set('agentId', agent.id);
    });

    grid.appendChild(card);
  });

  document.getElementById('btn-agent-next').addEventListener('click', () => {
    Audio.chip();
    Router.go('screen-config');
    initConfig();
  });

  document.getElementById('btn-agent-back').addEventListener('click', () => {
    Router.go('screen-mode');
  });
}

// ╔══════════════════════════════════════════╗
// ║  TABLE CONFIG                            ║
// ╚══════════════════════════════════════════╝
function initConfig() {
  // City pills
  const pillsEl = document.getElementById('city-pills');
  pillsEl.innerHTML = '';
  CITIES.forEach(c => {
    const pill = document.createElement('button');
    pill.className = 'city-pill' + (State.get('city') === c.id ? ' active' : '');
    pill.textContent = c.name;
    pill.addEventListener('click', () => {
      Audio.chip();
      document.querySelectorAll('.city-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      State.set('city', c.id);
      updateConfigBackdrop(c.id);
    });
    pillsEl.appendChild(pill);
  });

  // Player count
  const pRow = document.getElementById('player-count-row');
  pRow.innerHTML = '';
  for (let i = 1; i <= 4; i++) {
    const btn = document.createElement('button');
    btn.className = 'player-num-btn' + (State.get('players') === i ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      Audio.chip();
      document.querySelectorAll('.player-num-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.set('players', i);
    });
    pRow.appendChild(btn);
  }

  updateConfigBackdrop(State.get('city'));

  document.getElementById('btn-config-play').addEventListener('click', () => {
    Audio.deal();
    Router.go('screen-table');
    initTable();
  });

  document.getElementById('btn-config-back').addEventListener('click', () => {
    Router.go('screen-agent');
  });
}

function updateConfigBackdrop(cityId) {
  const city = CITIES.find(c => c.id === cityId);
  const backdrop = document.getElementById('config-backdrop');
  if (!backdrop) return;

  const img = backdrop.querySelector('img');
  if (img) {
    img.src = `assets/cities/${cityId}.jpg`;
    img.onerror = () => { backdrop.querySelector('.city-backdrop-fallback').style.background = city.gradient; };
  }

  const fb = backdrop.querySelector('.city-backdrop-fallback');
  if (fb) fb.style.background = city.gradient;
}

// ╔══════════════════════════════════════════╗
// ║  STORY MAP                               ║
// ╚══════════════════════════════════════════╝
function initStory() {
  const container = document.getElementById('story-path');
  container.innerHTML = '';
  const progress = State.get('storyProgress');

  CITIES.forEach((city, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'story-connector';
      container.appendChild(conn);
    }

    const beaten = progress[i];
    const locked  = i > 0 && !progress[i - 1];
    const isNext  = !beaten && !locked;

    const row = document.createElement('div');
    row.className = 'story-city' + (beaten ? ' beaten' : '') + (isNext ? ' active-city' : '') + (locked ? ' locked' : '');

    row.innerHTML = `
      <div class="story-city-num">${i + 1}</div>
      <div class="story-city-info">
        <div class="story-city-name">${city.name}</div>
        <div class="story-city-meta">Buy-in: $${fmt(city.buyIn)} · Pot: $${fmt(city.pot)}</div>
      </div>
      <div class="story-city-status ${beaten ? 'status-beaten' : locked ? 'status-locked' : 'status-play'}">
        ${beaten ? 'Cleared' : locked ? 'Locked' : 'Play'}
      </div>`;

    if (!locked) {
      row.addEventListener('click', () => {
        Audio.chip();
        State.set('city', city.id);
        Router.go('screen-agent');
        initAgentSelect();
      });
    }

    container.appendChild(row);
  });

  document.getElementById('btn-story-back').addEventListener('click', () => {
    Router.go('screen-mode');
  });
}

// ╔══════════════════════════════════════════╗
// ║  GAME TABLE                              ║
// ╚══════════════════════════════════════════╝

let G = null; // game round state

function initTable() {
  G = {
    shoe: E.newShoe(State.getNested('settings.decks')),
    round: null,
    playing: false,
    hintOn: false,
    sideBets: { perfectPairs: 0, twentyOnePlus3: 0 },
  };

  // City backdrop
  const cityId = State.get('city');
  const city = CITIES.find(c => c.id === cityId);
  const bgImg = document.getElementById('table-bg-img');
  const bgCanvas = document.getElementById('table-city-bg-canvas');

  if (bgImg) {
    bgImg.src = `assets/cities/${cityId}.jpg`;
    bgImg.onerror = () => {
      bgImg.style.display = 'none';
      if (bgCanvas) Skyline.animate(bgCanvas, cityId);
    };
    bgImg.onload = () => { bgImg.style.opacity = 1; };
  }

  // Dealer
  const agentId = State.get('agentId');
  const agent = AGENTS.find(a => a.id === agentId);
  const dealerAvatar = document.getElementById('dealer-avatar');
  if (dealerAvatar) {
    dealerAvatar.src = `assets/agents/${agentId}.png`;
    dealerAvatar.onerror = () => {
      dealerAvatar.style.display = 'none';
      document.getElementById('dealer-avatar-fallback').textContent = agent?.icon || '♠';
      document.getElementById('dealer-avatar-fallback').style.display = 'flex';
    };
  }

  const dealerNameEl = document.getElementById('dealer-name');
  if (dealerNameEl && agent) dealerNameEl.textContent = agent.name;

  const hintThumb = document.getElementById('hint-dealer-thumb');
  if (hintThumb) {
    hintThumb.src = `assets/agents/${agentId}.png`;
    hintThumb.onerror = () => { hintThumb.style.display = 'none'; };
  }

  // Felt color from settings
  const felt = document.querySelector('.table-felt');
  if (felt) {
    const fc = State.getNested('settings.feltColor') || '#0b2216';
    felt.style.background = `radial-gradient(ellipse at 50% 30%, ${fc} 0%, ${fc}99 35%, ${hexDarken(fc, 0.4)} 70%, #010605 100%)`;
  }

  renderBankroll();
  renderStats();
  buildChipSelector();
  buildAISeats();
  bindTableActions();
  setHint('Place your bet to begin.');
  resetActionBar(false);
}

function renderBankroll() {
  const el = document.getElementById('bankroll-amount');
  if (el) el.textContent = '$' + fmt(State.get('bankroll'));
}

function renderStats() {
  const stats = State.get('stats');
  const els = {
    'stat-wins': stats.wins,
    'stat-losses': stats.losses,
    'stat-bjs': stats.bjs,
    'stat-streak': stats.streak,
  };
  for (const [id, val] of Object.entries(els)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

function buildChipSelector() {
  const CHIPS = [10, 25, 50, 100, 250, 500, 1000, 5000];
  const container = document.getElementById('chip-selector');
  if (!container) return;
  container.innerHTML = '';

  CHIPS.forEach(val => {
    const btn = document.createElement('button');
    const [border, bg, text] = chipColor(val);
    btn.className = `chip-btn chip-${val}` + (State.get('selectedBetChip') === val ? ' active' : '');
    btn.style.cssText = `border-color:${border};color:${text};--chip-border:${border}`;
    btn.textContent = val >= 1000 ? (val / 1000) + 'K' : val;
    btn.addEventListener('click', () => {
      Audio.chip();
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.set('selectedBetChip', val);
      State.set('bet', val);
      document.getElementById('bet-amount').textContent = '$' + fmt(val);
    });
    container.appendChild(btn);
  });

  document.getElementById('bet-amount').textContent = '$' + fmt(State.get('bet'));
}

function buildAISeats() {
  const numPlayers = State.get('players');
  const container = document.getElementById('ai-seat-row');
  if (!container) return;
  container.innerHTML = '';

  if (numPlayers <= 1) { container.style.display = 'none'; return; }
  container.style.display = 'flex';

  const agentList = AGENTS.filter(a => a.id !== State.get('agentId')).slice(0, numPlayers - 1);

  agentList.forEach(agent => {
    const seat = document.createElement('div');
    seat.className = 'ai-seat';
    seat.id = 'ai-seat-' + agent.id;
    seat.innerHTML = `
      <div class="ai-seat-name" style="color:${agent.color}">${agent.name}</div>
      <div class="cards-row" id="ai-cards-${agent.id}"></div>
      <div class="ai-seat-val" id="ai-val-${agent.id}">—</div>`;
    container.appendChild(seat);
  });
}

function bindTableActions() {
  const handlers = {
    'btn-deal':       () => onDeal(),
    'btn-hit':        () => onHit(),
    'btn-stand':      () => onStand(),
    'btn-double':     () => onDouble(),
    'btn-split':      () => onSplit(),
    'btn-surrender':  () => onSurrender(),
    'btn-insurance':  () => onInsurance(),
    'btn-bet-down':   () => adjustBet(-State.get('selectedBetChip')),
    'btn-bet-up':     () => adjustBet(+State.get('selectedBetChip')),
    'btn-hint':       () => toggleHint(),
    'btn-table-settings': () => openModal('settings'),
    'btn-table-stats': () => openModal('stats'),
    'btn-table-back': () => { Router.go('screen-mode'); },
    'btn-side-pp':    () => toggleSideBet('perfectPairs'),
    'btn-side-21':    () => toggleSideBet('twentyOnePlus3'),
  };

  for (const [id, fn] of Object.entries(handlers)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }
}

function adjustBet(delta) {
  if (G && G.playing) return;
  const min = 10, max = Math.min(State.get('bankroll'), 50000);
  let newBet = Math.max(min, Math.min(max, State.get('bet') + delta));
  State.set('bet', newBet);
  const el = document.getElementById('bet-amount');
  if (el) el.textContent = '$' + fmt(newBet);
  Audio.chip();
}

function toggleSideBet(type) {
  if (G && G.playing) return;
  const current = G.sideBets[type];
  G.sideBets[type] = current ? 0 : State.get('bet');

  const btnId = type === 'perfectPairs' ? 'btn-side-pp' : 'btn-side-21';
  const btn = document.getElementById(btnId);
  const amountEl = btn ? btn.querySelector('.side-bet-amount') : null;
  const active = G.sideBets[type] > 0;

  if (btn) btn.classList.toggle('active', active);
  if (amountEl) amountEl.textContent = active ? '$' + fmt(G.sideBets[type]) : '';
  Audio.chip();
}

function toggleHint() {
  G.hintOn = !G.hintOn;
  const btn = document.getElementById('btn-hint');
  if (btn) btn.classList.toggle('on', G.hintOn);
  updateHint();
}

function setHint(text) {
  const el = document.getElementById('hint-text');
  if (el) el.innerHTML = text;
}

function updateHint() {
  if (!G || !G.round || !G.playing) return;
  if (!G.hintOn) { setHint('Hint mode <strong>OFF</strong>'); return; }

  const playerHand = G.round.seats?.[0]?.hand || G.playerHand || [];
  const dealerUp = G.round.dealerHand?.[0] || G.dealerHand?.[0];
  if (!playerHand.length || !dealerUp) return;

  const action = E.basicStrategy(playerHand, dealerUp.rank, State.get('settings'));
  const labels = { H: 'HIT', S: 'STAND', D: 'DOUBLE', P: 'SPLIT', R: 'SURRENDER' };
  const agentId = State.get('agentId');
  const quips = AGENT_QUIPS[agentId] || {};
  const label = labels[action] || action;
  setHint(`<strong>${label}</strong> — ${quips.deal || 'Basic strategy recommends this move.'}`);
}

// ── Game flow ────────────────────────────────────────────────

async function onDeal() {
  if (G.playing) return;
  const bet = State.get('bet');
  const bankroll = State.get('bankroll');

  if (bet > bankroll) {
    openModal('chips');
    setHint('Insufficient funds — add chips to continue.');
    return;
  }

  // Deduct bet + side bets
  let totalDeduct = bet;
  if (G.sideBets.perfectPairs > 0) totalDeduct += G.sideBets.perfectPairs;
  if (G.sideBets.twentyOnePlus3 > 0) totalDeduct += G.sideBets.twentyOnePlus3;

  State.set('bankroll', bankroll - totalDeduct);
  renderBankroll();

  G.playing = true;
  G.playerHand = [];
  G.dealerHand = [];

  clearCards();
  resetActionBar(false);
  hideResult();

  const agentId = State.get('agentId');
  const quips = AGENT_QUIPS[agentId] || {};
  setHint(quips.deal || 'Dealing…');

  // Deal sequence: P, D(face-down), P, D
  Audio.card();
  const p1 = Cards.makeCard(drawCard(), false, 0);
  document.getElementById('player-cards').appendChild(p1);
  G.playerHand.push(G._lastDrawn);
  await wait(200);

  Audio.card();
  const d1 = Cards.makeCard(drawCard(), true, 0);
  document.getElementById('dealer-cards').appendChild(d1);
  G.dealerHand.push(G._lastDrawn);
  await wait(200);

  Audio.card();
  const p2 = Cards.makeCard(drawCard(), false, 0);
  document.getElementById('player-cards').appendChild(p2);
  G.playerHand.push(G._lastDrawn);
  await wait(200);

  Audio.card();
  const d2 = Cards.makeCard(drawCard(), false, 0);
  document.getElementById('dealer-cards').appendChild(d2);
  G.dealerHand.push(G._lastDrawn);
  await wait(200);

  // Store hole card el for flip
  G.holeCardEl = d1;

  // Update totals
  updatePlayerTotal();
  updateDealerTotal(true); // show only face-up card

  // Deal AI seats
  await dealAISeats();

  // Check player BJ
  const playerBJ = E.isBlackjack(G.playerHand);
  if (playerBJ) {
    // Flip dealer hole
    flipHoleCard();
    await wait(350);
    const dealerBJ = E.isBlackjack(G.dealerHand);
    if (dealerBJ) {
      updateDealerTotal(false);
      await endRound('push', 0, 'PUSH');
    } else {
      updateDealerTotal(false);
      const payout = Math.floor(bet * 1.5);
      await endRound('bj', bet + payout, 'BLACKJACK');
      Audio.bj();
    }
    return;
  }

  resetActionBar(true);
  updateHint();
}

function drawCard() {
  if (G.shoe.length < 15) G.shoe = E.newShoe(State.getNested('settings.decks'));
  const c = G.shoe.pop();
  G._lastDrawn = c;
  return c;
}

function clearCards() {
  document.getElementById('player-cards').innerHTML = '';
  document.getElementById('dealer-cards').innerHTML = '';
  document.getElementById('player-total').textContent = '—';
  document.getElementById('player-total').className = 'hand-total';
  document.getElementById('dealer-total').textContent = '—';
  document.getElementById('dealer-total').className = 'hand-total';

  const numPlayers = State.get('players');
  if (numPlayers > 1) {
    AGENTS.filter(a => a.id !== State.get('agentId')).slice(0, numPlayers - 1).forEach(agent => {
      const el = document.getElementById('ai-cards-' + agent.id);
      const valEl = document.getElementById('ai-val-' + agent.id);
      if (el) el.innerHTML = '';
      if (valEl) valEl.textContent = '—';
    });
  }
}

function updatePlayerTotal() {
  const { total, soft } = E.handValue(G.playerHand);
  const el = document.getElementById('player-total');
  if (!el) return;
  if (total > 21) {
    el.textContent = 'BUST';
    el.className = 'hand-total bust';
  } else if (E.isBlackjack(G.playerHand)) {
    el.innerHTML = `<span>21</span><sup>BJ</sup>`;
    el.className = 'hand-total blackjack';
  } else {
    el.textContent = soft ? `${total - 10}/${total}` : total;
    el.className = 'hand-total';
  }
}

function updateDealerTotal(hideHole = true) {
  const el = document.getElementById('dealer-total');
  if (!el) return;
  if (hideHole) {
    const visible = [G.dealerHand[1]].filter(Boolean);
    const { total } = E.handValue(visible);
    el.textContent = total + ' + ?';
    el.className = 'hand-total';
  } else {
    const { total } = E.handValue(G.dealerHand);
    if (total > 21) {
      el.textContent = 'BUST';
      el.className = 'hand-total bust';
    } else if (E.isBlackjack(G.dealerHand)) {
      el.innerHTML = `<span>21</span><sup>BJ</sup>`;
      el.className = 'hand-total blackjack';
    } else {
      el.textContent = total;
      el.className = 'hand-total';
    }
  }
}

function flipHoleCard() {
  if (G.holeCardEl) Cards.flip(G.holeCardEl, G.dealerHand[0]);
}

async function dealAISeats() {
  const numPlayers = State.get('players');
  if (numPlayers <= 1) return;
  const agentList = AGENTS.filter(a => a.id !== State.get('agentId')).slice(0, numPlayers - 1);

  G.aiHands = {};
  for (const agent of agentList) {
    G.aiHands[agent.id] = [drawCard(), drawCard()];
    const container = document.getElementById('ai-cards-' + agent.id);
    if (container) {
      container.innerHTML = '';
      G.aiHands[agent.id].forEach((card, idx) => {
        container.appendChild(Cards.makeCard(card, false, idx * 0.06));
      });
      const valEl = document.getElementById('ai-val-' + agent.id);
      if (valEl) {
        const { total } = E.handValue(G.aiHands[agent.id]);
        valEl.textContent = total;
        valEl.className = 'ai-seat-val';
      }
    }
    await wait(80);
  }
}

async function onHit() {
  if (!G.playing) return;
  Audio.card();
  const card = drawCard();
  G.playerHand.push(card);
  const el = Cards.makeCard(card, false, 0);
  document.getElementById('player-cards').appendChild(el);
  updatePlayerTotal();
  updateHint();

  const { total } = E.handValue(G.playerHand);
  if (total >= 21) {
    resetActionBar(false);
    await wait(300);
    await resolveDealerPlay();
  }
}

async function onStand() {
  if (!G.playing) return;
  resetActionBar(false);
  await resolveDealerPlay();
}

async function onDouble() {
  if (!G.playing) return;
  const bet = State.get('bet');
  const bankroll = State.get('bankroll');
  if (bankroll < bet) { setHint('Insufficient funds to double.'); return; }

  State.set('bankroll', bankroll - bet);
  State.set('bet', bet * 2);
  document.getElementById('bet-amount').textContent = '$' + fmt(State.get('bet'));
  renderBankroll();

  Audio.card();
  const card = drawCard();
  G.playerHand.push(card);
  const el = Cards.makeCard(card, false, 0);
  document.getElementById('player-cards').appendChild(el);
  updatePlayerTotal();
  resetActionBar(false);
  await wait(400);
  await resolveDealerPlay();
}

async function onSplit() {
  if (!G.playing) return;
  if (G.playerHand.length !== 2 || G.playerHand[0].rank !== G.playerHand[1].rank) return;
  const bet = State.get('bet');
  if (State.get('bankroll') < bet) { setHint('Insufficient funds to split.'); return; }

  State.set('bankroll', State.get('bankroll') - bet);
  renderBankroll();

  // Simple split: remove second card, deal one new card
  const splitCard = G.playerHand.pop();
  const newCard = drawCard();
  G.playerHand.push(newCard);

  Audio.card();
  const container = document.getElementById('player-cards');
  container.innerHTML = '';
  G.playerHand.forEach((c, i) => container.appendChild(Cards.makeCard(c, false, i * 0.05)));
  updatePlayerTotal();
  updateHint();
  setHint('Split — play this hand normally.');
}

async function onSurrender() {
  if (!G.playing) return;
  const bet = State.get('bet');
  const refund = Math.floor(bet / 2);
  State.set('bankroll', State.get('bankroll') + refund);
  showResult('player-result', 'SURRENDER', 'push');
  showPayoutFloat('+' + fmt(refund), 'push');
  renderBankroll();
  await endRound('push', refund, 'SURRENDER');
}

async function onInsurance() {
  if (!G.playing) return;
  const bet = State.get('bet');
  const ins = Math.floor(bet / 2);
  if (State.get('bankroll') < ins) { setHint('Insufficient funds for insurance.'); return; }
  State.set('bankroll', State.get('bankroll') - ins);
  renderBankroll();
  setHint('Insurance placed — $' + fmt(ins));
  // Simplified: pays 2:1 if dealer has BJ
  G.insurance = ins;
}

async function resolveDealerPlay() {
  // Flip hole card
  flipHoleCard();
  updateDealerTotal(false);
  await wait(400);

  const settings = State.get('settings');
  // Dealer draws
  while (true) {
    const { total, soft } = E.handValue(G.dealerHand);
    if (total < 17) { await dealerDraw(); continue; }
    if (total === 17 && soft && settings.dealerHitsSoft17) { await dealerDraw(); continue; }
    break;
  }

  // Resolve AI seats
  await resolveAISeats();

  // Determine result
  const { total: pTotal } = E.handValue(G.playerHand);
  const { total: dTotal } = E.handValue(G.dealerHand);
  const bet = State.get('bet');

  let outcome, payout, label;

  if (pTotal > 21) {
    outcome = 'lose'; payout = 0; label = 'BUST';
  } else if (dTotal > 21) {
    outcome = 'win'; payout = bet * 2; label = 'DEALER BUST';
  } else if (pTotal > dTotal) {
    outcome = 'win'; payout = bet * 2; label = 'WIN';
  } else if (pTotal === dTotal) {
    outcome = 'push'; payout = bet; label = 'PUSH';
  } else {
    outcome = 'lose'; payout = 0; label = 'DEALER WINS';
  }

  // Insurance resolution
  if (G.insurance && E.isBlackjack(G.dealerHand)) {
    const insPay = G.insurance * 3; // 2:1 + return
    payout += insPay;
    label += ' (INS +' + fmt(insPay) + ')';
  }

  await endRound(outcome, payout, label);
}

async function dealerDraw() {
  Audio.card();
  const card = drawCard();
  G.dealerHand.push(card);
  document.getElementById('dealer-cards').appendChild(Cards.makeCard(card, false, 0));
  updateDealerTotal(false);
  await wait(300);
}

async function resolveAISeats() {
  if (!G.aiHands) return;
  const { total: dTotal } = E.handValue(G.dealerHand);
  const dBust = dTotal > 21;

  for (const [agentId, hand] of Object.entries(G.aiHands)) {
    // AI plays basic strategy
    const agentObj = AGENTS.find(a => a.id === agentId);
    while (true) {
      const action = E.basicStrategy(hand, G.dealerHand[1].rank, State.get('settings'));
      if (action !== 'H' && action !== 'D') break;
      const c = drawCard();
      hand.push(c);
      const container = document.getElementById('ai-cards-' + agentId);
      if (container) container.appendChild(Cards.makeCard(c, false, 0));
      await wait(150);
      const { total } = E.handValue(hand);
      if (total >= 21) break;
    }

    const { total: aTotal } = E.handValue(hand);
    const valEl = document.getElementById('ai-val-' + agentId);
    if (valEl) {
      if (aTotal > 21) { valEl.textContent = 'BUST'; valEl.className = 'ai-seat-val bust'; }
      else if (dBust || aTotal > dTotal) { valEl.textContent = aTotal + ' W'; valEl.className = 'ai-seat-val'; valEl.style.color = '#4ade80'; }
      else if (aTotal === dTotal) { valEl.textContent = aTotal + ' P'; valEl.className = 'ai-seat-val'; }
      else { valEl.textContent = aTotal + ' L'; valEl.className = 'ai-seat-val bust'; }
    }
  }
}

async function endRound(outcome, payout, label) {
  G.playing = false;
  G.insurance = 0;

  // Update bankroll
  State.set('bankroll', State.get('bankroll') + payout);

  // Update stats
  const stats = State.get('stats');
  if (outcome === 'win' || outcome === 'bj') {
    stats.wins++;
    stats.streak = Math.max(0, stats.streak) + 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (outcome === 'bj') stats.bjs++;
  } else if (outcome === 'lose') {
    stats.losses++;
    stats.streak = Math.min(0, stats.streak) - 1;
  } else {
    // push — streak stays
  }
  State.set('stats', stats);

  // Side bet resolution (simplified)
  if (G.sideBets.perfectPairs > 0 || G.sideBets.twentyOnePlus3 > 0) {
    resolveSideBets(payout);
  }

  // Show result
  showResult('player-result', label, outcome);
  showPayoutFloat((payout > 0 ? '+' : '') + fmt(payout - State.get('bet') + (outcome === 'push' ? 0 : 0)), outcome);

  // Dealer quip
  const agentId = State.get('agentId');
  const quips = AGENT_QUIPS[agentId] || {};
  setHint(quips[outcome] || quips[outcome === 'bj' ? 'bj' : outcome] || 'Round complete.');

  renderBankroll();
  renderStats();

  // Reset bet for next round
  State.set('bet', State.get('selectedBetChip'));
  document.getElementById('bet-amount').textContent = '$' + fmt(State.get('bet'));

  await wait(600);
  resetActionBar(false, true);

  // Story progress
  if (State.get('mode') === 'story' && (outcome === 'win' || outcome === 'bj')) {
    const cityId = State.get('city');
    const cityIdx = CITIES.findIndex(c => c.id === cityId);
    if (cityIdx >= 0) {
      const progress = State.get('storyProgress');
      progress[cityIdx] = true;
      State.set('storyProgress', progress);
    }
  }

  // Low bankroll warning
  if (State.get('bankroll') < 10) openModal('chips');
}

function resolveSideBets(mainPayout) {
  const ph = G.playerHand;
  let sidePay = 0;
  if (G.sideBets.perfectPairs > 0) {
    if (ph.length >= 2 && ph[0].rank === ph[1].rank) {
      const perfectMatch = ph[0].suit === ph[1].suit;
      const colorMatch = ['H','D'].includes(ph[0].suit) === ['H','D'].includes(ph[1].suit);
      const mult = perfectMatch ? 30 : colorMatch ? 10 : 5;
      sidePay += G.sideBets.perfectPairs * mult;
    }
  }
  if (G.sideBets.twentyOnePlus3 > 0) {
    const combo = [ph[0], ph[1], G.dealerHand[1]].filter(Boolean);
    if (combo.length === 3) {
      const val = E.handValue(combo).total;
      if (val === 21) sidePay += G.sideBets.twentyOnePlus3 * 9;
      else if (isStraightFlush(combo)) sidePay += G.sideBets.twentyOnePlus3 * 40;
      else if (isThreeOfAKind(combo)) sidePay += G.sideBets.twentyOnePlus3 * 30;
      else if (isStraight(combo)) sidePay += G.sideBets.twentyOnePlus3 * 10;
      else if (isFlush(combo)) sidePay += G.sideBets.twentyOnePlus3 * 5;
    }
  }
  if (sidePay > 0) {
    State.set('bankroll', State.get('bankroll') + sidePay);
    showPayoutFloat('SIDE +' + fmt(sidePay), 'win');
    renderBankroll();
  }
}

function isStraightFlush(cards) { return isFlush(cards) && isStraight(cards); }
function isFlush(cards) { return cards.every(c => c.suit === cards[0].suit); }
function isStraight(cards) {
  const vals = cards.map(c => ['A','J','Q','K'].includes(c.rank) ? (c.rank === 'A' ? 1 : 10) : parseInt(c.rank)).sort((a,b) => a-b);
  return vals[1] - vals[0] === 1 && vals[2] - vals[1] === 1;
}
function isThreeOfAKind(cards) { return cards.every(c => c.rank === cards[0].rank); }

function showResult(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'result-badge show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function hideResult() {
  document.querySelectorAll('.result-badge').forEach(el => el.classList.remove('show'));
}

function showPayoutFloat(text, type) {
  const container = document.getElementById('payout-float-area');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'payout-float ' + (type === 'win' || type === 'bj' ? 'positive' : type === 'lose' ? 'negative' : 'push');
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function resetActionBar(enable, showDeal = false) {
  const actionIds = ['btn-hit', 'btn-stand', 'btn-double', 'btn-split', 'btn-surrender', 'btn-insurance'];
  actionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = !enable; el.style.display = ''; }
  });

  const deal = document.getElementById('btn-deal');
  if (deal) {
    deal.disabled = enable;
    deal.style.display = enable ? 'none' : '';
  }

  // Enable/disable split & double based on hand
  if (enable && G.playerHand) {
    const bet = State.get('bet');
    const bankroll = State.get('bankroll');
    const doubleEl = document.getElementById('btn-double');
    const splitEl = document.getElementById('btn-split');
    const surrEl = document.getElementById('btn-surrender');
    const insEl = document.getElementById('btn-insurance');

    if (doubleEl) doubleEl.disabled = G.playerHand.length !== 2 || bankroll < bet;
    if (splitEl) splitEl.disabled = G.playerHand.length !== 2 || G.playerHand[0].rank !== G.playerHand[1].rank || bankroll < bet;
    if (surrEl) surrEl.disabled = G.playerHand.length !== 2 || !State.getNested('settings.surrender');
    if (insEl) insEl.disabled = !(G.dealerHand[1]?.rank === 'A');
  }
}

// ── MODALS ───────────────────────────────────────────────────

function openModal(type) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-sub');
  const body = document.getElementById('modal-body');

  if (!overlay) return;

  if (type === 'chips') {
    title.textContent = 'Add Chips';
    sub.textContent = 'Top up your stack to keep playing.';
    body.innerHTML = `
      <div class="add-chips-grid">
        ${[500,1000,2500,5000].map(n => `
          <div class="add-chips-btn" onclick="addChips(${n})">
            <span class="amount">$${fmt(n)}</span>
            <span class="label">${n >= 2500 ? 'High Roller' : 'Quick Top-Up'}</span>
          </div>`).join('')}
      </div>`;
  } else if (type === 'stats') {
    const stats = State.get('stats');
    title.textContent = 'Your Statistics';
    sub.textContent = 'Session performance at a glance.';
    body.innerHTML = `
      <div class="stats-modal-grid">
        <div class="stat-tile"><span class="stat-tile-num">${stats.wins + stats.losses + stats.pushes}</span><span class="stat-tile-lbl">Hands</span></div>
        <div class="stat-tile"><span class="stat-tile-num" style="color:#4ade80">${stats.wins}</span><span class="stat-tile-lbl">Wins</span></div>
        <div class="stat-tile"><span class="stat-tile-num" style="color:var(--red)">${stats.losses}</span><span class="stat-tile-lbl">Losses</span></div>
        <div class="stat-tile"><span class="stat-tile-num" style="color:var(--gold)">${stats.bjs}</span><span class="stat-tile-lbl">Blackjacks</span></div>
        <div class="stat-tile"><span class="stat-tile-num" style="color:var(--cyan)">${stats.streak > 0 ? '+' : ''}${stats.streak}</span><span class="stat-tile-lbl">Streak</span></div>
        <div class="stat-tile"><span class="stat-tile-num">${stats.bestStreak}</span><span class="stat-tile-lbl">Best</span></div>
      </div>
      <div class="divider-gold"></div>
      <div style="text-align:center">
        <div style="font-family:'Share Tech Mono',monospace;font-size:1.2rem;color:var(--gold)">$${fmt(State.get('bankroll'))}</div>
        <div style="font-family:'Cinzel',serif;font-size:0.45rem;letter-spacing:0.2em;color:var(--gold-dim);text-transform:uppercase;margin-top:0.2rem">Current Bankroll</div>
      </div>`;
  } else if (type === 'settings') {
    initSettingsModal(body);
    title.textContent = 'Table Settings';
    sub.textContent = 'Customize your experience.';
  }

  overlay.classList.add('show');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('show');
}

function addChips(n) {
  State.set('bankroll', State.get('bankroll') + n);
  renderBankroll();
  closeModal();
  Audio.win();
}

function initSettingsModal(body) {
  const s = State.get('settings');
  const FELT_COLORS = ['#0b2216','#162240','#1a1a38','#2a1414','#14241a','#0a1a2a'];

  body.innerHTML = `
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Number of Decks</div>
        <div class="settings-row-sub">Shoe composition</div>
      </div>
      <div class="seg-buttons">
        ${[3,6,8].map(d => `<button class="seg-btn${s.decks===d?' active':''}" onclick="setSetting('decks',${d},this)">${d}</button>`).join('')}
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Dealer Hits Soft 17</div>
        <div class="settings-row-sub">House edge modifier</div>
      </div>
      <div class="toggle-switch${s.dealerHitsSoft17?' on':''}" id="toggle-dhs17" onclick="toggleSetting('dealerHitsSoft17','toggle-dhs17')">
        <div class="toggle-knob"></div>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Surrender</div>
        <div class="settings-row-sub">Allow late surrender</div>
      </div>
      <div class="toggle-switch${s.surrender?' on':''}" id="toggle-surr" onclick="toggleSetting('surrender','toggle-surr')">
        <div class="toggle-knob"></div>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Sound</div>
        <div class="settings-row-sub">Audio effects</div>
      </div>
      <div class="toggle-switch${s.sound?' on':''}" id="toggle-sound" onclick="toggleSetting('sound','toggle-sound')">
        <div class="toggle-knob"></div>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-label">Felt Color</div>
        <div class="settings-row-sub">Table surface</div>
      </div>
      <div class="felt-color-row">
        ${FELT_COLORS.map(c => `<div class="felt-swatch${s.feltColor===c?' active':''}" style="background:${c}" onclick="setFeltColor('${c}',this)"></div>`).join('')}
      </div>
    </div>`;
}

// expose to inline onclick
window.setSetting = function(key, val, btn) {
  State.setNested('settings.' + key, val);
  const group = btn.parentElement;
  group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (key === 'decks' && G) G.shoe = E.newShoe(val);
};

window.toggleSetting = function(key, toggleId) {
  const current = State.getNested('settings.' + key);
  State.setNested('settings.' + key, !current);
  const el = document.getElementById(toggleId);
  if (el) el.classList.toggle('on', !current);
  if (key === 'sound') Audio.toggle(!current);
};

window.setFeltColor = function(color, el) {
  State.setNested('settings.feltColor', color);
  document.querySelectorAll('.felt-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const felt = document.querySelector('.table-felt');
  if (felt) felt.style.background = `radial-gradient(ellipse at 50% 30%, ${color} 0%, ${color}99 35%, ${hexDarken(color, 0.4)} 70%, #010605 100%)`;
};

window.addChips = addChips;
window.openModal = openModal;
window.closeModal = closeModal;

// ── Helpers ─────────────────────────────────────────────────
function hexDarken(hex, factor) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0,2),16);
  const g = parseInt(c.slice(2,4),16);
  const b = parseInt(c.slice(4,6),16);
  return `rgb(${Math.round(r*factor)},${Math.round(g*factor)},${Math.round(b*factor)})`;
}

// ── SETTINGS SCREEN ─────────────────────────────────────────
function initSettingsScreen() {
  const body = document.getElementById('settings-screen-body');
  if (body) initSettingsModal(body);
  document.getElementById('btn-settings-back')?.addEventListener('click', () => {
    Router.go('screen-table');
  });
}

// ── BOOT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Init splash skyline
  initSplash();

  // Start at splash
  Router.go('screen-splash');

  // Modal overlay close on backdrop click
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
});
