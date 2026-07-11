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
    startChoiceMade: false,     // FIX 4: whether the loan/grind choice has been presented
    startChoice: null,          // 'loan' | 'grind'
    lore: 0,
    inviteSeen: false,
    circuitUnlocked: false,
    beatCities: [],              // city ids beaten
    currentVenueId: null,
    currentCityId: null,
    tableWinnings: 0,           // net chips won AT this city's table (resets on city entry)
    selectedCompanionId: null,
    drinksDizzy: 0,              // 0–5 scale
    messageThreads: {},          // { contactId: [{from,text,ts}] }
    shopOwned: { cars:[], houses:[], clothes:[] },
    sessionLore: 0,              // lore earned this session (reset on venue entry)
    handWins: 0,
    handStreak: 0,
    phase: 'underground',        // 'underground' | 'circuit'
    // ── RUN STATS (leaderboard) ────────────────────────────
    handsThisRun: 0,             // total hands played this Story run
    usedLoanEver: false,         // set true the moment any Tony loan is taken
    runAgentId: null,            // agent chosen for this run (for lb submission)
    // ── PHASE-3 additions ──────────────────────────────────
    debt: 0,                     // Fat Tony debt principal
    tonyAnger: 0,                // 0–10 anger meter
    citiesSinceLoan: 0,          // cities entered since loan taken (not city clears)
    loanActive: false,           // true while debt > 0
    handsThisVenue: 0,           // for companion satisfaction tracking
    companionSatisfaction: {},   // { id: 0–100 }
    companionLeft: false,        // companion walked out this session
    loyaltyBroken: false,        // set true if player ever picks supermodel
    cassidyLoreAccrued: 0,       // raw lore cassidy has earned before any penalty
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

// ── Navigation history stack ─────────────────────────────────
// Allows Back to go one screen back instead of jumping to the main menu.
// The stack is in-memory (intentionally not persisted — on hard reload it
// resets gracefully to the mode-select screen which is perfectly correct).
const NavStack = (() => {
  const _stack = [];

  function push(screenId) {
    // Don't duplicate consecutive identical entries
    if (_stack.length && _stack[_stack.length - 1] === screenId) return;
    _stack.push(screenId);
  }

  // Pop the top (current) screen and return the previous one, or null if at root.
  function pop() {
    if (_stack.length > 1) {
      _stack.pop(); // discard current
      return _stack[_stack.length - 1];
    }
    return null; // at root — caller should go to mode select
  }

  function peek() {
    return _stack.length ? _stack[_stack.length - 1] : null;
  }

  function reset() { _stack.length = 0; }

  return { push, pop, peek, reset };
})();

// Wrap Router.go so every navigation is tracked automatically
const _origRouterGo = Router.go.bind(Router);
Router.go = function(id) {
  NavStack.push(id);
  _origRouterGo(id);
};

// Common "go back one screen" helper — used by all back-buttons in story mode
function goBack(fallbackScreen) {
  const prev = NavStack.pop();
  if (prev) {
    _origRouterGo(prev);  // use original to avoid double-pushing
    // Re-render the screen we popped back to
    _refreshScreen(prev);
  } else {
    // At root — go to mode select (or explicit fallback)
    _origRouterGo(fallbackScreen || 'screen-mode');
  }
}

function _refreshScreen(screenId) {
  // Re-render screen content WITHOUT pushing to nav stack or calling Router.go again.
  // We call the internal render helpers directly to avoid double-push.
  switch (screenId) {
    case 'screen-underground':
      renderLoreBar(); checkInviteUnlock(); renderVenueCards(); renderCompanionBtn(); renderDrinksBar(false);
      {
        const cb = document.getElementById('btn-open-circuit');
        if (cb) cb.style.display = SState.get('circuitUnlocked') ? 'flex' : 'none';
        const pb = document.getElementById('btn-open-phone');
        if (pb) pb.onclick = () => showPhone();
        const cpb = document.getElementById('btn-pick-companion');
        if (cpb) cpb.onclick = () => showCompanionPicker();
        if (cb) cb.onclick = () => showCircuit();
        const bb = document.getElementById('btn-underground-back');
        if (bb) bb.onclick = () => goBack('screen-mode');
      }
      break;
    case 'screen-circuit':
      renderCircuitLore(); renderCircuitMap();
      {
        const bb = document.getElementById('btn-circuit-back');
        if (bb) bb.onclick = () => goBack('screen-underground');
        const pb = document.getElementById('btn-circuit-phone');
        if (pb) pb.onclick = () => showPhone();
      }
      break;
    // phone / companion / cutscene / table: no special re-render needed when popping back
    default: break;
  }
}

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
  // Handle both old-style roster array and v2 array format
  const roster = Array.isArray(S.companions) ? S.companions : (S.companions.roster || []);
  return roster.find(c => c.id === id);
}

function getCity(id) {
  const cities = (window.STORY && window.STORY.cities) ? window.STORY.cities : (S.cities || []);
  return cities.find(c => c.id === id);
}

// ── PHASE-3: Fat Tony helpers ─────────────────────────────────
function fatTonyData() {
  const ft = (window.STORY && window.STORY.fatTony) ? window.STORY.fatTony : null;
  return ft || {
    name: 'Fat Tony',
    greet: ["You look short on cash, friend. Let me help you out."],
    taxRate: 0.25,
    angerLines: [
      { atAnger: 2, line: "Don't make me come find you." },
      { atAnger: 4, line: "Your tab's running real hot right now." },
      { atAnger: 6, line: "I'm a patient man — but patience has a price." },
      { atAnger: 8, line: "Last warning. Pay up or there are consequences." },
    ],
    threat: ["You thought I forgot? I never forget."],
    collection: ["You've been ducking me too long. Now you pay — one way or another."],
    payoffLines: ["Pleasure doing business. Don't make it a habit."],
  };
}

function tonyAngerLineForLevel(anger) {
  const ft = fatTonyData();
  const lines = (ft.angerLines || []).filter(l => l.atAnger <= anger);
  if (!lines.length) return null;
  return lines[lines.length - 1].line;
}

function showFatTonyModal(loanAmount) {
  const ft = fatTonyData();
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-sub');
  const body = document.getElementById('modal-body');
  if (!overlay) return;

  const greet = pick(ft.greet || ["Need a loan?"]);
  const imgSrc = 'assets/companions/fattony.png';

  title.textContent = ft.name || 'Fat Tony';
  sub.textContent = '"' + greet + '"';
  body.innerHTML = `
    <div style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:1rem">
      <div style="width:4rem;height:5rem;border-radius:4px;overflow:hidden;border:1px solid rgba(224,48,64,0.4);flex-shrink:0;background:#0a0608">
        <img src="${imgSrc}" alt="Fat Tony" style="width:100%;height:100%;object-fit:cover;object-position:top"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-family:'Cinzel Decorative',serif;font-size:1.6rem;color:#e03040">$</span>
      </div>
      <div style="flex:1">
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.8rem;color:rgba(245,240,232,0.55);line-height:1.5;margin-bottom:0.6rem">
          Interest rate: <span style="color:#e03040">${Math.round((ft.taxRate||0.25)*100)}% per city entered</span>.
          Miss 3 cities and things get… unpleasant.
        </div>
        <div id="tony-loan-opts" class="add-chips-grid" style="grid-template-columns:1fr 1fr">
          ${[500,1000,2500,5000].map(n => `
            <div class="add-chips-btn" onclick="window.takeTonyLoan(${n})" style="border-color:rgba(224,48,64,0.25)">
              <span class="amount" style="color:#e03040">$${n >= 1000 ? (n/1000)+'K' : n}</span>
              <span class="label">Borrow</span>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div id="tony-hud-msg" style="display:none;font-family:'Share Tech Mono',monospace;font-size:0.55rem;color:#e03040;text-align:center;margin-top:0.4rem"></div>
  `;
  overlay.classList.add('show');
}

window.takeTonyLoan = function(amount) {
  const ft = fatTonyData();
  const taxRate = ft.taxRate || 0.25;
  const currentDebt = SState.get('debt') || 0;
  const newDebt = currentDebt + amount;
  SState.set('debt', newDebt);
  SState.set('loanActive', true);
  SState.set('citiesSinceLoan', 0);
  // ── Run stat: mark loan ever used ─────────────────────
  SState.set('usedLoanEver', true);
  if (typeof State !== 'undefined') {
    State.set('bankroll', (State.get('bankroll') || 0) + amount);
  }
  // Lore bonus: debt = street cred
  earnLore(3, 'Tony\'s money — street cred');
  updateTonyHud();
  if (typeof renderBankroll !== 'undefined') renderBankroll();
  if (typeof closeModal !== 'undefined') closeModal();
  showLoreToast('Fat Tony fronted you $' + amount.toLocaleString() + ' — repay via Phone → Bank');
};

function repayTonyLoan(amount) {
  const debt = SState.get('debt') || 0;
  if (debt <= 0) {
    showLoreToast('No debt to repay.');
    return;
  }
  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  const pay = Math.min(amount || debt, bankroll, debt);
  if (pay <= 0) { showLoreToast('Not enough cash to repay.'); return; }

  const ft = fatTonyData();
  if (typeof State !== 'undefined') State.set('bankroll', bankroll - pay);
  const newDebt = Math.max(0, debt - pay);
  SState.set('debt', newDebt);
  if (newDebt <= 0) {
    SState.set('loanActive', false);
    SState.set('tonyAnger', 0);
    SState.set('citiesSinceLoan', 0);
    const line = pick(ft.payoffLines || ['Pleasure doing business.']);
    showLoreToast('Debt cleared. Fat Tony: "' + line + '"');
  } else {
    showLoreToast('Partial payment. Remaining: $' + newDebt.toLocaleString());
  }
  updateTonyHud();
  if (typeof renderBankroll !== 'undefined') renderBankroll();
}

function onCityEnterTonyCheck(cityId) {
  const loanActive = SState.get('loanActive');
  if (!loanActive) return;

  const ft = fatTonyData();
  const taxRate = ft.taxRate || 0.25;

  // Accrue interest
  const debt = SState.get('debt') || 0;
  const interest = Math.ceil(debt * taxRate);
  SState.set('debt', debt + interest);

  // Increase anger
  const anger = Math.min(10, (SState.get('tonyAnger') || 0) + 1);
  SState.set('tonyAnger', anger);

  const cities = (SState.get('citiesSinceLoan') || 0) + 1;
  SState.set('citiesSinceLoan', cities);

  // Show anger dialog
  const angerLine = tonyAngerLineForLevel(anger);
  if (angerLine) {
    setTimeout(() => showDialogBubble(ft.name || 'Fat Tony', 'VILLAIN', angerLine), 1800);
  }

  // Collection event after 3 cities unpaid
  if (cities >= 3) {
    setTimeout(() => triggerTonyCollection(), 2500);
  }

  updateTonyHud();
}

function triggerTonyCollection() {
  const ft = fatTonyData();
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-sub');
  const body = document.getElementById('modal-body');
  if (!overlay) return;

  const threatLine = pick(ft.threat || ["You've been ducking me."]);
  const collectionLine = pick(ft.collection || ["Pay up."]);

  // Penalty: lose 30% of bankroll, companion walks if present
  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  const penalty = Math.ceil(bankroll * 0.30);
  if (typeof State !== 'undefined') State.set('bankroll', Math.max(0, bankroll - penalty));

  // Companion walks
  const compId = SState.get('selectedCompanionId');
  if (compId) {
    SState.set('selectedCompanionId', null);
    SState.set('companionLeft', true);
  }

  // Lore hit
  const was = SState.get('lore');
  SState.set('lore', Math.max(0, was - 10));
  renderLoreBar();

  // Reset anger but keep debt (maybe partial paid)
  SState.set('tonyAnger', 0);
  SState.set('citiesSinceLoan', 0);

  title.textContent = 'GAME OVER';
  sub.textContent = '"' + threatLine + '"';
  body.innerHTML = `
    <div style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:1rem">
      <div style="width:4rem;height:5rem;border-radius:4px;overflow:hidden;border:2px solid #e03040;flex-shrink:0;background:#0a0608">
        <img src="assets/companions/fattony.png" alt="Fat Tony"
          style="width:100%;height:100%;object-fit:cover;object-position:top"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:1.6rem">💀</span>
      </div>
      <div style="flex:1">
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.85rem;color:rgba(245,240,232,0.8);line-height:1.5;margin-bottom:0.5rem">"${collectionLine}"</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.55rem;color:#e03040;margin-bottom:0.25rem">— Lost $${penalty.toLocaleString()} (30% of bankroll)</div>
        ${compId ? `<div style="font-family:'Share Tech Mono',monospace;font-size:0.55rem;color:rgba(245,240,232,0.4);">— Your companion left</div>` : ''}
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.55rem;color:rgba(245,240,232,0.4);">— −10 Lore</div>
      </div>
    </div>
    <div style="font-family:'Cinzel',serif;font-size:0.55rem;letter-spacing:0.1em;color:var(--gold-dim);text-transform:uppercase;text-align:center;margin-top:0.5rem">
      Remaining debt: <span style="color:#e03040">$${(SState.get('debt')||0).toLocaleString()}</span>
    </div>
  `;

  overlay.classList.add('show');
  if (typeof renderBankroll !== 'undefined') renderBankroll();
  updateTonyHud();

  // Skipping Fat Tony 3 cities in a row = automatic loss. End the run.
  SState.set('gameOver', true);
  const _goBtn = document.createElement('button');
  _goBtn.textContent = 'START OVER';
  _goBtn.style.cssText = 'width:100%;margin-top:0.8rem;padding:0.75rem;font-family:Cinzel,serif;letter-spacing:0.12em;text-transform:uppercase;background:linear-gradient(135deg,#e03040,#7a1420);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:700';
  _goBtn.onclick = () => {
    try { Object.keys(localStorage).filter(k => k.indexOf('shaddai_royale') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.reload();
  };
  if (body) body.appendChild(_goBtn);
}

function updateTonyHud() {
  let hud = document.getElementById('tony-debt-hud');
  const debt = SState.get('debt') || 0;
  const anger = SState.get('tonyAnger') || 0;
  const loanActive = SState.get('loanActive');

  if (!loanActive || debt <= 0) {
    if (hud) hud.style.display = 'none';
    return;
  }

  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'tony-debt-hud';
    hud.style.cssText = `
      position:fixed;top:3.5rem;left:0.7rem;z-index:900;
      background:rgba(10,4,8,0.9);border:1px solid rgba(224,48,64,0.4);
      border-radius:2px;padding:0.3rem 0.55rem;display:flex;
      flex-direction:column;gap:0.15rem;
      backdrop-filter:blur(4px);cursor:pointer;
    `;
    hud.title = 'Tap to repay Fat Tony';
    hud.onclick = () => showTonyRepayModal();
    document.body.appendChild(hud);
  }

  const angerPct = Math.round((anger / 10) * 100);
  const angerColor = anger >= 7 ? '#e03040' : anger >= 4 ? '#facc15' : '#f87171';

  hud.style.display = 'flex';
  hud.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.35rem">
      <div style="width:1.4rem;height:1.6rem;border-radius:2px;overflow:hidden;border:1px solid rgba(224,48,64,0.3);flex-shrink:0;background:#0a0608">
        <img src="assets/companions/fattony.png" alt="T"
          style="width:100%;height:100%;object-fit:cover;object-position:top"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:0.7rem;color:#e03040">$</span>
      </div>
      <div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.5rem;color:#e03040">DEBT $${debt.toLocaleString()}</div>
        <div style="width:36px;height:3px;background:rgba(224,48,64,0.15);border-radius:2px;margin-top:2px;overflow:hidden">
          <div style="width:${angerPct}%;height:100%;background:${angerColor};border-radius:2px;transition:width 0.5s"></div>
        </div>
      </div>
    </div>
  `;
}

function showTonyRepayModal() {
  const debt = SState.get('debt') || 0;
  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-sub');
  const body = document.getElementById('modal-body');
  if (!overlay) return;

  title.textContent = 'Repay Fat Tony';
  sub.textContent = 'Clear your debt before he comes collecting.';
  const options = [
    { label: 'Pay All', amount: Math.min(debt, bankroll) },
    { label: 'Pay Half', amount: Math.min(Math.ceil(debt/2), bankroll) },
    { label: '$500', amount: Math.min(500, bankroll, debt) },
  ].filter(o => o.amount > 0);

  body.innerHTML = `
    <div style="font-family:'Share Tech Mono',monospace;font-size:0.65rem;color:#e03040;text-align:center;margin-bottom:1rem">
      Outstanding: $${debt.toLocaleString()} · Anger: ${SState.get('tonyAnger')}/10
    </div>
    <div class="add-chips-grid" style="grid-template-columns:1fr 1fr 1fr">
      ${options.map(o => `
        <div class="add-chips-btn" onclick="window._tonyRepay(${o.amount})" style="border-color:rgba(224,48,64,0.3)">
          <span class="amount" style="color:#e03040">$${o.amount.toLocaleString()}</span>
          <span class="label">${o.label}</span>
        </div>`).join('')}
    </div>
    <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.7rem;color:rgba(245,240,232,0.3);text-align:center;margin-top:0.8rem">
      Your bankroll: $${bankroll.toLocaleString()}
    </div>
  `;
  overlay.classList.add('show');
}

window._tonyRepay = function(amount) {
  if (typeof closeModal !== 'undefined') closeModal();
  repayTonyLoan(amount);
};

// ── PHASE-3: Companion tier & loyalty ────────────────────────
function getCompanionTier(comp) {
  if (!comp) return 'normal';
  return comp.tier || 'normal';
}

function handleCompanionSelect(compId) {
  const comp = getCompanion(compId);
  if (!comp) return;
  const tier = getCompanionTier(comp);

  // If selecting supermodel, mark loyalty broken and halve cassidy accrued lore
  const loyalty = (window.STORY && window.STORY.loyalty) ? window.STORY.loyalty : null;
  const normalGirlId = (loyalty && loyalty.normalGirlId) ? loyalty.normalGirlId : 'cassidy';
  const penalty = (loyalty && loyalty.supermodelSwitchPenalty != null) ? loyalty.supermodelSwitchPenalty : 0.5;

  if ((tier === 'supermodel' || tier === 'model') && !SState.get('loyaltyBroken')) {
    SState.set('loyaltyBroken', true);
    // Halve cassidy's accrued lore contribution
    const accrued = SState.get('cassidyLoreAccrued') || 0;
    if (accrued > 0) {
      const loss = Math.ceil(accrued * penalty);
      const was = SState.get('lore');
      SState.set('lore', Math.max(0, was - loss));
      renderLoreBar();
      showLoreToast('Loyalty broken — −' + loss + ' Lore (Cassidy penalty)');
    }
  }

  // Track cassidy's session start
  if (compId === normalGirlId) {
    // Reset satisfaction
    const sat = SState.get('companionSatisfaction') || {};
    if (sat[compId] == null) sat[compId] = 100;
    SState.set('companionSatisfaction', sat);
  }
}

function onCompanionLoreEarn(compId, amount) {
  // If this is cassidy and loyalty is intact, track her contributions
  const loyalty = (window.STORY && window.STORY.loyalty) ? window.STORY.loyalty : null;
  const normalGirlId = (loyalty && loyalty.normalGirlId) ? loyalty.normalGirlId : 'cassidy';
  if (compId === normalGirlId && !SState.get('loyaltyBroken')) {
    const accrued = (SState.get('cassidyLoreAccrued') || 0) + amount;
    SState.set('cassidyLoreAccrued', accrued);
  }
}

// ── PHASE-3: Companion satisfaction needs ────────────────────
let _needsCheckTimer = null;
let _pendingNeedFor = null;

function checkCompanionNeeds(handCount) {
  const compId = SState.get('selectedCompanionId');
  if (!compId) return;
  const comp = getCompanion(compId);
  if (!comp) return;

  const satisfyEvery = comp.satisfyEveryHands || 5;
  if (handCount <= 0 || handCount % satisfyEvery !== 0) return;

  // Don't show if companion already left
  if (SState.get('companionLeft')) return;

  _pendingNeedFor = compId;
  showCompanionNeedPrompt(comp);
}

function showCompanionNeedPrompt(comp) {
  const sat = SState.get('companionSatisfaction') || {};
  const curSat = sat[comp.id] != null ? sat[comp.id] : 100;

  // Pick a drink or food from her likes
  const likes = comp.likes || { drinks: ['Champagne'], food: ['Sushi'] };
  const allOptions = [...(likes.drinks || []), ...(likes.food || [])];
  const want = pick(allOptions) || 'something nice';

  // Use bad convo line as the ask (she's demanding)
  const convoAsk = comp.convo ? (pick(comp.convo.bad) || 'I could use a little attention right now...') : 'I could use a little attention right now...';

  let prompt = document.getElementById('companion-need-prompt');
  if (!prompt) {
    prompt = document.createElement('div');
    prompt.id = 'companion-need-prompt';
    prompt.style.cssText = `
      position:fixed;bottom:11rem;left:50%;transform:translateX(-50%);
      z-index:850;max-width:min(420px,90vw);
      background:rgba(4,6,16,0.96);border:1px solid rgba(201,168,76,0.3);
      border-radius:4px;padding:0.7rem 0.9rem 0.8rem;
      backdrop-filter:blur(6px);box-shadow:0 16px 40px rgba(0,0,0,0.7);
    `;
    document.body.appendChild(prompt);
  }

  const imgSrc = `assets/companions/${comp.id}.png`;
  const initials = (comp.name || '?')[0].toUpperCase();
  const satColor = curSat > 60 ? 'var(--cyan)' : curSat > 30 ? '#facc15' : '#e03040';

  prompt.innerHTML = `
    <div style="display:flex;gap:0.7rem;align-items:flex-start">
      <div style="width:3rem;height:3.5rem;border-radius:3px;overflow:hidden;border:1px solid rgba(201,168,76,0.3);flex-shrink:0;background:#0a080e">
        <img src="${imgSrc}" alt="${comp.name}"
          style="width:100%;height:100%;object-fit:cover;object-position:top"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-family:'Cinzel Decorative',serif;font-size:1rem;color:var(--gold)">${initials}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:'Cinzel',serif;font-size:0.55rem;letter-spacing:0.1em;color:var(--gold);text-transform:uppercase;margin-bottom:0.2rem">${comp.name}</div>
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.78rem;color:rgba(245,240,232,0.8);line-height:1.4;margin-bottom:0.4rem">"${convoAsk}"</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.5rem;color:rgba(245,240,232,0.4);margin-bottom:0.4rem">She wants: <span style="color:var(--gold)">${want}</span></div>
        <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.5rem">
          <span style="font-family:'Share Tech Mono',monospace;font-size:0.45rem;color:rgba(245,240,232,0.3)">Satisfaction</span>
          <div style="flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
            <div style="width:${curSat}%;height:100%;background:${satColor};border-radius:2px;transition:width 0.5s"></div>
          </div>
          <span style="font-family:'Share Tech Mono',monospace;font-size:0.45rem;color:${satColor}">${curSat}%</span>
        </div>
        <div style="display:flex;gap:0.4rem">
          <button onclick="window._compBuy('${comp.id}')"
            style="flex:1;font-family:'Cinzel',serif;font-size:0.5rem;letter-spacing:0.1em;text-transform:uppercase;
            color:var(--navy);background:linear-gradient(135deg,var(--gold-bright),var(--gold));
            padding:0.35rem;border-radius:2px;cursor:pointer;border:none">
            Buy ($75)
          </button>
          <button onclick="window._compIgnore('${comp.id}')"
            style="flex:1;font-family:'Cinzel',serif;font-size:0.5rem;letter-spacing:0.1em;text-transform:uppercase;
            color:rgba(245,240,232,0.4);border:1px solid rgba(255,255,255,0.1);
            padding:0.35rem;border-radius:2px;cursor:pointer;background:transparent">
            Ignore
          </button>
        </div>
      </div>
    </div>
  `;
  prompt.style.display = 'flex';
  // Auto-dismiss after 8 seconds with ignore penalty
  clearTimeout(_needsCheckTimer);
  _needsCheckTimer = setTimeout(() => { window._compIgnore(comp.id); }, 8000);
}

window._compBuy = function(compId) {
  const comp = getCompanion(compId);
  if (!comp) return;
  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  if (bankroll < 75) { showLoreToast('Not enough for this.'); return; }
  if (typeof State !== 'undefined') State.set('bankroll', bankroll - 75);
  if (typeof renderBankroll !== 'undefined') renderBankroll();

  const sat = SState.get('companionSatisfaction') || {};
  sat[compId] = Math.min(100, (sat[compId] || 60) + 25);
  SState.set('companionSatisfaction', sat);

  // Use good convo line as positive response
  const reply = comp.convo ? (pick(comp.convo.good) || 'Thank you, I appreciate that 💛') : 'Thank you! 💛';
  showLoreToast(comp.name + ': "' + reply + '"');
  earnLore(2, comp.name + ' satisfied');

  const prompt = document.getElementById('companion-need-prompt');
  if (prompt) prompt.style.display = 'none';
  clearTimeout(_needsCheckTimer);
};

window._compIgnore = function(compId) {
  const comp = getCompanion(compId);
  if (!comp) { return; }
  const sat = SState.get('companionSatisfaction') || {};
  const newSat = Math.max(0, (sat[compId] || 100) - 30);
  sat[compId] = newSat;
  SState.set('companionSatisfaction', sat);

  const prompt = document.getElementById('companion-need-prompt');
  if (prompt) prompt.style.display = 'none';
  clearTimeout(_needsCheckTimer);

  if (newSat <= 0) {
    // She leaves
    SState.set('selectedCompanionId', null);
    SState.set('companionLeft', true);
    const leaveMsg = comp.convo ? (pick(comp.convo.bad) || "I'm done here.") : "I'm done here.";
    showLoreToast(comp.name + ' left — "' + leaveMsg + '"');
    renderCompanionAtTable();
    renderCompanionBtn();
  } else {
    showLoreToast(comp.name + '\'s mood dropping (' + newSat + '%)');
  }
};

// ── PHASE-3: Conversation lore system ────────────────────────
function buildConvoChoices(compId) {
  const comp = getCompanion(compId);
  if (!comp || !comp.convo) return [];
  return [
    { type: 'good', label: 'Be real with her', text: pick(comp.convo.good || []), lore: +3, satDelta: +15 },
    { type: 'flirt', label: 'Flirt a little', text: pick(comp.convo.flirt || comp.convo.good || []), lore: +2, satDelta: +10 },
    { type: 'disrespect', label: 'Be cold', text: pick(comp.convo.bad || []), lore: -2, satDelta: -20 },
  ];
}

// ── PHASE-3: Per-character dialog using byAgent ───────────────
function getDialogLine(moment) {
  // Try STORY.dialog.byAgent[currentBossId][moment] first
  const cityId = SState.get('currentCityId');
  const venueId = SState.get('currentVenueId');
  let bossId = null;
  if (cityId) {
    const boss = CITY_BOSS_MAP[cityId];
    if (boss) bossId = boss.agentId;
  } else if (venueId) {
    const boss = VENUE_BOSS_MAP[venueId] || VENUE_BOSS_MAP.default;
    if (boss) bossId = boss.agentId;
  }
  if (!bossId && typeof State !== 'undefined') bossId = State.get('agentId');

  const byAgent = window.STORY && window.STORY.dialog && window.STORY.dialog.byAgent;
  if (bossId && byAgent && byAgent[bossId] && byAgent[bossId][moment] && byAgent[bossId][moment].length) {
    return pick(byAgent[bossId][moment]);
  }
  // Fallback to generic pool
  const generic = (window.STORY && window.STORY.dialog && window.STORY.dialog[moment]) ? window.STORY.dialog[moment] : S.dialog[moment];
  return pick(generic || []) || null;
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
// FIX 4: START CHOICE — Loan or Grind
// ══════════════════════════════════════════════════

function showStartChoice() {
  // If already chosen this run, skip straight to intro
  if (SState.get('startChoiceMade')) { showIntro(); return; }
  Router.go('screen-start-choice');
  _renderStartChoice();
}

function _renderStartChoice() {
  const ft = fatTonyData();
  const ftName = ft.name || 'Fat Tony';
  const ftImg = 'assets/companions/fattony.png';
  const greetLine = pick(ft.greet || ["You look like you need a hand, kid."]);
  const loanAmounts = [500, 1000, 2500];

  const container = document.getElementById('start-choice-body');
  if (!container) return;

  container.innerHTML = `
    <div class="sc-header">
      <div class="sc-eyebrow">Before You Begin</div>
      <h2 class="sc-title">How Do You Start?</h2>
      <p class="sc-sub">Choose your path. Both lead to the same table — but one costs more.</p>
    </div>

    <div class="sc-options">
      <!-- Option A: Fat Tony Loan -->
      <div class="sc-option sc-option-loan" id="sc-opt-loan">
        <div class="sc-option-portrait">
          <img src="${ftImg}" alt="${ftName}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="sc-option-portrait-fallback">$</span>
        </div>
        <div class="sc-option-content">
          <div class="sc-option-tag sc-tag-danger">Fat Tony's Offer</div>
          <div class="sc-option-title">${ftName}</div>
          <div class="sc-option-quote">"${greetLine}"</div>
          <div class="sc-option-desc">Start with borrowed capital. Hit the ground running — but the debt runs with you.</div>
          <div class="sc-loan-btns" id="sc-loan-btns">
            ${loanAmounts.map(n => `
              <button class="sc-loan-btn" onclick="window._startWithLoan(${n})">
                Borrow <strong>$${n >= 1000 ? (n/1000) + 'K' : n}</strong>
                <span class="sc-loan-interest">${Math.round((ft.taxRate||0.25)*100)}%/city interest</span>
              </button>`).join('')}
          </div>
        </div>
      </div>

      <!-- Option B: Grind from bottom -->
      <div class="sc-option sc-option-grind" id="sc-opt-grind" onclick="window._startGrind()">
        <div class="sc-option-portrait sc-portrait-hustle">
          <span style="font-size:2rem">🤜</span>
        </div>
        <div class="sc-option-content">
          <div class="sc-option-tag sc-tag-grind">Pure Hustle</div>
          <div class="sc-option-title">Grind From Zero</div>
          <div class="sc-option-quote">"Nobody handed me anything."</div>
          <div class="sc-option-desc">Start with $${smFmt(250)} and build every chip yourself. No debt. No shortcuts. Full respect.</div>
          <div class="sc-grind-cta">Start with $250 →</div>
        </div>
      </div>
    </div>
  `;
}

window._startWithLoan = function(amount) {
  const ft = fatTonyData();
  const taxRate = ft.taxRate || 0.25;
  // Give loan money
  if (typeof State !== 'undefined') State.set('bankroll', (State.get('bankroll') || 0) + amount);
  // Set up debt
  SState.set('debt', amount);
  SState.set('loanActive', true);
  SState.set('citiesSinceLoan', 0);
  SState.set('startChoiceMade', true);
  SState.set('startChoice', 'loan');
  // ── Run stat: mark loan ever used ─────────────────────
  SState.set('usedLoanEver', true);
  earnLore(2, 'Tony\'s money — street cred');
  if (typeof renderBankroll !== 'undefined') renderBankroll();
  if (typeof updateTonyHud !== 'undefined') updateTonyHud();
  showLoreToast(ft.name + ' fronted you $' + amount.toLocaleString() + ' — repay via Phone → Bank');
  showIntro();
};

window._startGrind = function() {
  if (typeof State !== 'undefined') State.set('bankroll', 250);
  SState.set('startChoiceMade', true);
  SState.set('startChoice', 'grind');
  if (typeof renderBankroll !== 'undefined') renderBankroll();
  showLoreToast('No loans. No shortcuts. Just you.');
  showIntro();
};

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
  document.getElementById('btn-underground-back').onclick = () => goBack('screen-mode');
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
  const loreBonus = comp ? (comp.baseLoreBonus != null ? comp.baseLoreBonus : (comp.loreBonus || 0)) : 0;
  const sat = SState.get('companionSatisfaction') || {};
  const curSat = comp ? (sat[comp.id] != null ? sat[comp.id] : 100) : null;
  if (lbl) {
    if (comp) {
      const satStr = curSat != null ? ' · ' + curSat + '%' : '';
      lbl.textContent = comp.name + ' (+' + loreBonus + ' LORE)' + satStr;
    } else {
      lbl.textContent = 'Bring Someone';
    }
  }
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
  SState.set('handsThisVenue', 0);
  SState.set('companionLeft', false);
  // PHASE-3: Tony check on venue entry (counts as a city-like event)
  onCityEnterTonyCheck(venue.id);

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

  // PHASE-3: satisfaction and tier indicator
  const sat = SState.get('companionSatisfaction') || {};
  const curSat = sat[comp.id] != null ? sat[comp.id] : 100;
  const satColor = curSat > 60 ? 'var(--cyan)' : curSat > 30 ? '#facc15' : '#e03040';
  const tier = getCompanionTier(comp);
  const tierGlow = tier === 'supermodel' ? 'rgba(248,113,113,0.25)' : tier === 'model' ? 'rgba(0,229,255,0.15)' : 'rgba(201,168,76,0.2)';

  el.style.display = 'flex';
  el.innerHTML = `
    <div style="width:3.5rem;height:4.2rem;border-radius:4px;overflow:hidden;
      border:1px solid rgba(201,168,76,0.4);
      box-shadow:0 0 16px ${tierGlow}, 0 4px 12px rgba(0,0,0,0.5);
      background:#0a0a14;position:relative">
      <img src="${imgSrc}" alt="${comp.name}"
        style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-family:'Cinzel Decorative',serif;font-size:1.1rem;color:var(--gold)">${initials}</span>
      <!-- Satisfaction bar at bottom of portrait -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(0,0,0,0.4)">
        <div style="width:${curSat}%;height:100%;background:${satColor};transition:width 0.5s"></div>
      </div>
    </div>
    <div style="font-family:'Cinzel',serif;font-size:0.38rem;letter-spacing:0.12em;color:var(--gold-dim);text-transform:uppercase;text-align:center;max-width:3.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">${comp.name}</div>
  `;
}

// ══════════════════════════════════════════════════
// SCREEN: CIRCUIT MAP
// ══════════════════════════════════════════════════

function showCircuit() {
  Router.go('screen-circuit');
  renderCircuitLore();
  renderCircuitMap();

  document.getElementById('btn-circuit-back').onclick = () => goBack('screen-underground');
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
  SState.set('handsThisVenue', 0);
  SState.set('companionLeft', false);
  SState.set('tableWinnings', 0);  // FIX: reset table-winnings counter on city entry
  // PHASE-3: Fat Tony anger accrual on city entry
  onCityEnterTonyCheck(city.id);

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
    // Use nav stack: pop phone, go back to wherever we were
    goBack(_phoneReturnScreen);
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
      ${roster.map(c => {
        const sat = SState.get('companionSatisfaction') || {};
        const curSat = sat[c.id] != null ? sat[c.id] : 100;
        const satColor = curSat > 60 ? 'var(--cyan)' : curSat > 30 ? '#facc15' : '#e03040';
        const lb = c.baseLoreBonus != null ? c.baseLoreBonus : (c.loreBonus || 0);
        const tier = getCompanionTier(c);
        const tierColor = tier === 'supermodel' ? '#f87171' : tier === 'model' ? 'var(--cyan)' : 'var(--gold-dim)';
        return `
        <div class="phone-contact" onclick="openPhoneChat('${c.id}')">
          ${companionAvatarHTML(c.id, c.name, '2.4rem')}
          <div class="phone-contact-info">
            <div class="phone-contact-name">${c.name} <span style="font-size:0.42rem;color:${tierColor};opacity:0.7">${tier}</span></div>
            <div class="phone-contact-num" style="color:var(--cyan)">+${lb} LORE / session</div>
            <div style="display:flex;align-items:center;gap:0.3rem;margin-top:2px">
              <div style="width:36px;height:2px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
                <div style="width:${curSat}%;height:100%;background:${satColor};border-radius:2px"></div>
              </div>
              <span style="font-family:'Share Tech Mono',monospace;font-size:0.38rem;color:${satColor}">${curSat}%</span>
            </div>
          </div>
          <div class="phone-contact-note">${c.aesthetic || c.personality || ''}</div>
        </div>
      `}).join('')}
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

  } else if (tab === 'cloud') {
    // Cloud save / load and leaderboard access via phone
    const handsThisRun = SState.get('handsThisRun') || 0;
    const beaten = (SState.get('beatCities') || []).length;
    content.innerHTML = `
      <div style="padding:0.8rem 0.5rem 0.5rem">
        <div class="phone-section-title">VAULT — Cloud Save</div>
        <div style="display:flex;flex-direction:column;gap:0.4rem;margin-top:0.4rem">
          <div style="font-family:'Share Tech Mono',monospace;font-size:0.5rem;color:rgba(245,240,232,0.35);margin-bottom:0.2rem">
            Hands this run: <span style="color:var(--cyan)">${handsThisRun}</span> · Cities cleared: <span style="color:#4ade80">${beaten}/5</span>
          </div>
          <button onclick="window.Vault.open('save')" style="
            width:100%;font-family:'Cinzel',serif;font-size:0.5rem;letter-spacing:0.15em;
            text-transform:uppercase;color:var(--navy);
            background:linear-gradient(135deg,var(--gold-bright),var(--gold));
            padding:0.6rem;border-radius:2px;cursor:pointer;border:none;margin-bottom:0.2rem">
            ⬡ Save to Cloud
          </button>
          <button onclick="window.Vault.open('load')" style="
            width:100%;font-family:'Cinzel',serif;font-size:0.5rem;letter-spacing:0.15em;
            text-transform:uppercase;color:var(--gold-dim);
            border:1px solid rgba(201,168,76,0.2);padding:0.6rem;border-radius:2px;
            background:rgba(201,168,76,0.04);cursor:pointer;margin-bottom:0.5rem">
            ↓ Load Cloud Save
          </button>
          <div class="phone-bank-divider"></div>
          <button onclick="window.Leaderboard && window.Leaderboard.show('screen-phone')" style="
            width:100%;font-family:'Cinzel',serif;font-size:0.5rem;letter-spacing:0.15em;
            text-transform:uppercase;color:rgba(245,240,232,0.35);
            border:1px solid rgba(255,255,255,0.06);padding:0.5rem;border-radius:2px;
            background:transparent;cursor:pointer">
            ♔ Leaderboard
          </button>
        </div>
      </div>`;
    return;

  } else if (tab === 'bank') {
    const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
    const lore = SState.get('lore');
    const tier = currentLoreTier();
    const debt = SState.get('debt') || 0;
    const anger = SState.get('tonyAnger') || 0;
    const ft = fatTonyData();

    content.innerHTML = `
      <div class="phone-bank">
        <div class="phone-bank-header">${(S.phone && S.phone.bankName) || 'ROYALE BANK'}</div>
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
        ${debt > 0 ? `
        <div class="phone-bank-divider"></div>
        <div style="background:rgba(224,48,64,0.06);border:1px solid rgba(224,48,64,0.2);border-radius:2px;padding:0.5rem 0.6rem;margin-top:0.3rem">
          <div style="font-family:'Cinzel',serif;font-size:0.45rem;letter-spacing:0.25em;color:#e03040;text-transform:uppercase;margin-bottom:0.3rem">Fat Tony — Outstanding Debt</div>
          <div class="phone-bank-row" style="border:none;padding:0.15rem 0">
            <span>Principal</span>
            <span style="color:#e03040">$${smFmt(debt)}</span>
          </div>
          <div class="phone-bank-row" style="border:none;padding:0.15rem 0">
            <span>Anger</span>
            <div style="display:flex;align-items:center;gap:0.3rem">
              <div style="width:40px;height:3px;background:rgba(224,48,64,0.15);border-radius:2px;overflow:hidden">
                <div style="width:${anger*10}%;height:100%;background:#e03040;transition:width 0.4s"></div>
              </div>
              <span style="color:#e03040;font-size:0.48rem">${anger}/10</span>
            </div>
          </div>
          <button onclick="window._tonyRepayFromPhone()" style="
            width:100%;margin-top:0.4rem;font-family:'Cinzel',serif;font-size:0.48rem;
            letter-spacing:0.12em;text-transform:uppercase;color:#e03040;
            border:1px solid rgba(224,48,64,0.3);padding:0.35rem;border-radius:2px;
            background:rgba(224,48,64,0.08);cursor:pointer;transition:all 0.2s">
            Repay Tony
          </button>
        </div>` : `
        <div class="phone-bank-row" style="border-top:1px solid rgba(201,168,76,0.06);margin-top:0.3rem">
          <span style="color:rgba(245,240,232,0.25)">Fat Tony</span>
          <span style="color:rgba(74,222,128,0.5);font-size:0.5rem">No debt ✓</span>
        </div>`}
        <div class="phone-bank-divider"></div>
        <button onclick="window._phoneTonyLoan()" style="
          width:100%;font-family:'Cinzel',serif;font-size:0.48rem;
          letter-spacing:0.12em;text-transform:uppercase;color:rgba(245,240,232,0.35);
          border:1px solid rgba(255,255,255,0.06);padding:0.35rem;border-radius:2px;
          background:transparent;cursor:pointer;transition:all 0.2s">
          ${debt > 0 ? 'Borrow more (risky)' : 'Borrow from Tony'}
        </button>
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
  const presets = comp ? (comp.presetTexts || S.companions.presetTexts || []) : [];

  // P2: Avatar in chat header
  const avatarHtml = companionAvatarHTML(contactId, cname, '1.8rem');

  const thread = (SState.get('messageThreads')[contactId] || []);

  // PHASE-3: Convo choices for companions
  const convoChoices = comp ? buildConvoChoices(contactId) : [];
  const sat = SState.get('companionSatisfaction') || {};
  const curSat = sat[contactId] != null ? sat[contactId] : 100;
  const satColor = curSat > 60 ? 'var(--cyan)' : curSat > 30 ? '#facc15' : '#e03040';

  content.innerHTML = `
    <div class="phone-chat-header" style="gap:0.5rem">
      <button class="phone-chat-back" onclick="switchPhoneTab('messages')">← Back</button>
      ${avatarHtml}
      <span class="phone-chat-name">${cname}</span>
      ${comp ? `<span style="font-family:'Share Tech Mono',monospace;font-size:0.42rem;color:${satColor};margin-left:auto">${curSat}%</span>` : ''}
    </div>
    <div class="phone-chat-messages" id="phone-chat-msgs">
      ${thread.map(m => `
        <div class="phone-chat-bubble ${m.from === 'Me' ? 'mine' : 'theirs'}">
          ${m.text}
        </div>
      `).join('')}
    </div>
    ${comp && convoChoices.length ? `
    <div class="phone-chat-presets" style="gap:0.3rem">
      <div style="font-family:'Cinzel',serif;font-size:0.4rem;letter-spacing:0.15em;color:rgba(0,229,255,0.3);text-transform:uppercase;padding:0.2rem 0.3rem 0">Conversation</div>
      ${convoChoices.map((c, i) => `
        <button class="phone-preset-btn" onclick="window.sendConvoChoice('${contactId}', ${i})"
          style="display:flex;justify-content:space-between;align-items:center">
          <span>${c.label}</span>
          <span style="font-family:'Share Tech Mono',monospace;font-size:0.42rem;
            color:${c.lore >= 0 ? 'var(--cyan)' : '#e03040'};opacity:0.7">
            ${c.lore >= 0 ? '+' : ''}${c.lore} LORE · sat ${c.satDelta >= 0 ? '+' : ''}${c.satDelta}%
          </span>
        </button>
      `).join('')}
      ${presets.length ? `<div style="font-family:'Cinzel',serif;font-size:0.4rem;letter-spacing:0.15em;color:rgba(0,229,255,0.3);text-transform:uppercase;padding:0.3rem 0.3rem 0">Quick Texts</div>` : ''}
      ${presets.slice(0, 3).map((t, i) => `
        <button class="phone-preset-btn" onclick="sendPresetText('${contactId}', ${i})">${t}</button>
      `).join('')}
    </div>` : presets.length ? `
    <div class="phone-chat-presets">
      ${presets.slice(0, 4).map((t, i) => `
        <button class="phone-preset-btn" onclick="sendPresetText('${contactId}', ${i})">${t}</button>
      `).join('')}
    </div>` : ''}
  `;
  const chatEl = document.getElementById('phone-chat-msgs');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
};

// PHASE-3: Conversation choice handler — good/flirt/disrespect
window.sendConvoChoice = function(contactId, choiceIdx) {
  const comp = getCompanion(contactId);
  if (!comp) return;
  const choices = buildConvoChoices(contactId);
  const choice = choices[choiceIdx];
  if (!choice) return;

  // Apply lore delta
  if (choice.lore > 0) {
    earnLore(choice.lore, comp.name + ' convo');
    onCompanionLoreEarn(contactId, choice.lore);
    showLoreToast('+' + choice.lore + ' LORE · ' + comp.name);
  } else if (choice.lore < 0) {
    const was = SState.get('lore');
    SState.set('lore', Math.max(0, was + choice.lore));
    renderLoreBar();
    showLoreToast(choice.lore + ' LORE · ' + comp.name + ' unhappy');
  }

  // Apply satisfaction delta
  const sat = SState.get('companionSatisfaction') || {};
  sat[contactId] = Math.max(0, Math.min(100, (sat[contactId] != null ? sat[contactId] : 100) + choice.satDelta));
  SState.set('companionSatisfaction', sat);

  // Add messages to thread
  const threads = SState.get('messageThreads');
  if (!threads[contactId]) threads[contactId] = [];
  threads[contactId].push({ from: 'Me', text: choice.label, ts: Date.now() });

  // Companion replies with her relevant line
  const replyText = choice.text || (comp.intro || '...');
  setTimeout(() => {
    const t2 = SState.get('messageThreads');
    if (!t2[contactId]) t2[contactId] = [];
    t2[contactId].push({ from: comp.name, text: replyText, ts: Date.now() + 100 });
    SState.set('messageThreads', t2);
    window.openPhoneChat(contactId);
  }, 900);

  SState.set('messageThreads', threads);
  window.openPhoneChat(contactId);
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

// PHASE-3: Phone bank Tony helpers
window._phoneTonyLoan = function() {
  if (typeof closeModal !== 'undefined') closeModal();
  showFatTonyModal();
};
window._tonyRepayFromPhone = function() {
  const debt = SState.get('debt') || 0;
  const bankroll = typeof State !== 'undefined' ? State.get('bankroll') : 0;
  if (debt <= 0) { showLoreToast('No debt.'); return; }
  showTonyRepayModal();
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

  document.getElementById('btn-companion-back').onclick = () => goBack('screen-underground');
  document.getElementById('btn-companion-solo').onclick = () => {
    SState.set('selectedCompanionId', null);
    goBack('screen-underground');
  };
}

function renderCompanionGrid() {
  const grid = document.getElementById('companion-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const rosterRaw = Array.isArray(S.companions) ? S.companions : (S.companions.roster || []);
  const selected = SState.get('selectedCompanionId');
  const loyaltyBroken = SState.get('loyaltyBroken');

  // PHASE-3: loyalty data
  const loyalty = (window.STORY && window.STORY.loyalty) ? window.STORY.loyalty : null;
  const normalGirlId = (loyalty && loyalty.normalGirlId) ? loyalty.normalGirlId : 'cassidy';

  rosterRaw.forEach(comp => {
    const card = document.createElement('div');
    card.className = 'companion-card' + (selected === comp.id ? ' selected' : '');
    const knownCompanions = ['jade','nova','soleil','reign','cassidy'];
    const isKnown = knownCompanions.includes((comp.id || '').toLowerCase());
    const imgSrc = isKnown ? `assets/companions/${comp.id.toLowerCase()}.png` : `assets/companions/${comp.id}.png`;
    const initials = (comp.name || '?')[0].toUpperCase();

    // PHASE-3: tier badge
    const tier = getCompanionTier(comp);
    const tierLabel = tier === 'supermodel' ? 'Supermodel' : tier === 'model' ? 'Model' : 'Normal';
    const tierColor = tier === 'supermodel' ? '#f87171' : tier === 'model' ? 'var(--cyan)' : 'var(--gold-dim)';
    const tierBg = tier === 'supermodel' ? 'rgba(248,113,113,0.12)' : tier === 'model' ? 'rgba(0,229,255,0.1)' : 'rgba(201,168,76,0.06)';

    // PHASE-3: loyalty label for cassidy
    const isCassidy = comp.id === normalGirlId;
    const loyaltyNote = isCassidy && !loyaltyBroken ? '⭐ Max LORE if loyal' : (isCassidy && loyaltyBroken ? '⚠ Loyalty lost' : '');
    const loyaltyColor = isCassidy && !loyaltyBroken ? 'var(--gold)' : '#e03040';

    // Satisfaction bar
    const sat = SState.get('companionSatisfaction') || {};
    const curSat = sat[comp.id] != null ? sat[comp.id] : 100;
    const satColor = curSat > 60 ? 'var(--cyan)' : curSat > 30 ? '#facc15' : '#e03040';

    // PHASE-3: loreBonus — handle v1 and v2 schema
    const loreBonus = comp.baseLoreBonus != null ? comp.baseLoreBonus : (comp.loreBonus || 0);

    card.innerHTML = `
      <div class="companion-card-inner" style="align-items:flex-start;gap:0.9rem">
        <!-- PHASE-3: Bigger portrait -->
        <div style="width:4.5rem;height:5.5rem;border-radius:4px;overflow:hidden;
          border:1px solid rgba(201,168,76,0.3);flex-shrink:0;
          background:linear-gradient(135deg,rgba(40,20,10,0.8),rgba(10,5,20,0.8));
          box-shadow:0 0 14px rgba(201,168,76,0.12)">
          <img src="${imgSrc}" alt="${initials}"
            style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;
            font-family:'Cinzel Decorative',serif;font-size:1.4rem;color:var(--gold)">${initials}</span>
        </div>
        <div class="companion-info" style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.25rem">
            <div class="companion-name" style="margin-bottom:0">${comp.name}</div>
            <span style="font-family:'Cinzel',serif;font-size:0.38rem;letter-spacing:0.1em;
              color:${tierColor};background:${tierBg};border:1px solid ${tierColor};
              opacity:0.9;padding:0.1rem 0.4rem;border-radius:2px;text-transform:uppercase">${tierLabel}</span>
          </div>
          ${loyaltyNote ? `<div style="font-family:'Share Tech Mono',monospace;font-size:0.42rem;color:${loyaltyColor};margin-bottom:0.2rem">${loyaltyNote}</div>` : ''}
          <div class="companion-aesthetic">${comp.aesthetic || (comp.personality || '')}</div>
          <div class="companion-lore-bonus">+${loreBonus} LORE / session</div>
          <div class="companion-intro">"${comp.intro || ''}"</div>
          ${selected === comp.id ? `
          <div style="margin-top:0.35rem">
            <div style="display:flex;align-items:center;gap:0.35rem">
              <span style="font-family:'Share Tech Mono',monospace;font-size:0.42rem;color:rgba(245,240,232,0.3)">Satisfaction</span>
              <div style="flex:1;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden">
                <div style="width:${curSat}%;height:100%;background:${satColor};border-radius:2px;transition:width 0.5s"></div>
              </div>
              <span style="font-family:'Share Tech Mono',monospace;font-size:0.42rem;color:${satColor}">${curSat}%</span>
            </div>
          </div>` : ''}
        </div>
        ${selected === comp.id ? '<div class="companion-check">✓ With You</div>' : ''}
      </div>
    `;
    card.addEventListener('click', () => {
      // PHASE-3: handle tier/loyalty on select
      handleCompanionSelect(comp.id);
      SState.set('selectedCompanionId', comp.id);
      renderCompanionGrid();
      renderCompanionBtn();
      // Auto-seed message thread
      const threads = SState.get('messageThreads');
      if (!threads[comp.id]) {
        threads[comp.id] = [{ from: comp.name, text: comp.intro || '', ts: Date.now() }];
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

  // FIX: store off-state as data attribute; actual hiding/showing is handled by showDialogBubble
  bubble.dataset.bubbleOff = isOff ? 'true' : 'false';
  if (isOff) return;

  // FIX: always reset ALL positional properties with explicit values (not empty strings)
  // so CSS defaults cannot bleed back in
  bubble.style.top = 'auto';
  bubble.style.bottom = 'auto';
  bubble.style.left = 'auto';
  bubble.style.right = 'auto';
  bubble.style.transform = 'none';   // critical: kills the CSS translateX(-50%)

  const p = pos || 'bottom-center';
  if (p === 'top-left')         { bubble.style.top = '4.5rem';  bubble.style.left = '0.8rem'; }
  else if (p === 'top-right')   { bubble.style.top = '4.5rem';  bubble.style.right = '0.8rem'; }
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

  // ── Run stat: increment total hands for this Story run ──
  SState.set('handsThisRun', (SState.get('handsThisRun') || 0) + 1);

  // ── Run stat: keep agent synced (may change between runs) ──
  if (typeof State !== 'undefined') SState.set('runAgentId', State.get('agentId') || 'SHADDAI');

  // PHASE-3: track hands for companion needs
  const handsThisVenue = (SState.get('handsThisVenue') || 0) + 1;
  SState.set('handsThisVenue', handsThisVenue);

  if (outcome === 'win' || outcome === 'bj') {
    // FIX: accumulate net table winnings (profit from this hand only)
    // payout for a win is bet*2; net profit = payout - bet = bet (or 1.5x for BJ)
    const netProfit = payout - (bet || 0);
    if (netProfit > 0 && SState.get('currentCityId')) {
      SState.set('tableWinnings', (SState.get('tableWinnings') || 0) + netProfit);
    }

    // Lore from win
    earnLore(1, 'win');
    // PHASE-3: if companion with us, track cassidy lore
    const compId = SState.get('selectedCompanionId');
    if (compId) onCompanionLoreEarn(compId, 1);

    SState.set('handWins', (SState.get('handWins') || 0) + 1);
    const streak = (SState.get('handStreak') || 0) + 1;
    SState.set('handStreak', streak);

    // Big win dialog — PHASE-3: per-character
    if (payout >= (bet || 100) * 3) {
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || (typeof State !== 'undefined' ? State.get('agentId') : 'SHADDAI');
      const line = getDialogLine('bigWin') || 'Stack it.';
      showDialogBubble(agentId, agentId, line);
    }

    // Win streak dialog — PHASE-3: per-character
    if (streak >= 3 && streak % 3 === 0) {
      const line = getDialogLine('winStreak') || "Can't cool down right now.";
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || 'SHADDAI';
      showDialogBubble(agentId, agentId, line);
    }

    // Check circuit city victory condition
    checkCityVictory();

    // Check underground venue session end
    checkVenueSessionEnd(outcome);

  } else if (outcome === 'lose') {
    // FIX: losses reduce tableWinnings counter (net tracking)
    if (SState.get('currentCityId')) {
      SState.set('tableWinnings', (SState.get('tableWinnings') || 0) - (bet || 0));
    }
    SState.set('handStreak', 0);
    if (payout === 0 && bet >= 200) {
      const cityId = SState.get('currentCityId');
      const city = cityId ? getCity(cityId) : null;
      const agentId = city?.rival?.agent || 'SHADDAI';
      const line = getDialogLine('bigLoss') || 'Reload. Regroup. Return.';
      showDialogBubble(agentId, agentId, line);
    }
  } else if (outcome === 'push') {
    const line = getDialogLine('push') || 'Push. Nobody wins, nobody bleeds.';
    const cityId = SState.get('currentCityId');
    const city = cityId ? getCity(cityId) : null;
    showDialogBubble(city?.rival?.name || 'Dealer', city?.rival?.agent || '', line);
  }

  // Drunk dialog — PHASE-3: per-character
  if (dizzy >= 3 && Math.random() < 0.35) {
    const line = getDialogLine('drunk') || 'Hazy but focused.';
    showDialogBubble('The Table', '', line);
  }

  // Dealer taunt (random, low chance) — PHASE-3: per-character
  if (Math.random() < 0.12) {
    const cityId = SState.get('currentCityId');
    const city = cityId ? getCity(cityId) : null;
    const boss = cityId ? (CITY_BOSS_MAP[cityId] || {}) : {};
    const taunt = getDialogLine('dealerTaunt') || city?.rival?.taunt || boss.taunt || 'The house has something to say.';
    const dealerName = city?.rival?.name || boss.name || 'Dealer';
    const dealerAgent = city?.rival?.agent || boss.agentId || (typeof State !== 'undefined' ? State.get('agentId') : '');
    showDialogBubble(dealerName, dealerAgent, taunt);
  }

  // PHASE-3: companion needs check
  checkCompanionNeeds(handsThisVenue);

  // Update drinks bar dizzy
  renderDrinksBar(true);

  // P2: Schedule random agent trash-talk between matches
  scheduleTaunt();

  // P2 / P8: Auto-save on every round end
  SState.save();
}

function showDialog(moment) {
  // Called by ui.js for explicit moments (e.g. blackjack)
  // PHASE-3: use per-character byAgent lines with generic fallback
  const line = getDialogLine(moment);
  if (!line) return;
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

function checkCityVictory() {
  const cityId = SState.get('currentCityId');
  if (!cityId) return;
  const city = getCity(cityId);
  if (!city) return;

  const tableWinnings = SState.get('tableWinnings') || 0;
  const target = city.chipTarget || 0;

  // FIX: city is beaten only when net chips WON AT THIS TABLE >= chipTarget
  // Show progress toward target in the hint bar
  if (typeof setHint !== 'undefined' && target > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((tableWinnings / target) * 100)));
    const wonStr = tableWinnings < 0 ? '-$' + smFmt(-tableWinnings) : '$' + smFmt(tableWinnings);
    setHint(`Table won: <strong style="color:${tableWinnings >= target ? '#4ade80' : 'var(--gold)'}">
      ${wonStr} / $${smFmt(target)}</strong> (${pct}%)`);
  }

  if (tableWinnings >= target) {
    const beaten = SState.get('beatCities') || [];
    if (!beaten.includes(cityId)) {
      beaten.push(cityId);
      SState.set('beatCities', beaten);
      earnLore(25, city.name + ' cleared');

      // ── Check if ALL 5 cities are now beaten (full circuit complete) ──
      const allCities = S.cities || [];
      const allBeaten = allCities.length > 0 && allCities.every(c => beaten.includes(c.id));

      // Victory cutscene after short delay
      setTimeout(() => {
        showCutscene('victory', city, () => {
          _currentCity = null;
          SState.set('currentCityId', null);
          SState.set('tableWinnings', 0);

          if (allBeaten) {
            // Full circuit complete — trigger win submit overlay
            const handsThisRun = SState.get('handsThisRun') || 0;
            const usedLoanEver = SState.get('usedLoanEver') || false;
            const agent = SState.get('runAgentId') || (typeof State !== 'undefined' ? State.get('agentId') : 'SHADDAI');
            if (typeof window.WinSubmit !== 'undefined') {
              window.WinSubmit.show(handsThisRun, usedLoanEver, agent);
            } else {
              showCircuit();
            }
          } else {
            showCircuit();
          }
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

        if (!SState.get('startChoiceMade')) {
          // FIX 4: present loan-or-grind choice before intro
          NavStack.reset();
          showStartChoice();
        } else if (!SState.get('introSeen')) {
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
  showStartChoice,
  showPhone,
  earnLore,
  SState,
  drinkWater,
  renderCompanionAtTable,
  applyDialogPosition,
  // PHASE-3 additions
  showFatTonyModal,
  repayTonyLoan,
  updateTonyHud,
  getDialogLine,
  // Leaderboard helpers (accessed by WinSubmit in ui.js)
  getRunStats: () => ({
    handsThisRun: SState.get('handsThisRun') || 0,
    usedLoanEver: SState.get('usedLoanEver') || false,
    agent: SState.get('runAgentId') || (typeof State !== 'undefined' ? State.get('agentId') : 'SHADDAI'),
  }),
};

// Expose nav helpers so ui.js btn-table-back can use the same stack
window.NavStack = NavStack;
window._origRouterGo = _origRouterGo;
window._refreshScreen = _refreshScreen;
