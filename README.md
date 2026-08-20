# Nightbot Win/Loss/MMR Tracker

Nightbot doesn't have built-in persistent storage for custom stats, so this
gives it one: a tiny web API that stores your wins, losses, and MMR, which
Nightbot calls using its `$(urlfetch ...)` variable.

## 1. Set up the server

```bash
npm install
```

Set a secret key locally to test (protects your `!win`, `!loss`, `!mmr`
write commands from being spammed by random viewers who find your URL):

```bash
export SECRET_KEY=some-long-random-string
npm start
```

This runs locally on port 3000. Nightbot needs a **public HTTPS URL**, so
you'll deploy it to Railway.

### Deploying to Railway

1. **Push this folder to a GitHub repo.** Create a new repo (public or
   private) and push `server.js`, `package.json`, and this README to it.

2. **Create a Railway project from that repo.** Go to
   [railway.app](https://railway.app), sign in with GitHub, click
   **New Project → Deploy from GitHub repo**, and pick your repo. Railway
   detects it's a Node app and builds it automatically — no Dockerfile
   needed.

3. **Set the `SECRET_KEY` environment variable.** In your new service, open
   the **Variables** tab and add `SECRET_KEY` with a long random value.
   You'll reuse this value in your Nightbot command URLs.

4. **Attach a Volume for persistent storage.** Still in the service, go to
   the **Volumes** tab (or right-click the service on the canvas → **Attach
   Volume**) and mount it at `/data`. This is important — without it,
   `stats.json` gets wiped every time you redeploy. The server code already
   checks for Railway's `RAILWAY_VOLUME_MOUNT_PATH` variable and writes
   `stats.json` there automatically when a volume is attached.

5. **Generate a public domain.** Go to the **Settings** tab of your service
   → **Networking** → **Generate Domain**. Railway gives you a free
   `*.up.railway.app` URL — this is what Nightbot will call.

6. **Test it.** Visit `https://your-app.up.railway.app/api/stats` in a
   browser — you should see `Record: 0W - 0L (0.0%) | MMR: 0`. Then try
   `https://your-app.up.railway.app/api/win?key=YOUR_SECRET_KEY` and check
   that the win count went up.

7. **Redeploy to confirm persistence.** Trigger a redeploy (push a small
   commit, or click **Redeploy** in the dashboard) and check `/api/stats`
   again — your win should still be there. If it reset to zero, double
   check the volume is mounted at `/data` and the service has restarted
   since you attached it.

Every future `git push` to your repo auto-redeploys the service, and your
stats persist across those redeploys thanks to the volume.

## 2. Test it

Visit these in a browser (replace with your real URL and key):

- `https://your-app.onrender.com/api/stats` — should show `Record: 0W - 0L (0.0%) | MMR: 0`
- `https://your-app.onrender.com/api/win?key=YOUR_SECRET_KEY` — adds a win

## 3. Add the Nightbot commands

Go to the [Nightbot dashboard](https://nightbot.tv/dashboard/commands) →
Commands → Add Command, and create these (swap in your real Railway URL
and secret key):

| Command | Message | User level |
|---|---|---|
| `!win` | `$(urlfetch https://your-app.up.railway.app/api/win?key=YOUR_SECRET_KEY&amount=$(1))` | Moderator |
| `!loss` | `$(urlfetch https://your-app.up.railway.app/api/loss?key=YOUR_SECRET_KEY&amount=$(1))` | Moderator |
| `!mmrup` | `$(urlfetch https://your-app.up.railway.app/api/mmrup?key=YOUR_SECRET_KEY&amount=$(1))` | Moderator |
| `!mmrdown` | `$(urlfetch https://your-app.up.railway.app/api/mmrdown?key=YOUR_SECRET_KEY&amount=$(1))` | Moderator |
| `!mmrset` | `$(urlfetch https://your-app.up.railway.app/api/mmrset?key=YOUR_SECRET_KEY&value=$(1))` | Moderator |
| `!record` | `$(urlfetch https://your-app.up.railway.app/api/stats)` | Everyone |
| `!session` | `$(urlfetch https://your-app.up.railway.app/api/session)` | Everyone |
| `!newsession` | `$(urlfetch https://your-app.up.railway.app/api/newsession?key=YOUR_SECRET_KEY)` | Moderator |
| `!resetstats` | `$(urlfetch https://your-app.up.railway.app/api/reset?key=YOUR_SECRET_KEY)` | Moderator |

### Usage in chat

**`!win` and `!loss` are combined by default** — give them an MMR amount and
they update your win/loss count *and* your MMR in one command:

- `!win 25` → records a win **and** adds 25 MMR in one go
- `!loss 18` → records a loss **and** subtracts 18 MMR in one go

Leave the amount off and they just update the win/loss count, MMR untouched:

- `!win` → records a win only
- `!loss` → records a loss only

**MMR-only commands** still exist separately for whenever you want to adjust
MMR without it counting as a win or loss (placement changes, corrections,
decay, etc.):

- `!mmrup 25` → adds 25 MMR, no win/loss change
- `!mmrdown 18` → subtracts 18 MMR, no win/loss change
- `!mmrset 1500` → sets MMR to exactly 1500, no win/loss change

**Session tracking:**

- `!record` → shows your all-time record and current MMR (anyone can use this)
- `!session` → shows wins/losses/MMR change *for the current stream session
  only*, e.g. `Session: 3W - 1L (75.0%) | MMR: +42`
- A session automatically resets itself after 6 hours of no win/loss/MMR
  activity, so it lines up with "since I went live today" without you having
  to do anything. Change this window with the `SESSION_TIMEOUT_HOURS`
  environment variable (e.g. `SESSION_TIMEOUT_HOURS=4`) if 6 hours doesn't
  fit your schedule.
- `!newsession` lets you force a fresh session manually — handy if you go
  live more than once in the same day and don't want to wait for the
  timeout.

Setting write commands to "Moderator" level keeps viewers from spamming your
wins/losses — only you or your mods can trigger them, ideally right after
each match.

## 4. Optional tweaks

- Change the emoji/wording in `server.js`'s response strings to match your style.
- Add a `!winrate` command that also hits `/api/stats` if you want a
  separate alias.
- If you'd rather not run your own server at all, an alternative is using a
  spreadsheet-backed API service (e.g. one that turns a Google Sheet into a
  REST endpoint) and pointing the same Nightbot commands at that instead —
  useful if you want to edit stats by hand sometimes too.
