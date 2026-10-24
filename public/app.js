/* global Quill */
const view = document.getElementById('view');
const SAVE_DEBOUNCE_MS = 800;

let me = null;
let teardown = null; // cleanup for the current view (flushes unsaved edits)
let currentView = null;

// The session token lives in sessionStorage, so each tab has its own sign-in
// (Alice in one tab, Bob in another) and survives a refresh of that tab.
const TOKEN_KEY = 'ajaia-session';
function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: session lasts until reload */ }
}
let memoryToken = getToken();

// ---- helpers --------------------------------------------------------------

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (memoryToken) opts.headers.Authorization = `Bearer ${memoryToken}`;
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw Object.assign(new Error('Network error. Check your connection.'), { status: 0 });
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login' && me) {
    // Session ended (signed out elsewhere, or the server's data was reset).
    memoryToken = null;
    setToken(null);
    me = null;
    data.error = 'Your session ended. Please sign in again.';
    setTimeout(route);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 4000);
}

function mount(templateId) {
  view.replaceChildren(document.getElementById(templateId).content.cloneNode(true));
  return view;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };

// ---- routing --------------------------------------------------------------

async function route() {
  if (teardown) { await teardown(); teardown = null; }
  if (!me && memoryToken) {
    try { ({ user: me } = await api('/api/me')); } catch { me = null; }
  }
  currentView = null;
  document.getElementById('user-menu').hidden = !me;
  if (me) document.getElementById('user-name').textContent = `${me.name} (${me.email})`;
  if (!me) return renderLogin();

  const match = location.hash.match(/^#\/doc\/(\d+)$/);
  if (match) return renderEditor(Number(match[1]));
  return renderHome();
}

window.addEventListener('hashchange', route);
document.getElementById('logout').addEventListener('click', async () => {
  if (teardown) { await teardown(); teardown = null; }
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  me = null;
  memoryToken = null;
  setToken(null);
  location.hash = '#/';
  route();
});

// ---- login ----------------------------------------------------------------

async function renderLogin() {
  const root = mount('tpl-login');
  const list = root.querySelector('.login-users');
  const { users } = await api('/api/demo-users');
  for (const u of users) {
    list.append(el('button', {
      class: 'btn btn-secondary login-user',
      onclick: async () => {
        try {
          const { user, token } = await api('/api/login', { method: 'POST', body: { email: u.email } });
          me = user;
          memoryToken = token;
          setToken(token);
          route();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, el('strong', {}, u.name), el('span', { class: 'muted small' }, u.email)));
  }
}

// ---- home -----------------------------------------------------------------

// Coming back to the list tab picks up documents shared or changed meanwhile.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentView === 'home') renderHome();
});

async function renderHome() {
  const root = mount('tpl-home');
  currentView = 'home';
  root.querySelector('[data-action=new]').addEventListener('click', async () => {
    try {
      const { document: doc } = await api('/api/documents', { method: 'POST', body: {} });
      location.hash = `#/doc/${doc.id}`;
    } catch (e) { toast(e.message, 'error'); }
  });
  root.querySelector('[data-action=upload]').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      toast(`Importing ${file.name}…`);
      const { document: doc } = await api('/api/documents/import', { method: 'POST', form });
      toast(`Imported "${doc.title}"`, 'success');
      location.hash = `#/doc/${doc.id}`;
    } catch (e) { toast(e.message, 'error'); }
  });

  let data;
  try { data = await api('/api/documents'); } catch (e) { return toast(e.message, 'error'); }

  const ownedList = root.querySelector('[data-list=owned]');
  const sharedList = root.querySelector('[data-list=shared]');
  ownedList.append(...(data.owned.length ? data.owned.map((d) => docItem(d, true))
    : [el('li', { class: 'empty muted' }, 'No documents yet. Create one or upload a file.')]));
  sharedList.append(...(data.shared.length ? data.shared.map((d) => docItem(d, false))
    : [el('li', { class: 'empty muted' }, 'Nothing has been shared with you yet.')]));
}

function docItem(d, owned) {
  const meta = owned
    ? `Edited ${timeAgo(d.updatedAt)}${d.shareCount ? ` · Shared with ${d.shareCount}` : ''}`
    : `Owned by ${d.owner.name} · Edited ${timeAgo(d.updatedAt)}`;
  const del = owned && el('button', {
    class: 'btn btn-ghost btn-danger small', title: 'Delete document',
    onclick: async (ev) => {
      ev.preventDefault();
      if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
      try { await api(`/api/documents/${d.id}`, { method: 'DELETE' }); route(); } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Delete');
  return el('li', {},
    el('a', { href: `#/doc/${d.id}`, class: 'doc-item card' },
      el('div', { class: 'doc-item-main' },
        el('div', { class: 'doc-title' }, d.title,
          el('span', { class: `badge badge-${d.role}` }, owned ? (d.shareCount ? 'Owner · shared' : 'Owner') : ROLE_LABEL[d.role])),
        el('div', { class: 'doc-excerpt muted small' }, d.excerpt || 'Empty document'),
        el('div', { class: 'muted small' }, meta)),
      del));
}

// ---- editor ---------------------------------------------------------------

async function renderEditor(id) {
  let doc;
  try {
    ({ document: doc } = await api(`/api/documents/${id}`));
  } catch (e) {
    toast(e.status === 404 ? 'Document not found, or you no longer have access.' : e.message, 'error');
    location.hash = '#/';
    return;
  }

  const root = mount('tpl-editor');
  const canEdit = doc.role !== 'viewer';
  const titleInput = root.querySelector('.title-input');
  const status = root.querySelector('.save-status');
  const conflict = root.querySelector('.conflict');
  const roleBadge = root.querySelector('[data-role]');

  roleBadge.textContent = ROLE_LABEL[doc.role];
  roleBadge.className = `badge badge-${doc.role}`;
  root.querySelector('.owner-line').textContent = doc.role === 'owner'
    ? (doc.shares.length ? `Shared with ${doc.shares.map((s) => s.name).join(', ')}` : 'Only you can see this document')
    : `Owned by ${doc.owner.name}`;
  titleInput.value = doc.title;
  titleInput.readOnly = !canEdit;
  root.querySelectorAll('[data-edit-only]').forEach((n) => { n.hidden = !canEdit; });
  if (!canEdit) root.querySelector('#toolbar').hidden = true;

  const quill = new Quill('#editor', {
    theme: 'snow',
    modules: { toolbar: canEdit ? '#toolbar' : false },
    readOnly: !canEdit,
    placeholder: canEdit ? 'Start writing…' : '',
  });
  quill.clipboard.dangerouslyPasteHTML(doc.content, 'silent');
  quill.history.clear();
  if (canEdit) quill.focus();

  // --- autosave state machine: dirty -> saving -> saved | error | conflict
  let version = doc.version;
  let lastSavedTitle = doc.title;
  let dirty = false;
  let saving = null; // in-flight promise
  let timer = null;
  let halted = false; // true while a conflict is unresolved

  const setStatus = (text) => { status.textContent = text; };
  setStatus(canEdit ? `Saved ${timeAgo(doc.updatedAt)}` : '');

  function scheduleSave() {
    if (!canEdit || halted) return;
    dirty = true;
    setStatus('Unsaved changes…');
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  }

  async function save({ force = false } = {}) {
    clearTimeout(timer);
    if (saving) { await saving; if (!dirty) return; }
    if (!dirty || (halted && !force)) return;
    const title = titleInput.value.trim() || lastSavedTitle;
    const body = { title, content: quill.root.innerHTML };
    if (!force) body.baseVersion = version;
    dirty = false;
    setStatus('Saving…');
    saving = api(`/api/documents/${id}`, { method: 'PATCH', body })
      .then(({ document: saved }) => {
        version = saved.version;
        lastSavedTitle = saved.title;
        halted = false;
        conflict.hidden = true;
        setStatus(dirty ? 'Unsaved changes…' : 'All changes saved');
      })
      .catch((e) => {
        dirty = true;
        if (e.status === 409) {
          halted = true;
          conflict.hidden = false;
          setStatus('Not saved: conflict');
        } else if (e.status === 401 || e.status === 403 || e.status === 404) {
          halted = true;
          setStatus('Not saved');
          toast(e.status === 401 ? e.message : 'You no longer have edit access to this document.', 'error');
        } else {
          setStatus(`Save failed: ${e.message} Retrying…`);
          timer = setTimeout(save, 3000);
        }
      })
      .finally(() => { saving = null; });
    await saving;
  }

  quill.on('text-change', (_d, _o, source) => { if (source === 'user') scheduleSave(); });
  titleInput.addEventListener('input', scheduleSave);
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quill.focus(); } });
  titleInput.addEventListener('blur', () => {
    if (!titleInput.value.trim()) { titleInput.value = lastSavedTitle; toast('Title cannot be empty', 'error'); }
  });

  conflict.querySelector('[data-action=reload]').addEventListener('click', () => { dirty = false; halted = false; route(); });
  conflict.querySelector('[data-action=overwrite]').addEventListener('click', async () => {
    dirty = true;
    await save({ force: true });
  });

  root.querySelector('[data-action=import]').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const { html } = await api('/api/convert', { method: 'POST', form });
      const index = (quill.getSelection(true) || { index: quill.getLength() }).index;
      quill.clipboard.dangerouslyPasteHTML(index, html, 'user');
      toast(`Inserted ${file.name}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  const shareBtn = root.querySelector('[data-action=share]');
  shareBtn.hidden = doc.role !== 'owner';
  shareBtn.addEventListener('click', () => openShareDialog(doc));

  const onBeforeUnload = (e) => { if (dirty || saving) { save(); e.preventDefault(); } };
  window.addEventListener('beforeunload', onBeforeUnload);

  teardown = async () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (dirty && !halted) await save();
  };
}

// ---- sharing --------------------------------------------------------------

async function openShareDialog(doc) {
  const dialog = document.getElementById('share-dialog');
  const form = dialog.querySelector('form');
  const select = form.elements.email;
  const list = dialog.querySelector('.share-list');
  const error = dialog.querySelector('.error');
  let users = [];
  try { ({ users } = await api('/api/users')); } catch (e) { return toast(e.message, 'error'); }

  function render(shares) {
    doc.shares = shares;
    const sharedIds = new Set(shares.map((s) => s.userId));
    const candidates = users.filter((u) => u.id !== doc.owner.id && !sharedIds.has(u.id));
    select.replaceChildren(...candidates.map((u) => el('option', { value: u.email }, `${u.name} (${u.email})`)));
    select.disabled = form.querySelector('[data-action=add-share]').disabled = !candidates.length;
    if (!candidates.length) select.append(el('option', {}, 'Everyone already has access'));

    list.replaceChildren(
      el('li', {}, el('span', {}, `${doc.owner.name} `, el('span', { class: 'muted small' }, doc.owner.email)),
        el('span', { class: 'badge badge-owner' }, 'Owner')),
      ...shares.map((s) => {
        const roleSel = el('select', {
          'aria-label': `Access for ${s.name}`,
          onchange: () => update(() => api(`/api/documents/${doc.id}/shares`, { method: 'PUT', body: { email: s.email, role: roleSel.value } })),
        }, el('option', { value: 'editor' }, 'Can edit'), el('option', { value: 'viewer' }, 'Can view'));
        roleSel.value = s.role;
        return el('li', {},
          el('span', {}, `${s.name} `, el('span', { class: 'muted small' }, s.email)),
          el('span', { class: 'share-controls' }, roleSel,
            el('button', {
              type: 'button', class: 'btn btn-ghost btn-danger small',
              onclick: () => update(() => api(`/api/documents/${doc.id}/shares/${s.userId}`, { method: 'DELETE' })),
            }, 'Remove')));
      }));
  }

  async function update(request) {
    error.hidden = true;
    try {
      const { shares } = await request();
      render(shares);
      const ownerLine = document.querySelector('.owner-line');
      if (ownerLine) ownerLine.textContent = shares.length ? `Shared with ${shares.map((s) => s.name).join(', ')}` : 'Only you can see this document';
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  }

  form.onsubmit = (ev) => {
    if (ev.submitter?.value !== 'add') return;
    ev.preventDefault();
    update(() => api(`/api/documents/${doc.id}/shares`, { method: 'PUT', body: { email: select.value, role: form.elements.role.value } }));
  };

  error.hidden = true;
  render(doc.shares || []);
  dialog.showModal();
}

route();
