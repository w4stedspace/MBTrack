// Nightbot Stats Tracker
// A tiny HTTP API for tracking wins, losses, and MMR that Nightbot can call
// via $(urlfetch ...) from custom chat commands.
//
// Run locally:  npm install && npm start
// Deploy it somewhere with a public HTTPS URL (Render, Railway, Fly.io, etc.)
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

// ---- persistence helpers ----

function loadStats() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { wins: 0, losses: 0, mmr: 0 };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveStats(stats) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
}

function formatStats(stats) {
  const total = stats.wins + stats.losses;
  const winrate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
  return `Record: ${stats.wins}W - ${stats.losses}L (${winrate}%) | MMR: ${stats.mmr}`;
}

// ---- auth guard for write endpoints ----

function requireKey(req, res, next) {
  if (req.query.key !== SECRET_KEY) {
    return res.status(403).send('Forbidden: bad or missing key');
  }
  next();
}

// ---- routes ----

// GET /api/stats -> read-only, safe for anyone to trigger
app.get('/api/stats', (req, res) => {
  const stats = loadStats();
  res.type('text/plain').send(formatStats(stats));
});

// GET /api/win?key=SECRET -> increments wins
app.get('/api/win', requireKey, (req, res) => {
  const stats = loadStats();
  stats.wins += 1;
  saveStats(stats);
  res.type('text/plain').send(`✅ Win added! ${formatStats(stats)}`);
});

// GET /api/loss?key=SECRET -> increments losses
app.get('/api/loss', requireKey, (req, res) => {
  const stats = loadStats();
  stats.losses += 1;
  saveStats(stats);
  res.type('text/plain').send(`❌ Loss added! ${formatStats(stats)}`);
});

// GET /api/mmr/up/:amount?key=SECRET -> adds to MMR
app.get('/api/mmr/up/:amount', requireKey, (req, res) => {
  const amount = parseInt(req.params.amount, 10);
  if (isNaN(amount)) return res.status(400).send('Amount must be a number');
  const stats = loadStats();
  stats.mmr += amount;
  saveStats(stats);
  res.type('text/plain').send(`📈 MMR +${amount}! ${formatStats(stats)}`);
});

// GET /api/mmr/down/:amount?key=SECRET -> subtracts from MMR
app.get('/api/mmr/down/:amount', requireKey, (req, res) => {
  const amount = parseInt(req.params.amount, 10);
  if (isNaN(amount)) return res.status(400).send('Amount must be a number');
  const stats = loadStats();
  stats.mmr -= amount;
  saveStats(stats);
  res.type('text/plain').send(`📉 MMR -${amount}! ${formatStats(stats)}`);
});

// GET /api/mmr/set/:value?key=SECRET -> sets MMR to an exact value
app.get('/api/mmr/set/:value', requireKey, (req, res) => {
  const value = parseInt(req.params.value, 10);
  if (isNaN(value)) return res.status(400).send('Value must be a number');
  const stats = loadStats();
  stats.mmr = value;
  saveStats(stats);
  res.type('text/plain').send(`🎯 MMR set to ${value}! ${formatStats(stats)}`);
});

// GET /api/reset?key=SECRET -> resets everything to zero
app.get('/api/reset', requireKey, (req, res) => {
  const stats = { wins: 0, losses: 0, mmr: 0 };
  saveStats(stats);
  res.type('text/plain').send(`🔄 Stats reset. ${formatStats(stats)}`);
});

app.listen(PORT, () => {
  console.log(`Nightbot stats server running on port ${PORT}`);
});
