# Ajaia Docs

A lightweight collaborative document editor: create, format, upload, share and reopen documents in the browser.

**Live demo:** _add your deployment URL here_ · Sign in by picking a demo account (no password).

| Account | Purpose |
| --- | --- |
| `alice@ajaia.test` | Owns the seeded "Welcome to Ajaia Docs" document |
| `bob@ajaia.test` | Has **edit** access to Alice's welcome document |
| `carol@ajaia.test` | Starts with nothing shared, so you can test granting access |

## Features

- **Documents:** create, rename (click the title), edit, delete. Changes **autosave** about 0.8 s after you stop typing, and a status shows *Saving… / All changes saved*.
- **Rich text:** headings (H1–H3), bold, italic, underline, strikethrough, numbered and bulleted lists, quotes, links, clear formatting. Keyboard shortcuts (Ctrl/Cmd+B/I/U) work.
- **File upload:**
  - *Home → Upload file* turns a file into a **new editable document**, named after the file.
  - *Editor → Import file* inserts a file's content **at the cursor** in the open document.
  - **Supported types: `.txt`, `.md`/`.markdown`, `.docx`. Max 5 MB.** Anything else, or a corrupt `.docx`, gets a clear error. `.docx` keeps headings, bold/italic, lists and links. Images, tables and complex layout are dropped.
- **Sharing:** owners share with another user as **Can edit** or **Can view**, change the role, or remove access. The home page separates **My documents** from **Shared with me**, with role badges and the owner's name. Viewers get a read-only editor with no toolbar.
- **Edit conflicts:** if two people edit the same document, the second save is rejected instead of silently overwriting the first. That person can load the other version or knowingly overwrite it.
- **Persistence:** SQLite. Documents, formatting (stored as sanitized HTML) and shares survive refreshes and restarts.

## Run locally

Requires **Node.js 22.13 or newer**. Storage uses the built-in `node:sqlite`, so nothing native needs compiling.

```bash
npm install
npm start            # http://localhost:3000
npm test             # API tests (node:test)
```

Environment variables (optional):

| Var | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/ajaia.db` | The SQLite file is created on first run, and demo users and the sample doc are seeded. Delete it to reset. |

## Deploy

The app is one Node process plus one SQLite file, so any host that runs Node 22 works.

- **Render:** `render.yaml` is a ready Blueprint (New → Blueprint → select the repo). On the free plan the filesystem is temporary: data resets when the instance restarts, and the demo accounts and sample doc are re-seeded. For durable data, attach a disk at `/data` and set `DB_PATH=/data/ajaia.db`.
- **Docker / Fly.io / Railway:** `docker build -t ajaia-docs . && docker run -p 3000:3000 -v ajaia:/data ajaia-docs`.

## Tests

`test/api.test.js` runs the real Express app against an in-memory SQLite database and covers:

- auth required; create → rename → edit → reopen with formatting preserved
- HTML sanitization (scripts, event handlers and `javascript:` links stripped)
- validation (empty or too-long titles, wrong types)
- sharing end to end: unshared docs are invisible (404), only owners can share, viewers can't edit or delete, editors can, owned vs. shared listings, revoking access
- optimistic concurrency (stale version → 409 carrying the latest document)
- uploads: `.md`, `.txt`, a real `.docx` fixture, an unsupported type, and a corrupt `.docx`

The UI flow (login → create → format → reload → share → second user sees the doc read-only → upload `.docx`) was also checked by driving the app in headless Chromium. That script is not part of the test suite.

## Project layout

```
src/
  server.js    entry point
  app.js       Express app: auth, documents, sharing, upload, error handling
  db.js        schema + seed data (node:sqlite)
  content.js   HTML sanitization and file → HTML conversion
public/        index.html, app.js, styles.css (no build step; Quill served from node_modules)
test/          API tests + .docx fixture
```

Screenshots: [`docs/screenshots/`](docs/screenshots/).

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and tradeoffs.

## AI usage

I built this with an AI coding assistant (Claude Code) for scaffolding, boilerplate and test writing. These decisions were mine, and I checked the results myself: scope cuts, the access model (404 for documents you can't see, owner-only sharing), sanitizing on the server instead of trusting the editor, and optimistic concurrency instead of real-time sync. Every behavior listed above is covered by the tests or was checked in a real browser.
