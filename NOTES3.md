# Backend Notes 3 — Connecting a Frontend to a Backend (Proxy & CORS)

> **Project:** [`FullStack_basic/`](FullStack_basic/) — a React (Vite) frontend and an
> Express backend, talking to each other on two different ports.

NOTES2 ended by pointing at the CORS wall. This is that wall, hit properly — and the two
different tools that get you through it, one for **development** and one for **production**.

---

## 0. Big Picture (read this first)

A "full stack app" running locally is **two separate programs on two separate ports**.
Vite serves the React app on `5173`. Express serves the API on `3000`. They share a
folder and nothing else — separate `package.json`, separate `node_modules`, separate
`npm run` command, separate terminal.

The browser treats those two ports as **two different websites**. That single fact is the
entire chapter.

> 🧠 **Interview line:** "Locally, a full-stack app isn't one app — it's two servers, and
> the browser considers different ports to be different origins. Everything about proxies
> and CORS exists to paper over that gap."

---

## 1. The Two-Project Layout

```
FullStack_basic/
├── backend/
│   ├── package.json      # express
│   └── server.js         # the API — runs on :3000
└── frontend/
    ├── package.json      # react, axios, vite
    ├── vite.config.js    # ← the proxy lives here
    └── src/App.jsx       # the UI — runs on :5173
```

Two terminals, always:

```bash
cd backend  && npm start     # → http://localhost:3000
cd frontend && npm run dev   # → http://localhost:5173
```

> 💡 **They are not one project.** Installing `express` in the frontend, or `react` in the
> backend, is always a mistake. Each folder installs only what *its* process runs.

---

## 2. Fetching from React — `useEffect` + `axios`

```jsx
const [jokes, setJokes] = useState([])      // [] not undefined — see below

useEffect(() => {
  axios.get('/api/jokes')                   // relative URL — the proxy handles the rest
    .then((response) => setJokes(response.data))
    .catch((error) => console.log('error'))
}, [])                                      // ← the dependency array is not optional
```

### The three details that matter

| Detail | Why |
|---|---|
| `useState([])` | The first render happens **before** the data arrives. Initialise to an empty array so `.map()` and `.length` work on render #1 instead of crashing on `undefined`. |
| `, []` at the end | **Run once, on mount.** Without it the effect reruns after every render — and since it calls `setJokes`, it causes the render that retriggers itself. Infinite request loop. |
| `response.data` | Axios wraps the reply. The JSON body is `response.data`, *not* `response`. |

> 🧠 **Interview line:** "A `useEffect` with no dependency array runs after *every* render.
> If that effect also sets state, you've built an infinite loop that hammers your API —
> `[]` means run once on mount."

---

## 3. Rendering the List

```jsx
{
  jokes.map((joke) => (              // ← parentheses = implicit return
    <div key={joke.id}>
      <h3>{joke.title}</h3>
      <p>{joke.content}</p>
    </div>
  ))
}
```

**The trap:** `map((joke) => { <div>…</div> })` with **curly braces** is a function *body*,
not a returned value. It returns `undefined` for every item, so React renders nothing — no
error, no warning, just a blank list while `jokes.length` cheerfully says `3`.

- `( … )` → implicit return ✅
- `{ … }` → needs an explicit `return` ✅
- `{ … }` with no `return` → silently renders nothing ❌

`key={joke.id}` uses the **stable id from the database**, never the array index.

---

## 4. CORS — the wall

Call `http://localhost:3000` from a page served on `http://localhost:5173` and the browser
refuses to hand you the response.

**Origin = protocol + host + port.** All three must match. `localhost:5173` and
`localhost:3000` differ in the port, so they are **different origins** — same machine,
still blocked.

The critical framing: **the request usually succeeds.** The server received it, ran the
handler, and sent a reply. The *browser* then read the missing
`Access-Control-Allow-Origin` header and refused to expose the response to your JavaScript.

> 🧠 **Interview line:** "CORS is a browser rule, not a server error. curl and Postman
> ignore it completely — which is exactly why the endpoint 'works in Postman' and fails in
> the browser. The server isn't rejecting you; the browser is refusing to let your JS read
> a reply it already got."

---

## 5. The Proxy — the development fix

```js
// frontend/vite.config.js
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
```

Now the frontend asks for `/api/jokes` — a **relative** URL, so the browser sends it to
`localhost:5173`, its *own* origin. Vite's dev server catches anything starting with
`/api`, forwards it to `localhost:3000`, and pipes the reply back.

```
browser ──/api/jokes──▶ vite :5173 ──/api/jokes──▶ express :3000
        ◀───────────────  (same origin, so no CORS)
```

Server-to-server traffic has no same-origin policy — that's a browser-only rule. **The
browser only ever sees one origin, so CORS never triggers.**

### Two gotchas

**1. The path is forwarded *whole*, including the prefix.** `/api/jokes` arrives at Express
as `/api/jokes`, so the backend route must be `app.get('/api/jokes', …)`. To strip the
prefix instead, rewrite it:

```js
'/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') }
```

**2. `vite.config.js` changes need a dev-server restart.** Editing it while running does
not always take effect — stop and re-run `npm run dev`.

> 💡 **Bonus win:** relative URLs mean **no hardcoded `localhost:3000` in your React code**.
> The same `axios.get('/api/jokes')` works in dev *and* in production, unchanged.

---

## 6. Why the `/api` prefix

```js
app.get('/api/jokes', …)      // API route
```

The prefix is what makes the proxy rule possible — it's the marker that says "this request
is data, not a page." Without it you'd have to proxy `/jokes`, `/users`, `/login`
individually, and each one would collide with a frontend route of the same name.

One rule, `'/api'`, covers every endpoint you will ever add.

---

## 7. Production — the proxy is gone

**The Vite proxy is a dev-server feature. It does not exist in a production build.**
`npm run build` emits static HTML/CSS/JS. There is no Vite process left to proxy anything.

Two real options:

```js
// Option A — the backend opts in with CORS middleware
const cors = require('cors')
app.use(cors({ origin: process.env.CORS_ORIGIN }))   // your domain — never '*'
```

```js
// Option B — Express serves the built frontend, so there's only ONE origin
app.use(express.static('frontend/dist'))
```

Option B removes CORS entirely: same origin, same server, nothing cross about it.

> 🧠 **Interview line:** "The proxy solves CORS in development only — it's a dev-server
> feature and disappears at build time. In production you either whitelist the real domain
> with the `cors` middleware, or serve the built frontend from the same Express app so
> there's only one origin."

---

## 8. Bugs I Actually Hit

| Bug | Symptom | Cause |
|---|---|---|
| `import { response } from 'express'` in `App.jsx` | **Blank page**, dev server error | Editor autocomplete. Express is a Node package — Vite can't resolve it, the module tree dies. |
| `map` with `{ }` and no `return` | Count shows 3, no jokes render | Block body returns `undefined` |
| `useEffect` with no `[]` | Network tab floods with requests | Effect sets state → rerender → effect reruns |
| Route was `/jokes`, proxy was `/api` | 404 through the proxy | Prefix is forwarded, not stripped |

> 💡 **The first one is worth remembering.** Autocomplete happily imports backend packages
> into frontend files because both are JavaScript. **Nothing about `.jsx` stops you from
> importing `express` — only the bundler failing at build time tells you.**

---

## 9. Interview Questions & Answers

**Q1. What is an "origin"?**
> Protocol + host + **port**. All three must match. `localhost:5173` and `localhost:3000`
> are different origins.

**Q2. Is CORS a server error?**
> No — it's the **browser** enforcing the same-origin policy. The server already replied;
> the browser refuses to expose that reply to JS because the
> `Access-Control-Allow-Origin` header is missing.

**Q3. Why does it work in Postman but not the browser?**
> Postman and curl aren't browsers and don't implement the same-origin policy. Proof the
> endpoint is fine and the block is client-side.

**Q4. How does a proxy fix CORS?**
> The frontend requests a relative URL, so the browser talks only to its own origin. The
> dev server forwards it backend-side, where no same-origin policy applies. The browser
> never sees a second origin.

**Q5. Does the proxy work in production?**
> No. It's a Vite **dev-server** feature and vanishes at build time. Production needs the
> `cors` middleware or serving the built frontend from Express.

**Q6. Why `origin: 'https://myapp.com'` instead of `'*'`?**
> `'*'` lets any website on the internet call your API from a user's browser. Whitelist the
> exact domain.

**Q7. Why the `/api` prefix?**
> It gives the proxy a single rule to match, and keeps API paths from colliding with
> frontend routes.

**Q8. Does the proxy forward `/api` to the backend?**
> Yes — the full path, prefix included. `/api/jokes` arrives as `/api/jokes` unless you add
> a `rewrite`.

**Q9. Why `useState([])` and not `useState()`?**
> The first render happens before the fetch resolves. `undefined.map()` crashes; `[].map()`
> renders nothing and waits.

**Q10. What does an empty dependency array do?**
> Runs the effect once, on mount. Omit it and the effect runs after every render — and if
> it sets state, that's an infinite loop.

**Q11. `response` vs `response.data` in axios?**
> `response` is the whole axios object (status, headers, config). The JSON body is
> `response.data`.

**Q12. Frontend and backend in one repo — one `npm install` or two?**
> Two. Separate `package.json` and separate `node_modules` per folder, because they're two
> independent processes.

---

## 10. Quick self-test (cover the answers above)

1. What three things make up an origin? *(protocol + host + port)*
2. Whose rule is CORS? *(the browser's — curl ignores it)*
3. Why does a proxy avoid CORS? *(browser sees only its own origin; server-to-server is unrestricted)*
4. Does the proxy exist in production? *(no — dev-server only)*
5. `map` with `{ }` and no `return` renders what? *(nothing — silently)*
6. What breaks without `[]` on `useEffect`? *(infinite render/fetch loop)*
7. Where's the JSON body on an axios reply? *(`response.data`)*
8. Proxy `/api` — does the backend route include `/api`? *(yes, unless you `rewrite`)*

---

### ✅ Summary in one paragraph (for revision)
A local full-stack app is **two servers on two ports** — Vite on `5173`, Express on `3000`
— and because an **origin is protocol + host + port**, the browser treats them as different
websites. React fetches with `useEffect` + `axios`, where `useState([])` survives the first
render, the **empty dependency array** stops an infinite fetch loop, and the body is
`response.data`; rendering the list needs `map` to actually **return** its JSX (parentheses,
not braces). Calling `:3000` directly triggers **CORS** — a **browser** rule, not a server
error, which is why Postman works and the browser doesn't. In development the fix is a
**Vite proxy**: request the relative `/api/jokes`, Vite forwards it to Express server-side
where no same-origin policy applies, so the browser only ever sees one origin — just
remember the prefix is forwarded whole, so the backend route is `/api/jokes` too. That proxy
is **dev-only and disappears at build time**, so production either whitelists the real
domain with the **`cors` middleware** (never `'*'`) or serves the built frontend from
Express so there's only one origin at all.
