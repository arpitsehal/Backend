# Backend Notes 10 — File Uploads: Multer + Cloudinary

> **Project:** [`FullStack/`](FullStack/) — files touched: `src/middlewares/multer.middleware.js`,
> `src/utils/cloudinary.js`, `package.json` (both `FullStack/package.json` **and** the root
> `package.json` — see §10).
> **Prereq:** [NOTES8](NOTES8.md) (the `utils/` contract, `app.use()` as "attach middleware") and
> [NOTES9](NOTES9.md) (`avatar`, `coverImage`, `videoFile`, `thumbnail` declared as `String` —
> *"cloudinary url"*, never a blob). This note builds the pipeline that actually **produces**
> those URLs.

NOTES9 wrote `avatar: { type: String }` and commented `// cloudinary url` next to it, then moved
on. That comment was a promise: *a file goes in somewhere, a URL comes out.* This note is where
that promise gets kept — a browser file upload has to cross from an HTTP request, onto this
server, up to a CDN, and only the **link** to it ever touches MongoDB.

The whole note comes down to **one idea**: **a file makes two hops, never one.** It lands on this
server's disk first (**Multer**), then gets pushed up to permanent storage (**Cloudinary**), and
the local copy is deleted the moment that succeeds. The server is a **relay, not a warehouse** —
nothing here is meant to still exist on disk five seconds after the request ends.

---

## 1. Why a file can't go straight where you'd expect

| Option | Problem |
|---|---|
| **Store the file bytes in MongoDB** | A document has a **16 MB hard limit**, a video blows past that instantly, and every read of the user now drags image bytes with it. This is the rule NOTES9 already stated for `videoFile`/`avatar`. |
| **Browser uploads directly to Cloudinary** | The browser would need Cloudinary **API credentials** to do that — and anything shipped to a browser is public. Leaking `CLOUDINARY_API_SECRET` lets anyone upload/delete/overwrite on your account. |
| **Server holds the file only in memory (RAM) and forwards it** | Works for small images. A multi-hundred-MB video held as a single in-memory buffer per concurrent upload is how you OOM-crash a Node process under load. |
| **Server writes to local disk, uploads to Cloudinary, deletes the local copy** ✅ | The credentials never leave the server. Disk usage is **temporary and bounded** — one file, one request, then gone. This is what's built here. |

```
 browser ──(multipart/form-data)──► Multer ──(disk, temp)──► Cloudinary ──► permanent URL
                                        │                                       │
                                        └──────────── local file deleted ◄──────┘
```

> 🧠 **Interview line:** "File uploads go through two hops: Multer first writes the incoming
> multipart file to a temp folder on the server's own disk, then a Cloudinary helper pushes that
> file up to the CDN and deletes the local copy. The API secret never reaches the browser, and
> nothing but a URL string ever reaches MongoDB."

> 💡 **Mental model:** *"The server is a relay, not a warehouse."*

---

## 2. `middlewares/multer.middleware.js` — catching the file on the way in

```js
import multer from 'multer';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/temp");
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

export const upload = multer({ storage });
```

### 2.1 `multer` is Express middleware, same shape as NOTES8's `app.use()`

`multer(options)` returns an object with `.single()`, `.array()`, `.fields()` — each of those
**returns a middleware function** with the standard `(req, res, next)` signature. It's not wired
into a route yet in this codebase, but this is the shape it's built for:

```js
router.post(
  "/register",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  registerUser
);
```

| Method | Use when | Populates |
|---|---|---|
| `upload.single("avatar")` | exactly one file, one field name | `req.file` (singular) |
| `upload.array("photos", 5)` | multiple files, **same** field name | `req.files` (array) |
| `upload.fields([{ name, maxCount }, ...])` | multiple **different** field names — e.g. `avatar` + `coverImage` at once | `req.files.avatar[0]`, `req.files.coverImage[0]` |

The middleware runs **before** the controller, parses the `multipart/form-data` body, saves the
file to disk per the `storage` config, and attaches the file's metadata to `req` — the controller
never touches raw bytes, only `req.file.path` / `req.files.avatar[0].path`.

> ⚠️ Regular `express.json()` (NOTES8 §2.2) **cannot** parse file uploads — it only understands
> JSON bodies. `multipart/form-data` needs its own parser. That's Multer's whole job.

### 2.2 `multer.diskStorage({ destination, filename })`

Two callbacks, both with the signature `(req, file, cb)`, where `cb` is Node's classic
**error-first callback**: `cb(error, value)`. Pass `null` for "no error."

| Callback | Job | What's here |
|---|---|---|
| `destination` | *Where* to write the file | Hard-coded `"./public/temp"` |
| `filename` | *What* to name it on disk | `file.originalname` — the name from the client's machine |

### 2.3 Disk storage vs memory storage

| | `multer.diskStorage` (used here) | `multer.memoryStorage()` |
|---|---|---|
| Where the file lives during the request | Written to disk immediately | Held as a `Buffer` in RAM |
| Large files (video) | Fine — streamed to disk | Risky — one big buffer per upload, OOM under load |
| Needs a "cleanup" step after | **Yes** — must delete the temp file (§4) | No — garbage collected once the request ends |
| `req.file.path` available | Yes | No (`req.file.buffer` instead) |

Disk storage is the right call here specifically *because* this app uploads video, not just
avatars — the whole reason `duration` shows up as a video field in NOTES9.

> 🧠 **Interview line:** "I used disk storage instead of memory storage because this app accepts
> video, not just images — holding a large file as a single in-memory buffer per upload doesn't
> scale under concurrent load. Disk storage streams it to a temp folder instead, and that file is
> deleted right after the Cloudinary upload succeeds."

---

## 3. Why `public/temp` needs to already exist

Multer's `destination` callback does **not** create the folder for you — if `./public/temp`
doesn't exist, the first upload throws `ENOENT: no such directory`. Since an **empty** folder
can't be committed to git (git tracks files, not directories), the fix is the standard trick:
drop a placeholder file — `public/temp/.gitkeep` — so the folder itself ships with the repo even
though it should always be empty at rest.

> ⚠️ **`.gitkeep` is a convention, not a Git feature.** Any filename works; `.gitkeep` is just the
> name everyone recognises as *"this file exists only so the folder does."*

---

## 4. `utils/cloudinary.js` — the second hop, and where it deletes the first

```js
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) {
      throw new Error('Local file path is required for upload.');
    }
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: 'auto',
    });
    return response;
  } catch (error) {
    fs.unlinkSync(localFilePath);
    console.error('Error uploading to Cloudinary:', error);
    throw error;
  }
};
```

### 4.1 `cloudinary.config()` — credentials from `.env`, once

Same rule as the JWT secrets in NOTES9 §9: **never hard-code third-party credentials.** All three
values come from `process.env`, read once at module load.

### 4.2 `resource_type: 'auto'`

Cloudinary's uploader normally needs to know if it's receiving an `image` or a `video`. `'auto'`
tells it to **detect the type from the file itself**, so this one function handles the avatar,
the cover image, the video file, *and* the thumbnail — no branching needed in the caller.

### 4.3 What `response` actually contains

The object `cloudinary.uploader.upload()` resolves with is what eventually gets written onto the
model (NOTES9):

| Field on `response` | Used for |
|---|---|
| `response.url` / `response.secure_url` | The value saved into `avatar`, `coverImage`, `videoFile`, `thumbnail` |
| `response.public_id` | Cloudinary's own id for the asset — needed later to **delete/replace** it |
| `response.duration` | Present only for video uploads — this is where `video.model.js`'s `duration` field (NOTES9 §3, commented *"seconds, from cloudinary"*) actually comes from |

> 🧠 **Interview line:** "`resource_type: 'auto'` lets Cloudinary detect image vs video itself, so
> one upload function serves every file field on both models. The video's `duration` field isn't
> computed locally — it's read straight off Cloudinary's response after upload."

---

## 5. The bug that matters most in this file: the temp file is only ever deleted on failure

Walk the **success path** of `uploadOnCloudinary` line by line: `cloudinary.uploader.upload(...)`
resolves, and the function immediately `return`s `response`. **`fs.unlinkSync` only appears inside
the `catch` block.**

```
upload succeeds ─► return response          ❌ local file in ./public/temp is NEVER deleted
upload fails    ─► catch ─► unlink ─► throw  ✅ local file IS deleted
```

This inverts the one case that actually matters. A **failed** upload is rare and already an error
path — cleaning up there is nice but low-stakes. A **successful** upload is the common case, and
it's exactly the one leaking a file onto disk every single time. Run this in production for a
week and `public/temp` grows without bound until the disk fills up and the server starts failing
uploads (and everything else) for an unrelated reason.

**The fix** is to delete the file after a successful upload too — typically with `finally`, so it
runs on both branches:

```js
const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) throw new Error('Local file path is required for upload.');
    const response = await cloudinary.uploader.upload(localFilePath, { resource_type: 'auto' });
    return response;
  } catch (error) {
    console.error('Error uploading to Cloudinary:', error);
    throw error;
  } finally {
    if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
  }
};
```

### 5.1 The second bug this reveals: the `catch` block can itself throw

Look again at the guard: `if (!localFilePath) throw new Error(...)`. When `localFilePath` is
missing, that `throw` is caught by the **same function's** `catch` block — which then runs
`fs.unlinkSync(localFilePath)` on a path that is `undefined`/empty. `fs.unlinkSync(undefined)`
throws its own `TypeError`, **inside a `catch` block**, which is not caught by anything — an
unhandled exception from a code path whose entire job was error handling. The `finally` + guard
version above sidesteps this too, because `fs.existsSync` on a falsy path is just `false`.

> ⚠️ **Rule of thumb:** a `catch` block should never assume the state it expects — if it does file
> cleanup, check the file/path is real before acting on it. A `catch` that can itself throw
> defeats the point of having one.

> 🧠 **Interview line:** "The original cleanup only ran in the `catch` branch, so every successful
> upload left its temp file on disk permanently — a slow disk leak. I moved the `unlinkSync` into
> a `finally` guarded with `existsSync`, so the temp file is removed on both outcomes, and a
> missing path can't throw a second, uncaught error from inside the error handler itself."

---

## 6. `filename: file.originalname` — a second, quieter bug

Naming the temp file after the client's own filename means **two uploads with the same original
name collide** — two users each uploading `photo.jpg` at the same moment, or one user re-uploading
their own avatar twice in a row, can read/overwrite each other's in-flight temp file before either
upload to Cloudinary completes. The usual fix is to make the on-disk name unique and keep the
extension:

```js
filename: function (req, file, cb) {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  cb(null, uniqueSuffix + "-" + file.originalname);
}
```

Cloudinary is never told this name — `uploadOnCloudinary` just needs *a* valid local path, and
Cloudinary assigns its own `public_id` regardless of what the temp file was called on disk. So
uniqueness costs nothing downstream.

---

## 7. No size/count limits — the DoS gotcha, again

```js
export const upload = multer({ storage });
```

No `limits` object was passed. Compare this to NOTES8 §2.2, where `express.json({ limit: "16kb"
})` existed specifically so a giant JSON body couldn't be used to crash the server. The exact same
gap exists here, except worse — file uploads are *supposed* to be large, so there's no small
default to lean on. An unbounded `multer()` config will happily accept a multi-gigabyte "avatar."

```js
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // e.g. 5 MB cap
});
```

> 🧠 **Interview line:** "Just like `express.json`'s `limit` option, Multer needs an explicit
> `limits.fileSize` — without one, there's no cap on how large a single uploaded file can be,
> which is a denial-of-service vector on both disk space and upload time."

---

## 8. Environment variables this note requires

```env
CLOUDINARY_CLOUD_NAME=<your cloud name>
CLOUDINARY_API_KEY=<your api key>
CLOUDINARY_API_SECRET=<your api secret>
```

Same rule as every secret so far (NOTES9 §9): names in `.env` must match `process.env.X` in the
code **exactly**, or `cloudinary.config()` silently configures itself with `undefined` values and
every upload fails with an auth error that has nothing obviously to do with a typo.

---

## 9. `package.json` — the dependency, in the wrong place too

```json
"dependencies": {
  "cloudinary": "^2.10.1",
  "multer": "^2.2.0"
}
```

`multer` was added only to `FullStack/package.json` — correct, since that's the project that
imports it. **`cloudinary` was added to *both*** `FullStack/package.json` **and the root**
`package.json`. The root `package.json` is a separate, unrelated CommonJS scaffold (`"type":
"commonjs"`, `main: "index.js"`) that nothing in `FullStack/` ever runs — this is the exact same
mistake NOTES9 §9 already flagged for `bcrypt`/`jsonwebtoken`, now repeated for `cloudinary`. It
doesn't break `FullStack/`, but it's dead weight that makes it look like the root folder is a
working app, when it isn't one.

> 🧠 **Interview line:** "Dependencies have to be installed in the directory whose `package.json`
> actually gets run — this repo has two `package.json` files, and a package installed in the
> wrong one just sits there unused. It's a recurring mistake here, not a one-off."

---

## 10. Bugs & Gotchas (every one of these is a real issue in this code)

| Bug | Symptom | Cause / Fix |
|---|---|---|
| **`fs.unlinkSync` only in `catch`** | `public/temp` grows forever in production; every *successful* upload leaves its file behind | Cleanup should run on **both** outcomes — move it to a `finally` block (§5). |
| **`catch` block itself can throw** | An unhandled `TypeError` from inside error handling, on top of the original error | `fs.unlinkSync(localFilePath)` runs even when `localFilePath` is falsy. Guard with `fs.existsSync(localFilePath)` before unlinking. |
| **`filename: file.originalname`** | Two concurrent uploads with the same original filename can collide/overwrite before either finishes | Generate a unique on-disk name (`Date.now()` + random suffix); Cloudinary assigns its own `public_id` regardless. |
| **No `limits` on `multer()`** | An uploaded file of unbounded size can exhaust disk or hang the connection | Add `limits: { fileSize: ... }`, mirroring `express.json({ limit })` from NOTES8. |
| **`cloudinary` added to the root `package.json`** | Dead dependency; misleads about what the root folder is | Only `FullStack/package.json` should list packages `FullStack/src` imports — same class of bug as NOTES9 §9. |
| **`destination: "./public/temp"` assumed to exist** | `ENOENT` on first upload if the folder is missing | Multer never creates directories. Commit the folder via a `.gitkeep` placeholder (already done here). |
| **No `upload` middleware wired into any route yet** | Nothing breaks, but the pipeline is inert — `req.file`/`req.files` never populate | Expected at this stage — the next note wires `upload.fields([...])` into `router.post("/register", ...)`. |

---

## 11. Interview Questions & Answers

**Q1. Why does a file upload go through the server's disk before Cloudinary, instead of the
browser uploading directly?**
> Direct-to-Cloudinary would require shipping the API secret to the browser, where anyone could
> read it and upload/delete on the account. Routing through the server keeps credentials
> server-side.

**Q2. Why disk storage instead of memory storage for Multer here?**
> This app accepts video files. Holding each upload as a single in-memory buffer doesn't scale
> under concurrent load; disk storage streams the file instead, avoiding an OOM risk.

**Q3. What does `multer.diskStorage({ destination, filename })` actually configure?**
> Two callbacks with an error-first `(req, file, cb)` signature: `destination` picks the folder to
> write into, `filename` picks the name on disk. Both call `cb(null, value)` on success.

**Q4. Does Multer create the destination folder if it's missing?**
> No — the folder must already exist, or the first upload throws `ENOENT`. That's why an
> otherwise-empty `public/temp` folder ships with a `.gitkeep` placeholder.

**Q5. What's the actual bug in this project's `uploadOnCloudinary` cleanup?**
> The temp file is only deleted in the `catch` block. Every *successful* upload — the common case
> — leaves its file on disk permanently, which is a slow disk leak in production.

**Q6. How do you fix cleanup so it runs on both success and failure?**
> Move `fs.unlinkSync` into a `finally` block so it always runs, guarded with `fs.existsSync` so a
> missing/falsy path doesn't throw a second error.

**Q7. Why can the original `catch` block itself throw an uncaught error?**
> If `localFilePath` is falsy, the function throws inside `try`, lands in `catch`, and then calls
> `fs.unlinkSync(localFilePath)` on that same falsy value — which throws again, uncaught, from
> inside the error handler.

**Q8. What does `resource_type: 'auto'` do and why use it here?**
> It tells Cloudinary to detect whether the upload is an image or video itself, so one function
> can handle avatars, cover images, video files, and thumbnails without branching per type.

**Q9. Where does a `Video` document's `duration` field actually come from?**
> It's not computed by this server — it's read off `response.duration` in Cloudinary's upload
> result, present because the uploaded file was detected as a video.

**Q10. Why is naming the temp file `file.originalname` a problem?**
> Two uploads sharing an original filename — different users, or the same user twice — can
> collide on disk before either finishes uploading to Cloudinary. A unique on-disk name avoids it;
> Cloudinary's own `public_id` doesn't depend on the local filename anyway.

**Q11. Why does `multer()` need a `limits` option?**
> Without one, there's no cap on uploaded file size — the same denial-of-service concern NOTES8
> raised for `express.json({ limit: "16kb" })`, except worse, since large files are the expected
> case here.

**Q12. What's the difference between `upload.single()`, `.array()`, and `.fields()`?**
> `single(field)` expects one file under one field name → `req.file`. `array(field, max)` expects
> several files under the *same* field name → `req.files` (array). `fields([{name, maxCount}, ...])`
> expects different field names at once (e.g. `avatar` + `coverImage`) → `req.files.avatar[0]`.

**Q13. Why can't `express.json()` handle file uploads?**
> It only parses JSON request bodies. File uploads arrive as `multipart/form-data`, which needs a
> dedicated parser — Multer's job specifically.

**Q14. What's wrong with `cloudinary` being listed in the root `package.json`?**
> The root folder is a separate, unrelated project that nothing in `FullStack/` runs — installing
> a dependency there does nothing for the app and just misleads about what that folder is.

**Q15. Why does MongoDB only ever store a URL, never the file itself?**
> A document has a 16 MB cap, and storing binary data bloats every read of that document. This was
> already the rule for `avatar`/`videoFile` as `String` fields in NOTES9 — this note is what
> produces the URL that goes into them.

---

## 12. Quick self-test (cover the answers)

1. What are the two hops a file takes before its URL reaches MongoDB? *(disk via Multer → Cloudinary)*
2. Why not upload straight from the browser to Cloudinary? *(API secret would be exposed client-side)*
3. Why disk storage over memory storage here specifically? *(video files — buffering in RAM doesn't scale)*
4. What does Multer's `destination` callback need that isn't automatic? *(the folder must already exist)*
5. What's the real bug in `uploadOnCloudinary`'s cleanup? *(unlink only happens in `catch`, never on success)*
6. How can the `catch` block itself throw an uncaught error? *(`unlinkSync` on a falsy `localFilePath`)*
7. What does `resource_type: 'auto'` buy you? *(one function handles images and videos both)*
8. Where does a video's `duration` field come from? *(Cloudinary's upload response, not computed locally)*
9. Why is `file.originalname` as the disk filename risky? *(collisions between concurrent uploads)*
10. What option caps upload size, and why does it matter? *(`limits.fileSize` — DoS protection, same idea as `express.json`'s `limit`)*
11. Which `package.json` should `cloudinary` live in, and where did it also (wrongly) land? *(`FullStack/package.json`; also the unrelated root one)*

---

### ✅ Summary in one paragraph (for revision)
This stage answers the question NOTES9 left open — how a file actually becomes the URL stored on
`avatar`, `coverImage`, `videoFile`, and `thumbnail`. It's a **two-hop relay, not a warehouse**:
**Multer**'s `diskStorage` first writes the incoming `multipart/form-data` file to a temporary
folder on the server (`destination`/`filename` callbacks, error-first `cb(null, value)`), then
**`uploadOnCloudinary`** pushes that file to Cloudinary with `resource_type: 'auto'` — letting one
function handle both images and video — and is supposed to delete the local temp copy immediately
after. Disk storage (over memory storage) is the right call specifically because this app accepts
video, where a single in-memory buffer per upload doesn't scale. The real bug in this stage's code
is that the temp-file cleanup only runs in the `catch` branch, so **every successful upload leaks
a file onto disk permanently**, and the same `catch` block can itself throw an uncaught error if
`localFilePath` is falsy when `unlinkSync` runs on it — both fixed by moving cleanup into a
`finally`, guarded with `fs.existsSync`. Two smaller issues ride along: naming the temp file after
`file.originalname` risks collisions between concurrent uploads, and `multer()` has no `limits`
option set, leaving upload size uncapped — the same DoS shape as the missing `limit` on
`express.json()` back in NOTES8. Both Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) come from `.env`, and `cloudinary` was added as a
dependency correctly to `FullStack/package.json` but was **also** added to the unrelated root
`package.json` — the same wrong-project-installed-it mistake NOTES9 already flagged once before.
