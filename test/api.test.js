const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Logs in as a seeded user and returns a tiny client bound to that session. */
async function login(email) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body) => {
    const opts = { method, headers: { cookie } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(base + path, opts);
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
  };
}

function fileForm(name, contents) {
  const form = new FormData();
  form.append('file', new Blob([contents]), name);
  return form;
}

test('API requires a session', async () => {
  const res = await fetch(`${base}/api/documents`);
  assert.equal(res.status, 401);
});

test('create, rename, edit and reopen a document with formatting preserved', async () => {
  const alice = await login('alice@ajaia.test');
  const created = await alice.post('/api/documents', {});
  assert.equal(created.status, 201);
  const { id, version } = created.body.document;
  assert.equal(created.body.document.title, 'Untitled document');

  const html = '<h2>Plan</h2><p><strong>Bold</strong> <em>it</em> <u>u</u></p><ol><li data-list="bullet">one</li></ol>';
  const saved = await alice.patch(`/api/documents/${id}`, { title: '  Q3 plan ', content: html, baseVersion: version });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.document.version, version + 1);

  const reopened = await alice.get(`/api/documents/${id}`);
  assert.equal(reopened.body.document.title, 'Q3 plan');
  assert.equal(reopened.body.document.content, html);
});

test('stored HTML is sanitized', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents', {
    title: 'xss', content: '<p onclick="steal()">hi<script>alert(1)</script><a href="javascript:x()">l</a></p>',
  });
  assert.equal(body.document.content, '<p>hi<a target="_blank" rel="noopener noreferrer">l</a></p>');
});

test('validation: empty title and wrong types are rejected', async () => {
  const alice = await login('alice@ajaia.test');
  const { body } = await alice.post('/api/documents', {});
  assert.equal((await alice.patch(`/api/documents/${body.document.id}`, { title: '   ' })).status, 400);
  assert.equal((await alice.patch(`/api/documents/${body.document.id}`, { content: 42 })).status, 400);
  assert.equal((await alice.post('/api/documents', { title: 'x'.repeat(201) })).status, 400);
});

test('sharing: owner grants access, roles are enforced, owned vs shared lists differ', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');

  const { body } = await alice.post('/api/documents', { title: 'Private memo', content: '<p>secret</p>' });
  const id = body.document.id;

  // Not shared yet: invisible to others (404 rather than 403, so existence isn't leaked).
  assert.equal((await bob.get(`/api/documents/${id}`)).status, 404);

  // Only the owner can share.
  assert.equal((await bob.put(`/api/documents/${id}/shares`, { email: 'bob@ajaia.test' })).status, 404);
  assert.equal((await alice.put(`/api/documents/${id}/shares`, { email: 'nobody@x.test' })).status, 404);
  assert.equal((await alice.put(`/api/documents/${id}/shares`, { email: 'alice@ajaia.test' })).status, 400);

  const shared = await alice.put(`/api/documents/${id}/shares`, { email: 'bob@ajaia.test', role: 'viewer' });
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.body.shares.map((s) => [s.email, s.role]), [['bob@ajaia.test', 'viewer']]);

  // Viewer can read but not write, rename, reshare or delete.
  const asBob = await bob.get(`/api/documents/${id}`);
  assert.equal(asBob.status, 200);
  assert.equal(asBob.body.document.role, 'viewer');
  assert.equal(asBob.body.document.shares, undefined, 'share list is owner-only');
  assert.equal((await bob.patch(`/api/documents/${id}`, { content: '<p>hacked</p>' })).status, 403);
  assert.equal((await bob.del(`/api/documents/${id}`)).status, 403);

  // Appears under "shared" for Bob, under "owned" for Alice, nowhere for Carol.
  const bobList = (await bob.get('/api/documents')).body;
  assert.ok(bobList.shared.some((d) => d.id === id && d.owner.email === 'alice@ajaia.test'));
  assert.ok(!bobList.owned.some((d) => d.id === id));
  assert.ok((await alice.get('/api/documents')).body.owned.some((d) => d.id === id && d.shareCount === 1));
  const carolList = (await carol.get('/api/documents')).body;
  assert.ok(![...carolList.owned, ...carolList.shared].some((d) => d.id === id));

  // Upgrade to editor: Bob can now edit.
  await alice.put(`/api/documents/${id}/shares`, { email: 'bob@ajaia.test', role: 'editor' });
  assert.equal((await bob.patch(`/api/documents/${id}`, { content: '<p>edited by bob</p>' })).status, 200);

  // Revoke: Bob loses access.
  const bobId = shared.body.shares[0].userId;
  assert.equal((await alice.del(`/api/documents/${id}/shares/${bobId}`)).status, 200);
  assert.equal((await bob.get(`/api/documents/${id}`)).status, 404);
});

test('concurrent edits: a stale baseVersion gets 409 instead of overwriting', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const { body } = await alice.post('/api/documents', { title: 'Shared draft' });
  const { id, version } = body.document;
  await alice.put(`/api/documents/${id}/shares`, { email: 'bob@ajaia.test', role: 'editor' });

  assert.equal((await bob.patch(`/api/documents/${id}`, { content: '<p>bob</p>', baseVersion: version })).status, 200);
  const stale = await alice.patch(`/api/documents/${id}`, { content: '<p>alice</p>', baseVersion: version });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.document.content, '<p>bob</p>', 'conflict response carries the latest version');
});

test('upload: .md and .txt become new editable documents; unsupported types are rejected', async () => {
  const alice = await login('alice@ajaia.test');

  const md = await alice.post('/api/documents/import', fileForm('Meeting notes.md', '# Notes\n\n- **one**\n- two\n'));
  assert.equal(md.status, 201);
  assert.equal(md.body.document.title, 'Meeting notes');
  assert.match(md.body.document.content, /<h1>Notes<\/h1>/);
  assert.match(md.body.document.content, /<ul>\s*<li><strong>one<\/strong><\/li>/);

  const txt = await alice.post('/api/documents/import', fileForm('todo.txt', 'line <1>\n\nline 2'));
  assert.equal(txt.status, 201);
  assert.equal(txt.body.document.content, '<p>line &lt;1&gt;</p><p><br /></p><p>line 2</p>');

  const pdf = await alice.post('/api/documents/import', fileForm('scan.pdf', '%PDF-1.4'));
  assert.equal(pdf.status, 400);
  assert.match(pdf.body.error, /Unsupported file type/);

  const badDocx = await alice.post('/api/documents/import', fileForm('broken.docx', 'not a zip'));
  assert.equal(badDocx.status, 400);
});

test('upload: a real .docx keeps headings, emphasis and lists', async () => {
  const alice = await login('alice@ajaia.test');
  const buf = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'brief.docx'));
  const res = await alice.post('/api/documents/import', fileForm('brief.docx', buf));
  assert.equal(res.status, 201);
  assert.equal(res.body.document.title, 'brief');
  const html = res.body.document.content;
  assert.match(html, /<h1>Project Brief<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul><li>First point<\/li><li>Second point<\/li><\/ul>/);
});
