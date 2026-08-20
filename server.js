// Nightbot Stats Tracker
// A tiny HTTP API for tracking wins, losses, and MMR that Nightbot can call
// via $(urlfetch ...) from custom chat commands.
//
// Run locally:  npm install && npm start
// Deploy it somewhere with a public HTTPS URL (Railway, Render, etc.)
// so Nightbot can reach it.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'change-me'; // used to protect write actions

// Railway automatically sets RAILWAY_VOLUME_MOUNT_PATH when a volume is
// attached to this service — write stats.json there so it survives
// redeploys. Falls back to the local folder for local development.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'stats.json');

// A "session" auto-resets after this many hours of no win/loss/MMR activity —
// meant to roughly line up with "since I started streaming today". Override
// with the SESSION_TIMEOUT_HOURS env var if you want a different cutoff.
const SESSION_TIMEOUT_MS = (parseFloat(process.env.SESSION_TIMEOUT_HOURS) || 6) * 60 * 60 * 1000;

// ---- persistence helpers ----

function defaultStats() {
  return {
    wins: 0,
    losses: 0,
    mmr: 0,
    oopsAllScorpions: 0,
    session: {
      wins: 0,
      losses: 0,
      mmrChange: 0,
      startedAt: Date.now(),
      lastActivity: Date.now(),
    },
  };
}

function loadStats() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = defaultStats();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const stats = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Backfill in case this is an old stats.json from before sessions existed.
  if (!stats.session) {
    stats.session = defaultStats().session;
  }
  if (typeof stats.oopsAllScorpions !== 'number') {
    stats.oopsAllScorpions = 0;
  }
  return stats;
}

function saveStats(stats) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
}

// Call this before applying any win/loss/MMR change. If enough time has
// passed since the last change, treat it as the start of a new stream
// session and zero out the session-only counters.
function rolloverSessionIfStale(stats) {
  const now = Date.now();
  if (now - stats.session.lastActivity > SESSION_TIMEOUT_MS) {
    stats.session = {
      wins: 0,
      losses: 0,
      mmrChange: 0,
      startedAt: now,
      lastActivity: now,
    };
  }
}

function formatStats(stats) {
  const total = stats.wins + stats.losses;
  const winrate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
  return `Record: ${stats.wins}W - ${stats.losses}L (${winrate}%) | MMR: ${stats.mmr} | Oops All Scorpions: ${stats.oopsAllScorpions}`;
}

function formatSession(stats) {
  const s = stats.session;
  const total = s.wins + s.losses;
  if (total === 0 && s.mmrChange === 0) {
    return `No games recorded yet this session. | Oops All Scorpions: ${stats.oopsAllScorpions}`;
  }
  const winrate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0.0';
  const sign = s.mmrChange >= 0 ? '+' : '';
  return `Session: ${s.wins}W - ${s.losses}L (${winrate}%) | MMR: ${sign}${s.mmrChange} | Oops All Scorpions: ${stats.oopsAllScorpions}`;
}

// ---- auth guard for write endpoints ----

function requireKey(req, res, next) {
  if (req.query.key !== SECRET_KEY) {
    return res.status(403).send('Forbidden: bad or missing key');
  }
  next();
}

// Parses the free-form text after !win / !loss (e.g. "25 Y", "Y", "25", "")
// into an optional MMR amount and a yes/no "did a scorpion happen" flag.
// Order-independent and works with either token missing.
function parseWinLossArgs(raw) {
  const tokens = (raw || '').trim().split(/\s+/).filter(Boolean);
  let amount = null;
  let oops = false;
  for (const token of tokens) {
    if (/^-?\d+$/.test(token)) {
      amount = parseInt(token, 10);
    } else if (/^y(es)?$/i.test(token)) {
      oops = true;
    } else if (/^n(o)?$/i.test(token)) {
      oops = false;
    }
  }
  return { amount, oops };
}

// ---- routes ----

// GET /api/stats -> lifetime record, read-only, safe for anyone to trigger
app.get('/api/stats', (req, res) => {
  const stats = loadStats();
  res.type('text/plain').send(formatStats(stats));
});

// GET /api/session -> current-stream-session record only, read-only
app.get('/api/session', (req, res) => {
  const stats = loadStats();
  res.type('text/plain').send(formatSession(stats));
});

// GET /api/winrate -> lifetime winrate only, read-only
app.get('/api/winrate', (req, res) => {
  const stats = loadStats();
  const total = stats.wins + stats.losses;
  const winrate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
  res.type('text/plain').send(`Winrate: ${winrate}% (${stats.wins}W - ${stats.losses}L)`);
});

// GET /api/session/winrate -> winrate for the current stream session only
app.get('/api/session/winrate', (req, res) => {
  const stats = loadStats();
  const s = stats.session;
  const total = s.wins + s.losses;
  const winrate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0.0';
  res.type('text/plain').send(`Session winrate: ${winrate}% (${s.wins}W - ${s.losses}L)`);
});

// ---- "Oops All Scorpions" counter ----
// A fully independent counter — not tied to wins/losses/MMR or sessions,
// just a running total you can bump up or down whenever it happens.

// GET /api/oopsallscorpions -> read-only, current count
app.get('/api/oopsallscorpions', (req, res) => {
  const stats = loadStats();
  res.type('text/plain').send(`Oops All Scorpions: ${stats.oopsAllScorpions}`);
});

// GET /api/oopsallscorpions/add?key=SECRET&amount=1 -> increments the count.
// amount defaults to 1 if omitted or invalid.
app.get('/api/oopsallscorpions/add', requireKey, (req, res) => {
  const amount = parseInt(req.query.amount, 10);
  const delta = isNaN(amount) ? 1 : amount;

  const stats = loadStats();
  stats.oopsAllScorpions += delta;
  saveStats(stats);

  res.type('text/plain').send(`🦂 Oops All Scorpions: ${stats.oopsAllScorpions}`);
});

// GET /api/oopsallscorpions/remove?key=SECRET&amount=1 -> decrements the
// count. amount defaults to 1 if omitted or invalid. Floors at 0.
app.get('/api/oopsallscorpions/remove', requireKey, (req, res) => {
  const amount = parseInt(req.query.amount, 10);
  const delta = isNaN(amount) ? 1 : amount;

  const stats = loadStats();
  stats.oopsAllScorpions = Math.max(0, stats.oopsAllScorpions - delta);
  saveStats(stats);

  res.type('text/plain').send(`🦂 Oops All Scorpions: ${stats.oopsAllScorpions}`);
});

// GET /api/win?key=SECRET&args=25%20Y
// Default combined behavior: records a win AND, if an amount is present in
// `args`, applies it as an MMR gain in the same call. A trailing Y/N in
// `args` also logs whether an Oops All Scorpions moment happened.
// Examples of `args`: "25 Y", "Y", "25", "" (any order, either part optional).
// `amount` is still accepted on its own for backward compatibility.
app.get('/api/win', requireKey, (req, res) => {
  const stats = loadStats();
  rolloverSessionIfStale(stats);

  stats.wins += 1;
  stats.session.wins += 1;

  const { amount: parsedAmount, oops } = parseWinLossArgs(req.query.args);
  const legacyAmount = parseInt(req.query.amount, 10);
  const amount = parsedAmount !== null ? parsedAmount : (isNaN(legacyAmount) ? null : legacyAmount);
  const hasMmr = amount !== null;
  if (hasMmr) {
    stats.mmr += amount;
    stats.session.mmrChange += amount;
  }
  if (oops) {
    stats.oopsAllScorpions += 1;
  }

  stats.session.lastActivity = Date.now();
  saveStats(stats);

  const mmrNote = hasMmr ? ` (+${amount} MMR)` : '';
  const oopsNote = oops ? ` (+1 Oops All Scorpions)` : '';
  res.type('text/plain').send(`✅ Win added!${mmrNote}${oopsNote} ${formatStats(stats)}`);
});

// GET /api/loss?key=SECRET&args=18%20Y
// Default combined behavior: records a loss AND, if an amount is present in
// `args`, subtracts it from MMR in the same call. A trailing Y/N in `args`
// also logs whether an Oops All Scorpions moment happened.
// Examples of `args`: "18 Y", "Y", "18", "" (any order, either part optional).
// `amount` is still accepted on its own for backward compatibility.
app.get('/api/loss', requireKey, (req, res) => {
  const stats = loadStats();
  rolloverSessionIfStale(stats);

  stats.losses += 1;
  stats.session.losses += 1;

  const { amount: parsedAmount, oops } = parseWinLossArgs(req.query.args);
  const legacyAmount = parseInt(req.query.amount, 10);
  const amount = parsedAmount !== null ? parsedAmount : (isNaN(legacyAmount) ? null : legacyAmount);
  const hasMmr = amount !== null;
  if (hasMmr) {
    stats.mmr -= amount;
    stats.session.mmrChange -= amount;
  }
  if (oops) {
    stats.oopsAllScorpions += 1;
  }

  stats.session.lastActivity = Date.now();
  saveStats(stats);

  const mmrNote = hasMmr ? ` (-${amount} MMR)` : '';
  const oopsNote = oops ? ` (+1 Oops All Scorpions)` : '';
  res.type('text/plain').send(`❌ Loss added!${mmrNote}${oopsNote} ${formatStats(stats)}`);
});

// GET /api/mmrup?key=SECRET&amount=25 -> adjusts MMR only, no win/loss change
app.get('/api/mmrup', requireKey, (req, res) => {
  const amount = parseInt(req.query.amount, 10);
  if (isNaN(amount)) return res.status(400).send('amount must be a number');

  const stats = loadStats();
  rolloverSessionIfStale(stats);

  stats.mmr += amount;
  stats.session.mmrChange += amount;
  stats.session.lastActivity = Date.now();
  saveStats(stats);

  res.type('text/plain').send(`📈 MMR +${amount}! ${formatStats(stats)}`);
});

// GET /api/mmrdown?key=SECRET&amount=18 -> adjusts MMR only, no win/loss change
app.get('/api/mmrdown', requireKey, (req, res) => {
  const amount = parseInt(req.query.amount, 10);
  if (isNaN(amount)) return res.status(400).send('amount must be a number');

  const stats = loadStats();
  rolloverSessionIfStale(stats);

  stats.mmr -= amount;
  stats.session.mmrChange -= amount;
  stats.session.lastActivity = Date.now();
  saveStats(stats);

  res.type('text/plain').send(`📉 MMR -${amount}! ${formatStats(stats)}`);
});

// GET /api/mmrset?key=SECRET&value=1500 -> sets MMR to an exact value,
// no win/loss change. Session MMR-change tracks the delta this creates.
app.get('/api/mmrset', requireKey, (req, res) => {
  const value = parseInt(req.query.value, 10);
  if (isNaN(value)) return res.status(400).send('value must be a number');

  const stats = loadStats();
  rolloverSessionIfStale(stats);

  const delta = value - stats.mmr;
  stats.mmr = value;
  stats.session.mmrChange += delta;
  stats.session.lastActivity = Date.now();
  saveStats(stats);

  res.type('text/plain').send(`🎯 MMR set to ${value}! ${formatStats(stats)}`);
});

// GET /api/newsession?key=SECRET -> manually starts a fresh session now,
// useful if you want to reset session stats without waiting for the
// inactivity timeout (e.g. going live again same day).
app.get('/api/newsession', requireKey, (req, res) => {
  const stats = loadStats();
  const now = Date.now();
  stats.session = { wins: 0, losses: 0, mmrChange: 0, startedAt: now, lastActivity: now };
  saveStats(stats);
  res.type('text/plain').send('🆕 New session started! Session stats reset to zero.');
});

// GET /api/reset?key=SECRET -> resets everything (lifetime + session) to zero
app.get('/api/reset', requireKey, (req, res) => {
  const stats = defaultStats();
  saveStats(stats);
  res.type('text/plain').send(`🔄 Stats reset. ${formatStats(stats)}`);
});

app.listen(PORT, () => {
  console.log(`Nightbot stats server running on port ${PORT}`);
});
