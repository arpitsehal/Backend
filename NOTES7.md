# Backend Notes 7 — Connecting the Database (Two Approaches)

> **Project:** [`FullStack/`](FullStack/) — the app we now wire to MongoDB.
> **Prereq:** [NOTES5](NOTES5.md) (data modelling) + [NOTES6](NOTES6.md) (Prettier/best
> practices). We have schemas and a clean codebase; now we make the app actually **talk to a
> database**.

Everything so far described *shapes* of data. None of it runs until the app opens a live
connection to MongoDB. This note is about that single act — `connect to the DB` — done two
different ways, and the two rules that make either way safe.

The whole note comes down to **two golden rules**: the database lives *in another continent*,
so every DB call must be **`async/await`** (it always takes time) and **wrapped in
`try/catch`** (it can always fail). Get those two right and the rest is just *where* you put
the code.

---

## 1. The two golden rules (memorise these)

Every interviewer starts here, and every bug below is a violation of one of them.

| Rule | Why | In code |
|---|---|---|
| **1. Always `async/await`** | The DB is on a remote server — a network round-trip. It is **never** instant, so you must wait for it. | `const x = await mongoose.connect(...)` |
| **2. Always `try/catch`** | Networks drop, credentials expire, the URI is wrong. DB code **can and will** throw. | `try { await connect } catch (e) { ... }` |

> 🧠 **Interview line:** "Two things are guaranteed about a database: it's on another server so
> talking to it takes time, and that talk can fail. So every DB operation is `async/await`
> wrapped in `try/catch` — that's non-negotiable."

> 💡 **Mental model:** *"The database is always in another continent."* That one sentence
> forces both rules at once — distance means `await`, unreliability means `try/catch`.

---

## 2. First, the environment must be ready

Before either approach can connect, two things must be in place.

### 2.1 The connection string is a **secret** → `.env`

The Mongo URI holds your username, password and cluster host. It **never** goes in source
code. It lives in `.env` at the project root and is loaded at runtime by **dotenv**.

```
# .env  (never committed)
PORT=8000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxx.mongodb.net
```

### 2.2 Load `.env` **before anything else** — `index.js` line 1

```js
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
```

`dotenv.config()` reads the file and injects every key into `process.env`. This **must be the
very first thing that runs**, before `connectDB()` — otherwise `process.env.MONGODB_URI` is
`undefined` when the connection code reads it.

> 💡 **`"type": "module"` project → use `import`, not `require`.** Because `package.json` has
> `"type": "module"`, the whole file is an ES module. `require('dotenv')` throws
> `require is not defined`. Import syntax is mandatory. (There is also an experimental flag
> approach — `node -r dotenv/config` in the dev script — but importing it in code is the simple,
> reliable way.)

### 2.3 The DB name is a **constant** → `constants.js`

```js
// src/constants.js
export const DB_NAME = "ArpitDB";
```

The database name is fixed and reused, so it's a constant — not hard-coded into the URI, not a
secret in `.env`. We **append** it to the URI at connect time: `${MONGODB_URI}/${DB_NAME}`.

> 🧠 **Interview line:** "The URI (a secret) goes in `.env`; the database name (a non-secret
> constant) goes in a `constants.js` file. You concatenate them: URI + `/` + DB name."

---

## 3. Approach 1 — connect **inside `index.js`** (the IIFE)

The quick, everything-in-one-file way. An **IIFE** (Immediately Invoked Function Expression) —
an `async` function that defines and runs itself on the spot — opens the connection as the app
boots.

```js
import express from "express";
const app = express();

(async () => {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);

    app.on("error", (error) => {          // DB connected but Express can't run
      console.log("ERRR:", error);
      throw error;
    });

    app.listen(process.env.PORT, () => {
      console.log(`App is listening on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.error("ERROR:", error);
    throw error;
  }
})();
```

Read it piece by piece:

| Piece | What it does |
|---|---|
| `(async () => { ... })()` | **IIFE** — runs immediately at startup, and `async` lets us `await` inside it. |
| `await mongoose.connect(...)` | Rule 1 — wait for the remote DB. |
| `try / catch` | Rule 2 — catch a failed connection. |
| `app.on("error", ...)` | Handles the case where the **DB is fine but Express itself errors** (e.g. can't bind the port). Easy to forget. |
| `app.listen(PORT, ...)` | Only start the server **after** the DB is connected — a server with no DB is useless. |

> 💡 **The leading `;` trick.** In the real code the IIFE is often written `;(async () => {...})()`.
> The semicolon guards against **Automatic Semicolon Insertion** bugs — if the previous line
> didn't end in `;`, JS could glue it to the `(` and misread the IIFE as a function call. The
> `;` makes the IIFE self-contained.

**Downside:** the entry file now mixes *DB connection* + *server startup* + *error handling*.
It works, but it's cluttered and not reusable. That's why we refactor to Approach 2.

> 🧠 **Interview line:** "The IIFE approach connects right in the entry file using an
> immediately-invoked async function. It works but pollutes `index.js` by mixing database and
> server concerns — so production code moves the connection into its own file."

---

## 4. Approach 2 — a **dedicated `db/index.js`** (the professional way)

Give the connection its **own file and its own function**. `index.js` then does almost nothing
— it just calls `connectDB()`. This is **single responsibility**: one file, one job.

```js
// src/db/index.js
import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(
      `${process.env.MONGODB_URI}/${DB_NAME}`
    );
    console.log(
      `\n MongoDB connected ! DB HOST: ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.log("MONGODB connection error ", error);
    process.exit(1);
  }
};

export default connectDB;
```

```js
// src/index.js — now clean
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import connectDB from "./db/index.js";

connectDB();
```

What each detail buys you:

| Detail | Why it matters |
|---|---|
| `connectDB` in its own file | Reusable, testable, keeps `index.js` a **2-line** entry point. |
| `const connectionInstance = await ...` | `mongoose.connect` **returns** the connection object. Capturing it lets us inspect *what we connected to*. |
| `connectionInstance.connection.host` | Logs the **actual host**. A cheap sanity check so you never realise too late you connected to the **wrong** (e.g. production) database. |
| `process.exit(1)` | On a failed DB connection the app **cannot function**, so exit hard with a non-zero (failure) code instead of limping on. |
| `export default connectDB` | Default export → clean `import connectDB from "./db/index.js"`. |

> 🧠 **Interview line:** "Production code puts the DB connection in a separate `db/` file
> exporting a `connectDB` function. `index.js` just imports and calls it. It logs
> `connection.host` to confirm the target and `process.exit(1)` on failure because an app with
> no database shouldn't keep running."

---

## 5. The two approaches side by side

| | **Approach 1 — IIFE in `index.js`** | **Approach 2 — `db/index.js` function** |
|---|---|---|
| Where | All in the entry file | Own file (`src/db/index.js`) |
| Shape | Immediately-invoked async function | Named `connectDB` async function, exported |
| Entry file | Cluttered (DB + server + errors) | Clean — imports and calls `connectDB()` |
| Reusable? | No | Yes |
| On failure | `throw` | `process.exit(1)` |
| Verdict | Fine for a demo | **The professional choice** |

**Both** obey the two golden rules — `async/await` + `try/catch`. The only thing that changes
is *where the code lives*. Approach 2 wins because of **separation of concerns**: the entry
point boots the app; the db file knows how to connect.

---

## 6. Bugs & Gotchas (every one of these was a real bug here)

| Bug | Symptom | Cause / Fix |
|---|---|---|
| `require('dotenv')` in a module project | `ReferenceError: require is not defined in ES module scope` | `package.json` has `"type": "module"` → use `import dotenv from "dotenv"`. |
| Wrong env path `./env` | `.env` never loads; `MONGODB_URI` is `undefined` | The file is `.env`, so the path is `"./.env"` — not `"./env"` (a file literally named `env`). |
| **Single quotes** around the URI | `MongoParseError: Invalid scheme, expected ... "mongodb://"` | `'${process.env.MONGODB_URI}/${DB_NAME}'` is a **literal string** — `${}` only interpolates inside **backticks** `` ` ``. |
| Stray space in the string | Same invalid-scheme error | `.../ ${DB_NAME}` (space after `/`) corrupts the URI — remove it. |
| `dotenv.config()` called **after** `connectDB()` | `MONGODB_URI` is `undefined` at connect time | Load env on **line 1**, before importing/calling anything that reads `process.env`. |
| DB name **inside** the URI in `.env` | Double DB name / wrong DB | Keep the name in `constants.js` and append once as `/${DB_NAME}`; the `.env` URI ends at the host. |
| Trailing `/` on the URI in `.env` | `.../ArpitDB` becomes `...//ArpitDB` | The URI must **not** end in `/`; the code adds the `/` before `DB_NAME`. |
| No `try/catch` around `connect` | Unhandled promise rejection crashes the process | Rule 2 — always wrap DB calls. |
| Forgot `await` | Code runs before the DB is ready | Rule 1 — always `await` a DB call. |

> These are the fixes applied to `index.js` and `db/index.js` while writing this note:
> `require → import`, `./env → ./.env`, and single-quotes-to-**backticks** on the connect
> string (the classic invalid-scheme crash).

---

## 7. Interview Questions & Answers

**Q1. What two rules apply to *every* database operation?**
> `async/await` (it's a remote call, always takes time) and `try/catch` (it can always fail).
> "The database is in another continent."

**Q2. What are the two ways to connect the DB, and which is better?**
> (1) An **IIFE inside `index.js`** — quick but clutters the entry file. (2) A dedicated
> **`connectDB` function in `db/index.js`**, imported and called from `index.js`. Approach 2 is
> better — separation of concerns.

**Q3. What is an IIFE and why use one here?**
> An Immediately Invoked Function Expression — a function that defines and runs itself at once.
> Making it `async` lets us `await mongoose.connect` right at startup.

**Q4. Why capture the return of `mongoose.connect`?**
> It returns a connection instance. Logging `connectionInstance.connection.host` confirms
> **which host** you actually connected to — a guard against hitting the wrong database.

**Q5. Why `process.exit(1)` on a connection failure?**
> If the DB won't connect the app can't work, so exit with a non-zero (failure) code rather
> than run in a broken state.

**Q6. Why must `dotenv.config()` be the first thing to run?**
> It injects `.env` values into `process.env`. Any code that reads `process.env.MONGODB_URI`
> before it runs sees `undefined`.

**Q7. You got `require is not defined`. Why?**
> The project is an ES module (`"type": "module"`), so `require` doesn't exist — use `import`.

**Q8. Why did Mongo say "Invalid scheme"?**
> The connection string used single quotes, so `${...}` wasn't interpolated and Mongo received
> a literal `${process.env.MONGODB_URI}...`. Template literals need **backticks**.

**Q9. Where do the URI and the DB name each live, and why?**
> URI in `.env` (it's a secret with credentials); DB name in `constants.js` (a non-secret
> constant). Concatenate them at connect time.

---

## 8. Quick self-test (cover the answers)

1. The two golden rules of DB code? *(`async/await` + `try/catch`)*
2. One-line mental model? *("the database is in another continent")*
3. Two ways to connect? *(IIFE in `index.js`; `connectDB` in `db/index.js`)*
4. Which is professional and why? *(the separate file — separation of concerns)*
5. What does `connectionInstance.connection.host` tell you? *(the host you actually connected to)*
6. Why `process.exit(1)` on failure? *(app is useless without a DB — exit with a failure code)*
7. Where must `dotenv.config()` run? *(line 1, before anything reads `process.env`)*
8. `require is not defined` — fix? *(`"type": "module"` → use `import`)*
9. `Invalid scheme` — fix? *(use backticks, not single quotes, around the URI)*
10. Correct env path here? *(`"./.env"`, not `"./env"`)*

---

### ✅ Summary in one paragraph (for revision)
Connecting to a database rests on **two golden rules** — because the DB is *in another
continent*, every call is **`async/await`** (it takes time) and **`try/catch`** (it can fail).
First the environment is prepared: the secret **URI lives in `.env`** and is loaded on line 1
by `dotenv.config({ path: "./.env" })`, while the **DB name is a constant** in `constants.js`,
appended as `${MONGODB_URI}/${DB_NAME}`. Then there are **two ways to actually connect**:
**Approach 1** runs an **IIFE inside `index.js`** (an immediately-invoked async function that
`await`s `mongoose.connect`, wires `app.on("error")`, then `app.listen`) — quick but it
clutters the entry file; **Approach 2**, the professional one, puts a **`connectDB` async
function in its own `db/index.js`**, captures the connection to log `connection.host`, and
`process.exit(1)`s on failure — so `index.js` shrinks to `import connectDB` + `connectDB()`.
Approach 2 wins on **separation of concerns**. The classic bugs are all here: `require` in an
ES-module project (use `import`), the `./env` vs `./.env` path, and — the famous one — using
**single quotes instead of backticks** on the connection string, which makes Mongo reject the
literal `${...}` with *"Invalid scheme."*
