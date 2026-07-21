# Backend Notes 4 — Data Modelling Basics with Mongoose (Schema, Model, Document)

> **Project:** [`Mongoose_Models/`](Mongoose_Models/) — the schemas built alongside these notes.
> **This note covers the basics using the `todos/` models only.** The advanced practice
> (embed vs reference, sub-schemas, `enum`, array flavours, images) moves to
> [**NOTES5**](NOTES5.md), built on the ecommerce and hospital models.

NOTES1–3 were about the **server**. This one is about the **data**: how you decide what
shape your documents have, before you write a single route. We use one small domain the
whole way through — **todos** — so the concepts stay in front of you.

---

## 0. Big Picture (read this first)

MongoDB is **schema-less** — it will happily store `{ name: "a" }` and `{ price: 9 }` in the
same collection. That's freedom you don't want. **Mongoose is the layer that puts the schema
back**, in your JavaScript, and enforces it before anything reaches the database.

Three words, in order:

| Term | What it is |
|---|---|
| **Schema** | The *blueprint* — field names, types, rules. Just an object. |
| **Model** | The schema **compiled into a class** you can call `.create()` / `.find()` on. |
| **Document** | One actual record — an instance of the model. |

> 🧠 **Interview line:** "MongoDB has no schema; Mongoose adds one at the application layer.
> The schema is the blueprint, the model is the compiled interface you query with, and a
> document is a single record. The database never enforces the rules — Mongoose does."

**Data modelling is a design job, not a coding job.** Sit down and draw the fields and the
connections *first*. The code is a 10-minute translation of a 30-minute decision.

---

## 1. The Boilerplate (memorise this shape)

```js
import mongoose from "mongoose"

const userSchema = new mongoose.Schema(
  { /* 1st argument: the fields */ },
  { timestamps: true }          // 2nd argument: options
)

export const User = mongoose.model("User", userSchema)
```

Two arguments. **Fields first, options second.** The most common beginner bug is putting
`timestamps: true` *inside* the first object — Mongoose then treats it as a field called
"timestamps" and you silently get no `createdAt`.

### `timestamps: true`
Auto-adds two fields to every document: **`createdAt`** and **`updatedAt`**, maintained by
Mongoose. Free, and you will need them (sorting, "latest first", audit trails).

### The model name gets mangled — on purpose
```js
mongoose.model("User", userSchema)   // → collection in MongoDB is  users
mongoose.model("SubTodo", schema)    // → collection is             subtodos
```
Mongoose takes your name, **lowercases it and pluralises it**. Write the model name
singular + PascalCase (`User`, `Todo`, `SubTodo`) and let it do the rest.

> 🧠 **Interview line:** "`mongoose.model('User', schema)` creates a collection called
> `users` — Mongoose lowercases and pluralises the model name automatically."

---

## 2. Field Options — the full toolkit

Straight from [`todos/user.models.js`](Mongoose_Models/models/todos/user.models.js):

```js
username: {
  type: String,      // required — the data type
  required: true,    // won't save without it
  unique: true,      // no two documents may share this value
  lowercase: true,   // transforms "ARPIT" → "arpit" before saving
  trim: true,        // strips leading/trailing whitespace
},
password: {
  type: String,
  required: [true, "Password is required"],   // [condition, custom error message]
},
complete: {
  type: Boolean,
  default: false,    // used when the field isn't supplied
},
```

| Option | Does what | Note |
|---|---|---|
| `type` | `String`, `Number`, `Boolean`, `Date`, `Array`, `ObjectId` | The only mandatory one |
| `required` | Rejects the save if missing | `[true, "msg"]` for a custom message |
| `unique` | No duplicates | ⚠️ **Not a validator** — see below |
| `lowercase` / `uppercase` | Transforms the value on save | Great for emails/usernames |
| `trim` | Removes surrounding spaces | `" arpit "` → `"arpit"` |
| `default` | Fallback value | Use for flags, counters, statuses |

### ⚠️ The `unique` trap (asked in interviews)
`unique: true` is **not a validator** — it's an instruction to MongoDB to build a **unique
index**. Consequences:
1. The error you get on a duplicate is a raw **MongoDB E11000 duplicate key** error, not a
   friendly Mongoose validation error.
2. If the collection **already has duplicates**, the index silently fails to build and
   `unique` does nothing.

> 🧠 **Interview line:** "`unique` isn't validation, it's a database index. It throws a
> Mongo E11000 error, and it won't apply retroactively to a collection that already has
> duplicate values."

### Shorthand
```js
name: String              // same as  name: { type: String }
name: { type: String }    // you MUST use this form once you add any other option
```

---

## 3. Relationships — `ObjectId` + `ref`

MongoDB has no joins and no foreign keys. You link documents by **storing the other
document's `_id`** and telling Mongoose which model it points at. From
[`todos/todo.models.js`](Mongoose_Models/models/todos/todo.models.js):

```js
createdBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",     // ← must EXACTLY match the string in mongoose.model("User", …)
}
```

Two halves, both required:
- **`type: mongoose.Schema.Types.ObjectId`** — "this field holds an id, not a string"
- **`ref: "User"`** — "the id belongs to the User model"

Without `ref` you just have a meaningless id. `ref` is what makes `.populate()` work later.

This is a **one-to-one** reference: one todo belongs to one user, so the field is a single
object. Every todo (and every sub-todo) carries `createdBy` pointing back at its owner.

---

## 4. One-to-many = the same thing, wrapped in `[ ]`

A todo owns many sub-todos. Same `ObjectId` + `ref` definition — just wrapped in an array
([`todos/todo.models.js`](Mongoose_Models/models/todos/todo.models.js)):

```js
subTodos: [
  { type: mongoose.Schema.Types.ObjectId, ref: "SubTodo" }
]
```

That's the whole difference. **One reference → an object. Many references → an array of
that same object.**

```
User ──1─────many──▶ Todo ──1─────many──▶ SubTodo
       createdBy            subTodos[]
```

> 🧠 **Interview line:** "One-to-one and one-to-many are the same reference field —
> one-to-many just wraps the `{ type: ObjectId, ref }` in an array."

---

## 5. `.populate()` — what `ref` buys you

```js
const todos = await Todo.find().populate("createdBy")
// createdBy: "652f8a..."  →  createdBy: { _id: "652f8a…", username: "arpit", … }
```

Mongoose runs a second query and swaps the id for the real document. **This is a Mongoose
feature, not a MongoDB one** — it's an application-side join. You can only populate a field
that has a `ref`; that's the entire reason `ref` exists.

> 🧠 **Interview line:** "MongoDB has no joins. You store an ObjectId with a `ref`, and
> Mongoose's `.populate()` does an application-level join by firing a second query. That's
> why `ref` has to match the model name exactly."

---

## 6. The Models Built (in [`Mongoose_Models/models/todos/`](Mongoose_Models/models/todos/))

```
Mongoose_Models/models/todos/
├── user.models.js       unique / lowercase / trim, custom required message
├── todo.models.js       ref to User (one-to-one) + array of refs to SubTodo (one-to-many)
└── sub_todo.models.js   ref back to User
```

Read them in that order — each adds exactly one idea on top of the previous file.

> ➡️ **Next:** [NOTES5](NOTES5.md) takes these same tools into two bigger domains
> (ecommerce + hospital) and adds the real modelling decisions: **embed vs reference**,
> **sub-schemas**, **`enum`**, the **three array flavours**, and **images/files**.

---

## 7. Bugs & Gotchas

| Bug | Symptom | Cause |
|---|---|---|
| `timestamps: true` inside the **first** object | No `createdAt` / `updatedAt`, no error | It's the **second** argument |
| `ref: "user"` (lowercase) | `.populate()` returns `null` | Must match `mongoose.model("User", …)` exactly |
| `type: String` for a relation | Populate never works | Must be `mongoose.Schema.Types.ObjectId` |
| `unique: true` on an existing dirty collection | Duplicates still get saved | The index failed to build |
| Duplicate key crash | Raw `E11000` in the response | `unique` throws a Mongo error, not a validation error — catch it |
| `name: String, required: true` (not an object) | Schema silently wrong | Once you add options, the field **must** be an object |
| Forgot `mongoose.model()` | Collection never appears | No model → no collection |
| Typo in the type: `mongoose.schems` | Crash at import | It's `mongoose.Schema` (capital S) |

---

## 8. Interview Questions & Answers (basics)

**Q1. Schema vs Model vs Document?**
> Schema = the blueprint (fields + rules). Model = the schema compiled into a queryable
> interface. Document = one record, an instance of the model.

**Q2. MongoDB is schema-less — so what is Mongoose doing?**
> Enforcing a schema at the **application** layer. The database still accepts anything;
> Mongoose validates before it gets there.

**Q3. What does `timestamps: true` do, and where does it go?**
> Adds `createdAt` and `updatedAt` automatically. It's the **second** argument to
> `new mongoose.Schema()`, not a field.

**Q4. What collection does `mongoose.model("User", schema)` create?**
> `users` — Mongoose lowercases and pluralises the model name.

**Q5. How do you model a relationship in MongoDB?**
> Store the other document's `_id` in a field typed
> `mongoose.Schema.Types.ObjectId` with `ref: "ModelName"`.

**Q6. What does `ref` actually do?**
> Nothing at save time — it tells `.populate()` which model to look the id up in.

**Q7. What is `.populate()`?**
> A Mongoose (not MongoDB) application-level join: it fires a second query and replaces the
> stored ObjectId with the full document.

**Q8. One-to-many — how?**
> Same ObjectId + ref definition, wrapped in an array.

**Q9. Is `unique: true` a validator?**
> No — it creates a **unique index** in MongoDB. It throws an `E11000` duplicate-key error,
> and it won't help on a collection that already contains duplicates.

**Q10. Custom validation message?**
> `required: [true, "Password is required"]` — array form: `[condition, message]`.

---

## 9. Quick self-test (cover the answers)

1. Which argument of `new mongoose.Schema()` takes `timestamps`? *(the second)*
2. `mongoose.model("SubTodo", …)` → collection name? *(`subtodos`)*
3. Two halves of a reference field? *(`type: ObjectId` + `ref: "Model"`)*
4. `ref` string must match what? *(the model name, exactly, case-sensitive)*
5. One-to-many vs one-to-one in code? *(wrap it in `[ ]`)*
6. Is `unique` a validator? *(no — an index; throws E11000)*
7. Where does `timestamps` go? *(second argument, the options object)*
8. `.populate()` is a feature of? *(Mongoose, not MongoDB — it's a second query)*

---

### ✅ Summary in one paragraph (for revision)
MongoDB stores anything, so **Mongoose puts the schema back** at the application layer:
a **schema** is the blueprint, `mongoose.model("User", schema)` compiles it into a queryable
**model** (and creates the lowercased, pluralised `users` collection), and each record is a
**document**. `new mongoose.Schema(fields, { timestamps: true })` takes **fields first,
options second** — `timestamps` gives you free `createdAt`/`updatedAt`. Fields carry
`type`, `required` (with an optional custom message), `default`, `lowercase`, `trim`, and
`unique` — which is **an index, not a validator**, and throws a raw `E11000`.
Relationships have no joins or foreign keys: you store the other document's id with
`type: mongoose.Schema.Types.ObjectId` + `ref: "Model"`, wrap it in `[ ]` for one-to-many,
and `.populate()` (a **Mongoose**-side second query) swaps the id for the real document.
The todos domain shows all of this in three small files — then [NOTES5](NOTES5.md) takes it
into embed-vs-reference, sub-schemas, `enum`, arrays, and files.
