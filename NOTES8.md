# Backend Notes 8 — Custom API Response & Error Handling

> **Project:** [`FullStack/`](FullStack/) — files touched: `src/app.js`, `src/index.js`,
> `src/utils/asyncHandler.js`, `src/utils/apiError.js`, `src/utils/apiResponse.js`, `package.json`.
> **Prereq:** [NOTES7](NOTES7.md) (DB connection). The DB now connects — this note **starts the
> server**, **configures Express**, and builds the three **utility classes** that every
> controller from here on will use.

NOTES7 ended with `connectDB()` being called and *nothing happening after it*. This note
finishes that thought (`.then(app.listen)`), then does the thing that separates a hobby backend
from a professional one: **it stops writing `try/catch` and `res.json({...})` by hand in every
controller.**

The whole note is one idea: **a backend has exactly two possible outcomes — it worked, or it
didn't.** So build **one shape for success** (`apiResponse`), **one shape for failure**
(`apiError`), and **one wrapper** that routes every controller into one of the two
(`asyncHandler`). Write them once in `utils/`, use them a hundred times.

---

## 1. The problem these utilities solve

Without them, every single controller looks like this:

```js
const registerUser = async (req, res) => {
  try {
    // ...actual work...
    res.status(200).json({ success: true, data: user, message: "ok" });
  } catch (error) {
    res.status(500).json({ successs: false, message: error.message });  // typo, ad-hoc shape
  }
};
```

Three problems, and they compound across 50 controllers:

| Problem | Consequence |
|---|---|
| `try/catch` copy-pasted everywhere | Boilerplate noise; one missing `catch` = **unhandled promise rejection** → process crash |
| Response shape invented per-controller | Frontend can't trust any field. Is it `data`, `result`, `payload`? Is it `success` or `successs`? |
| Error shape invented per-controller | No status code, no stack trace, no validation-errors array |

> 🧠 **Interview line:** "Before writing any controller I set up three utilities: a wrapper that
> handles async errors so I never write `try/catch` in a controller, a standardised success
> class, and a standardised error class. It means every endpoint in the API returns the exact
> same shape, and the frontend can be written against one contract."

> 💡 **Mental model:** *"Two outcomes, two classes, one wrapper."*

---

## 2. `app.js` — the Express app, configured properly

The app is now split out of `index.js` into its own file. `index.js` **boots** (env + DB +
listen); `app.js` **configures** (middleware). Separation of concerns again.

```js
// src/app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

export { app };
```

### 2.1 `app.use()` — the middleware keyword

`app.use()` is how you register **middleware** — code that runs on the request *before* it
reaches your controller. Whenever you see configuration or a plugin being attached, it's
`app.use()`.

### 2.2 The four configurations, one by one

| Middleware | What it does | Why it's here |
|---|---|---|
| `cors({ origin, credentials })` | **Cross-Origin Resource Sharing** — tells the browser which frontend origins may call this API. | The browser blocks cross-origin requests by default. `origin` comes from `.env` (`CORS_ORIGIN`) so dev/prod differ without code changes. `credentials: true` allows **cookies** to cross origins. |
| `express.json({ limit: "16kb" })` | Parses incoming **JSON bodies** into `req.body`. | Without it `req.body` is `undefined`. The **`limit` caps payload size** — an attacker posting a 2 GB JSON body would otherwise crash the server. |
| `express.urlencoded({ extended: true, limit })` | Parses **HTML form** submissions (`application/x-www-form-urlencoded`). | URLs encode spaces as `+` or `%20`; this normalises that into `req.body`. `extended: true` allows **nested objects** in the form data. |
| `express.static("public")` | Serves files from the `public/` folder. | For assets the server itself stores — images, favicons, temp uploads — served straight off disk with no controller. |
| `cookieParser()` | Parses the `Cookie` header into `req.cookies`, and enables setting cookies on `res`. | This is how you **read and write secure cookies from the user's browser** — the foundation of the JWT auth we do next. Server can CRUD cookies only if this is registered. |

> 💡 **Why `limit` on json/urlencoded is a real answer, not trivia.** It's a **DoS protection**.
> Accepting unbounded request bodies is a denial-of-service vector. `16kb` is generous for JSON
> (files go through multer, not here).

> 🧠 **Interview line:** "In `app.js` I configure four things: `cors` with a whitelisted origin
> from env and `credentials: true` so cookies work cross-origin; `express.json` and
> `express.urlencoded` both with a `16kb` limit to cap payload size; `express.static` for public
> assets; and `cookie-parser` so the server can read and set browser cookies for auth."

### 2.3 Named export, not default

```js
export { app };            // → import { app } from "./app.js"
```

`app.js` may later export more than one thing, so a **named export** is used here — unlike
`connectDB`, which is a `export default`.

---

## 3. `index.js` — starting the server *after* the DB connects

`connectDB()` is an `async` function, so **it returns a Promise**. That promise is the signal
we need: only listen for traffic once the database is actually up.

```js
// src/index.js
import dotenv from "dotenv";
dotenv.config({ path: './.env' });

import connectDB from "./db/index.js";

connectDB()
  .then(() => {
    app.listen(process.env.PORT || 8000, () => {
      console.log(`Server is running at port : ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MONGO DB Connection failed!", err);
  });
```

| Piece | Why |
|---|---|
| `connectDB().then(...)` | An `async` function **always returns a promise** — so we can chain. The server starts **only after** a successful connection. |
| `app.listen(...)` inside `.then` | A server accepting requests with no database would return errors on every route. Order matters. |
| `process.env.PORT \|\| 8000` | **Fallback port.** If `.env` is missing `PORT`, don't crash — default to `8000`. Deployment platforms inject their own `PORT`. |
| `.catch(err)` | The outer safety net if the connection promise rejects. |

> ⚠️ **Two levels of error handling here.** `db/index.js` already has its own `try/catch` +
> `process.exit(1)`. This `.catch` is the *second* net at the call site. Belt and braces —
> normal and correct.

> 🧠 **Interview line:** "`connectDB` is async so it returns a promise. I chain `.then` and start
> `app.listen` inside it, so the server only accepts traffic once Mongo is connected, with a
> `.catch` for a failed connection and a `|| 8000` fallback port."

---

## 4. `utils/asyncHandler.js` — stop writing `try/catch`

The single most reused utility in the project. It is a **higher-order function**: a function
that takes a function and returns a function.

```js
// src/utils/asyncHandler.js
const asyncHandler = (requestHandler) => {
  return (req, res, next) => {
    Promise.resolve(requestHandler(req, res, next))
      .catch((err) => next(err));
  };
};

export { asyncHandler };
```

### 4.1 How to read it (build it up in your head)

```
const asyncHandler = () => {}                 // a function
const asyncHandler = (fn) => () => {}         // returning a function
const asyncHandler = (fn) => async () => {}   // …an async one
```

That's the whole trick. You pass your controller in; you get back a **wrapped** controller that
Express can call, and which can never leak an unhandled rejection.

### 4.2 Usage

```js
const registerUser = asyncHandler(async (req, res) => {
  const user = await User.create(req.body);        // no try/catch needed
  res.status(201).json(new apiResponse(201, user, "User registered"));
});
```

If `User.create` throws, `.catch` fires `next(err)` — Express hands it to the global error
middleware. **The controller stays pure business logic.**

| Piece | Why |
|---|---|
| `Promise.resolve(...)` | Normalises the return value into a promise so `.catch` is always available — even if the handler wasn't async. |
| `next(err)` | Passes the error **into Express's error pipeline** rather than responding here. One central place formats errors. |
| `(req, res, next)` | The returned function must have Express's exact middleware signature, or Express can't call it. |

### 4.3 The `try/catch` variant (same job, other style)

Both styles are common. This one responds directly instead of delegating to `next`:

```js
const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    res.status(error.code || 500).json({
      success: false,
      message: error.message
    });
  }
};
```

| | **Promise version** (used) | **try/catch version** |
|---|---|---|
| On error | `next(err)` → central error middleware | Responds immediately with JSON |
| Response shape | Decided in **one** place | Decided **here**, duplicated logic |
| Verdict | **Preferred** — cleaner, centralised | Fine, more explicit for beginners |

> 🧠 **Interview line:** "`asyncHandler` is a higher-order function that wraps every controller.
> It resolves the handler as a promise and forwards any rejection to `next()`, so async errors
> reach Express's error middleware. That means no controller in the codebase contains a
> `try/catch`."

---

## 5. `utils/apiError.js` — one shape for every failure

Node has a built-in `Error` class, but it only carries `message` and `stack`. An **API** error
also needs a status code and a validation-errors list. So we **extend** it.

```js
// src/utils/apiError.js
class apiError extends Error {
  constructor(
    statusCode,
    message = "Something went wrong",
    errors = [],
    stack = ""
  ) {
    super(message);                 // hand message to the parent Error
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export { apiError };
```

| Field | Meaning |
|---|---|
| `statusCode` | The HTTP status — `400`, `401`, `404`, `500`. |
| `message` | Human-readable reason. Defaulted so you can `throw new apiError(500)`. |
| `data: null` | Always `null` on an error — **keeps the shape identical to `apiResponse`** so the frontend can read one contract. |
| `success: false` | Hard-coded. An `apiError` is *never* a success. |
| `errors: []` | Array for **multiple** problems at once — e.g. every failing field in a form validation. |
| `stack` | The stack trace. Accepted as an argument so you can **pass a caller's stack through**; otherwise generated. |

### 5.1 `super(message)` — the important line

`extends Error` means `apiError` inherits from `Error`. `super(message)` calls the **parent
constructor**, which is what actually sets up a real JS error object. **You must call `super()`
before touching `this`** — that's a language rule, not a style choice.

### 5.2 `Error.captureStackTrace(this, this.constructor)`

Generates the stack trace **excluding the constructor frame itself**, so the trace points at
*where the error was thrown in your code*, not at `apiError.js`. Cleaner debugging.

### 5.3 Usage

```js
if (!email) throw new apiError(400, "Email is required");
if (existingUser) throw new apiError(409, "User already exists");
throw new apiError(422, "Validation failed", ["email invalid", "password too short"]);
```

Because the controller is wrapped in `asyncHandler`, a `throw` here is caught and forwarded to
`next()` automatically. **`throw` is the only thing a failing controller ever does.**

> 🧠 **Interview line:** "`apiError` extends the built-in `Error` and adds `statusCode`,
> `success: false`, `data: null` and an `errors` array for validation failures. It calls
> `super(message)` and `Error.captureStackTrace` so the stack points at the real throw site. In
> a controller I just `throw new apiError(400, '...')` and the asyncHandler routes it to the
> error middleware."

---

## 6. `utils/apiResponse.js` — one shape for every success

The mirror image, and much simpler — success has nothing to catch.

```js
// src/utils/apiResponse.js
class apiResponse {
  constructor(statusCode, data, message = "Success") {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }
}

export { apiResponse };
```

| Field | Meaning |
|---|---|
| `statusCode` | HTTP status — `200`, `201`. |
| `data` | The actual payload. **The only field that varies.** |
| `message` | Defaults to `"Success"`. |
| `success` | **Derived**, not passed: `statusCode < 400`. |

### 6.1 `success = statusCode < 400` — why derive it

Because HTTP already encodes this. The standard ranges:

| Range | Meaning |
|---|---|
| `1xx` | Informational |
| `2xx` | **Success** |
| `3xx` | Redirection |
| `4xx` | **Client error** (bad request, unauthorised, not found) |
| `5xx` | **Server error** |

Anything under `400` is not an error, so `success` is computed from the status code. **You can't
accidentally return `success: true` with a `404`** — the class makes that state unrepresentable.

### 6.2 Usage

```js
return res.status(200).json(new apiResponse(200, user, "User fetched successfully"));
```

> 🧠 **Interview line:** "`apiResponse` standardises every successful reply as `statusCode`,
> `data`, `message`, `success` — and `success` is derived as `statusCode < 400` rather than
> passed in, so it can never contradict the status code."

---

## 7. `package.json` — the two new dependencies

```json
"dependencies": {
  "cookie-parser": "^1.4.7",
  "cors": "^2.8.5",
  "dotenv": "^17.4.2",
  "express": "^5.2.1",
  "mongoose": "^9.8.0"
}
```

| Package | Purpose |
|---|---|
| `cors` | Middleware that sets the `Access-Control-Allow-*` headers so a browser on another origin may call this API. |
| `cookie-parser` | Populates `req.cookies` from the `Cookie` header and lets the server set cookies — required for JWT-in-cookie auth. |

---

## 8. How the three utilities work together

```
                 ┌─────────────────────────────┐
   request  ───► │ asyncHandler( controller )  │
                 └───────────┬─────────────────┘
                             │
              works ─────────┴───────── fails
                │                          │
   new apiResponse(200, data)      throw new apiError(400, msg)
                │                          │
         res.json(...)              .catch → next(err)
                │                          │
                ▼                          ▼
     { statusCode, data,          { statusCode, data: null,
       message, success: true }     message, success: false, errors: [] }
```

**Identical field names on both sides.** The frontend reads `res.data.success` and branches —
it never needs to know which endpoint it called.

> 🧠 **Interview line:** "The three compose: `asyncHandler` wraps the controller so nothing
> escapes unhandled, success goes out through `apiResponse`, failure is `throw new apiError`.
> Both classes expose the same field names, so the API has exactly one response contract."

---

## 9. Bugs & Gotchas (every one of these was a real bug in this code)

| Bug | Symptom | Cause / Fix |
|---|---|---|
| **`asyncHandler` missing `return`** | Every wrapped route silently does nothing — request hangs until timeout | `(requestHandler) => { (req,res,next) => {...} }` uses **braces**, so the inner arrow is just an unused expression statement and the function returns `undefined`. Add `return`, or drop the braces: `(fn) => (req,res,next) => {...}`. **The classic arrow-function trap.** |
| **`apiResponse` never exported** | `SyntaxError: does not provide an export named 'apiResponse'` on first import | The file defines the class but has **no `export` statement**. Add `export { apiResponse }`. |
| **`statck` typo in `apiError`** | Stack trace never attached; `err.stack` is `undefined` when one was passed in | The parameter and both usages are spelled `statck`. Because `if (statck)` is falsy for the default `""`, it *appears* to work — the bug only shows when a stack **is** passed. Rename all three to `stack`. |
| **`cookies-parser` in dependencies** | Dead weight; import of the real package still works so nothing breaks visibly | A typo'd install. The correct package is **`cookie-parser`** (singular). Both were listed — `npm uninstall cookies-parser`. |
| `app` not imported in `index.js` | `ReferenceError: app is not defined` at `app.listen` | `index.js` uses `app` inside `.then()` — it needs `import { app } from "./app.js"`. |
| No `export { app }` / wrong import style | `undefined is not a function` | `app.js` uses a **named** export → `import { app }`, with braces. `connectDB` is a **default** export → no braces. Don't mix them up. |
| Forgetting `express.json()` | `req.body` is `undefined` in every POST controller | JSON parsing is **not** on by default in Express. |
| No `limit` on body parsers | Server can be crashed by a huge payload | Always cap: `{ limit: "16kb" }`. |
| Hard-coding `success: true` in a response | `404` responses that claim `success: true` | Derive it — `this.success = statusCode < 400`. |
| Class names lowercase | Not a bug, but non-standard | Convention is **PascalCase** for classes — `ApiResponse`, `ApiError`. |

> These are the concrete fixes applied to the code while writing this note: added the missing
> **`return`** in `asyncHandler`, added the missing **`export`** in `apiResponse.js`, fixed
> **`statck` → `stack`**, added the missing **`import { app }`** in `index.js`, and removed the
> stray **`cookies-parser`** package.

---

## 10. Interview Questions & Answers

**Q1. Why build custom response and error classes at all?**
> So every endpoint returns an identical shape. Without them each controller invents its own
> JSON, the frontend can't be written against one contract, and typos like `successs` leak into
> production. One success class, one error class, defined once in `utils/`.

**Q2. What is `asyncHandler` and why does it exist?**
> A higher-order function that wraps a controller, resolves it as a promise and forwards any
> rejection to `next()`. It removes `try/catch` from every controller and guarantees no
> unhandled promise rejection can crash the process.

**Q3. What is a higher-order function?**
> A function that takes a function as an argument and/or returns a function.
> `asyncHandler` does both: `(fn) => (req, res, next) => {...}`.

**Q4. Two ways to write `asyncHandler` — difference?**
> The **promise** version calls `next(err)` so a single central error middleware formats the
> response. The **try/catch** version responds with JSON on the spot, duplicating response
> logic. Promise version is preferred.

**Q5. Why does `apiError` extend `Error`?**
> To stay a real JS error (works with `throw`, has a stack, `instanceof Error`) while adding
> API-specific fields: `statusCode`, `success: false`, `data: null`, `errors[]`.

**Q6. What does `super(message)` do, and why first?**
> Calls the parent `Error` constructor to initialise the error. JS requires `super()` be called
> before `this` is used in a derived-class constructor.

**Q7. What is `Error.captureStackTrace(this, this.constructor)` for?**
> Builds the stack trace while excluding the constructor's own frame, so the trace points at the
> line that threw, not at `apiError.js`.

**Q8. Why is `errors` an array?**
> To report **multiple** failures in one response — typically every invalid field from a form
> validation, rather than one at a time.

**Q9. Why is `success` computed instead of passed?**
> `statusCode < 400`. HTTP already defines success (`2xx`/`3xx`) vs error (`4xx`/`5xx`), so
> deriving it makes an inconsistent response impossible.

**Q10. What does `cors` do and why `credentials: true`?**
> It sets the `Access-Control-Allow-*` headers that let a browser on a different origin call the
> API. `credentials: true` additionally permits cookies and auth headers to be sent
> cross-origin — required for cookie-based auth.

**Q11. Why put a `limit` on `express.json()`?**
> Payload-size cap — a denial-of-service protection against huge request bodies.

**Q12. What does `express.urlencoded({ extended: true })` do?**
> Parses HTML form submissions into `req.body`, normalising URL encoding (`+`, `%20`).
> `extended: true` allows nested objects in the form data.

**Q13. Why `cookie-parser`?**
> It parses the `Cookie` header into `req.cookies` and lets the server set cookies on the
> response — the mechanism for storing JWTs securely in the browser.

**Q14. Why is `app.listen` inside `connectDB().then()`?**
> `connectDB` is async so it returns a promise. Starting the listener only after it resolves
> means the server never accepts requests it can't serve.

**Q15. Why `process.env.PORT || 8000`?**
> A fallback so a missing `PORT` doesn't crash the app; hosting platforms inject their own port.

**Q16. What's the difference between `export default` and `export { }` here?**
> `connectDB` is a default export → `import connectDB from ...` (no braces). `app`,
> `asyncHandler`, `apiError`, `apiResponse` are named exports → `import { app } from ...` (with
> braces).

---

## 11. Quick self-test (cover the answers)

1. Two outcomes of any request → what handles each? *(`apiResponse` / `apiError`)*
2. What kind of function is `asyncHandler`? *(higher-order — takes a fn, returns a fn)*
3. What does it do on rejection? *(`next(err)` → Express error middleware)*
4. Why does `apiError` extend `Error`? *(keep real error behaviour + add `statusCode`, `errors`)*
5. What must be called before `this` in a derived constructor? *(`super()`)*
6. How is `success` set on `apiResponse`? *(derived: `statusCode < 400`)*
7. Why is `data: null` on `apiError`? *(identical shape to the success response)*
8. Two reasons for `limit: "16kb"`? *(cap payload size / DoS protection)*
9. What does `credentials: true` in cors enable? *(cookies & auth headers cross-origin)*
10. Why is `app.listen` inside `.then()`? *(only serve traffic once the DB is up)*
11. The arrow-function trap in `asyncHandler`? *(braces without `return` → returns `undefined`)*
12. Which package is correct — `cookie-parser` or `cookies-parser`? *(`cookie-parser`)*

---

### ✅ Summary in one paragraph (for revision)
Every request has **two outcomes**, so this stage builds **two classes and one wrapper** in
`src/utils/`. **`asyncHandler`** is a **higher-order function** — `(fn) => (req,res,next) => {}`
— that wraps each controller, `Promise.resolve`s it and forwards any rejection to `next(err)`,
so **no controller ever contains a `try/catch`** and no async rejection goes unhandled.
**`apiError extends Error`**, calling `super(message)` and `Error.captureStackTrace`, and adds
`statusCode`, `success: false`, `data: null` and an `errors[]` array for multi-field validation
failures — a failing controller just does `throw new apiError(400, "...")`. **`apiResponse`**
mirrors it with `statusCode`, `data`, `message` and a **derived** `success = statusCode < 400`,
so a `404` can never claim success. Both classes expose the **same field names**, giving the
frontend a single contract. Around them, **`app.js`** configures Express — `cors` with an env
origin and `credentials: true`, `express.json` and `express.urlencoded` both capped at `16kb`
(a DoS guard), `express.static("public")`, and `cookieParser()` for reading/writing browser
cookies — and **`index.js`** chains `connectDB().then(() => app.listen(process.env.PORT || 8000))`
so the server only accepts traffic once Mongo is connected. The bugs to watch: the
**missing `return`** in `asyncHandler`'s braces (silently returns `undefined`), the **missing
`export`** in `apiResponse.js`, the **`statck`** typo, and the stray **`cookies-parser`**
package.
