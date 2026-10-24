# Architecture note

## Shape

```
Browser (vanilla JS + Quill 2)  ──JSON/multipart──▶  Express 5  ──▶  SQLite (node:sqlite)
      hash routing, autosave                         auth · access checks · sanitize · convert
```

There is one Node process and one SQLite file. The frontend has no build step: plain ES modules, with Quill served straight from `node_modules`. That keeps setup to `npm install && npm start` and leaves the timebox for product behavior instead of tooling.

## What I prioritized, and why

1. **A trustworthy core loop: create → edit → it's saved → reopen.** This is what makes a doc tool usable, so it got the most care. Autosave is debounced, the save status is always visible, failed saves retry, and unsaved edits are flushed when you navigate away. Edits are never lost silently.
2. **Sharing whose rules live on the server.** There are three roles (owner, editor, viewer), and one function (`loadDoc(req, minRole)`) enforces them on every document route. A document you can't access returns 404, not 403, so its existence isn't leaked. Only owners can share, change roles, revoke or delete. The UI mirrors these rules but doesn't enforce them.
3. **Safe content.** The editor stores HTML, and HTML from a client or an uploaded file is untrusted. Everything is passed through an allowlist sanitizer (`src/content.js`) that matches what the editor can produce. Imports are reduced to the same subset, so whatever is stored renders and round-trips in the editor.
4. **Not losing a collaborator's work.** Each document has a `version`. Saves send the version they were based on, and a stale save gets **409 Conflict** carrying the current document. The UI then offers *load theirs* or *overwrite*. It's cheap to build and closes the most likely way two people would clobber each other.
5. **Useful upload.** Turning `.txt`, `.md` or `.docx` into an editable document, or inserting one into the current document, matches how people actually start docs. Files are converted on the server (mammoth for `.docx`, marked for Markdown) and are not stored as blobs.

## Key decisions and tradeoffs

| Decision | Why | Cost / what I'd revisit |
| --- | --- | --- |
| **Quill 2** editor, content stored as HTML | Mature, covers every required format, no bundler needed. HTML is readable and easy to import into. | HTML is harder to diff and merge than a structured model (Quill Delta, ProseMirror JSON). Real-time collaboration would need a structured model. |
| **Optimistic concurrency, not real-time co-editing** | Real-time (CRDT/OT via Yjs plus websockets) is the single biggest scope item. Without it, the main risk is overwrites, and version checks remove that risk. | Two people can't type in the same doc at the same moment. Yjs + y-websocket would be the next step. |
| **Mock auth** (pick a seeded user; session token stored in the DB, kept per tab in `sessionStorage`) | The brief allows it. Sessions are real, so all access control is exercised for real. Per-tab sessions let you test sharing with two users in one browser. A shared cookie silently switched every open tab to whoever signed in last. | No passwords or sign-up. A token readable by JavaScript is acceptable here because content is sanitized on the server. In production, use OAuth/SSO with an httpOnly cookie. |
| **SQLite via built-in `node:sqlite`** | Zero infrastructure, transactional, nothing native to compile, trivial to reset. | Single writer and single instance. Postgres is the move once there's more than one app server. `node:sqlite` is still marked experimental in Node 22. |
| **Share by picking from known users** | Users are seeded, so a dropdown avoids typos. The API takes an email, so the UI could become free text. | Sharing with people who aren't users yet (invites) and link-sharing were left out. |
| **No build step** | Faster setup and review. | No TypeScript or component framework. That's fine at this size (~350 lines of frontend), but I'd add them before the UI grows. |

## Deliberately out of scope

Real-time presence and co-editing, comments and suggestions, version history, images and tables, search, export, folders, invite emails, rate limiting, and production auth.
