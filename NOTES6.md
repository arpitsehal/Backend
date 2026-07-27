# Backend Notes 6 — Production-Ready Setup (Prettier & Best Practices)

> **Project:** [`FullStack/`](FullStack/) — the app we're setting up for production.
> **Prereq:** [NOTES5](NOTES5.md) — data modelling. This note is a small but important
> detour: before we write more features, we make the codebase **consistent and professional**.

Up to now we cared about *what the code does*. A production-ready app also cares about *how
the code looks* — because a team reads code far more than it writes it. The first best
practice we apply is a **code formatter**: **Prettier**. Set it up once, and every file in
the project follows the same style automatically — no more arguing about tabs vs spaces or
semicolons in a pull request.

The whole note comes down to **one idea**: *style is a machine's job, not a human's.*

---

## 1. Why a formatter at all?

On a real team, everyone's editor formats differently — one person uses 4 spaces, another
uses tabs, someone else adds semicolons and someone doesn't. The result is messy diffs full
of whitespace changes that hide the real code change.

A **formatter** fixes this by rewriting your code to **one agreed style** on save. You stop
thinking about formatting entirely; the tool guarantees it.

| | Without a formatter | With Prettier |
|---|---|---|
| Style | Whatever each dev's editor does | One style, project-wide |
| Diffs | Noisy — full of whitespace changes | Clean — only real changes show |
| Reviews | Arguments about style | Zero style discussion |

> 🧠 **Interview line:** "Prettier is an opinionated code formatter. It enforces one
> consistent style across the whole team automatically, so code reviews focus on logic, not
> whitespace."

---

## 2. Installing Prettier — as a **dev dependency**

```bash
npm i -D prettier
```

`-D` (short for `--save-dev`) installs it as a **devDependency**. This is a deliberate
choice, and interviewers ask about it:

```json
"devDependencies": {
  "nodemon": "^3.1.14",
  "prettier": "^3.9.6"
}
```

- **`dependencies`** — packages the app **needs at runtime** in production (e.g. `express`).
- **`devDependencies`** — tools you only need **while developing**: formatters, test runners,
  `nodemon`. They're not shipped/installed in the production build (`npm install --production`
  skips them), keeping the deployed app lean.

Prettier and nodemon are both pure dev tools — the running server never calls them — so both
belong in `devDependencies`.

> 🧠 **Interview line:** "`dependencies` are needed at runtime; `devDependencies` are needed
> only during development — formatters, linters, test tools. Prettier goes in devDependencies."

---

## 3. `.prettierrc` — the config file

A dotfile at the project root that tells Prettier **how** to format. It's JSON:

```json
{
  "singleQuote": false,
  "bracketSpacing": true,
  "tabWidth": 2,
  "semi": true,
  "trailingComma": "es5"
}
```

Line by line — each is a formatting rule everyone on the project now shares:

| Option | Value | What it does |
|---|---|---|
| `singleQuote` | `false` | Use **double** quotes → `"hello"`, not `'hello'` |
| `bracketSpacing` | `true` | Spaces inside object braces → `{ a: 1 }`, not `{a: 1}` |
| `tabWidth` | `2` | Indent with **2 spaces** per level |
| `semi` | `true` | Always end statements with a **semicolon** |
| `trailingComma` | `"es5"` | Add trailing commas where ES5 allows (arrays, objects) |

> 💡 **`.prettierrc` = the single source of truth for style.** Commit it, and every teammate's
> Prettier formats identically — the config, not each person's editor, decides.

---

## 4. `.prettierignore` — what NOT to format

Just like `.gitignore`, this lists files/folders Prettier should **skip**:

```
*.env
.env

/.vscode
/node_modules
./dist
```

Why ignore each of these:
- **`.env` / `*.env`** — secrets and config; you never want a formatter touching them.
- **`/node_modules`** — third-party code; not yours to reformat (and huge — would waste time).
- **`/.vscode`** — editor settings, not source code.
- **`./dist`** — the **build output**; it's generated, so formatting it is pointless.

> 🧠 **Interview line:** "`.prettierignore` works like `.gitignore` — it excludes generated
> and third-party files (`node_modules`, `dist`) and secrets (`.env`) from formatting."

---

## 5. The three files, together

A complete Prettier setup is just **three small pieces** at the project root:

```
FullStack/
├── package.json        prettier listed under devDependencies
├── .prettierrc         HOW to format (the style rules)
└── .prettierignore     WHAT to skip (generated / secret files)
```

That's the entire setup. Install once, add two dotfiles, and the whole project is formatted
consistently forever.

---

## 6. Bugs & Gotchas

| Bug | Symptom | Cause |
|---|---|---|
| Prettier in `dependencies` | Bloated production install | Dev tools belong in `devDependencies` (`-D`) |
| `.prettierrc` has a trailing comma / comment | Prettier errors on its own config | The config is **strict JSON** — no comments, no trailing commas |
| Forgot `.prettierignore` | `node_modules` gets reformatted / slow | Always exclude generated + third-party folders |
| Config committed but styles still differ | Editor uses its own formatter | Team must point their editor at Prettier + the repo config |
| `.env` reformatted | Secrets file altered | Add `.env` / `*.env` to `.prettierignore` |

---

## 7. Interview Questions & Answers

**Q1. What is Prettier?**
> An opinionated code formatter that rewrites code to one consistent style automatically, so
> a whole team's code looks identical.

**Q2. `dependencies` vs `devDependencies` — where does Prettier go, and why?**
> `devDependencies`. It's only used during development; the running app never needs it, so it
> shouldn't ship to production. Install with `npm i -D prettier`.

**Q3. What does `.prettierrc` do?**
> It's the config file (strict JSON) holding the formatting rules — quotes, semicolons, tab
> width, trailing commas — the single source of truth for the project's style.

**Q4. What does `.prettierignore` do?**
> Lists files/folders Prettier skips, exactly like `.gitignore` — typically `node_modules`,
> `dist`, and `.env`.

**Q5. Why bother with a formatter on a team?**
> It removes style from code reviews and keeps diffs clean — only real logic changes show up,
> not whitespace noise.

**Q6. What does `trailingComma: "es5"` mean?**
> Add trailing commas where ES5 allows them (in arrays and objects), which keeps future diffs
> smaller when a line is added.

**Q7. Why do we ignore `dist`?**
> It's generated build output, not source code — formatting it is pointless and it gets
> overwritten on every build anyway.

---

## 8. Quick self-test (cover the answers)

1. What kind of tool is Prettier? *(an opinionated code formatter)*
2. Which flag installs it as a dev dependency? *(`-D` / `--save-dev`)*
3. Which file holds the style rules? *(`.prettierrc`)*
4. Which file lists what to skip? *(`.prettierignore`)*
5. `tabWidth: 2` means? *(indent with 2 spaces)*
6. `semi: true` means? *(always add semicolons)*
7. Name two things you always put in `.prettierignore`. *(`node_modules`, `dist` / `.env`)*
8. Why not put Prettier in `dependencies`? *(runtime never needs it — keeps prod install lean)*

---

### ✅ Summary in one paragraph (for revision)
A production-ready app isn't just correct — it's **consistent**, and the first tool that
buys you that is **Prettier**, an opinionated formatter that rewrites every file to one
agreed style. Install it as a **devDependency** (`npm i -D prettier`) because the running app
never needs it. Configure it with two dotfiles at the project root: **`.prettierrc`** holds
the style rules in strict JSON (`singleQuote`, `bracketSpacing`, `tabWidth: 2`, `semi`,
`trailingComma: "es5"`), and **`.prettierignore`** — working like `.gitignore` — excludes
generated and secret files (`node_modules`, `dist`, `.env`). The payoff: clean diffs and code
reviews about logic, not whitespace, because **style becomes a machine's job, not a human's.**
