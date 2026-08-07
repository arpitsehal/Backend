# Backend Notes 9 — User & Video Models: Hooks, bcrypt & JWT

> **Project:** [`FullStack/`](FullStack/) — files touched: `src/models/user.model.js`,
> `src/models/video.model.js`, `package.json`.
> **Prereq:** [NOTES4](NOTES4.md) + [NOTES5](NOTES5.md) (schema/model, field options, `ObjectId`
> + `ref`, embed-vs-reference) and [NOTES8](NOTES8.md) (the `utils/` contract). We have a
> configured app and a live DB — this note builds the **two models the whole app revolves
> around**, and gives one of them **behaviour**.

NOTES4 and NOTES5 taught schemas as *shapes*: fields, types, options, references. Every model so
far was passive — a description of what a document looks like, and nothing more. This note is
where a schema stops being a shape and starts being an **object with behaviour**: it hashes its
own password before saving, it can check a password against itself, and it can mint its own JWTs.

The whole note comes down to **one idea**: **security logic belongs on the model, not in the
controller.** A password must be hashed *every* time a user is saved — so the hash runs in a
**pre-save hook** on the schema, not in whichever controller happened to remember. A token must
be signed with the user's own id — so the signer is an **instance method** on the document, not
a helper the controller imports. Put it on the model once, and it can never be forgotten.

---

## 1. The two models and how they relate

This project is a video platform, so it has two central entities and one relationship:

```
   User                                Video
   ├── username, email, fullname       ├── videoFile, thumbnail
   ├── avatar, coverImage              ├── title, description, duration
   ├── password  (hashed)              ├── views, isPublished
   ├── refreshToken                    └── owner ──────┐
   └── watchHistory [ ]────────────────────► Video     │
                     ▲                                 │
                     └─────────────────────────────────┘
                            (both directions referenced)
```

| Relationship | Direction | Why this way |
|---|---|---|
| `Video.owner` → `User` | **many-to-one** | Every video has exactly one uploader. A single `ObjectId`. |
| `User.watchHistory` → `[Video]` | **one-to-many** | A user watches many videos. An **array** of `ObjectId`. |

Both sides are **referenced, never embedded** — the NOTES5 decision applied. A video document is
large and changes independently (views tick up constantly); duplicating it inside every user's
watch history would be unbounded growth plus a consistency nightmare.

> 🧠 **Interview line:** "The two models reference each other by `ObjectId`. `Video.owner` is a
> single ref to `User`; `User.watchHistory` is an array of refs to `Video`. Both are references
> rather than embedded documents because videos are large, mutate independently, and the watch
> history is unbounded."

> 💡 **Mental model:** *"Shape on the schema, behaviour on the schema too."*

---

## 2. `user.model.js` — the schema, field by field

```js
import mongoose, { Schema } from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const userSchema = new Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    fullname: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    avatar: {
        type: String,          // cloudinary url
        required: true,
    },
    coverImage: {
        type: String,          // cloudinary url
    },
    watchHistory: [{
        type: Schema.Types.ObjectId,
        ref: "Video"
    }],
    password: {
        type: String,
        required: [true, "Password is required"],
    },
    refreshToken: {
        type: String,
    }
}, { timestamps: true });
```

### 2.1 The field options that matter here

| Option | Effect | Why it's used |
|---|---|---|
| `required: true` | Validation — reject the document if missing. | Non-negotiable fields. |
| `required: [true, "Password is required"]` | Same, but with a **custom error message**. | The array form is `[condition, message]`. That string is what the client actually sees, so write it for a human. |
| `unique: true` | Creates a **unique index** in MongoDB. | No two users share a username or email. |
| `lowercase: true` | Mongoose lowercases the value **before saving**. | `Arpit@x.com` and `arpit@x.com` must be the same account. Normalising at the model level means no controller can forget. |
| `trim: true` | Strips leading/trailing whitespace. | `" arpit "` and `"arpit"` are the same username. Prevents duplicate-looking accounts. |
| `index: true` | Builds a **B-tree index** on that field. | Makes lookups/searches on it fast. |
| `timestamps: true` | Adds `createdAt` / `updatedAt` automatically. | Free audit trail. |

### 2.2 `index: true` — the cost/benefit you must be able to state

An index makes **reads** fast and **writes** slightly slower, and it consumes disk. So it is not
free and you do not sprinkle it everywhere.

- `username` and `fullname` get `index: true` because they are the fields a **search box** will
  query.
- `email` does **not** get an explicit `index: true` here — but note it already has `unique: true`,
  and **`unique` creates an index anyway**. So email is indexed regardless.

> ⚠️ **`unique` is not a validator** (this trap is in [NOTES4](NOTES4.md)). It's a **database
> index constraint**. It produces a MongoDB `E11000 duplicate key` error, not a Mongoose
> validation error — and if duplicates already exist in the collection when the index is built,
> the index silently fails to build. Always check for an existing user in the controller *as
> well*, and return a clean `409` via `apiError`.

> 🧠 **Interview line:** "`unique` isn't validation — it creates a unique index in MongoDB and
> surfaces as an `E11000` duplicate-key error. I still check for an existing user in the
> controller so I can return a proper 409 instead of leaking a driver error."

### 2.3 `watchHistory` — one-to-many, as an array of refs

```js
watchHistory: [{
    type: Schema.Types.ObjectId,
    ref: "Video"
}]
```

Exactly the NOTES4 pattern: a single reference wrapped in `[ ]`. The string in `ref` must match
the **first argument of `mongoose.model()`** for that model — `"Video"` here, not `"videos"`.
Get it wrong and `.populate()` silently returns `null`.

---

## 3. `video.model.js` — schema plus a plugin

```js
import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const videoSchema = new Schema({
    videoFile:   { type: String,  required: true },   // cloudinary url
    thumbnail:   { type: String,  required: true },   // cloudinary url
    title:       { type: String,  required: true },
    description: { type: String,  required: true },
    duration:    { type: Number,  required: true },   // seconds, from cloudinary
    views:       { type: Number,  default: 0 },
    isPublished: { type: Boolean, default: true },
    owner:       { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

videoSchema.plugin(mongooseAggregatePaginate);

export const Video = mongoose.model("Video", videoSchema);
```

| Field | Note |
|---|---|
| `videoFile`, `thumbnail` | **URLs, not binary.** The file lives on a CDN (Cloudinary/S3); Mongo stores only the link. This is the NOTES5 "images and files" rule — *never put a blob in your database*. |
| `duration` | A **`Number`** (seconds). The upload service returns it, so you don't compute it. |
| `views` | `default: 0` — a counter must start somewhere, and `undefined + 1` is `NaN`. |
| `isPublished` | `default: true` — the flag that powers draft/private videos and soft-unpublishing. A boolean flag beats deleting rows. |
| `owner` | The `ObjectId` ref back to `User`. |

### 3.1 `schema.plugin()` — what a Mongoose plugin is

```js
videoSchema.plugin(mongooseAggregatePaginate);
```

A **plugin** is a function that receives your schema and adds things to it — fields, methods,
statics, hooks. `.plugin()` is how you install it. It's the schema-level equivalent of
`app.use()` in Express: *"attach this reusable capability."*

`mongoose-aggregate-paginate-v2` adds a single static — **`Video.aggregatePaginate()`** — which
runs an **aggregation pipeline** and returns it **paginated**:

```js
const result = await Video.aggregatePaginate(pipeline, { page: 2, limit: 10 });
// → { docs, totalDocs, limit, page, totalPages, hasNextPage, hasPrevPage, ... }
```

**Why it's installed now, before it's used:** a video feed can never be `find()`-everything —
that's a million documents down the wire. You need pages. And a real feed isn't a plain `find`
either: it joins the owner, counts likes, filters published — that's an **aggregation pipeline**.
This plugin is the one that paginates *pipelines* (the plain `mongoose-paginate-v2` only
paginates simple queries).

> 🧠 **Interview line:** "I add `mongoose-aggregate-paginate-v2` as a schema plugin on the video
> model. A plugin extends a schema with reusable functionality — here it adds an
> `aggregatePaginate` static so the video feed can run a full aggregation pipeline and still
> return one page at a time, instead of loading every document."

---

## 4. `bcrypt` — never store a password

```js
this.password = await bcrypt.hash(this.password, 10);
```

You **cannot** store passwords as plain text, and you **must not** store them with a plain hash
like MD5/SHA-256 either. bcrypt exists because it is deliberately **slow** and **salted**.

| Property | What it means | Why it matters |
|---|---|---|
| **One-way** | Hashing is not reversible. There is no `unhash()`. | Even with full DB access, an attacker doesn't get the passwords. |
| **Salted** | A random salt is generated per password and stored *inside* the hash string. | Two users with the password `123456` get **different** hashes. Rainbow tables are useless. |
| **Slow (cost factor)** | The `10` is the number of rounds — `2^10` iterations. | A fast hash lets an attacker try billions/second offline. Slowness is the *feature*. |
| **Self-describing** | The output `$2b$10$...` embeds algorithm, cost and salt. | `compare()` needs nothing else to verify. |

### 4.1 The cost factor (`10`)

Cost is **exponential** — `12` is 4× the work of `10`. `10` is the common default; `12` is a
reasonable production choice. Too high and your own login endpoint becomes the bottleneck (and a
DoS vector). It's a **security-vs-latency** dial, and knowing that is the interview answer.

### 4.2 `bcrypt` vs `bcryptjs` — pick one

| | `bcrypt` | `bcryptjs` |
|---|---|---|
| Implementation | Native C++ addon | Pure JavaScript |
| Speed | Faster | ~30% slower |
| Install | Needs a build toolchain / prebuilt binary | Zero build step, works anywhere |
| API | Same (`hash`, `compare`) | Same |

They are **drop-in compatible** — hashes from one verify with the other. But you must **install
the one you import**. Importing `bcryptjs` while `bcrypt` is in `package.json` is a
`MODULE_NOT_FOUND` at boot (see §9).

> 🧠 **Interview line:** "Passwords go through bcrypt, never plain text and never a fast hash.
> bcrypt is one-way, auto-salts each password so identical passwords produce different hashes,
> and its cost factor makes it deliberately slow — that slowness is what makes offline brute
> force impractical."

---

## 5. Mongoose hooks — `pre("save")`

This is the centrepiece of the note.

```js
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});
```

A **hook** (Mongoose calls it *middleware*) is a function that runs **around a document
lifecycle event**. `pre("save")` runs **just before** a document is written to the database —
every time, from anywhere in the codebase.

### 5.1 Why a hook instead of hashing in the controller

Because the controller is the *wrong place to hold a rule*. There will be a register controller,
a change-password controller, a reset-password controller, and a seed script. Each is a chance to
forget. The hook is **one line, in one file, that cannot be bypassed** — anything that calls
`.save()` gets hashed. Same principle as `apiResponse` in NOTES8: define the rule once.

### 5.2 `function` — not an arrow function

```js
userSchema.pre("save", async function (next) { ... });   // ✅
userSchema.pre("save", async (next) => { ... });         // ❌ broken
```

The hook needs `this` to be **the document being saved** (`this.password`, `this.isModified`).
Mongoose supplies that by calling the function with the document as its `this`. An **arrow
function has no own `this`** — it inherits the surrounding module scope, so `this.password` is
`undefined` and the hash silently produces garbage. **This is the single most common bug in this
file.**

> ⚠️ Rule of thumb: **any Mongoose callback that needs the document — hooks, `methods`, virtuals,
> `statics` — must be a regular `function`.** Arrow functions are fine everywhere else.

### 5.3 `next()` — and why the guard returns it

`next` is the **continuation callback**. Mongoose waits for it before proceeding with the actual
save. Two rules:

- **Forget to call `next()`** → the save hangs forever. The request never responds.
- **Call `next()` twice** → Mongoose throws or double-runs the chain.

Hence `return next()` in the guard, not just `next()` — the `return` stops the function so the
hash below can't also run and call `next()` a second time.

### 5.4 `if (!this.isModified("password")) return next()` — the guard that prevents a real bug

Without it, **every** `.save()` re-hashes the password.

```
user.avatar = "new-url.jpg";
await user.save();          // no guard → password gets hashed AGAIN
```

Now the stored value is `hash(hash(password))`. `bcrypt.compare(plainPassword, storedHash)`
returns `false`, and the user is **permanently locked out** — with no error anywhere. Updating an
avatar silently destroys the account.

`this.isModified(path)` returns `true` only if that field changed since the document was loaded.
So: *hash only when the password actually changed.*

> 🧠 **Interview line:** "I hash in a `pre('save')` hook rather than the controller, so every code
> path that saves a user hashes automatically. It has to be a regular `function` because the hook
> needs `this` to be the document, and it's guarded with `this.isModified('password')` — without
> that, updating any unrelated field would re-hash the existing hash and lock the user out."

---

## 6. Custom instance methods — `schema.methods`

Mongoose lets you attach your own methods to every document of a model:

```js
userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};
```

```js
const user = await User.findOne({ email });
const ok = await user.isPasswordCorrect(req.body.password);   // → true / false
if (!ok) throw new apiError(401, "Invalid credentials");
```

| Piece | Why |
|---|---|
| `schema.methods.x` | An **instance** method — available on a document (`user.x()`). |
| `schema.statics.x` | A **model** method — available on the model (`User.x()`). *(The plugin in §3 adds a static.)* |
| `function`, not arrow | Needs `this` = the document, exactly as in §5.2. |
| `async` / `await` | `bcrypt.compare` is asynchronous — it's doing that deliberately-slow work. |
| `bcrypt.compare(plain, hash)` | Argument order is **(plain, hash)**. It re-hashes `plain` using the salt embedded in `hash` and compares in **constant time** (no timing leak). |

**Never** write `if (hash(input) === storedHash)` yourself — the salt is per-password, so the
comparison only works through `compare()`.

> 💡 **Why on the model at all?** The controller shouldn't know that passwords are bcrypt, or
> that they're salted. It asks a question — *is this password correct?* — and the model answers.
> Swap bcrypt for argon2 tomorrow and no controller changes.

---

## 7. JWT — what it actually is

```js
import jwt from "jsonwebtoken";
```

A **JSON Web Token** is a **string that carries data and is cryptographically signed**. It is the
answer to *"the user logged in one request ago — how do I know it's still them?"* without storing
a session on the server.

### 7.1 The three parts

```
eyJhbGciOiJIUzI1NiJ9 . eyJfaWQiOiI2NGYuLi4ifQ . SflKxwRJSMeKKF2QT4fwpM
└──── header ────────┘ └──── payload ────────┘ └───── signature ─────┘
   algorithm & type      the claims (your data)   HMAC(header.payload, SECRET)
```

| Part | Contents |
|---|---|
| **Header** | Which algorithm signed it (`HS256`) and the type (`JWT`). |
| **Payload** | Your **claims** — here `_id`, `email`, `username`, `fullname`, plus `iat` (issued at) and `exp` (expiry) added automatically. |
| **Signature** | `HMAC(header + payload, secret)`. Only the server knows the secret. |

> ⚠️ **A JWT is signed, NOT encrypted.** The payload is **base64url**, not ciphertext — anyone
> can paste the token into jwt.io and read it. So: **never put a password, card number or any
> secret in the payload.** The signature guarantees the payload was *not tampered with*; it does
> not hide it. This is the most commonly-missed JWT question in interviews.

### 7.2 Why the signature makes it trustworthy

Change one character of the payload and the signature no longer matches, because you'd need the
secret to recompute it. So the server can accept a token from a hostile client and still trust
its contents — **statelessly**, without a database lookup. That's the whole point: no session
table, so any server instance behind a load balancer can validate any request.

### 7.3 `jwt.sign(payload, secret, options)`

```js
jwt.sign(
  { _id: this._id, email: this.email },   // payload — the claims
  process.env.ACCESS_TOKEN_SECRET,        // secret — from .env, never in code
  { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }   // options — "1d", "10m", ...
);
```

- **`sign` is synchronous** when no callback is passed — that's why these methods aren't `async`.
- **`expiresIn`** accepts a string like `"1d"`, `"15m"`, `"10d"` (or a number of seconds). It
  writes an `exp` claim; `jwt.verify()` rejects the token automatically once past it.
- **The secret must come from `.env`.** Hard-code it and anyone with repo access can forge tokens
  for any user id. Rotating the secret instantly invalidates every issued token — which is a
  feature.

---

## 8. Access token vs refresh token — the strategy

Two token generators, deliberately different:

```js
userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        { _id: this._id, email: this.email, username: this.username, fullname: this.fullname },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }        // short — e.g. "1d"
    );
};

userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        { _id: this._id },                                     // minimal payload
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }        // long — e.g. "10d"
    );
};
```

| | **Access token** | **Refresh token** |
|---|---|---|
| **Purpose** | Sent with every request to prove identity | Used only to get a **new** access token |
| **Lifetime** | **Short** — minutes to a day | **Long** — days to weeks |
| **Payload** | Rich: `_id`, `email`, `username`, `fullname` | Minimal: `_id` only |
| **Secret** | `ACCESS_TOKEN_SECRET` | `REFRESH_TOKEN_SECRET` (a **different** secret) |
| **Stored in DB?** | **No** — fully stateless | **Yes** — on the `refreshToken` field |
| **If stolen** | Damage window is short | Serious — but it can be **revoked** |

### 8.1 Why two tokens exist at all

It's a trade-off between two things you can't have at once:

- A **long-lived** token is convenient (users don't re-login daily) but a stolen one is valid for
  weeks and **cannot be revoked** — a JWT is stateless, the server has nothing to delete.
- A **short-lived** token is safe but forces a login every few minutes.

The split gives you both. The **access token is short-lived and stateless** — checked purely by
signature, no DB hit, on every single request. The **refresh token is long-lived but stateful** —
it's stored on the user document, so it *can* be revoked: set `user.refreshToken = null` and that
session is dead immediately. Logout, "log out all devices", and force-invalidation all become
possible.

### 8.2 The flow

```
login  ──► verify password (isPasswordCorrect)
       ──► generateAccessToken()  +  generateRefreshToken()
       ──► save refreshToken on the user document
       ──► send both back as httpOnly cookies

request ─► send access token  ──► verify signature ──► ✅ proceed   (no DB hit)

access expired (401) ─► send refresh token
                     ─► verify signature  AND  match it against user.refreshToken in DB
                     ─► issue a fresh access token (and rotate the refresh token)
```

That DB match in the refresh step is the whole reason the field exists on the schema. A refresh
token with a valid signature but which **doesn't match what's stored** is rejected — that's how a
revoked or already-rotated token gets caught.

### 8.3 Why the refresh token payload is minimal

An access token is decoded on every request, so packing `email`/`username` into it saves a DB
lookup for common needs. A refresh token is used rarely and its only job is *"which user?"* —
`_id` is enough. Less in the payload means less leaked if it's intercepted, and a smaller token.

> 🧠 **Interview line:** "I issue two JWTs. The access token is short-lived with a small user
> payload and is verified purely by signature, so authenticated requests don't touch the
> database. The refresh token is long-lived, carries only the user id, is signed with a separate
> secret, and is persisted on the user document — so it can be matched and revoked. That gives
> stateless auth on the hot path with the ability to invalidate a session."

---

## 9. Environment variables this note requires

```env
ACCESS_TOKEN_SECRET=<long random string>
ACCESS_TOKEN_EXPIRY=1d
REFRESH_TOKEN_SECRET=<a different long random string>
REFRESH_TOKEN_EXPIRY=10d
```

| Rule | Why |
|---|---|
| Two **different** secrets | If one leaks, the other token type is still safe. Reusing one secret means a leaked access-token secret lets an attacker forge refresh tokens too. |
| Long and random | It's an HMAC key. `"secret123"` is brute-forceable offline. |
| Never committed | `.env` is gitignored; `.env.example` documents the **names** only. |
| Names must match the code **exactly** | `process.env.TYPO` is `undefined`, and `jwt.sign` with an undefined secret throws `secretOrPrivateKey must have a value` at runtime. See §10. |

---

## 10. New dependencies

```json
"dependencies": {
  "bcrypt": "^6.0.0",
  "jsonwebtoken": "^9.0.3",
  "mongoose-aggregate-paginate-v2": "^1.1.4"
}
```

| Package | Purpose |
|---|---|
| `bcrypt` | One-way, salted, deliberately-slow password hashing. (Or `bcryptjs` — pick one, see §4.2.) |
| `jsonwebtoken` | `sign()` / `verify()` for JWTs. |
| `mongoose-aggregate-paginate-v2` | Schema plugin adding `aggregatePaginate()` for paginated aggregation pipelines. |

---

## 11. Bugs & Gotchas (every one of these is a real bug in this code)

| Bug | Symptom | Cause / Fix |
|---|---|---|
| **`const mongoose, { Schema } = require("mongoose")`** in `video.model.js` | `SyntaxError: Missing initializer in const declaration` — the file won't even parse | Two errors in one line: (1) `const a, {b} = x` is **not valid JS** — you can't declare-then-destructure in one statement; (2) it mixes **CommonJS `require`** into a file that uses `import` on the very next line, in an ESM project (`"type": "module"`). **Fix:** `import mongoose, { Schema } from "mongoose";` — matching `user.model.js`. |
| **`import bcrypt from "bcryptjs"` but `bcrypt` is installed** | `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'bcryptjs'` at startup | The import name and the installed package must match. Either `npm i bcryptjs` or change the import to `"bcrypt"`. They're API-compatible, so either fix works — but do exactly one. |
| **`mongoose-aggregate-paginate-v2` imported, never installed** | `ERR_MODULE_NOT_FOUND` when `video.model.js` is first imported | The plugin was written into the schema before `npm i mongoose-aggregate-paginate-v2` was run. Install it. |
| **`process.env.JWT_SECRET` in `generateAccessToken`** | `Error: secretOrPrivateKey must have a value` — but only at **login time**, not at boot | The `.env` file defines **`ACCESS_TOKEN_SECRET`**; the code reads `JWT_SECRET`, which is `undefined`. Note `generateRefreshToken` correctly uses `REFRESH_TOKEN_SECRET` — so the two are **inconsistent**. **Fix:** use `process.env.ACCESS_TOKEN_SECRET`. A whole class of env bugs: the code and the `.env` must agree on the exact name. |
| **`bcrypt` / `jsonwebtoken` installed in the root `package.json`** | `MODULE_NOT_FOUND` in `FullStack/` even though `npm ls` at the root shows them | The root is a **separate CommonJS project**; the app lives in `FullStack/` with its own `package.json` and its own `node_modules`. Dependencies must be installed **in the directory that imports them** — `cd FullStack && npm i bcrypt jsonwebtoken mongoose-aggregate-paginate-v2`. |
| **Arrow function in `pre("save")`** | Password saved as `undefined`/garbage; login always fails, no error thrown | An arrow function has no own `this`, so `this.password` isn't the document's field. **Must be `function`.** (§5.2) |
| **Missing `isModified` guard** | User silently locked out after any unrelated profile update | Every `.save()` re-hashes → `hash(hash(pw))`. `compare()` then always fails. **Always guard.** (§5.4) |
| **Forgetting `next()`** (or not `return`ing it in the guard) | Request hangs until timeout / `next()` called twice | Mongoose waits on `next`. `return next()` in the guard, `next()` at the end — exactly once. |
| **Missing `await` on `bcrypt.hash`** | Password field stores `[object Promise]` | `hash` returns a promise. `this.password = await bcrypt.hash(...)`. |
| **`bcrypt.compare(hash, plain)` — arguments swapped** | Always returns `false` | Order is **`compare(plainText, hash)`**. |
| **`duration` commented as "cloudinary url"** | None — cosmetic | The type is `Number` (seconds); the copy-pasted comment is wrong. Misleading comments cost real debugging time later. |
| **Secrets in the payload** | Total compromise | The JWT payload is base64, **not encrypted** — readable by anyone. Never put a password or key in it. (§7.1) |
| **`ref: "Video"` mismatch** | `.populate()` returns `null` with no error | The `ref` string must exactly match `mongoose.model("Video", ...)`. |
| **Relying on `unique: true` for validation** | Raw `E11000` driver error leaks to the client | It's an index, not a validator. Check for an existing user in the controller and `throw new apiError(409, ...)`. |
| **Storing the refresh token in plain text** | A DB leak hands over live sessions | Works, and is what's done here — but hashing the stored refresh token is the hardened version. Worth saying out loud in an interview. |

> These are the concrete fixes to apply: rewrite the **`video.model.js` import line**, align
> **`bcrypt` vs `bcryptjs`**, install **`mongoose-aggregate-paginate-v2`**, change
> **`JWT_SECRET` → `ACCESS_TOKEN_SECRET`**, and move the new dependencies into
> **`FullStack/package.json`**.

---

## 12. Interview Questions & Answers

**Q1. Why hash a password in a `pre("save")` hook instead of in the controller?**
> Because it's a rule about the data, not about one request. Register, change-password,
> reset-password and any seed script all call `.save()` — the hook guarantees every one of them
> hashes, with no chance of a controller forgetting.

**Q2. Why must a Mongoose hook be a regular `function`, not an arrow function?**
> The hook needs `this` bound to the document being saved. Arrow functions don't have their own
> `this`; they inherit from the enclosing scope, so `this.password` would be `undefined`.

**Q3. What does `this.isModified("password")` do, and what breaks without it?**
> It returns `true` only when that field changed. Without the guard, saving *any* field re-hashes
> the already-hashed password, so `bcrypt.compare` never matches again and the user is
> permanently locked out.

**Q4. What is `next()` in a Mongoose hook?**
> The continuation callback. Mongoose won't proceed with the save until it's called. Omit it and
> the operation hangs; call it twice and the middleware chain misbehaves — hence `return next()`
> in the early-exit branch.

**Q5. Why bcrypt and not SHA-256?**
> SHA-256 is fast, which is exactly wrong for passwords — an attacker can try billions per second
> offline. bcrypt is deliberately slow with a tunable cost factor, and auto-salts each password so
> identical passwords hash differently and rainbow tables don't apply.

**Q6. What is the `10` in `bcrypt.hash(password, 10)`?**
> The cost factor — `2^10` rounds. It's exponential, so it's a dial between security and login
> latency. Raising it makes brute force proportionally harder and your own endpoint slower.

**Q7. Why can't you just compare hashes yourself?**
> Because the salt is random per password, so hashing the same input twice gives different
> output. `bcrypt.compare` extracts the salt from the stored hash, re-hashes with it, and
> compares in constant time to avoid a timing side-channel.

**Q8. What is a JWT and what are its three parts?**
> A signed token: header (algorithm), payload (claims), signature (HMAC of the first two with a
> server secret). Tampering with the payload invalidates the signature, so the server can trust a
> token that was stored on the client.

**Q9. Is a JWT encrypted?**
> **No.** The payload is base64url-encoded and readable by anyone holding the token. Signing
> guarantees integrity, not confidentiality — so never put secrets in the payload.

**Q10. Access token vs refresh token — what's the difference and why have both?**
> The access token is short-lived, stateless and sent on every request. The refresh token is
> long-lived, stored in the DB, and only used to mint new access tokens. Together they give you
> the convenience of long sessions with the safety of short-lived credentials — and because the
> refresh token is stored, a session can actually be revoked.

**Q11. Why is the refresh token saved on the user document?**
> So it can be matched and invalidated. A stateless JWT can't be revoked; storing the refresh
> token means logout, token rotation and "log out everywhere" become possible — you just clear
> the field.

**Q12. Why do the two tokens use different secrets?**
> Blast-radius containment. If the access-token secret leaks, an attacker can forge access tokens
> — but not refresh tokens, so they can't mint an indefinite session.

**Q13. Why does the refresh token carry only `_id`?**
> Its only job is identifying the user. A smaller payload leaks less if intercepted, and the
> extra claims in the access token exist purely to avoid a DB lookup on hot requests.

**Q14. What is `schema.methods` vs `schema.statics`?**
> `methods` attaches to **documents** (`user.isPasswordCorrect()`); `statics` attaches to the
> **model** (`Video.aggregatePaginate()`). Both need regular `function`s if they use `this`.

**Q15. What is a Mongoose plugin?**
> A reusable function that receives a schema and extends it with fields, methods, statics or
> hooks — installed with `schema.plugin(fn)`. `mongoose-aggregate-paginate-v2` adds an
> `aggregatePaginate` static for paginating aggregation pipelines.

**Q16. Why paginate the video feed with an *aggregate* paginator specifically?**
> Because a real feed isn't a plain `find` — it joins the owner, counts likes and filters, which
> is an aggregation pipeline. The plain paginator only handles simple queries; this one paginates
> pipelines.

**Q17. Why `lowercase: true` and `trim: true` on username and email?**
> Normalisation at the model layer. Without it `"Arpit "` and `"arpit"` create two accounts, and
> a user who types their email with a capital can't log in. Doing it on the schema means no
> controller can skip it.

**Q18. When do you add `index: true`?**
> On fields you query or search often. It speeds reads at the cost of slower writes and more
> disk, so it's a deliberate choice — not something to add everywhere. Note `unique: true`
> already creates an index.

**Q19. Why are the file fields Strings?**
> They hold CDN URLs. Binary files go to Cloudinary/S3; the database stores only the reference.
> Blobs in Mongo bloat documents and blow past the 16 MB document limit.

**Q20. Why `isPublished` instead of deleting a video?**
> A boolean flag is a reversible soft state — drafts, unlisting and moderation all work without
> destroying data or breaking every `watchHistory` reference that points at it.

---

## 13. Quick self-test (cover the answers)

1. Where does password hashing live, and why there? *(a `pre("save")` hook — one rule, unbypassable)*
2. Why `function` and not `=>` in a hook? *(`this` must be the document)*
3. What breaks without `this.isModified("password")`? *(double hashing → permanent lockout)*
4. What happens if you never call `next()`? *(the save hangs forever)*
5. Two properties that make bcrypt right for passwords? *(salted per-password / deliberately slow)*
6. What is the `10`? *(cost factor — `2^10` rounds, exponential)*
7. Correct argument order for compare? *(`compare(plainText, hash)`)*
8. Three parts of a JWT? *(header / payload / signature)*
9. Is the payload encrypted? *(**no** — base64, readable; signed only)*
10. Access token: lifetime, storage, payload? *(short / not stored / rich)*
11. Refresh token: lifetime, storage, payload? *(long / stored on the user doc / `_id` only)*
12. Why store the refresh token at all? *(so it can be matched and revoked)*
13. Why two different secrets? *(one leak doesn't compromise the other)*
14. `methods` vs `statics`? *(document-level vs model-level)*
15. What does `schema.plugin()` do? *(installs reusable schema functionality)*
16. Why does `unique: true` not count as validation? *(it's a DB index → `E11000`, not a validator)*
17. Why are `videoFile` and `avatar` Strings? *(CDN URLs — files never live in Mongo)*
18. Which env vars must exist for login to work? *(`ACCESS_TOKEN_SECRET`/`EXPIRY`, `REFRESH_TOKEN_SECRET`/`EXPIRY`)*

---

### ✅ Summary in one paragraph (for revision)
This stage builds the two models the app revolves around and, crucially, **gives the user model
behaviour**. `User` and `Video` reference each other by **`ObjectId`** — `Video.owner` is a single
ref, `User.watchHistory` an array of refs — never embedded, because videos are large and mutate
independently. Field options do the normalising (`lowercase`, `trim`) and the indexing (`index`
for searchable fields; `unique` creates an index too, and is **not** a validator). The video
schema installs **`mongoose-aggregate-paginate-v2`** via `schema.plugin()`, adding an
`aggregatePaginate` static so the feed can run a full pipeline and still return one page.
Passwords are hashed with **bcrypt** — one-way, auto-salted, and deliberately slow via a cost
factor of `10` — inside a **`pre("save")` hook**, so every code path that saves a user hashes
automatically. That hook must be a regular **`function`** (it needs `this` to be the document),
must call **`next()`** exactly once, and must be guarded with **`this.isModified("password")`** or
an unrelated profile update re-hashes the hash and locks the user out forever. Verification lives
on the model too, as the instance method **`isPasswordCorrect`**, which delegates to
`bcrypt.compare(plain, hash)`. Auth then issues **two JWTs**: a **short-lived access token** with
a rich payload, verified by signature alone so authenticated requests never hit the database, and
a **long-lived refresh token** carrying only `_id`, signed with a **separate secret** and
**persisted on the user document** so a session can actually be revoked. Remember that a JWT is
**signed, not encrypted** — the payload is public — and that all four secrets/expiries come from
`.env` under names that must match the code **exactly**; the bugs here are the invalid
`require` line in `video.model.js`, the `bcryptjs`/`bcrypt` mismatch, the uninstalled paginate
plugin, and `JWT_SECRET` where `.env` says `ACCESS_TOKEN_SECRET`.
