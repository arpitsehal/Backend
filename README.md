# Backend — Interview-Ready Notes & Projects

A learn-by-building backend repository, in the same shape as my
[React](https://github.com/arpitsehal/React) and [Javascript](https://github.com/arpitsehal/Javascript)
notes. Every concept gets **two halves**: a project folder you can run, and a matching
`NOTES*.md` file with the theory, the gotchas, and the interview questions.

The notes are numbered in the order they were learned. Follow them in order — each one
assumes the previous one.

> **Prerequisite:** the [Javascript](https://github.com/arpitsehal/Javascript) repo,
> especially `Async_code/`, `Filter_maps_reduce/` and `Objects/`. Backend is mostly data
> wrangling — shaky fundamentals there make every controller here painful.

---

## Repository at a Glance

| # | Notes | Project | Core Topic |
|---|-------|---------|-----------|
| 1 | [NOTES1.md](NOTES1.md) | *(theory only)* | Roadmap — server, runtime, the two pillars, folder structure |
| 2 | [NOTES2.md](NOTES2.md) | [`index.js`](index.js) | First Express server + deploying it to production |
| 3 | [NOTES3.md](NOTES3.md) | [`FullStack_basic/`](FullStack_basic/) | Connecting React to Express — proxy, CORS, origins |

*More steps land here as I work through them.*

---

## The Learning Path

### Step 1 — The Roadmap
**Project:** *none — pure theory* · **Read:** [NOTES1.md](NOTES1.md)

The map before the territory. A **server is software, not a machine**. Backend is a
**field, not a language** — it rests on two pillars: a programming language for business
logic and a database for storage. Covers where Node.js (runtime), Express (framework) and
Mongoose (**ODM**, not ORM) each sit, why every DB call is async and wrapped in try/catch,
the three things backend code ever does, and the industry-standard folder structure.

> **Interview hooks:** What *is* a server? Is Node.js a framework? Why is Mongoose an ODM
> and not an ORM? Why is every database call async? Models vs controllers?

---

### Step 2 — Your First Server, and Shipping It
**Project:** [`index.js`](index.js) · **Read:** [NOTES2.md](NOTES2.md)

Theory becomes a URL. `npm init` → `package.json`, then a four-route Express server in
twenty lines: `express()` builds the app, `app.get()` registers routes, `app.listen()`
**binds the port** — the moment it becomes a server. The real lesson is the last mile:
production is the *same code with different configuration*. `dotenv.config()` first,
`.env` never committed, and **`process.env.PORT`** because the *host* picks the port, not
you. Then build command vs start command, why your env vars must be retyped in the
dashboard, and the CORS wall waiting on the other side.

> **Interview hooks:** Why `process.env.PORT` and not `3000`? Why must `dotenv.config()` be
> the first line? `.env` is gitignored — so how does production get its variables? Build
> command vs start command? Is CORS a server error?

**Run it:**
```bash
npm install
cp .env.example .env    # Windows: copy .env.example .env
npm start               # → http://localhost:3000
```
Routes: `/` · `/twitter` · `/login` · `/youtube`

---

### Step 3 — Wiring a Frontend to It
**Project:** [`FullStack_basic/`](FullStack_basic/) · **Read:** [NOTES3.md](NOTES3.md)

The CORS wall NOTES2 pointed at, hit properly. A React (Vite) app and an Express API are
**two servers on two ports**, and since an **origin is protocol + host + port**, the browser
treats them as different websites. Covers fetching with `useEffect` + `axios` (why
`useState([])`, why the empty dependency array, why `response.data`), why `map` with braces
and no `return` silently renders nothing, and then the main event: **CORS is a browser rule,
not a server error** — fixed in development by a **Vite proxy** that keeps everything on one
origin, and in production by the **`cors` middleware** or serving the built frontend from
Express, because the proxy disappears at build time.

> **Interview hooks:** What is an origin? Is CORS a server error? Why does it work in
> Postman but not the browser? How does a proxy fix CORS? Does the proxy work in
> production? Why not `origin: '*'`?

**Run it — two terminals:**
```bash
cd FullStack_basic/backend  && npm install && npm start     # → http://localhost:3000
cd FullStack_basic/frontend && npm install && npm run dev   # → http://localhost:5173
```
API: `/api/jokes` · proxied through Vite, so the browser only ever sees one origin

---

## Suggested Revision Order (Day Before an Interview)

1. **NOTES1** — server = software, runtime vs framework, the two pillars, folder structure
2. **NOTES2** — `process.env.PORT`, `.env` vs dashboard vars, build vs start, CORS
3. **NOTES3** — origin = protocol+host+port, CORS is the browser, proxy is dev-only

Most notes end with a **Quick self-test** and a **one-paragraph summary** — cover the
answers and use those as flashcards.
