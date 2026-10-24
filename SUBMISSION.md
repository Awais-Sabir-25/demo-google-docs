# Submission: Ajaia Docs

## Links

| | |
| --- | --- |
| **Live app** | https://ajaia-docs-v46b.onrender.com |
| **Walkthrough video** | https://www.loom.com/share/6d082a605b374e049667e0d509fdd53e (also in `VIDEO_URL.txt`) |
| **Source code** | https://github.com/Awais-Sabir-25/demo-google-docs (a copy is also in this folder) |

> The live app runs on Render's free plan. **The first request after about 15 minutes of inactivity can take 30–60 s** while the server wakes up. A restart also resets the data to the seeded state, which keeps the demo accounts and sample document.

## Test accounts

There are no passwords: choose an account on the sign-in screen.

| Account | Starts with |
| --- | --- |
| `alice@ajaia.test` | Owns "Welcome to Ajaia Docs", shared with Bob as editor |
| `bob@ajaia.test` | Sees Alice's welcome doc under **Shared with me** |
| `carol@ajaia.test` | Nothing shared yet, so you can test granting access |

**To test sharing quickly:** each browser tab has its own sign-in, so open two tabs.
1. Sign in as **Alice** in one tab and **Carol** in the other.
2. As Alice, create a document and click **Share**. Choose Carol and pick *Can view* or *Can edit*.
3. Switch to Carol's tab. The document appears under **Shared with me**.

## What's in this folder

| File / folder | What it is |
| --- | --- |
| `README.md` | Features, local setup and run instructions, deploy notes, tests |
| `ARCHITECTURE.md` | Architecture note: what I prioritized, tradeoffs, scope cuts |
| `AI_WORKFLOW.md` | AI workflow note: tools, speed-ups, what I changed or rejected, verification |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `docs/screenshots/` | Editor, share dialog, "Shared with me" view, conflict handling |
| `src/`, `public/`, `test/` | Source code: Node/Express backend, vanilla JS + Quill frontend, API tests |
| `package.json`, `package-lock.json` | Dependencies (run `npm install`) |
| `render.yaml`, `Dockerfile` | Deployment config |

## Run locally

Requires Node.js 22.13+. No database server or paid services are needed.

```bash
npm install
npm start      # http://localhost:3000
npm test       # 9 API tests
```

## Status

**Working end to end**
- Create, rename, edit, delete and reopen documents, with autosave and a visible save status.
- Rich text: H1–H3, bold, italic, underline, strikethrough, numbered and bulleted lists, quotes, links.
- Upload `.txt`, `.md` or `.docx` (max 5 MB) as a new document, or import one into an open document at the cursor.
- Sharing with **Can edit** or **Can view** access, changing roles, and revoking. Owned and shared documents are listed separately, and viewers get a read-only editor.
- Persistence in SQLite. Edit conflicts between two editors are detected rather than silently overwritten.

**Deliberately not built**
- Real-time co-editing and presence.
- Comments, version history, images and tables, export, real authentication.

**Known limitations**
- The free hosting plan resets the data on restart. Add a persistent disk (see the README) for durable data.
- Two people editing the same document at once get a conflict prompt instead of a merge.
- A `.docx` import drops images, tables and complex layout.

**Next 2–4 hours**
1. Version history: a snapshot on each save, with restore. The `version` column already exists.
2. Live updates: poll, or push over SSE, so that open documents update and others' changes appear without a conflict prompt. This is a stepping stone to Yjs co-editing.
3. Playwright end-to-end tests in CI covering the multi-user sharing flow, which caught the one bug the API tests missed.
4. Export to `.docx`/PDF.
