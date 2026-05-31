const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

let games = {};
let players = {};

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function newDeck() {
  let d = [];
  for (let s of SUITS) for (let r of RANKS) d.push({ r, s, v: r === 'A' ? 11 : (['J','Q','K'].includes(r) ? 10 : +r) });
  for (let i = d.length - 1; i > 0; i--) { let j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function hv(hand) { let v = 0, a = 0; hand.forEach(c => { v += c.v; if (c.r === 'A') a++; }); while (v > 21 && a > 0) { v -= 10; a--; } return v; }
function bj(hand) { return hand.length === 2 && hv(hand) === 21; }

// AI Agent strategies
const AGENT_STRATS = {
  neo: { name: 'NEO', style: 'Aggressive', hitUntil: 18, doubleOn: 10, aggressive: true },
  cipher: { name: 'CIPHER', style: 'Conservative', hitUntil: 13, doubleOn: 11, aggressive: false },
  viper: { name: 'VIPER', style: 'Lucky', hitUntil: 0, doubleOn: 9, aggressive: false },
  ghost: { name: 'GHOST', style: 'Random', hitUntil: 0, doubleOn: 10, aggressive: false },
  turtle: { name: 'TURTLE', style: 'Math', hitUntil: 0, doubleOn: 11, aggressive: false },
  phoenix: { name: 'PHOENIX', style: 'High Roller', hitUntil: 17, doubleOn: 9, aggressive: true },
  shadow: { name: 'SHADOW', style: 'Stealth', hitUntil: 14, doubleOn: 10, aggressive: false },
};

function getAgentDecision(agentId, hand, dealerUpcard) {
  const agent = AGENT_STRATS[agentId];
  if (!agent) return 'stand';
  const v = hv(hand);
  
  if (agent.style === 'Random') {
    const r = Math.random();
    if (r < 0.35) return 'hit';
    if (r < 0.45 && hand.length === 2) return 'double';
    return 'stand';
  }
  
  if (agent.style === 'Lucky') {
    const r = Math.random();
    if (r < 0.5 && v < 21) return 'hit';
    if (r > 0.85 && hand.length === 2 && v >= 9 && v <= 11) return 'double';
    return 'stand';
  }
  
  if (agent.style === 'Math') {
    // Basic strategy approach
    if (v <= 11 && hand.length === 2) return 'double';
    if (v <= 16) return 'hit';
    if (v === 17 && hand.length === 2 && dealerUpcard >= 7) return 'hit';
    return 'stand';
  }
  
  if (agent.aggressive) {
    if (v <= agent.hitUntil) return 'hit';
    if (v >= 9 && v <= 11 && hand.length === 2 && Math.random() > 0.3) return 'double';
    return 'stand';
  }
  
  // Conservative
  if (v < agent.hitUntil) return 'hit';
  if (v <= agent.doubleOn && hand.length === 2 && Math.random() > 0.5) return 'double';
  return 'stand';
}

function shuffleArray(a) { for (let i = a.length - 1; i > 0; i--) { let j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

app.post('/api/create-game', (req, res) => {
  const { playerName, buyIn, mode } = req.body;
  const gameId = Math.random().toString(36).substr(2, 8).toUpperCase();
  games[gameId] = {
    id: gameId,
    deck: newDeck(),
    dealer: [],
    players: [],
    phase: 'betting',
    pot: 0,
    mode: mode || 'arcade',
    createdAt: Date.now(),
    tournament: mode === 'tourney' ? {
      entryFee: 500,
      prizePool: 0,
      round: 1,
      maxRounds: 5,
      finished: false,
      leaderboard: [],
    } : null,
  };
  players[gameId] = {};
  res.json({ gameId, message: 'Game created' });
});

app.post('/api/join-game', (req, res) => {
  const { gameId, playerName, buyIn } = req.body;
  if (!games[gameId]) return res.status(404).json({ error: 'Game not found' });
  const player = { id: Date.now().toString(), name: playerName, chips: buyIn, bet: 0, hands: [], ready: false, isAgent: false };
  games[gameId].players.push(player);
  io.to(gameId).emit('player-joined', player);
  res.json({ player, game: games[gameId] });
});

app.post('/api/join-agent', (req, res) => {
  const { gameId, agentId } = req.body;
  if (!games[gameId]) return res.status(404).json({ error: 'Game not found' });
  const agentDef = AGENT_STRATS[agentId];
  if (!agentDef) return res.status(400).json({ error: 'Unknown agent' });
  const agent = {
    id: 'agent_' + agentId + '_' + Date.now(),
    name: agentDef.name,
    chips: 5000,
    bet: 0,
    hands: [],
    ready: false,
    isAgent: true,
    agentId: agentId,
    agentStyle: agentDef.style,
  };
  games[gameId].players.push(agent);
  io.to(gameId).emit('player-joined', agent);
  res.json({ player: agent, game: games[gameId] });
});

app.post('/api/place-bet', (req, res) => {
  const { gameId, playerId, bet } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.chips < bet) return res.status(400).json({ error: 'Insufficient chips' });
  player.chips -= bet;
  player.bet = bet;
  if (game.mode === 'tourney' && game.tournament) {
    game.tournament.prizePool += bet;
  }
  io.to(gameId).emit('bet-placed', { playerId, bet, chips: player.chips });
  res.json({ success: true, chips: player.chips });
});

app.post('/api/start-hand', (req, res) => {
  const { gameId } = req.body;
  const game = games[gameId];
  game.deck = newDeck();
  game.dealer = [];
  game.players.forEach(p => { p.hands = [{ cards: [], done: false, bet: p.bet }]; p.bet = 0; });
  
  game.dealer.push(game.deck.pop());
  game.players.forEach(p => p.hands[0].cards.push(game.deck.pop()));
  game.dealer.push(game.deck.pop());
  game.players.forEach(p => p.hands[0].cards.push(game.deck.pop()));
  
  io.to(gameId).emit('hand-started', { dealer: game.dealer, players: game.players });
  res.json({ success: true });
});

app.post('/api/hit', (req, res) => {
  const { gameId, playerId, handIndex } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  
  const hand = player.hands[handIndex];
  hand.cards.push(game.deck.pop());
  
  if (hv(hand) > 21) hand.done = true;
  
  io.to(gameId).emit('card-dealt', { playerId, handIndex, card: hand.cards[hand.cards.length - 1] });
  res.json({ hand });
});

app.post('/api/stand', (req, res) => {
  const { gameId, playerId, handIndex } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (player) { player.hands[handIndex].done = true; }
  io.to(gameId).emit('player-stood', { playerId, handIndex });
  res.json({ success: true });
});

app.post('/api/split', (req, res) => {
  const { gameId, playerId, handIndex } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.chips < player.hands[handIndex].bet) return res.status(400).json({ error: 'Insufficient chips for split' });
  if (player.hands[handIndex].cards.length !== 2) return res.status(400).json({ error: 'Can only split with 2 cards' });
  if (player.hands[handIndex].cards[0].r !== player.hands[handIndex].cards[1].r) return res.status(400).json({ error: 'Cards must match' });
  
  const ogBet = player.hands[handIndex].bet;
  player.chips -= ogBet;
  
  const hand1 = { cards: [player.hands[handIndex].cards[0], game.deck.pop()], done: false, bet: ogBet };
  const hand2 = { cards: [player.hands[handIndex].cards[1], game.deck.pop()], done: false, bet: ogBet };
  
  if (hand1.cards[0].r === 'A') { hand1.done = true; hand2.done = true; }
  
  player.hands[handIndex] = hand1;
  player.hands.push(hand2);
  
  io.to(gameId).emit('player-split', { playerId, handIndex });
  res.json({ success: true, hands: player.hands, chips: player.chips });
});

app.post('/api/surrender', (req, res) => {
  const { gameId, playerId, handIndex } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  
  const hand = player.hands[handIndex];
  const refund = Math.floor(hand.bet / 2);
  player.chips += refund;
  hand.done = true;
  hand.result = 'surrender';
  
  io.to(gameId).emit('player-surrendered', { playerId, handIndex, refund });
  res.json({ success: true, chips: player.chips });
});

app.post('/api/double', (req, res) => {
  const { gameId, playerId, handIndex } = req.body;
  const game = games[gameId];
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.chips < player.hands[handIndex].bet) return res.status(400).json({ error: 'Insufficient chips' });
  
  player.chips -= player.hands[handIndex].bet;
  player.hands[handIndex].bet *= 2;
  player.hands[handIndex].cards.push(game.deck.pop());
  player.hands[handIndex].done = true;
  io.to(gameId).emit('player-doubled', { playerId, handIndex, bet: player.hands[handIndex].bet });
  res.json({ success: true, hand: player.hands[handIndex], chips: player.chips });
});

app.post('/api/agent-play', async (req, res) => {
  const { gameId } = req.body;
  const game = games[gameId];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  
  const agents = game.players.filter(p => p.isAgent);
  for (const agent of agents) {
    const dealerUpcard = game.dealer.length > 0 ? game.dealer[0].v : 10;
    
    for (let hi = 0; hi < agent.hands.length; hi++) {
      const hand = agent.hands[hi];
      if (hand.done) continue;
      if (hv(hand) === 21) { hand.done = true; continue; }
      
      let maxActions = 5;
      while (!hand.done && maxActions > 0) {
        maxActions--;
        const decision = getAgentDecision(agent.agentId, hand.cards, dealerUpcard);
        
        if (decision === 'hit') {
          await new Promise(r => setTimeout(r, 300));
          hand.cards.push(game.deck.pop());
          io.to(gameId).emit('card-dealt', { playerId: agent.id, handIndex: hi, card: hand.cards[hand.cards.length - 1] });
          if (hv(hand) > 21) { hand.done = true; break; }
        } else if (decision === 'double' && hand.cards.length === 2 && agent.chips >= hand.bet) {
          await new Promise(r => setTimeout(r, 300));
          agent.chips -= hand.bet;
          hand.bet *= 2;
          hand.cards.push(game.deck.pop());
          hand.done = true;
          io.to(gameId).emit('player-doubled', { playerId: agent.id, handIndex: hi, bet: hand.bet });
          break;
        } else {
          hand.done = true;
          io.to(gameId).emit('player-stood', { playerId: agent.id, handIndex: hi });
          break;
        }
      }
      hand.done = true;
    }
  }
  
  res.json({ success: true, players: game.players });
});

app.post('/api/dealer-play', (req, res) => {
  const { gameId } = req.body;
  const game = games[gameId];
  
  while (hv(game.dealer) < 17) { game.dealer.push(game.deck.pop()); }
  
  const dv = hv(game.dealer);
  game.players.forEach(p => {
    p.hands.forEach(hand => {
      const pv = hv(hand.cards);
      if (hand.result === 'surrender') return;
      if (pv > 21) hand.result = 'bust';
      else if (dv > 21) { hand.result = 'win'; p.chips += hand.bet * 2; }
      else if (pv > dv) { hand.result = 'win'; p.chips += hand.bet * 2; }
      else if (pv === dv) { hand.result = 'push'; p.chips += hand.bet; }
      else hand.result = 'lose';
    });
  });
  
  // Update tournament leaderboard
  if (game.mode === 'tourney' && game.tournament) {
    game.tournament.leaderboard = game.players
      .map(p => ({ name: p.name, chips: p.chips }))
      .sort((a, b) => b.chips - a.chips);
    if (game.tournament.round < game.tournament.maxRounds) {
      game.tournament.round++;
    } else {
      game.tournament.finished = true;
    }
  }
  
  io.to(gameId).emit('hand-ended', { dealer: game.dealer, players: game.players, tournament: game.tournament });
  res.json({ dealer: game.dealer, players: game.players, tournament: game.tournament });
});

app.get('/api/game/:gameId', (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

app.get('/api/agents', (req, res) => {
  const list = Object.entries(AGENT_STRATS).map(([id, def]) => ({ id, ...def }));
  res.json(list);
});

app.post('/api/tournament/start', (req, res) => {
  const { gameId } = req.body;
  const game = games[gameId];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.mode !== 'tourney') return res.status(400).json({ error: 'Not a tournament game' });
  
  // Add AI agents to fill the table
  const agentIds = Object.keys(AGENT_STRATS);
  const shuffled = shuffleArray([...agentIds]);
  const numAgents = Math.min(3, shuffled.length);
  for (let i = 0; i < numAgents; i++) {
    const agentDef = AGENT_STRATS[shuffled[i]];
    const agent = {
      id: 'agent_' + shuffled[i] + '_' + Date.now() + '_' + i,
      name: agentDef.name,
      chips: 5000,
      bet: 0,
      hands: [],
      ready: true,
      isAgent: true,
      agentId: shuffled[i],
      agentStyle: agentDef.style,
    };
    game.players.push(agent);
    game.tournament.prizePool += 500;
  }
  
  io.to(gameId).emit('tournament-started', { players: game.players, tournament: game.tournament });
  res.json({ success: true, players: game.players, tournament: game.tournament });
});

io.on('connection', (socket) => {
  socket.on('join-room', (gameId) => { socket.join(gameId); });
  socket.on('leave-room', (gameId) => { socket.leave(gameId); });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Blackjack server running on port ${PORT}`));
