# Backend Notes 4 — Data Modelling with Mongoose (Schemas, Refs, Relationships)

> **Project:** [`Mongoose_Models/`](Mongoose_Models/) — the schemas built alongside these notes.

NOTES1–3 were about the **server**. This one is about the **data**: how you decide what
shape your documents have, before you write a single route.

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
| `enum` | Restricts to a fixed list | Only for `String` |

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
document's `_id`** and telling Mongoose which model it points at.

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

### One-to-many = the same thing, wrapped in `[ ]`

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

### `.populate()` — what `ref` buys you
```js
const todos = await Todo.find().populate("createdBy")
// createdBy: "652f8a..."  →  createdBy: { _id: "652f8a…", username: "arpit", … }
```
Mongoose runs a second query and swaps the id for the real document. **This is a Mongoose
feature, not a MongoDB one** — it's an application-side join.

> 🧠 **Interview line:** "MongoDB has no joins. You store an ObjectId with a `ref`, and
> Mongoose's `.populate()` does an application-level join by firing a second query. That's
> why `ref` has to match the model name exactly."

---

## 4. Embed or Reference? (the actual modelling decision)

This is *the* data modelling question, and the one interviewers care about.

| | **Embed** (nest the object) | **Reference** (store the `_id`) |
|---|---|---|
| Looks like | `orderItems: [orderItemSchema]` | `customer: { type: ObjectId, ref: "User" }` |
| Read cost | 1 query — it's already there | 2 queries (`populate`) |
| Best when | Data is **owned** by the parent and read together | Data is **shared** or grows unbounded |
| Downside | Duplication; 16 MB document limit | Extra queries |
| Example | Items inside one order | The user who placed the order |

**Rule of thumb:** if the child has no meaning without the parent → **embed**. If the child
is an independent thing other documents also point at → **reference**.

A `User` is referenced (one user, many orders — never duplicate them). An order's line
items are embedded (they belong to that one order and nothing else reads them).

---

## 5. Sub-schemas (schema without a model)

```js
const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  quantity:  { type: Number, required: true },
})
// ← notice: NO mongoose.model() call

const orderSchema = new mongoose.Schema({
  orderItems: [orderItemSchema],   // embedded, right inside the order document
})
```

A schema you never pass to `mongoose.model()` gets **no collection of its own**. It exists
only as the shape of an embedded sub-document. Use it when you need structure + validation
for nested data, but the nested data isn't a standalone entity.

> 💡 **Model = collection.** No `mongoose.model()` call → no collection. That one line is
> the entire difference between an entity and a sub-document.

---

## 6. `enum` — fixed set of values

```js
status: {
  type: String,
  enum: ["PENDING", "CANCELLED", "DELIVERED"],
  default: "PENDING",
}
```

Anything outside the list is rejected at save time. Use it for statuses, roles, and
categories — it's self-documenting and stops typos (`"pending"` vs `"PENDING"`) from
becoming two different states in production.

---

## 7. Arrays — the three flavours

```js
specializedIn: [{ type: String }]              // 1. plain values

subTodos: [{ type: ObjectId, ref: "SubTodo" }] // 2. references to other documents

worksInHospitals: [                            // 3. objects — reference + extra data
  {
    hospital:     { type: ObjectId, ref: "Hospital" },
    hoursPerWeek: { type: Number },
  }
]
```

Flavour 3 is the one worth remembering: **when the relationship itself carries data**
(hours per week, role, joined-on date), a bare array of ids can't hold it. You need an
array of objects — the NoSQL version of a join table.

---

## 8. Images and files

```js
productImage: { type: String }    // a URL. That's it.
```

**Files never go in MongoDB.** They go to S3 / Cloudinary / any file host, and you store the
returned **URL as a string**. Documents stay small and fast; the CDN does what it's good at.

---

## 9. The Models Built (in [`Mongoose_Models/`](Mongoose_Models/))

```
Mongoose_Models/models/
├── todos/                       ← the core example
│   ├── user.models.js           unique/lowercase/trim, custom required message
│   ├── todo.models.js           ref to User + array of refs to SubTodo
│   └── sub_todo.models.js
├── ecommerce/                   ← practice models
│   ├── product.models.js        image-as-URL, defaults
│   └── order.models.js          sub-schema + enum + embedded array
└── hospital/
    ├── hospital.models.js       array of plain strings
    └── doctor.models.js         array of objects (ref + hoursPerWeek)
```

Each file demonstrates a different concept — read them in that order.

---

## 10. Bugs & Gotchas

| Bug | Symptom | Cause |
|---|---|---|
| `timestamps: true` inside the **first** object | No `createdAt` / `updatedAt`, no error | It's the **second** argument |
| `ref: "user"` (lowercase) | `.populate()` returns `null` | Must match `mongoose.model("User", …)` exactly |
| `type: String` for a relation | Populate never works | Must be `mongoose.Schema.Types.ObjectId` |
| `unique: true` on an existing dirty collection | Duplicates still get saved | The index failed to build |
| Duplicate key crash | Raw `E11000` in the response | `unique` throws a Mongo error, not a validation error — catch it |
| `name: { type: String, required: true }` written as `name: String, required: true` | Schema silently wrong | Once you add options, the field **must** be an object |
| Forgot `mongoose.model()` | Collection never appears | No model → no collection |

---

## 11. Interview Questions & Answers

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

**Q9. Embed or reference?**
> Embed data owned by and read with the parent (order line items). Reference data that's
> shared or grows unbounded (the user). Trade-off: 1 query + duplication vs 2 queries +
> normalisation.

**Q10. Is `unique: true` a validator?**
> No — it creates a **unique index** in MongoDB. It throws an `E11000` duplicate-key error,
> and it won't help on a collection that already contains duplicates.

**Q11. How do you restrict a field to a fixed set of values?**
> `enum: ["PENDING", "CANCELLED", "DELIVERED"]` on a String field.

**Q12. A schema with no `mongoose.model()` call — what is it?**
> A sub-schema. It gets no collection; it only defines the shape of embedded
> sub-documents.

**Q13. Where do you store uploaded images?**
> On a file service (S3/Cloudinary). The database stores the **URL** as a String.

**Q14. The relationship itself has data (e.g. hours per week) — how do you model it?**
> An array of objects, each holding the `ObjectId` reference plus the extra fields.

**Q15. Custom validation message?**
> `required: [true, "Password is required"]` — array form: `[condition, message]`.

---

## 12. Quick self-test (cover the answers)

1. Which argument of `new mongoose.Schema()` takes `timestamps`? *(the second)*
2. `mongoose.model("SubTodo", …)` → collection name? *(`subtodos`)*
3. Two halves of a reference field? *(`type: ObjectId` + `ref: "Model"`)*
4. `ref` string must match what? *(the model name, exactly, case-sensitive)*
5. One-to-many vs one-to-one in code? *(wrap it in `[ ]`)*
6. Is `unique` a validator? *(no — an index; throws E11000)*
7. Schema with no `model()` call = ? *(sub-schema, embedded only)*
8. Where do image files live? *(a file host; the DB stores the URL)*
9. Fixed set of allowed strings? *(`enum`)*
10. `.populate()` is a feature of? *(Mongoose, not MongoDB — it's a second query)*

---

### ✅ Summary in one paragraph (for revision)
MongoDB stores anything, so **Mongoose puts the schema back** at the application layer:
a **schema** is the blueprint, `mongoose.model("User", schema)` compiles it into a queryable
**model** (and creates the lowercased, pluralised `users` collection), and each record is a
**document**. `new mongoose.Schema(fields, { timestamps: true })` takes **fields first,
options second** — `timestamps` gives you free `createdAt`/`updatedAt`. Fields carry
`type`, `required` (with an optional custom message), `default`, `lowercase`, `trim`,
`enum`, and `unique` — which is **an index, not a validator**, and throws a raw `E11000`.
Relationships have no joins or foreign keys: you store the other document's id with
`type: mongoose.Schema.Types.ObjectId` + `ref: "Model"`, wrap it in `[ ]` for one-to-many,
and `.populate()` (a **Mongoose**-side second query) swaps the id for the real document.
The real design decision is **embed vs reference** — embed what's owned by and read with the
parent, reference what's shared or unbounded; a schema you never pass to `mongoose.model()`
is a **sub-schema** with no collection, used purely for embedded data. When the relationship
itself carries data, use an array of objects; and **files never go in the database** — store
the URL.
