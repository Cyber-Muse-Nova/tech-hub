// Cloudflare Worker — GitHub Contents API proxy with admin gating
//
// Required env vars (Workers dashboard → Settings → Variables and Secrets):
//   GITHUB_TOKEN          — GitHub PAT with `contents: write` permission (set as Secret)
//   GITHUB_OWNER          — repo owner, e.g. "Cyber-Muse-Nova"
//   GITHUB_REPO           — repo name,  e.g. "tech-hub"
//   ADMIN_PASSWORD_HASH   — SHA-256 hex of the admin password
//   ALLOWED_ORIGIN        — CORS allow origin, e.g. "https://tech-hub.pages.dev" (or "*")

const ADDITIVE_PATHS = new Set([
  'data/comments.json',
  'data/links.json',
  'data/posts.json',
  'data/messages.json',
]);
const FREE_WRITE_PATHS = new Set([
  'data/meta.json',
]);
const ADMIN_ONLY_WRITE_PATHS = new Set([
  'data/guide.json',
]);

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    try {
      if (url.pathname === '/api/read') return await handleRead(env, url, json);
      if (url.pathname === '/api/write') return await handleWrite(env, request, json);
      if (url.pathname === '/api/delete') return await handleDelete(env, request, json);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  }
};

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function ghContents(env, path, init = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'tech-hub-worker',
      ...(init.headers || {}),
    },
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isAdmin(env, request) {
  const pw = request.headers.get('X-Admin-Password');
  if (!pw || !env.ADMIN_PASSWORD_HASH) return false;
  return (await sha256Hex(pw)) === env.ADMIN_PASSWORD_HASH;
}

async function handleRead(env, url, json) {
  const path = url.searchParams.get('path');
  if (!path) return json({ error: 'path required' }, 400);
  const r = await ghContents(env, encodePath(path));
  const data = await r.json().catch(() => ({}));
  return json(data, r.status);
}

async function handleWrite(env, request, json) {
  const body = await request.json().catch(() => null);
  if (!body || !body.path || !body.content || !body.message) {
    return json({ error: 'path, content, message required' }, 400);
  }
  const { path, content, message, sha } = body;
  const admin = await isAdmin(env, request);

  if (!admin) {
    if (path.startsWith('resources/')) {
      if (sha) return json({ error: '不能覆盖已有文件，需要管理员密码' }, 401);
    } else if (ADMIN_ONLY_WRITE_PATHS.has(path)) {
      return json({ error: '此操作需要管理员密码' }, 401);
    } else if (ADDITIVE_PATHS.has(path)) {
      const ok = await verifyAdditive(env, path, content);
      if (!ok) return json({ error: '修改未通过审核（仅允许新增），如需删除请输入管理员密码' }, 401);
    } else if (!FREE_WRITE_PATHS.has(path)) {
      return json({ error: '路径未授权: ' + path }, 403);
    }
  }

  const ghBody = { message, content };
  if (sha) ghBody.sha = sha;
  const r = await ghContents(env, encodePath(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ghBody),
  });
  const data = await r.json().catch(() => ({}));
  return json(data, r.status);
}

async function handleDelete(env, request, json) {
  if (!(await isAdmin(env, request))) {
    return json({ error: '需要管理员密码' }, 401);
  }
  const body = await request.json().catch(() => null);
  if (!body || !body.path || !body.message) {
    return json({ error: 'path, message required' }, 400);
  }
  const { path, message } = body;
  let { sha } = body;

  // Always re-fetch latest sha if missing or stale (listing API can return outdated SHAs)
  if (!sha) {
    const cur = await ghContents(env, encodePath(path));
    if (cur.status === 404) return json({ ok: true, note: 'already gone' });
    if (!cur.ok) return json({ error: '无法读取最新 SHA' }, cur.status);
    const j = await cur.json();
    sha = j.sha;
  }

  const r = await ghContents(env, encodePath(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha }),
  });
  const data = await r.json().catch(() => ({}));
  return json(data, r.status);
}

function b64ToString(b64) {
  const binary = atob((b64 || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

async function verifyAdditive(env, path, newContentB64) {
  const r = await ghContents(env, encodePath(path));
  if (r.status === 404) return true; // file doesn't exist yet — first creation
  if (!r.ok) return false;
  let oldVal, newVal;
  try {
    const j = await r.json();
    oldVal = JSON.parse(b64ToString(j.content));
  } catch { return false; }
  try { newVal = JSON.parse(b64ToString(newContentB64)); } catch { return false; }

  if (path === 'data/comments.json') return isCommentsAdditive(oldVal, newVal);
  return isArrayAdditive(oldVal, newVal);
}

function isArrayAdditive(oldArr, newArr) {
  if (!Array.isArray(oldArr) || !Array.isArray(newArr)) return false;
  if (newArr.length < oldArr.length) return false;
  for (let i = 0; i < oldArr.length; i++) {
    if (!deepEqual(oldArr[i], newArr[i])) return false;
  }
  return true;
}

function isCommentsAdditive(oldObj, newObj) {
  if (typeof oldObj !== 'object' || oldObj === null) return false;
  if (typeof newObj !== 'object' || newObj === null) return false;
  for (const k of Object.keys(oldObj)) {
    if (!isArrayAdditive(oldObj[k] || [], newObj[k] || [])) return false;
  }
  return true;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}
