# AI-Native Workflow Note

## Tools used

- **Claude Code** (Anthropic's agentic coding assistant, run in a cloud sandbox). It scaffolded the project, wrote most of the first-pass code and tests, ran the test suite, and drove the app in headless Chromium (Playwright) to take screenshots and check UI flows.
- **Manual testing** in my own browser, both locally and on the Render deployment. This is where the most important bugs were found (see below).

## Where AI materially sped things up

- **Scaffolding and boilerplate.** It produced the Express routes, SQLite schema, seed data, the Quill setup, and the share dialog. That would have been most of the first two hours by hand.
- **Library integration details.** For example, Quill 2 renders both list types as `<ol><li data-list="bullet">`. The HTML sanitizer allowlist had to permit that, or saved bullet lists would silently turn into numbered ones. `.docx` conversion via mammoth and Markdown via marked were also wired up quickly.
- **Test writing.** The API test suite covers the full sharing and permissions matrix, edit conflicts, sanitization, and uploads using a real `.docx` fixture. It was generated quickly and then checked against the intended rules.
- **Scripted browser checks.** Playwright scripts ran through the full flow (create → format → reload → share → second user → upload → edit conflict) and saved screenshots, so UI regressions were cheap to catch.

## What I changed or rejected

| AI output | What was wrong | What I did |
| --- | --- | --- |
| **Cookie-based sessions** (one cookie per browser) | All 8 API tests passed, but when I tested sharing with several tabs in one browser, documents "disappeared" or showed up as both *mine* and *shared*. Signing in as Bob in one tab silently switched an open "Alice" tab to Bob, while the header still said Alice. | Replaced with per-tab bearer tokens in `sessionStorage`. An expired session now returns the tab to sign-in instead of failing silently. The list refreshes when its tab regains focus. Added a test that sessions are independent. |
| **Editor padding CSS** | The caret appeared partway along the "Start writing…" placeholder. Quill places the placeholder 15px from the edge, but the custom padding moved the caret to 3rem. Found by manual use. | Aligned both through one CSS variable, including on mobile. |
| **Document list rendering** | A stray `false` was printed on every shared-doc row. The DOM helper filtered out `null` but not `false`. Caught by reviewing screenshots, not tests. | Fixed the helper. |
| Small UI issues | Viewers saw "View only" twice. The share dialog heading inherited the uppercase section style. | Fixed. |
| **Scope** | Real-time co-editing (CRDT or WebSockets) is the obvious "Google Docs" feature and the biggest time sink. | Deliberately cut. I chose optimistic concurrency (version check → 409 → "load theirs / keep mine") instead. It prevents silent overwrites, which is the actual risk, at a fraction of the cost. |
| Storage format | `getSemanticHTML()` gives cleaner HTML, but in Quill 2.0.3 it converts spaces to `&nbsp;`. | Stored the editor's own HTML instead, so content round-trips exactly. |

**Lesson:** the cross-tab bug passed every automated test because each test client had its own session. The tests matched the design, not how a real person would test sharing. Manual testing of the real flow found it.

## How I verified correctness, UX and reliability

- **Automated (`npm test`, 9 tests):**
  - The create → rename → edit → reopen loop, with formatting preserved.
  - The sharing matrix: unshared documents return 404, only owners can share, viewers can't edit or delete, editors can, and revoking access works.
  - Conflict handling: a stale save is rejected with 409.
  - XSS sanitization, input validation, and `.txt`, `.md` and `.docx` import (including bad files).
  - Independent sessions.
- **Scripted browser runs (Playwright):** the end-to-end flows above, a two-user edit conflict, and three users in three tabs of one browser. I reviewed the screenshots by eye.
- **Manual testing** on the deployed Render app. This found the session and placeholder bugs.
- **Security choices I checked rather than accepted by default:** all HTML is sanitized on the server for both edits and imports, and access is checked on every document route.
