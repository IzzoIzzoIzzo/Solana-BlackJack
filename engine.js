/**
 * engine.js — SHADDAI Blackjack Rules Engine
 * Exposes: window.BJ
 *
 * Regulated Las Vegas / Atlantic City multi-deck blackjack.
 * Zero dependencies. Pure browser JS.
 *
 * Payout audit trail:
 *   Win:           +1× bet
 *   Blackjack:     +1.5× bet (3:2, default) — configurable
 *   Push:          ±0
 *   Loss:          -1× bet
 *   Surrender:     -0.5× bet  (late surrender; half returned)
 *   Insurance:     2:1 on ½-bet side wager
 *
 * Perfect Pairs payouts (published industry-standard):
 *   Mixed pair  (same rank, different colour, different suit): 6:1
 *   Coloured pair (same rank, same colour, different suit):   12:1
 *   Perfect pair (same rank, same suit):                      25:1
 *
 * 21+3 payouts (player two cards + dealer upcard, published):
 *   Flush           (same suit, different ranks):              5:1
 *   Straight        (sequential ranks, different suits):      10:1
 *   Three-of-a-kind (same rank, different suits):             30:1
 *   Straight flush  (sequential + same suit):                 40:1
 *   Suited trips    (same rank, same suit — only possible
 *                    with 2+ decks):                         100:1
 */

;(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────

  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const SUITS = ['S','H','D','C'];

  // Numeric value of each rank (Aces handled separately in handValue)
  const RANK_VALUE = {
    'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
    '10':10,'J':10,'Q':10,'K':10
  };

  // Suit colour for Perfect Pairs
  const SUIT_COLOR = { S:'black', C:'black', H:'red', D:'red' };

  // Rank-to-number for straights (A=1, J=11, Q=12, K=13)
  const RANK_NUM = {
    'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
    '10':10,'J':11,'Q':12,'K':13
  };

  // ─────────────────────────────────────────────────────────
  // DEFAULT RULES
  // ─────────────────────────────────────────────────────────

  const RULES_DEFAULT = Object.freeze({
    decks:             6,
    dealerHitsSoft17:  false,   // Vegas H17 = true, S17 = false
    blackjackPays:     1.5,     // 3:2
    doubleAfterSplit:  true,
    resplitAces:       false,
    lateSurrender:     true,
    insurance:         true,
    penetration:       0.75     // reshuffle when 75% dealt
  });

  // ─────────────────────────────────────────────────────────
  // SHOE BUILDER + FISHER-YATES SHUFFLE
  // ─────────────────────────────────────────────────────────

  /**
   * Build a fresh shoe of `decks` decks (3 or 6 supported; any integer works).
   * Returns a shuffled array of card objects: { rank, suit }.
   */
  function newShoe(decks) {
    decks = decks || RULES_DEFAULT.decks;
    const cards = [];
    for (let d = 0; d < decks; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          cards.push({ rank, suit });
        }
      }
    }
    // Fisher-Yates (Knuth) shuffle — cryptographically adequate for a game
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = cards[i];
      cards[i] = cards[j];
      cards[j] = tmp;
    }
    return cards;
  }

  // ─────────────────────────────────────────────────────────
  // HAND VALUE
  // ─────────────────────────────────────────────────────────

  /**
   * Calculate the best blackjack total for an array of cards.
   * Returns { total: number, soft: boolean }
   * 'soft' = true when at least one Ace is counted as 11.
   */
  function handValue(cards) {
    let total = 0;
    let aces  = 0;
    for (const c of cards) {
      if (c.rank === 'A') {
        aces++;
        total += 11;
      } else {
        total += RANK_VALUE[c.rank];
      }
    }
    let soft = aces > 0 && total <= 21;
    // Reduce aces from 11 → 1 as needed
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    // Re-evaluate soft (only soft if the surviving Ace is still counted as 11)
    soft = aces > 0 && total <= 21;
    return { total, soft };
  }

  // ─────────────────────────────────────────────────────────
  // BLACKJACK DETECTION
  // ─────────────────────────────────────────────────────────

  /**
   * Returns true iff the hand is a natural blackjack:
   * exactly 2 cards totalling 21.
   */
  function isBlackjack(hand) {
    const cards = Array.isArray(hand) ? hand : hand.cards;
    if (!cards || cards.length !== 2) return false;
    return handValue(cards).total === 21;
  }

  // ─────────────────────────────────────────────────────────
  // DEAL HELPER
  // ─────────────────────────────────────────────────────────

  function _deal(shoe) {
    if (shoe.length === 0) throw new Error('BJ: shoe exhausted');
    return shoe.pop(); // pop from end (was shuffled, direction doesn't matter)
  }

  // ─────────────────────────────────────────────────────────
  // START ROUND
  // ─────────────────────────────────────────────────────────

  /**
   * Deal a new round.
   *
   * @param {object} params
   * @param {Array}  params.shoe    — current shoe (mutated as cards are dealt)
   * @param {Array}  params.seats   — [{ id, bet, sideBets:{ perfectPairs, twentyOnePlus3 } }]
   * @param {object} params.rules   — merged with RULES_DEFAULT
   *
   * @returns round state object (described in module docs)
   */
  function startRound({ shoe, seats, rules }) {
    rules = Object.assign({}, RULES_DEFAULT, rules);

    // Check penetration — reshuffle if needed
    const totalCards = rules.decks * 52;
    if (shoe.length < totalCards * (1 - rules.penetration)) {
      // Auto-reshuffle (caller can also manage this themselves)
      const fresh = newShoe(rules.decks);
      shoe.splice(0, shoe.length, ...fresh);
    }

    // Build seat state
    const seatStates = seats.map(s => ({
      id:       s.id,
      bet:      s.bet,
      sideBets: Object.assign({ perfectPairs: 0, twentyOnePlus3: 0 }, s.sideBets),
      // hands[0] = main hand; split creates hands[1]
      hands: [{
        cards:    [],
        done:     false,
        doubled:  false,
        split:    false,      // true if this hand came from a split
        surrendered: false,
        insuranceTaken: false,
        insuranceBet: 0
      }],
      results: null
    }));

    // Deal: card to each seat, card to dealer, second card to each seat, dealer hole card
    for (const seat of seatStates) {
      seat.hands[0].cards.push(_deal(shoe));
    }
    const dealerCards = [_deal(shoe)];

    for (const seat of seatStates) {
      seat.hands[0].cards.push(_deal(shoe));
    }
    dealerCards.push(_deal(shoe)); // hole card (index 1 — hidden until dealerPlay)

    return {
      seats:  seatStates,
      dealer: {
        cards:  dealerCards,
        upcard: dealerCards[0] // dealerCards[1] is the hole card (hidden)
      },
      rules,
      shoe,
      _phase: 'player' // 'player' | 'dealer' | 'settled'
    };
  }

  // ─────────────────────────────────────────────────────────
  // ACTIVE HAND HELPER
  // ─────────────────────────────────────────────────────────

  function _getActiveSeat(round, seatId) {
    const seat = round.seats.find(s => s.id === seatId);
    if (!seat) throw new Error(`BJ: seat ${seatId} not found`);
    return seat;
  }

  function _getActiveHand(seat) {
    // Return first non-done hand
    const hand = seat.hands.find(h => !h.done);
    if (!hand) throw new Error(`BJ: no active hand for seat ${seat.id}`);
    return hand;
  }

  function _checkBust(hand) {
    if (handValue(hand.cards).total > 21) {
      hand.done = true;
    }
  }

  function _allHandsDone(round) {
    return round.seats.every(s => s.hands.every(h => h.done));
  }

  // ─────────────────────────────────────────────────────────
  // PLAYER ACTIONS
  // ─────────────────────────────────────────────────────────

  /**
   * HIT — deal one card to the active hand.
   */
  function hit(round, seatId) {
    if (round._phase !== 'player') throw new Error('BJ: not player phase');
    const seat = _getActiveSeat(round, seatId);
    const hand = _getActiveHand(seat);
    hand.cards.push(_deal(round.shoe));
    _checkBust(hand);
    // If 21, auto-stand
    if (!hand.done && handValue(hand.cards).total === 21) {
      hand.done = true;
    }
    return round;
  }

  /**
   * STAND — player takes no more cards on the active hand.
   */
  function stand(round, seatId) {
    if (round._phase !== 'player') throw new Error('BJ: not player phase');
    const seat = _getActiveSeat(round, seatId);
    const hand = _getActiveHand(seat);
    hand.done = true;
    return round;
  }

  /**
   * DOUBLE DOWN — double the bet, take exactly one card, then stand.
   * Allowed: first two cards of a hand (or after split if doubleAfterSplit).
   */
  function double(round, seatId) {
    if (round._phase !== 'player') throw new Error('BJ: not player phase');
    const seat = _getActiveSeat(round, seatId);
    const hand = _getActiveHand(seat);
    if (hand.cards.length !== 2) {
      throw new Error('BJ: double only allowed on first two cards');
    }
    if (hand.split && !round.rules.doubleAfterSplit) {
      throw new Error('BJ: double after split not allowed by rules');
    }
    hand.doubled = true;
    hand.cards.push(_deal(round.shoe));
    hand.done = true;
    return round;
  }

  /**
   * SPLIT — split a pair into two hands.
   * - Only on pairs (same rank).
   * - Aces: each gets exactly one card and is done (unless resplitAces).
   * - Splitting gives each hand one more card immediately.
   */
  function split(round, seatId) {
    if (round._phase !== 'player') throw new Error('BJ: not player phase');
    const seat  = _getActiveSeat(round, seatId);
    const hand  = _getActiveHand(seat);
    const cards = hand.cards;

    if (cards.length !== 2) throw new Error('BJ: split only on two cards');
    if (cards[0].rank !== cards[1].rank) throw new Error('BJ: split requires a pair');

    const isAce = cards[0].rank === 'A';
    if (isAce && !round.rules.resplitAces && hand.split) {
      throw new Error('BJ: resplit aces not allowed by rules');
    }

    // Take the second card off the original hand, form new hand
    const splitCard = cards.splice(1, 1)[0];
    hand.split = true;

    // Deal one card to the original hand
    hand.cards.push(_deal(round.shoe));

    // If ace, hand is done after one card
    if (isAce) hand.done = true;

    // Create second hand
    const newHand = {
      cards:    [splitCard, _deal(round.shoe)],
      done:     isAce, // aces get one card, auto-done
      doubled:  false,
      split:    true,
      surrendered: false,
      insuranceTaken: false,
      insuranceBet: 0
    };
    seat.hands.push(newHand);

    // Check for auto-21 on non-ace split hands
    if (!isAce) {
      if (handValue(hand.cards).total === 21) hand.done = true;
      if (handValue(newHand.cards).total === 21) newHand.done = true;
    }

    return round;
  }

  /**
   * SURRENDER — late surrender (available before any extra cards).
   * Forfeits hand; player gets half their bet back (net = -0.5).
   * Only offered when dealer upcard is NOT an Ace (or after insurance offered/resolved).
   */
  function surrender(round, seatId) {
    if (round._phase !== 'player') throw new Error('BJ: not player phase');
    if (!round.rules.lateSurrender) throw new Error('BJ: surrender not enabled by rules');
    const seat = _getActiveSeat(round, seatId);
    const hand = _getActiveHand(seat);
    if (hand.cards.length !== 2) throw new Error('BJ: surrender only on initial two cards');
    if (hand.split) throw new Error('BJ: surrender not allowed after split');
    hand.surrendered = true;
    hand.done = true;
    return round;
  }

  /**
   * INSURANCE — offered when dealer upcard is Ace.
   * Side bet = half the original bet. Pays 2:1 if dealer has blackjack.
   * @param {boolean} take — true = take insurance, false = decline
   */
  function insurance(round, seatId, take) {
    if (!round.rules.insurance) throw new Error('BJ: insurance not enabled by rules');
    if (round.dealer.upcard.rank !== 'A') throw new Error('BJ: insurance only offered when dealer shows Ace');
    const seat = _getActiveSeat(round, seatId);
    const hand = seat.hands[0]; // insurance is on the main hand only
    if (hand.insuranceTaken !== false) throw new Error('BJ: insurance already decided');
    hand.insuranceTaken = true;
    hand.insuranceBet   = take ? seat.bet / 2 : 0;
    return round;
  }

  // ─────────────────────────────────────────────────────────
  // DEALER PLAY
  // ─────────────────────────────────────────────────────────

  /**
   * Reveal the hole card and draw per rules.
   * Dealer stands on hard 17+.
   * Dealer hits soft 17 iff rules.dealerHitsSoft17.
   */
  function dealerPlay(round) {
    if (round._phase !== 'player') throw new Error('BJ: call after all player hands are done');
    round._phase = 'dealer';

    // Hole card is already in dealer.cards[1] — just draw more
    const dealer = round.dealer;
    const rules  = round.rules;

    // Check if all seats busted / surrendered → dealer doesn't need to draw
    const allBustOrSurrender = round.seats.every(s =>
      s.hands.every(h => {
        if (h.surrendered) return true;
        return handValue(h.cards).total > 21;
      })
    );

    if (!allBustOrSurrender) {
      // Draw until dealer must stand
      let { total, soft } = handValue(dealer.cards);
      while (
        total < 17 ||
        (total === 17 && soft && rules.dealerHitsSoft17)
      ) {
        dealer.cards.push(_deal(round.shoe));
        ({ total, soft } = handValue(dealer.cards));
      }
    }

    return round;
  }

  // ─────────────────────────────────────────────────────────
  // SIDE BET: PERFECT PAIRS
  // ─────────────────────────────────────────────────────────

  /**
   * Evaluate Perfect Pairs on the player's first two cards.
   * Returns net payout multiplier (relative to side bet amount):
   *   Win  →  positive integer (payout ratio)
   *   Loss → -1
   *
   * Pairs classification:
   *   Perfect pair:  same rank + same suit               → 25:1
   *   Coloured pair: same rank + same colour (diff suit) → 12:1
   *   Mixed pair:    same rank + different colour        →  6:1
   *   No pair:       different rank                      → loss
   */
  function _evalPerfectPairs(c1, c2) {
    if (c1.rank !== c2.rank) return -1; // no pair → loss
    if (c1.suit === c2.suit)                            return 25; // perfect
    if (SUIT_COLOR[c1.suit] === SUIT_COLOR[c2.suit])    return 12; // coloured
    return 6;                                                       // mixed
  }

  // ─────────────────────────────────────────────────────────
  // SIDE BET: 21+3
  // ─────────────────────────────────────────────────────────

  /**
   * Evaluate 21+3: player's 2 cards + dealer upcard (3 cards total).
   * Returns net payout multiplier or -1 for loss.
   *
   * Hand rankings (highest to lowest, first match wins):
   *   Suited trips    (3 same rank + 3 same suit)       → 100:1
   *   Straight flush  (3 sequential ranks + same suit)  →  40:1
   *   Three-of-a-kind (3 same rank, mixed suits)        →  30:1
   *   Straight        (3 sequential, mixed suits)       →  10:1
   *   Flush           (3 same suit, non-sequential)     →   5:1
   *   Nothing                                           →  -1
   */
  function _evalTwentyOnePlus3(c1, c2, c3) {
    const ranks = [c1.rank, c2.rank, c3.rank];
    const suits = [c1.suit, c2.suit, c3.suit];
    const nums  = ranks.map(r => RANK_NUM[r]).sort((a,b) => a - b);

    const allSameSuit = suits[0] === suits[1] && suits[1] === suits[2];
    const allSameRank = ranks[0] === ranks[1] && ranks[1] === ranks[2];

    // Check sequential (straight): nums are consecutive
    const isSeq = (nums[1] === nums[0] + 1) && (nums[2] === nums[1] + 1);
    // Special ace-low wrap: A-2-3 → nums = [1,2,3], handled naturally
    // No high-ace wrap in 21+3 (K-A-2 does NOT count as straight)

    if (allSameRank && allSameSuit) return 100; // suited trips
    if (isSeq && allSameSuit)       return 40;  // straight flush
    if (allSameRank)                return 30;  // three-of-a-kind
    if (isSeq)                      return 10;  // straight
    if (allSameSuit)                return 5;   // flush
    return -1;
  }

  // ─────────────────────────────────────────────────────────
  // SETTLE
  // ─────────────────────────────────────────────────────────

  /**
   * Resolve all bets and set seat.results.
   *
   * Results shape per seat:
   * {
   *   hands: [{ net, outcome }],  // net = units won/lost relative to bet
   *   sideBets: { perfectPairs: net, twentyOnePlus3: net },
   *   insurance: net,
   *   total: number               // total net across all bets
   * }
   *
   * net conventions (multiples of the *main* bet):
   *   +1.5 = blackjack win (3:2)
   *   +1   = normal win
   *    0   = push
   *   -0.5 = surrender
   *   -1   = loss / doubled loss (doubled net handled at hand level)
   *
   * For doubled hands the bet is effectively 2× so net of +1 on a
   * double = +2 original bet units. We express this as-is — the UI
   * should multiply by hand.doubled ? 2 : 1 for display, or use
   * the `totalNet` which already accounts for it.
   */
  function settle(round) {
    if (round._phase === 'player') {
      throw new Error('BJ: call dealerPlay before settle');
    }
    round._phase = 'settled';

    const dealerCards   = round.dealer.cards;
    const dealerVal     = handValue(dealerCards).total;
    const dealerBJ      = isBlackjack(dealerCards);
    const dealerBust    = dealerVal > 21;
    const upcard        = round.dealer.upcard;

    for (const seat of round.seats) {
      const handResults  = [];
      let   totalNet     = 0;
      let   insuranceNet = 0;

      // ── Insurance settlement ──────────────────────────────
      // Insurance is on hands[0] only
      const mainHand = seat.hands[0];
      if (mainHand.insuranceTaken && mainHand.insuranceBet > 0) {
        if (dealerBJ) {
          // Pays 2:1 on the insurance bet
          // Insurance bet = seat.bet/2, win = 2× that = seat.bet
          insuranceNet = mainHand.insuranceBet * 2; // in absolute chips
        } else {
          insuranceNet = -mainHand.insuranceBet;    // lose the side wager
        }
        // Normalise to main bet units for the result
        insuranceNet = insuranceNet / seat.bet;
      }
      totalNet += insuranceNet;

      // ── Main hand(s) settlement ───────────────────────────
      for (const hand of seat.hands) {
        const betMultiplier = hand.doubled ? 2 : 1;
        let   outcome, net;

        if (hand.surrendered) {
          outcome = 'surrender';
          net     = -0.5; // half the original bet lost
          // No multiplier on surrender
          handResults.push({ outcome, net });
          totalNet += net;
          continue;
        }

        const playerVal = handValue(hand.cards).total;
        const playerBJ  = isBlackjack(hand) && !hand.split; // BJ only on un-split original hand
        const playerBust = playerVal > 21;

        if (playerBust) {
          outcome = 'bust';
          net     = -1 * betMultiplier;
        } else if (playerBJ && dealerBJ) {
          outcome = 'push';
          net     = 0;
        } else if (playerBJ) {
          outcome = 'blackjack';
          net     = round.rules.blackjackPays; // e.g. 1.5
        } else if (dealerBJ) {
          outcome = 'loss';
          net     = -1 * betMultiplier;
        } else if (dealerBust) {
          outcome = 'win';
          net     = 1 * betMultiplier;
        } else if (playerVal > dealerVal) {
          outcome = 'win';
          net     = 1 * betMultiplier;
        } else if (playerVal === dealerVal) {
          outcome = 'push';
          net     = 0;
        } else {
          outcome = 'loss';
          net     = -1 * betMultiplier;
        }

        handResults.push({ outcome, net });
        totalNet += net;
      }

      // ── Side bet: Perfect Pairs ───────────────────────────
      let ppNet = 0;
      if (seat.sideBets.perfectPairs > 0) {
        const cards = seat.hands[0].cards;
        const mult  = _evalPerfectPairs(cards[0], cards[1]);
        ppNet       = mult; // +25/+12/+6 or -1, all relative to the side bet
        totalNet   += ppNet * (seat.sideBets.perfectPairs / seat.bet);
      }

      // ── Side bet: 21+3 ───────────────────────────────────
      let t3Net = 0;
      if (seat.sideBets.twentyOnePlus3 > 0) {
        const cards = seat.hands[0].cards;
        const mult  = _evalTwentyOnePlus3(cards[0], cards[1], upcard);
        t3Net       = mult;
        totalNet   += t3Net * (seat.sideBets.twentyOnePlus3 / seat.bet);
      }

      seat.results = {
        hands:    handResults,
        sideBets: {
          perfectPairs:    ppNet,     // multiplier applied to perfectPairs bet
          twentyOnePlus3:  t3Net      // multiplier applied to twentyOnePlus3 bet
        },
        insurance: insuranceNet,      // units of main bet
        totalNet                      // net in main-bet units (approx; side bets scaled)
      };
    }

    return round;
  }

  // ─────────────────────────────────────────────────────────
  // TRUE COUNT
  // ─────────────────────────────────────────────────────────

  /**
   * Hi-Lo true count for the remaining shoe.
   * Running count ÷ decks remaining.
   * Positive = player advantage.
   */
  function trueCount(shoe) {
    let running = 0;
    for (const card of shoe) {
      const r = card.rank;
      if (['2','3','4','5','6'].includes(r))          running += 1;
      else if (['10','J','Q','K','A'].includes(r))    running -= 1;
      // 7,8,9 are neutral (0)
    }
    const decksRemaining = shoe.length / 52;
    if (decksRemaining < 0.01) return 0;
    return running / decksRemaining;
  }

  // ─────────────────────────────────────────────────────────
  // BASIC STRATEGY
  // ─────────────────────────────────────────────────────────

  /**
   * Returns the perfect basic-strategy decision for the player's hand.
   * Based on published 6-deck, S17/H17 tables (Griffin/Wizard of Odds).
   *
   * Returns one of:
   *   'H' — Hit
   *   'S' — Stand
   *   'D' — Double (hit if not allowed)
   *   'P' — Split
   *   'R' — Surrender (hit if not allowed)
   *
   * @param {object[]} playerHand  — array of card objects (the active hand)
   * @param {object}   dealerUpcard — single card object
   * @param {object}   rules        — the round rules (for H17 etc.)
   */
  function basicStrategy(playerHand, dealerUpcard, rules) {
    rules = rules || RULES_DEFAULT;
    const cards    = Array.isArray(playerHand) ? playerHand : playerHand.cards;
    const { total, soft } = handValue(cards);
    const d        = RANK_VALUE[dealerUpcard.rank]; // dealer upcard numeric (1-10; A=1 here)
    const dUp      = dealerUpcard.rank === 'A' ? 11 : d; // 11 for Ace upcard
    const dNum     = dealerUpcard.rank === 'A' ? 11 : Math.min(d, 10);

    const isSplittable = cards.length === 2 && cards[0].rank === cards[1].rank;
    const canSurrender = rules.lateSurrender;
    const h17          = rules.dealerHitsSoft17;

    // ── PAIRS TABLE ──────────────────────────────────────────
    if (isSplittable) {
      const pairRank = cards[0].rank;
      const pv       = pairRank === 'A' ? 11 : RANK_VALUE[pairRank]; // pair card value

      // A-A: always split
      if (pairRank === 'A') return 'P';

      // 8-8: always split (even vs T/A)
      if (pv === 8) return 'P';

      // 2-2, 3-3: split vs 2-7
      if (pv === 2 || pv === 3) return dNum >= 2 && dNum <= 7 ? 'P' : 'H';

      // 4-4: split vs 5-6 only
      if (pv === 4) return dNum >= 5 && dNum <= 6 ? 'P' : 'H';

      // 5-5: treat as hard 10 (never split)
      // Falls through to hard totals below — handled by returning nothing here.
      if (pv === 5) { /* fall through */ }
      else {
        // 6-6: split vs 2-6
        if (pv === 6) return dNum >= 2 && dNum <= 6 ? 'P' : 'H';

        // 7-7: split vs 2-7
        if (pv === 7) return dNum >= 2 && dNum <= 7 ? 'P' : 'H';

        // 9-9: split vs 2-9 except 7; stand vs 7/T/A
        if (pv === 9) {
          if (dNum === 7 || dNum === 10 || dNum === 11) return 'S';
          return 'P';
        }

        // T-T (10,J,Q,K): never split — stand
        if (pv === 10) return 'S';
      }
    }

    // ── SOFT TOTALS TABLE ────────────────────────────────────
    if (soft && total <= 21) {
      // Soft 21 = blackjack, handled elsewhere; just stand
      if (total === 21) return 'S';

      // Soft 20 (A-9): always stand
      if (total === 20) return 'S';

      // Soft 19 (A-8): stand; double vs 6 only if H17
      if (total === 19) return (h17 && dNum === 6) ? 'D' : 'S';

      // Soft 18 (A-7):
      if (total === 18) {
        if (dNum >= 2 && dNum <= 6) return 'D';
        if (dNum === 7 || dNum === 8) return 'S';
        return 'H'; // vs 9, T, A
      }

      // Soft 17 (A-6): double vs 3-6, else hit
      if (total === 17) return (dNum >= 3 && dNum <= 6) ? 'D' : 'H';

      // Soft 16 (A-5): double vs 4-6, else hit
      if (total === 16) return (dNum >= 4 && dNum <= 6) ? 'D' : 'H';

      // Soft 15 (A-4): double vs 4-6, else hit
      if (total === 15) return (dNum >= 4 && dNum <= 6) ? 'D' : 'H';

      // Soft 14 (A-3): double vs 5-6, else hit
      if (total === 14) return (dNum >= 5 && dNum <= 6) ? 'D' : 'H';

      // Soft 13 (A-2): double vs 5-6, else hit
      if (total === 13) return (dNum >= 5 && dNum <= 6) ? 'D' : 'H';

      return 'H';
    }

    // ── HARD TOTALS TABLE ────────────────────────────────────

    // 21: stand
    if (total >= 21) return 'S';

    // Hard 17-20: always stand
    if (total >= 17) return 'S';

    // Hard 16:
    if (total === 16) {
      if (canSurrender && (dNum === 9 || dNum === 10 || dNum === 11)) return 'R';
      if (dNum >= 2 && dNum <= 6) return 'S';
      return 'H';
    }

    // Hard 15:
    if (total === 15) {
      if (canSurrender && dNum === 10) return 'R';
      if (dNum >= 2 && dNum <= 6) return 'S';
      return 'H';
    }

    // Hard 14:
    if (total === 14) {
      if (dNum >= 2 && dNum <= 6) return 'S';
      return 'H';
    }

    // Hard 13:
    if (total === 13) {
      if (dNum >= 2 && dNum <= 6) return 'S';
      return 'H';
    }

    // Hard 12:
    if (total === 12) {
      if (dNum >= 4 && dNum <= 6) return 'S';
      return 'H';
    }

    // Hard 11: double vs 2-10; hit vs Ace
    if (total === 11) {
      return dNum <= 10 ? 'D' : 'H';
    }

    // Hard 10: double vs 2-9; hit vs T/A
    if (total === 10) {
      return (dNum >= 2 && dNum <= 9) ? 'D' : 'H';
    }

    // Hard 9: double vs 3-6; else hit
    if (total === 9) {
      return (dNum >= 3 && dNum <= 6) ? 'D' : 'H';
    }

    // Hard 8 and below: always hit
    return 'H';
  }

  // ─────────────────────────────────────────────────────────
  // SELF TEST
  // ─────────────────────────────────────────────────────────

  /**
   * Run a suite of assertions.
   * Logs 'BJ selfTest PASS' on success; throws detailed error on failure.
   */
  function selfTest() {
    const assert = (condition, msg) => {
      if (!condition) throw new Error('BJ selfTest FAIL: ' + msg);
    };

    // ── handValue ──────────────────────────────────────────
    // Ace + 9 = soft 20
    assert(handValue([{rank:'A',suit:'S'},{rank:'9',suit:'H'}]).total === 20, 'A+9 = 20');
    assert(handValue([{rank:'A',suit:'S'},{rank:'9',suit:'H'}]).soft  === true, 'A+9 soft');

    // Ace + King = soft 21 (blackjack)
    assert(handValue([{rank:'A',suit:'S'},{rank:'K',suit:'H'}]).total === 21, 'A+K = 21');
    assert(handValue([{rank:'A',suit:'S'},{rank:'K',suit:'H'}]).soft  === true, 'A+K soft');

    // Ace + 5 + 7 = 13 (ace demoted)
    assert(handValue([{rank:'A',suit:'S'},{rank:'5',suit:'H'},{rank:'7',suit:'D'}]).total === 13, 'A+5+7 = 13');
    assert(handValue([{rank:'A',suit:'S'},{rank:'5',suit:'H'},{rank:'7',suit:'D'}]).soft  === false, 'A+5+7 hard');

    // Ace + Ace + 9 = 21 (A=11, A=1, 9) — one ace demoted
    assert(handValue([{rank:'A',suit:'S'},{rank:'A',suit:'H'},{rank:'9',suit:'D'}]).total === 21, 'A+A+9 = 21');
    assert(handValue([{rank:'A',suit:'S'},{rank:'A',suit:'H'},{rank:'9',suit:'D'}]).soft  === true, 'A+A+9 soft');

    // Bust: 10 + 8 + 7 = 25
    assert(handValue([{rank:'10',suit:'S'},{rank:'8',suit:'H'},{rank:'7',suit:'D'}]).total === 25, '10+8+7 = 25');

    // Multiple aces that all demote: A+A+A+A = 14 (all 1 except one=11 → bust, keep reducing)
    // Actually: A+A+A+A → 44 → 34 → 24 → 14 (3 aces demoted, one stays 11)
    assert(handValue([{rank:'A',suit:'S'},{rank:'A',suit:'H'},{rank:'A',suit:'D'},{rank:'A',suit:'C'}]).total === 14, 'A+A+A+A = 14');

    // 10+10 = hard 20
    assert(handValue([{rank:'10',suit:'S'},{rank:'10',suit:'H'}]).total === 20, '10+10 = 20');
    assert(handValue([{rank:'10',suit:'S'},{rank:'10',suit:'H'}]).soft  === false, '10+10 hard');

    // ── isBlackjack ────────────────────────────────────────
    assert(isBlackjack([{rank:'A',suit:'S'},{rank:'K',suit:'H'}])  === true,  'A+K = BJ');
    assert(isBlackjack([{rank:'A',suit:'S'},{rank:'9',suit:'H'}])  === false, 'A+9 != BJ');
    assert(isBlackjack([{rank:'10',suit:'S'},{rank:'Q',suit:'H'},{rank:'A',suit:'D'}]) === false, '10+Q+A != BJ (3 cards)');

    // ── newShoe ────────────────────────────────────────────
    const shoe3 = newShoe(3);
    assert(shoe3.length === 156, 'shoe3 has 156 cards');
    const shoe6 = newShoe(6);
    assert(shoe6.length === 312, 'shoe6 has 312 cards');

    // Count aces in 6-deck shoe = 24
    const aces6 = shoe6.filter(c => c.rank === 'A').length;
    assert(aces6 === 24, 'shoe6 has 24 aces');

    // ── Side bets: Perfect Pairs ───────────────────────────
    assert(_evalPerfectPairs({rank:'K',suit:'S'},{rank:'K',suit:'S'}) === 25, 'PP perfect = 25');
    assert(_evalPerfectPairs({rank:'K',suit:'S'},{rank:'K',suit:'C'}) === 12, 'PP coloured = 12');
    assert(_evalPerfectPairs({rank:'K',suit:'S'},{rank:'K',suit:'H'}) === 6,  'PP mixed = 6');
    assert(_evalPerfectPairs({rank:'K',suit:'S'},{rank:'Q',suit:'S'}) === -1, 'PP no pair = -1');

    // ── Side bets: 21+3 ───────────────────────────────────
    // Suited trips: A♠ A♠ A♠ (only possible multi-deck)
    assert(_evalTwentyOnePlus3({rank:'A',suit:'S'},{rank:'A',suit:'S'},{rank:'A',suit:'S'}) === 100, '21+3 suited trips = 100');
    // Straight flush: 7♠ 8♠ 9♠
    assert(_evalTwentyOnePlus3({rank:'7',suit:'S'},{rank:'8',suit:'S'},{rank:'9',suit:'S'}) === 40, '21+3 straight flush = 40');
    // Three-of-a-kind: K♠ K♥ K♦
    assert(_evalTwentyOnePlus3({rank:'K',suit:'S'},{rank:'K',suit:'H'},{rank:'K',suit:'D'}) === 30, '21+3 three-of-a-kind = 30');
    // Straight: 7♠ 8♥ 9♦
    assert(_evalTwentyOnePlus3({rank:'7',suit:'S'},{rank:'8',suit:'H'},{rank:'9',suit:'D'}) === 10, '21+3 straight = 10');
    // Flush: 2♠ 7♠ K♠
    assert(_evalTwentyOnePlus3({rank:'2',suit:'S'},{rank:'7',suit:'S'},{rank:'K',suit:'S'}) === 5, '21+3 flush = 5');
    // Nothing: 2♠ 5♥ K♦
    assert(_evalTwentyOnePlus3({rank:'2',suit:'S'},{rank:'5',suit:'H'},{rank:'K',suit:'D'}) === -1, '21+3 nothing = -1');

    // ── Split ─────────────────────────────────────────────
    {
      const shoe = newShoe(6);
      const round = startRound({
        shoe,
        seats: [{ id:'p1', bet:100, sideBets:{} }],
        rules: RULES_DEFAULT
      });
      // Force a pair on seat p1 hand
      round.seats[0].hands[0].cards = [{rank:'8',suit:'S'},{rank:'8',suit:'H'}];
      split(round, 'p1');
      assert(round.seats[0].hands.length === 2, 'split creates 2 hands');
      assert(round.seats[0].hands[0].cards[0].rank === '8', 'split hand0 has 8');
      assert(round.seats[0].hands[1].cards[0].rank === '8', 'split hand1 has 8');
    }

    // ── Dealer soft 17 ────────────────────────────────────
    {
      const shoe = newShoe(6);
      // Rig a round where dealer has A+6 = soft 17 and H17=true
      const round = startRound({ shoe, seats:[{id:'p1',bet:100,sideBets:{}}], rules: RULES_DEFAULT });
      // Stand the player hand so dealer must play
      round.seats[0].hands[0].done = true;
      // Force dealer cards
      round.dealer.cards = [{rank:'A',suit:'S'},{rank:'6',suit:'H'}];
      // H17 = true → dealer must hit
      round.rules = Object.assign({}, RULES_DEFAULT, { dealerHitsSoft17: true });
      dealerPlay(round);
      // After hitting, dealer has at least 3 cards (drew on soft 17)
      assert(round.dealer.cards.length >= 3, 'dealer hits soft 17 when H17=true');
    }
    {
      // S17 variant: dealer stands on soft 17
      const shoe2 = newShoe(6);
      const round2 = startRound({ shoe:shoe2, seats:[{id:'p1',bet:100,sideBets:{}}], rules: RULES_DEFAULT });
      round2.seats[0].hands[0].done = true;
      round2.dealer.cards = [{rank:'A',suit:'S'},{rank:'6',suit:'H'}];
      round2.rules = Object.assign({}, RULES_DEFAULT, { dealerHitsSoft17: false });
      dealerPlay(round2);
      assert(round2.dealer.cards.length === 2, 'dealer stands on soft 17 when S17=false');
    }

    // ── Basic strategy spot checks ────────────────────────
    const defRules = RULES_DEFAULT;
    // Hard 16 vs 10 → surrender
    assert(basicStrategy([{rank:'9',suit:'S'},{rank:'7',suit:'H'}], {rank:'10',suit:'D'}, defRules) === 'R', 'BS hard 16 vs T = R');
    // Hard 11 vs 6 → double
    assert(basicStrategy([{rank:'6',suit:'S'},{rank:'5',suit:'H'}], {rank:'6',suit:'D'}, defRules) === 'D', 'BS hard 11 vs 6 = D');
    // Soft 18 (A-7) vs 5 → double
    assert(basicStrategy([{rank:'A',suit:'S'},{rank:'7',suit:'H'}], {rank:'5',suit:'D'}, defRules) === 'D', 'BS soft 18 vs 5 = D');
    // A-A vs 5 → split
    assert(basicStrategy([{rank:'A',suit:'S'},{rank:'A',suit:'H'}], {rank:'5',suit:'D'}, defRules) === 'P', 'BS A-A = P');
    // 9-9 vs 7 → stand
    assert(basicStrategy([{rank:'9',suit:'S'},{rank:'9',suit:'H'}], {rank:'7',suit:'D'}, defRules) === 'S', 'BS 9-9 vs 7 = S');
    // Hard 12 vs 4 → stand
    assert(basicStrategy([{rank:'7',suit:'S'},{rank:'5',suit:'H'}], {rank:'4',suit:'D'}, defRules) === 'S', 'BS hard 12 vs 4 = S');

    // ── Full round settle ─────────────────────────────────
    {
      const shoe = newShoe(6);
      const round = startRound({
        shoe,
        seats: [{ id:'p1', bet:100, sideBets:{ perfectPairs:10, twentyOnePlus3:10 } }],
        rules: RULES_DEFAULT
      });
      // Stand everything
      for (const seat of round.seats) for (const hand of seat.hands) hand.done = true;
      dealerPlay(round);
      settle(round);
      assert(round.seats[0].results !== null, 'settle sets results');
      assert(typeof round.seats[0].results.totalNet === 'number', 'results.totalNet is number');
    }

    // ── Surrender net ─────────────────────────────────────
    {
      const shoe = newShoe(6);
      const round = startRound({ shoe, seats:[{id:'p1',bet:100,sideBets:{}}], rules:RULES_DEFAULT });
      // Force player hard 16 vs T (classic surrender spot)
      round.seats[0].hands[0].cards = [{rank:'9',suit:'S'},{rank:'7',suit:'H'}];
      surrender(round, 'p1');
      for (const hand of round.seats[0].hands) hand.done = true;
      dealerPlay(round);
      settle(round);
      assert(round.seats[0].results.hands[0].net === -0.5, 'surrender net = -0.5');
    }

    console.log('BJ selfTest PASS — all assertions passed');
  }

  // ─────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────

  global.BJ = {
    RULES_DEFAULT,

    // Shoe
    newShoe,

    // Round lifecycle
    startRound,
    dealerPlay,
    settle,

    // Player actions
    hit,
    stand,
    double,
    split,
    surrender,
    insurance,

    // Helpers
    handValue,
    isBlackjack,
    basicStrategy,
    trueCount,

    // QA
    selfTest,

    // Internals exposed for testing / AI bots
    _evalPerfectPairs,
    _evalTwentyOnePlus3
  };

})(typeof window !== 'undefined' ? window : global);
