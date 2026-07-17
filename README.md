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

## Suggested Revision Order (Day Before an Interview)

1. **NOTES1** — server = software, runtime vs framework, the two pillars, folder structure
2. **NOTES2** — `process.env.PORT`, `.env` vs dashboard vars, build vs start, CORS

Most notes end with a **Quick self-test** and a **one-paragraph summary** — cover the
answers and use those as flashcards.
