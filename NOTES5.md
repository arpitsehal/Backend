# Backend Notes 5 — Data Modelling Practice (Ecommerce + Hospital)

> **Project:** [`Mongoose_Models/`](Mongoose_Models/) — the schemas built alongside these notes.
> **Prereq:** [NOTES4](NOTES4.md) — schema/model/document, field options, `ObjectId` + `ref`,
> one-to-many, `.populate()`. This note assumes all of that and adds the real design decisions.

NOTES4 taught the mechanics on one tiny domain (todos). Now we model two **realistic**
domains — an **ecommerce store** and a **hospital system** — and meet the questions that
actually come up when you design for production: *do I embed this or reference it? when is a
schema not a model? how do I store a list? where do files go?*

The whole note comes down to **one decision, repeated**: for every piece of data, do you
**embed** it inside its parent or **reference** it by id? Everything else is a consequence.

---

## 1. The Core Decision — Embed or Reference?

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

> 🧠 **Interview line:** "Embed data that's owned by and read with the parent; reference data
> that's shared or grows unbounded. It's a trade: 1 query + duplication vs 2 queries +
> normalisation."

We'll now see both sides of this decision live in the ecommerce models.

---

## 2. Ecommerce — the four models

```
Mongoose_Models/models/ecommerce/
├── user.models.js       the customer / owner — referenced everywhere
├── category.models.js   a lookup table — referenced by products
├── product.models.js    two refs (category + owner), an image URL, numeric defaults
└── order.models.js      the payoff: sub-schema + embedded array + enum + a ref
```

```
Category ◀──ref── Product ──ref──▶ User
                     ▲                ▲
                     │ (embedded      │ customer (ref)
                     │  snapshot in   │
                     │  orderItems)   │
                  Order ──────────────┘
```

### 2.1 `category.models.js` — the smallest possible model

```js
const categorySchema = new mongoose.Schema(
  { name: { type: String, required: true } },
  { timestamps: true }
)
export const Category = mongoose.model("Category", categorySchema)
```

Why is a category its **own model** and not just a string on the product? Because it's
**shared** — hundreds of products point at the same "Electronics" category, and you want to
rename it in one place. That's the textbook "reference, don't embed" case. Model name is
`"Category"`, so products can `ref: "Category"`.

### 2.2 `product.models.js` — two references, an image, numeric defaults

```js
const productSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    name:        { type: String, required: true },
    productImage:{ type: String },              // just the URL — see §6
    price:       { type: Number, default: 0 },  // number defaults, not strings
    stock:       { type: Number, default: 0 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    owner:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
)
export const Product = mongoose.model("Product", productSchema)
```

Three things worth naming:
- **Two references in one document** — a product both *belongs to* a category and *is owned
  by* a user. Nothing stops a document from pointing at several models.
- **`required` on a reference** — `category` is `required: true`; a product with no category
  is meaningless, so reject it at save time.
- **Numeric `default: 0`** — defaults aren't just for booleans. A new product starts at
  price 0 / stock 0 rather than `undefined`, so your arithmetic never hits `NaN`.

### 2.3 `order.models.js` — the model that uses everything

This one file demonstrates the sub-schema, the embedded array, the `enum`, **and** a
reference — so it gets its own sections (§3–§5) below. The full shape:

```js
const orderItemSchema = new mongoose.Schema({          // ← sub-schema, no model()
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  quantity:  { type: Number, required: true },
})

const orderSchema = new mongoose.Schema({
  orderPrice: { type: Number, required: true },
  customer:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },  // reference
  orderItems: { type: [orderItemSchema] },                            // embedded array
  address:    { type: String, required: true },
  status: {
    type: String,
    enum: ["PENDING", "CANCELLED", "DELIVERED"],                      // fixed set
    default: "PENDING",
  },
}, { timestamps: true })

export const Order = mongoose.model("Order", orderSchema)
```

Notice the decision applied twice in one document: the **customer is referenced** (shared,
independent — one user places many orders), the **items are embedded** (owned by this one
order, read together with it).

---

## 3. Sub-schemas (a schema without a model)

```js
const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  quantity:  { type: Number, required: true },
})
// ← notice: NO mongoose.model() call

const orderSchema = new mongoose.Schema({
  orderItems: { type: [orderItemSchema] },   // embedded, right inside the order document
})
```

A schema you never pass to `mongoose.model()` gets **no collection of its own**. It exists
only as the shape of an embedded sub-document. Use it when you need structure + validation
for nested data, but the nested data isn't a standalone entity.

> 💡 **Model = collection.** No `mongoose.model()` call → no collection. That one line is
> the entire difference between an entity and a sub-document.

Why embed order items instead of referencing them? An order item (this product, this
quantity, on this order) has **no life outside its order** — nobody queries order items on
their own. It's owned, it's read with the order, it doesn't grow unbounded. Textbook embed.

> 🧠 **Interview line:** "A schema with no `mongoose.model()` call is a sub-schema — it gets
> no collection and exists purely to shape embedded sub-documents, like the line items inside
> an order."

---

## 4. `enum` — a fixed set of values

```js
status: {
  type: String,
  enum: ["PENDING", "CANCELLED", "DELIVERED"],
  default: "PENDING",
}
```

Anything outside the list is rejected at save time. Use it for statuses, roles, and
categories — it's self-documenting and stops typos (`"pending"` vs `"PENDING"`) from
becoming two different states in production. Pair it with `default` so a new order starts in
a known state. `enum` is a String-field option.

---

## 5. Arrays — the three flavours

Across these two domains you meet all three kinds of array. This is the table to memorise:

```js
specializedIn: [{ type: String }]              // 1. plain values (hospital)

orderItems: [orderItemSchema]                  // 2a. embedded sub-documents (order)
subTodos:  [{ type: ObjectId, ref: "SubTodo" }]// 2b. references to other documents (todo)

worksInHospitals: [                            // 3. objects — reference + extra data (doctor)
  {
    hospital:     { type: ObjectId, ref: "Hospital" },
    hoursPerWeek: { type: Number },
  }
]
```

Flavour 3 is the one worth remembering: **when the relationship itself carries data**
(hours per week, role, joined-on date), a bare array of ids can't hold it. You need an
array of objects — the NoSQL version of a **join table**. We see it in the hospital domain
next.

---

## 6. Images and files

```js
productImage: { type: String }    // a URL. That's it.
```

**Files never go in MongoDB.** They go to S3 / Cloudinary / any file host, and you store the
returned **URL as a string**. Documents stay small and fast; the CDN does what it's good at.
The `product` model does exactly this.

> 🧠 **Interview line:** "Uploaded files live on a file service like S3 or Cloudinary; the
> database only stores the returned URL as a String, so documents stay small."

---

## 7. Hospital — the join-table pattern

```
Mongoose_Models/models/hospital/
├── hospital.models.js   flat fields + an array of plain strings
└── doctor.models.js     an array of OBJECTS (ref + hoursPerWeek) — the relationship carries data
```

### 7.1 `hospital.models.js` — flat fields + a string array

```js
const hospitalSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },                 // optional — no `required`
    city:         { type: String, required: true },
    pincode:      { type: String, required: true }, // String, not Number — leading zeros
    specializedIn:[{ type: String }],               // array flavour 1: plain values
  },
  { timestamps: true }
)
export const Hospital = mongoose.model("Hospital", hospitalSchema)
```

Two small but real decisions:
- **`pincode` is a `String`, not a `Number`.** Pincodes can have leading zeros and you never
  do maths on them. Same logic for phone numbers. "Is it a number you'd calculate with?" —
  if no, it's a String.
- **`specializedIn` is a plain string array** — the specialities ("Cardiology", "Ortho")
  are just labels, not entities with their own records. No `ref`, no sub-schema.

### 7.2 `doctor.models.js` — the relationship that carries data

A doctor can work at **several** hospitals, and at each one for a **different number of
hours**. That "number of hours" belongs to *the pairing of doctor + hospital*, not to the
doctor and not to the hospital. So a bare `[ObjectId]` array can't express it — you need an
array of **objects**:

```js
const doctorSchema = new mongoose.Schema(
  {
    name:              { type: String, required: true },
    salary:            { type: Number, required: true },
    qualification:     { type: String, required: true },
    experienceInYears: { type: Number, default: 0 },

    worksInHospitals: [
      {
        hospital:     { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
        hoursPerWeek: { type: Number },
      },
    ],
  },
  { timestamps: true }
)
export const Doctor = mongoose.model("Doctor", doctorSchema)
```

This is array **flavour 3**, and it's the many-to-many "join table" of the NoSQL world: each
element is a **reference plus the data about that specific relationship**. If you ever find
yourself wanting to attach a field to a link between two documents (a role, a start date,
hours), this is the shape.

> 🧠 **Interview line:** "When the relationship itself has attributes — hours per week, a
> role, a joined-on date — you model it as an array of objects, each holding the `ObjectId`
> reference plus the extra fields. That's the NoSQL equivalent of a join table."

---

## 8. Putting the decision table to work

For every field you design, walk this tiny decision tree:

```
Is it a value (name, price, status)?            → plain field  (String/Number/Boolean)
Is it one of a fixed set of labels?             → String + enum
Is it a file?                                   → String (store the URL)
Is it another entity...
   ...owned by this doc, read together, bounded → EMBED  (sub-schema / array of sub-schemas)
   ...shared or unbounded                       → REFERENCE (ObjectId + ref)
   ...and the link itself has data              → array of objects (ref + extra fields)
```

That single tree produced every field in all six models across NOTES4 + NOTES5.

---

## 9. Bugs & Gotchas (the ones these models expose)

| Bug | Symptom | Cause |
|---|---|---|
| `new mongoose.schems({...})` | Crash at import | It's `mongoose.Schema` — capital S, no typo |
| `reqired: true` (misspelled) | Field saves as optional, no error | Mongoose ignores unknown keys — spelling matters |
| `{ timestamp: true }` / `{ Timestamps: true }` | No `createdAt` / `updatedAt` | The key is exactly `timestamps` (plural, lowercase) |
| `mongoose.model("category", …)` but `ref: "Category"` | `.populate()` returns `null` | The `ref` string must match the model name **exactly**, case-sensitive |
| `pincode: { type: Number }` | Leading zeros vanish (`007` → `7`) | Codes/phones are Strings, not Numbers |
| Bare `[ObjectId]` when the link has data | Nowhere to store `hoursPerWeek` | Use an array of objects (flavour 3) |
| Embedding a shared entity (e.g. the user) | Duplicated user data everywhere | Shared/unbounded data must be **referenced** |
| Referencing an owned sub-doc (e.g. order items) | Needless second query + orphan risk | Owned, read-together data should be **embedded** |

> These typos are exactly why the ecommerce models were fixed while writing this note:
> `schems → Schema`, `reqired → required`, `timestamp/Timestamps → timestamps`, and the
> category model name `"category" → "Category"` so `product.category`'s `ref` resolves.

---

## 10. Interview Questions & Answers

**Q1. Embed or reference — how do you decide?**
> Embed data owned by and read with the parent (order line items). Reference data that's
> shared or grows unbounded (the user, the category). Trade-off: 1 query + duplication vs
> 2 queries + normalisation.

**Q2. A schema with no `mongoose.model()` call — what is it?**
> A sub-schema. It gets no collection; it only defines the shape of embedded sub-documents,
> like `orderItemSchema` inside an order.

**Q3. How do you restrict a field to a fixed set of values?**
> `enum: ["PENDING", "CANCELLED", "DELIVERED"]` on a String field, usually with a `default`.

**Q4. Where do you store uploaded images?**
> On a file service (S3/Cloudinary). The database stores the **URL** as a String.

**Q5. The relationship itself has data (e.g. hours per week) — how do you model it?**
> An array of objects, each holding the `ObjectId` reference plus the extra fields — the
> NoSQL version of a join table (`worksInHospitals` in the doctor model).

**Q6. Why is `pincode` a String and not a Number?**
> Codes and phone numbers can have leading zeros and are never used in arithmetic. "Would you
> ever calculate with it?" — if no, it's a String.

**Q7. Can one document reference more than one model?**
> Yes — a product references both `Category` and `User` (owner). A field references exactly
> one model, but a document can have many such fields.

**Q8. Why make `category` its own model instead of a string on the product?**
> Because it's shared across many products — referencing lets you rename it in one place and
> keeps the data normalised.

**Q9. What are the three array flavours?**
> Plain values (`[String]`), references (`[{ type: ObjectId, ref }]`) or embedded
> sub-documents (`[subSchema]`), and objects carrying a ref plus extra relationship data.

**Q10. Why is `required` put on a reference field like `category`?**
> Because the relationship is mandatory — a product without a category is invalid, so it's
> rejected at save time.

---

## 11. Quick self-test (cover the answers)

1. Order line items — embed or reference? *(embed — owned, read together, bounded)*
2. The customer on an order — embed or reference? *(reference — shared, independent)*
3. Schema with no `model()` call = ? *(sub-schema, embedded only, no collection)*
4. Restrict `status` to three values? *(`enum` on a String field)*
5. Where does an uploaded image go? *(a file host; the DB stores the URL string)*
6. A doctor's hours-per-hospital — which array flavour? *(flavour 3: array of objects, ref + data)*
7. `pincode` type? *(String — leading zeros, no arithmetic)*
8. `ref: "Category"` needs the model registered as? *(`mongoose.model("Category", …)` — exact case)*
9. Product's `price` default? *(`0`, a Number — defaults aren't just for booleans)*
10. Can a product point at two models? *(yes — `Category` and `User`)*

---

### ✅ Summary in one paragraph (for revision)
Real data modelling is **one decision made repeatedly: embed or reference.** Embed what's
**owned by and read with the parent and stays bounded** (an order's line items → a
**sub-schema** with no `mongoose.model()` call, so no collection); reference what's **shared
or unbounded** (the `customer`, the `category` → `ObjectId` + `ref`). A single document can
hold several references (a product points at both `Category` and `User`). Fixed sets of
labels use **`enum`** (order `status`), usually with a `default`; **files** never go in the
DB — you store the **URL** as a String (`productImage`). Arrays come in three flavours —
plain values (`specializedIn: [String]`), references / embedded sub-docs, and **objects
carrying a ref plus relationship data** (`worksInHospitals: [{ hospital, hoursPerWeek }]`),
which is the NoSQL join table for many-to-many links that carry their own fields. Watch the
type choices (`pincode` is a **String**) and the spelling (`Schema`, `required`,
`timestamps`, and a `ref` that matches the model name **exactly**) — every one of those was a
real bug in the ecommerce models.
