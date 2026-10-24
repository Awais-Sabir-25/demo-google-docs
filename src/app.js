const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  sanitizeContent, fileToHtml, titleFromFilename, plainText, UnsupportedFileError,
  MAX_CONTENT_BYTES, MAX_TITLE_LENGTH, SUPPORTED_UPLOADS,
} = require('./content');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function createApp(db) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.use(express.json({ limit: '2mb' }));

  // ---- data access -------------------------------------------------------

  const q = {
    userByEmail: db.prepare('SELECT id, email, name FROM users WHERE email = ?'),
    userBySession: db.prepare(`SELECT u.id, u.email, u.name FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = ?`),
    createSession: db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    allUsers: db.prepare('SELECT id, email, name FROM users ORDER BY name'),
    docById: db.prepare(`SELECT d.*, u.name AS owner_name, u.email AS owner_email
      FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?`),
    shareRole: db.prepare('SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?'),
    ownedDocs: db.prepare(`SELECT d.id, d.title, d.content, d.updated_at,
        (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
      FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`),
    sharedDocs: db.prepare(`SELECT d.id, d.title, d.content, d.updated_at, s.role,
        u.name AS owner_name, u.email AS owner_email
      FROM document_shares s JOIN documents d ON d.id = s.document_id
      JOIN users u ON u.id = d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC`),
    insertDoc: db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)'),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    sharesForDoc: db.prepare(`SELECT u.id AS user_id, u.email, u.name, s.role FROM document_shares s
      JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY u.name`),
    upsertShare: db.prepare(`INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?'),
  };

  /** Returns 'owner' | 'editor' | 'viewer' | null for this user on this document. */
  function roleFor(doc, userId) {
    if (doc.owner_id === userId) return 'owner';
    return q.shareRole.get(doc.id, userId)?.role ?? null;
  }

  // Loads a document and enforces the minimum role. Documents the user cannot
  // see at all return 404 (not 403) so their existence isn't leaked.
  function loadDoc(req, minRole) {
    const id = Number(req.params.id);
    const doc = Number.isInteger(id) ? q.docById.get(id) : undefined;
    const role = doc && roleFor(doc, req.user.id);
    if (!role) throw new HttpError(404, 'Document not found');
    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[minRole]) {
      throw new HttpError(403, minRole === 'owner'
        ? 'Only the owner can do that'
        : 'You have view-only access to this document');
    }
    return { doc, role };
  }

  function serializeDoc(doc, role) {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      updatedAt: doc.updated_at,
      createdAt: doc.created_at,
      owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
      role,
      shares: role === 'owner' ? q.sharesForDoc.all(doc.id).map(serializeShare) : undefined,
    };
  }

  const serializeShare = (s) => ({ userId: s.user_id, email: s.email, name: s.name, role: s.role });
  const excerpt = (html) => plainText(html).slice(0, 140);

  function validateTitle(raw) {
    if (typeof raw !== 'string') throw new HttpError(400, 'Title must be a string');
    const title = raw.trim();
    if (!title) throw new HttpError(400, 'Title cannot be empty');
    if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
    return title;
  }

  function validateContent(raw) {
    if (typeof raw !== 'string') throw new HttpError(400, 'Content must be a string');
    if (Buffer.byteLength(raw) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Document is too large (max 1 MB)');
    return sanitizeContent(raw);
  }

  function createDoc(ownerId, title, content) {
    const { lastInsertRowid } = q.insertDoc.run(ownerId, title, content);
    return q.docById.get(Number(lastInsertRowid));
  }

  // ---- auth (mocked: pick a seeded account, no password) ------------------
  // Sessions are bearer tokens the client keeps per browser tab (sessionStorage),
  // not a cookie: a cookie is shared by every tab, so signing in as Bob in one tab
  // would silently turn an open "Alice" tab into Bob. Per-tab sessions also let a
  // reviewer test sharing with two users side by side in one browser.
  const bearer = (req) => /^Bearer (\w+)$/.exec(req.get('authorization') ?? '')?.[1];

  app.post('/api/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(401, 'Unknown account. Use one of the demo accounts.');
    const token = crypto.randomBytes(24).toString('hex');
    q.createSession.run(token, user.id);
    res.json({ user, token });
  });

  app.get('/api/demo-users', (req, res) => res.json({ users: q.allUsers.all() }));

  app.use('/api', (req, res, next) => {
    const token = bearer(req);
    req.user = token ? q.userBySession.get(token) : undefined;
    if (!req.user) throw new HttpError(401, 'Not signed in');
    next();
  });

  app.post('/api/logout', (req, res) => {
    q.deleteSession.run(bearer(req));
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: req.user }));
  app.get('/api/users', (req, res) => res.json({ users: q.allUsers.all() }));

  // ---- documents ---------------------------------------------------------

  app.get('/api/documents', (req, res) => {
    res.json({
      owned: q.ownedDocs.all(req.user.id).map((d) => ({
        id: d.id, title: d.title, updatedAt: d.updated_at, excerpt: excerpt(d.content),
        role: 'owner', shareCount: d.share_count,
      })),
      shared: q.sharedDocs.all(req.user.id).map((d) => ({
        id: d.id, title: d.title, updatedAt: d.updated_at, excerpt: excerpt(d.content),
        role: d.role, owner: { name: d.owner_name, email: d.owner_email },
      })),
    });
  });

  app.post('/api/documents', (req, res) => {
    const title = req.body?.title === undefined ? 'Untitled document' : validateTitle(req.body.title);
    const content = req.body?.content === undefined ? '' : validateContent(req.body.content);
    res.status(201).json({ document: serializeDoc(createDoc(req.user.id, title, content), 'owner') });
  });

  app.post('/api/documents/import', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field');
    const html = await fileToHtml(req.file.originalname, req.file.buffer);
    const doc = createDoc(req.user.id, titleFromFilename(req.file.originalname), html);
    res.status(201).json({ document: serializeDoc(doc, 'owner') });
  });

  // Converts a file without creating a document (used to import into an open draft).
  app.post('/api/convert', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field');
    res.json({ html: await fileToHtml(req.file.originalname, req.file.buffer) });
  });

  app.get('/api/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req, 'viewer');
    res.json({ document: serializeDoc(doc, role) });
  });

  app.patch('/api/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req, 'editor');
    const body = req.body ?? {};
    const title = body.title === undefined ? doc.title : validateTitle(body.title);
    const content = body.content === undefined ? doc.content : validateContent(body.content);

    // Optimistic concurrency: if the client edited an older version, refuse
    // rather than silently overwrite someone else's changes.
    if (body.baseVersion !== undefined && body.baseVersion !== doc.version) {
      throw new HttpError(409, 'This document was changed by someone else', {
        document: serializeDoc(doc, role),
      });
    }
    db.prepare(`UPDATE documents SET title = ?, content = ?, version = version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(title, content, doc.id);
    res.json({ document: serializeDoc(q.docById.get(doc.id), role) });
  });

  app.delete('/api/documents/:id', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    q.deleteDoc.run(doc.id);
    res.status(204).end();
  });

  // ---- sharing -----------------------------------------------------------

  app.put('/api/documents/:id/shares', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = req.body?.role ?? 'editor';
    if (!['editor', 'viewer'].includes(role)) throw new HttpError(400, 'Role must be "editor" or "viewer"');
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user with email "${email}"`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'The owner already has full access');
    q.upsertShare.run(doc.id, target.id, role);
    res.json({ shares: q.sharesForDoc.all(doc.id).map(serializeShare) });
  });

  app.delete('/api/documents/:id/shares/:userId', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    q.deleteShare.run(doc.id, Number(req.params.userId));
    res.json({ shares: q.sharesForDoc.all(doc.id).map(serializeShare) });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---- static frontend ---------------------------------------------------

  app.use('/vendor/quill', express.static(path.join(path.dirname(require.resolve('quill/package.json')), 'dist')));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // ---- errors ------------------------------------------------------------

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof UnsupportedFileError) return res.status(400).json({ error: err.message, supported: SUPPORTED_UPLOADS });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB)' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
