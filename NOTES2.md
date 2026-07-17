# Backend Notes 2 — Your First Server & Deploying It to Production

> **Project:** [`index.js`](index.js) — a four-route Express server, built to be deployed.

NOTES1 was the map. This is the first territory: create a Node project, write a real
server in ~20 lines, and put it on the internet where someone else can hit the URL.

---

## 0. Big Picture (read this first)

The whole point of this step isn't the routes — it's the **last mile**. Code that runs on
your laptop and code that runs in production are the *same code* with **different
configuration**. Everything below exists to make that sentence true.

> 🧠 **Interview line:** "Deployment isn't a separate build of the app. It's the same
> code, given different environment variables, on a machine I don't own. If those two
> versions differ by anything other than config, I've done it wrong."

---

## 1. Starting a Node Project — `npm init`

```bash
npm init          # asks questions, writes package.json
npm init -y       # accepts every default
npm i express dotenv
```

`npm init` creates **`package.json`** — the project's ID card (NOTES1 §5). It's the file
that makes a folder a *project* rather than a pile of `.js` files.

The fields that actually matter:

| Field | Job |
|---|---|
| `main` | The entry point — which file *is* the app (`index.js`) |
| `scripts` | Named commands: `npm start` → `node index.js` |
| `dependencies` | What `npm install` reinstalls on the deploy server |
| `type` | `commonjs` (`require`) vs `module` (`import`) — **pick one, don't mix** |

> 💡 **`node_modules` is never committed.** `package.json` + `package-lock.json` are the
> *recipe*; `node_modules` is the *cooked meal*. The server runs `npm install` and cooks
> its own. That's why the lockfile matters — it pins exact versions so the server's build
> matches your laptop's.

---

## 2. The Server Itself

```js
require('dotenv').config()
const express = require('express')

const app = express()
const port = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
```

That's a server. Five lines of setup and it's already the "software, not a machine" from
NOTES1 §0 — a program listening on a port.

### The three pieces

| Piece | What it does |
|---|---|
| `express()` | Creates the app object — the thing that holds routes and middleware |
| `app.get(path, handler)` | Registers a **route**: "when a GET hits this URL, run this" |
| `app.listen(port, cb)` | **Binds to the port** and starts accepting requests |

### `req` and `res`

Every handler gets two objects, and they're the entire conversation:

- **`req`** — what *came in* (URL, headers, body, query params)
- **`res`** — what *goes back*. You **must** send something, or the request hangs forever.

```js
res.send('Hello World!')                     // string or HTML
res.send('<h1> Please login</h1>')           // Content-Type inferred: text/html
res.json({ name: 'Arpit' })                  // the real-world default for an API
res.status(404).json({ error: 'Not found' }) // status code + body, chained
```

> 🧠 **Interview line:** "A route handler has exactly one obligation: end the response.
> Every path through it must call `send`, `json`, or `next` — otherwise the client waits
> until it times out and you get a hang with no error in the logs."

---

## 3. `.env` and `dotenv` — the file that makes it deployable

```js
require('dotenv').config()   // FIRST line — before anything reads process.env
```

`dotenv` reads `.env` and loads each key into **`process.env`**, Node's global bag of
environment variables.

**Why it must be the first line:** `config()` mutates `process.env` at the moment it runs.
Any module imported *above* it that reads `process.env` at import time sees `undefined`.
This is a genuinely common bug — a database URL that's mysteriously empty.

### The `.env` / `.env.example` pair

| File | Committed? | Purpose |
|---|---|---|
| `.env` | ❌ **never** | The real secrets — your actual keys |
| `.env.example` | ✅ yes | The **shape**: which keys exist, with dummy values |

`.gitignore` must contain `.env` before your first commit. A secret pushed once is
compromised forever — deleting it later doesn't help, git history keeps it, and bots scrape
public repos for exactly this within minutes. **Rotate the key, don't just delete it.**

> 🧠 **Interview line:** "`.env` is ignored, `.env.example` is committed. A new developer
> clones the repo and instantly knows *which* variables to set without me leaking *what*
> they're set to."

---

## 4. `process.env.PORT` — the one that breaks every first deployment

```js
const port = process.env.PORT || 3000        // ✅
app.listen(port, () => console.log(`listening on ${port}`))
```

```js
app.listen(3000)                             // ❌ works locally, dies in production
```

**You do not choose the port in production. The host does.** The platform starts your
container, injects `PORT` into the environment, and routes public traffic to *that* port
only. Hardcode `3000` and the host's health check knocks on the port it assigned, finds
nothing listening, and kills your deploy as unhealthy.

`|| 3000` is the **local fallback** — for when `.env` is missing on your laptop. In
production the host always sets `PORT`, so the fallback never fires.

### The bug that was in this repo

```js
const port = 3000
app.listen(process.env.PORT, () => {
  console.log(`Example app listening on port ${port}`)   // ← lies
})
```

It **binds** to `process.env.PORT` (correct) but **logs** a hardcoded `3000` (wrong). Deploy
that and the log confidently reports port 3000 while the app is actually on 10000. Nothing
crashes — you just debug the wrong number. One variable, used for both, fixes it.

> 🧠 **Interview line:** "Any value that differs between laptop and production is
> configuration, not code — port, DB URL, API keys. If I'm editing a `.js` file to deploy,
> that value belonged in `.env`."

---

## 5. Deploying — what actually happens

The flow is the same on **Render**, **Railway**, **Vercel**, **Heroku**, or a raw VPS:

```
git push  →  host pulls repo  →  npm install  →  npm start  →  public URL
                                (build cmd)     (start cmd)
```

### What you configure in the dashboard

| Setting | Typical value | Why |
|---|---|---|
| **Build command** | `npm install` | Rebuilds `node_modules` from `package.json` |
| **Start command** | `npm start` | Runs your `scripts.start` → `node index.js` |
| **Root directory** | `.` or `./backend` | Where `package.json` lives, in a monorepo |
| **Environment variables** | `PORT`, DB URL, keys | **Your `.env` never shipped — retype them here** |

> 💡 **The step everyone forgets:** `.env` is gitignored, so it is *not* in the repo the
> host cloned. Every variable must be re-entered in the platform's dashboard. "It works
> locally but crashes on deploy" is, nine times out of ten, a missing env var.

### Auto-deploy

Connect the GitHub repo and every push to `main` triggers a fresh build. That's the
"continuous deployment" half of CI/CD — no manual upload step ever again.

> 🧠 **Interview line:** "The deploy server is a clean machine. It has my repo and my
> dashboard env vars — nothing else. Anything my app needs that isn't in one of those two
> places is a bug waiting for production."

---

## 6. Frontend + Backend Together — CORS and the proxy

Once the backend is live on its own URL, the frontend calling it hits **CORS**.

**Why:** the browser's **same-origin policy** blocks JS on `myapp.com` from reading a
response from `api-xyz.onrender.com` — different origin. It's the browser refusing, not
your server failing. (Origin = protocol + host + **port**, so `localhost:5173` →
`localhost:3000` is cross-origin too — same machine, still blocked.)

**Two fixes, for two different situations:**

```js
// Production: the server opts in, by sending the header the browser wants
const cors = require('cors')
app.use(cors({ origin: process.env.CORS_ORIGIN }))   // whitelist — not '*'
```

```js
// Local dev only: the dev server proxies, so the browser sees one origin
// vite.config.js
server: { proxy: { '/api': 'http://localhost:3000' } }
```

> 🧠 **Interview line:** "CORS is a *browser* rule, not a server error — Postman and curl
> ignore it entirely, which is why the endpoint 'works' there and fails in the browser. The
> fix is the server whitelisting the origin, and in production you whitelist your actual
> domain, never `*`."

---

## 7. Interview Questions & Answers

**Q1. What does `npm init` do?**
> Creates `package.json` — the project's ID card: entry point, scripts, and dependencies.
> `npm init -y` skips the questions and takes the defaults.

**Q2. Why isn't `node_modules` committed?**
> It's a rebuildable artifact — huge, and platform-specific. `package.json` +
> `package-lock.json` are the recipe; the deploy server runs `npm install` and rebuilds it.

**Q3. What is `app.listen()` actually doing?**
> Binding the process to a TCP port and starting the event loop listening for connections.
> That bind is the exact moment the program becomes "a server."

**Q4. Why `process.env.PORT` instead of `3000`?**
> The host assigns the port and routes traffic to it. Hardcoding means the platform's
> health check finds nothing on the port it expects, and kills the deploy.

**Q5. What does `|| 3000` fall back for, if production always sets `PORT`?**
> Local development, when `.env` is missing. In production it never fires.

**Q6. Why must `dotenv.config()` be the first line?**
> It loads `.env` into `process.env` *at the moment it runs*. Anything imported above it
> that reads `process.env` at import time gets `undefined`.

**Q7. `.env` is gitignored — so how does production get its variables?**
> You re-enter them in the host's dashboard. They live in the platform's environment, not
> the repo. That's the single most common cause of "works locally, breaks on deploy."

**Q8. What's `.env.example` for?**
> The committed *shape* of `.env` — key names with dummy values. It tells a new developer
> which variables to set without revealing any.

**Q9. Build command vs start command?**
> **Build** runs once per deploy to prepare the app (`npm install`). **Start** is the
> long-running process that serves traffic (`npm start`). Build finishes; start never does.

**Q10. What is CORS and whose rule is it?**
> The **browser's** same-origin policy blocking a cross-origin response. Not a server
> error — curl and Postman ignore it. Fix: the server whitelists the origin via the `cors`
> middleware.

**Q11. You pushed `.env` by accident. What now?**
> **Rotate every key in it.** Removing the file doesn't help — git history retains it and
> public repos are scraped within minutes. Treat the secrets as compromised, not recoverable.

**Q12. `res.send()` vs `res.json()`?**
> `send` infers the Content-Type (string → text, HTML → `text/html`). `json` always
> serializes and sets `application/json`. Real APIs use `json`.

---

## 8. Quick self-test (cover the answers above)

1. Which file makes a folder a Node *project*? *(`package.json`)*
2. Why is `node_modules` gitignored? *(rebuildable from the lockfile — server runs `npm install`)*
3. `app.listen(3000)` in production — what breaks? *(host assigned a different port; health check fails)*
4. Where must `dotenv.config()` go? *(first line — before anything reads `process.env`)*
5. `.env` is ignored — how does prod get the values? *(dashboard env vars)*
6. Build command vs start command? *(prepare once vs serve forever)*
7. CORS — server error or browser rule? *(browser; curl ignores it)*
8. What's the one obligation of a route handler? *(end the response)*

---

### ✅ Summary in one paragraph (for revision)
A server is ~20 lines: `express()` makes the app, `app.get()` registers routes, `app.listen()`
binds the port — and that bind is the moment it becomes a server. Every handler gets `req`
(what came in) and `res` (what goes back), and its one obligation is to **end the response**.
Deployment is the same code with **different configuration**: `dotenv.config()` — always the
first line — loads `.env` into `process.env`, `.env` is **never committed** (`.env.example`
ships the shape instead), and the port comes from **`process.env.PORT`** because the *host*
assigns it, not you. The platform pulls the repo, runs the **build command** (`npm install`,
once) then the **start command** (`npm start`, forever), and hands back a public URL. Because
`.env` never shipped, every variable is **re-entered in the dashboard** — the missing one is
why "it works locally." Once the frontend calls that URL, **CORS** appears: the browser's
same-origin policy, not a server error, fixed by whitelisting the origin.
