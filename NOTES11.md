# Backend Notes 11 — Router & Controller Wiring + Debugging

> **Project:** [`FullStack/`](FullStack/) — files touched: `src/controllers/user.controller.js`,
> `src/routes/user.routes.js`, `src/app.js`.
> **Prereq:** [NOTES8](NOTES8.md) (`asyncHandler`, the `utils/` contract) and the folder-structure
> rule from [NOTES1](NOTES1.md) §5 (`routes/` = "the switchboard", `controllers/` = "what a User
> can *do*"). This note is where that split actually gets **wired together and proven to work**.

Every endpoint is three small pieces that must agree with each other: a **controller** function
that does the work, a **router** that maps a URL + HTTP verb to that function, and **`app.js`**
that mounts the router under a path prefix. None of the three is complicated on its own — almost
all real bugs here are a **mismatch between the pieces**, not broken logic inside any one of them.

The whole note comes down to **one idea**: **wire first, prove it with the smallest possible
response, then fill in logic.** A controller that just returns `{ message: "ok" }` is not
unfinished — it's the correct first step, because it isolates "is the plumbing connected?" from
"is the business logic correct?".

---

## 1. The three-file chain

```
request  "/api/v1/users/register"
    │
    ▼
app.js          app.use("/api/v1/users", userRouter)     ← mounts the router under a prefix
    │
    ▼
user.routes.js  router.route("/register").post(registerUser)   ← maps verb+path → controller
    │
    ▼
user.controller.js   const registerUser = asyncHandler(...)    ← the actual logic
```

The **full path a client hits** is the prefix from `app.js` **concatenated** with the path given
to the router — `"/api/v1/users"` + `"/register"` = `"/api/v1/users/register"`. The router itself
knows nothing about `/api/v1/users`; that's deliberately `app.js`'s job, so the same router could
be re-mounted under a different prefix without touching it.

> 🧠 **Interview line:** "A route's full URL is assembled in two places: the router only knows the
> path relative to itself, and `app.js` supplies the prefix when it mounts that router with
> `app.use(prefix, router)`. Keeping the prefix out of the router is what makes it reusable."

---

## 2. `express.Router()` — a mini, mountable app

```js
import { Router } from "express";
const router = Router();

router.route("/register").post(registerUser);

export default router;
```

`Router()` returns an isolated mini-app: its own set of routes, its own middleware, nothing global.
`app.js` never sees `/register` directly — it only sees "this whole router," mounted at one prefix.
That isolation is **why routes live in their own file per resource** (`user.routes.js`,
`video.routes.js`, ...) instead of all being declared directly on `app`.

### 2.1 `router.route(path).method(handler)` vs `router.method(path, handler)`

Both exist and do the same thing:

```js
router.route("/register").post(registerUser);     // chainable — same path, multiple verbs
router.post("/register", registerUser);           // flat — one verb per line
```

The chained form earns its keep once a path needs more than one verb:

```js
router.route("/videos/:id")
  .get(getVideo)
  .patch(updateVideo)
  .delete(deleteVideo);
```

> 💡 **Mental model:** *"`.route(path)` groups every verb for one URL in one place."*

---

## 3. Mounting the router — `app.use(prefix, router)`

```js
// app.js
import userRouter from "./routes/user.routes.js";

app.use("/api/v1/users", userRouter);

export { app };
```

| Piece | Why |
|---|---|
| `import userRouter from ...` (**no braces**) | `user.routes.js` uses `export default router` — a default export, so the import has no braces. Mismatch this and you get `undefined` where Express expects a router, which throws at mount time, not silently. |
| `"/api/v1/users"` | **API versioning in the URL itself.** If `v2` ever needs a breaking change, `v1` clients keep working unmodified — you just add a second mount. |
| Must run **before** `export { app }` | Middleware/routes registered *after* a response has already been sent for a request don't apply to it — order of `app.use()` calls matters, top to bottom. |

> 🧠 **Interview line:** "Versioning the API in the path — `/api/v1/...` — means a future breaking
> change ships as `/api/v2/...` alongside it, instead of breaking every existing client at once."

---

## 4. The controller — logic lives here, nowhere else

```js
import { asyncHandler } from "../utils/asyncHandler.js";

const registerUser = asyncHandler(async (req, res) => {
  res.status(200).json({ message: "ok" });
});

export { registerUser };
```

A controller is **just a function with the `(req, res)` shape**, wrapped in `asyncHandler`
(NOTES8) so it never needs its own `try/catch`. At this stage it's a deliberate **stub** — the
real job of this note isn't the business logic, it's confirming every file in the chain agrees
with every other file *before* that logic gets written. Writing real logic against a broken wire
just makes the eventual bug harder to isolate.

> 🧠 **Interview line:** "I stub the controller with a trivial response first and hit it from
> Postman before writing any real logic. That way, if something's broken later, I already know
> routing isn't the problem — it's isolated to the logic I just added."

---

## 5. Debugging the wiring — the actual checklist

When a route "doesn't work," walk it in this order — it's almost always one of these, not a typo
inside the handler itself:

1. **Did the request even reach the server?** Add a one-line `console.log` as the very first thing
   in the controller. If it never prints, the problem is routing/mounting, not logic.
2. **Does the method match?** A `GET` sent to a route registered as `.post()` isn't a 404 in some
   setups — it can be a silent fallthrough to the next matching route or Express's default
   404/405. Confirm the verb in Postman matches the verb in `router.route(path).<verb>()`.
3. **Does the full path match exactly?** Concatenate the mount prefix (§3) with the router's path
   by hand and compare it, character for character, with what Postman is actually sending —
   trailing slashes and casing both matter.
4. **Is the router actually mounted?** Check `app.js` has the `app.use(prefix, router)` line, and
   that it runs **before** `app.listen`/`export { app }` elsewhere.
5. **Default vs named export/import mismatch?** `export default router` needs
   `import userRouter from ...` (no braces); `export { registerUser }` needs
   `import { registerUser } from ...` (braces). Swapping either throws immediately on import.
6. **Set a real breakpoint if `console.log` isn't enough.** VS Code's built-in Node debugger
   (`Run and Debug` → `Node.js`, or `node --inspect` and attach) lets you stop *inside* the
   controller and inspect `req.body`/`req.params` live, instead of guessing from log lines.

> ⚠️ **The 90% bug at this stage isn't logic — it's a mismatch between what the client sends and
> what the router/mount expect.** Verify the plumbing before doubting the handler.

> 🧠 **Interview line:** "My first debugging step is always a `console.log` at the very top of the
> controller — if it doesn't print, I know the bug is in routing or mounting, not in the handler's
> logic, and I stop looking there."

---

## 6. Bugs & Gotchas

| Bug | Symptom | Cause / Fix |
|---|---|---|
| **Default/named export mismatch** | `TypeError: argument handler must be a function` or `undefined` is not a router | `export default router` paired with `import { userRouter }` (or vice versa for named exports). Match the export style exactly. |
| **Router never mounted** | Every request to that resource is a 404, controller code never runs | Missing `app.use(prefix, router)` in `app.js`, or it's present but after the server already started handling requests in some other broken order. |
| **Wrong HTTP verb in the client** | "It's not working" but the server never logs anything | `.post()` registered, client sends `GET` (or Postman defaults to `GET`). Check the verb first. |
| **Prefix duplicated or missing** | 404 even though the route "looks right" | Full path = mount prefix + router path. Forgetting the `/api/v1/users` prefix when testing in Postman is the single most common false alarm. |
| **Route file not imported in `app.js`** | Router is fully correct but nothing happens | A file existing isn't enough — it must be `import`ed and passed to `app.use()`. |
| **Controller not wrapped in `asyncHandler`** | An async error inside the controller becomes an unhandled rejection instead of a clean error response | Every controller should go through `asyncHandler` (NOTES8), even a stub — consistency now avoids a silent crash later. |
| **Testing without restarting `nodemon`** | Code changes don't seem to take effect | Confirm the dev server actually restarted — a stale process serving old code looks identical to a wiring bug. |

---

## 7. Interview Questions & Answers

**Q1. What are the three pieces every route needs, and what does each own?**
> A controller (the logic), a router (verb + path → controller), and `app.js` (mounts the router
> under a URL prefix). Each piece should only know about its own job.

**Q2. How is the final URL a client hits actually assembled?**
> The mount prefix given to `app.use(prefix, router)` in `app.js`, concatenated with the path given
> to that route inside the router file.

**Q3. Why keep the `/api/v1` prefix out of the router file itself?**
> So the router stays reusable — it doesn't hard-code where it's mounted, and the same router
> could be mounted at a different prefix without being edited.

**Q4. What's the difference between `router.route(path).post(fn)` and `router.post(path, fn)`?**
> Functionally identical for one verb. `.route(path)` is preferred when a path needs multiple verbs
> (`GET`/`PATCH`/`DELETE` on the same resource), since they can all chain off one call.

**Q5. Why stub a controller with `{ message: "ok" }` before writing real logic?**
> It isolates "is the wiring correct?" from "is the logic correct?" — hitting a working stub from
> Postman first means any later bug is known to be inside the logic, not the plumbing.

**Q6. What's the very first debugging step when a route "does nothing"?**
> A `console.log` as the first line of the controller. If it never prints, the request never
> reached the handler — the bug is in routing/mounting, not inside the function.

**Q7. What error do you get from a default/named export mismatch, and why?**
> Something like `undefined is not a function`/`argument handler must be a function` — Express
> receives `undefined` instead of the router or controller because the import style didn't match
> how it was exported.

**Q8. Why does `app.use(prefix, router)` need to run before the app is exported/listened on?**
> `app.use()` calls register in order; a route added after the server is already handling traffic
> in some broken control-flow path won't apply to requests that already passed that point.

**Q9. A route returns 404 even though the controller and router both "look correct" — what do you
check first?**
> Reconstruct the full path by hand (prefix + router path) and compare it character-for-character
> against what the client actually sent, including trailing slash and the HTTP verb.

**Q10. Why wrap even a placeholder controller in `asyncHandler`?**
> Consistency — every controller in the codebase should go through the same error-handling wrapper
> from day one, so nothing is ever one bug-fix away from an unhandled rejection crashing the
> process.

**Q11. When is a `console.log` not enough, and what's the alternative?**
> When you need to inspect live request data (`req.body`, `req.params`) rather than guess from
> printed values — set an actual breakpoint with the VS Code Node debugger (or `node --inspect`)
> and step through the controller.

---

## 8. Quick self-test (cover the answers)

1. The three files every route touches? *(controller / router / app.js)*
2. How is the full URL built? *(mount prefix + router's own path)*
3. Why keep the prefix out of the router file? *(keeps the router reusable)*
4. `.route(path).post()` vs `.post(path, fn)` — when does the chained form earn its keep?
   *(multiple verbs on one path)*
5. Why return a trivial stub before writing real controller logic? *(isolates wiring bugs from
   logic bugs)*
6. First thing to check when a route does nothing? *(does a `console.log` at the top even print?)*
7. Symptom of a default/named export mismatch? *(`undefined` where a function/router was expected)*
8. Most common false-alarm 404 cause? *(forgetting the mount prefix when testing)*
9. Why should even a stub controller go through `asyncHandler`? *(consistency — no controller is
   ever an exception to the error-handling rule)*

---

### ✅ Summary in one paragraph (for revision)
A route is three small, separately-owned pieces that have to **agree with each other**: the
**controller** holds the logic and is wrapped in **`asyncHandler`** even as a stub; the **router**
(`express.Router()`) maps an HTTP verb + relative path to that controller, using either
`router.route(path).verb()` (chainable, good for multiple verbs on one path) or
`router.verb(path, fn)`; and **`app.js`** mounts that router under a versioned prefix with
`app.use("/api/v1/users", userRouter)` — the client's full URL is that prefix concatenated with
the router's own path, and the prefix is deliberately kept **out** of the router file so it stays
reusable. Almost every real bug at this stage is a **mismatch between the pieces**, not broken
logic: a default/named export mismatch between a file and its import, a router that's never
actually mounted, a verb mismatch between client and route, or forgetting the mount prefix when
testing in Postman. The fastest way to isolate any of these is the cheapest one — a `console.log`
as the first line of the controller tells you immediately whether the request even reached the
handler — and a real VS Code breakpoint is the fallback once you need to inspect live
`req.body`/`req.params` instead of guessing from printed values. Wiring first, with a trivial
response, and proving it end-to-end before writing real logic, is what makes the eventual bug (if
any) easy to locate.
