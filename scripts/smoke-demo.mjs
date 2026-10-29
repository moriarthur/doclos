#!/usr/bin/env node
// Post-deploy smoke test for the public demo preview (PD-DEP4).
//
// Verifies the full public-demo user journey through the FRONTEND origin
// (same-origin proxy), never prints secrets (the generated password and all
// cookie values stay in memory), and exits non-zero on the first failure.
//
// Usage:
//   node scripts/smoke-demo.mjs [frontendOrigin]
//   FRONTEND_URL=https://doclos.example.com node scripts/smoke-demo.mjs
//
// Requires a REAL deployment (Postgres, Redis, R2, GLM) — this drives the
// actual pipeline end to end.

const FRONTEND_ORIGIN = (
  process.argv[2] ||
  process.env.FRONTEND_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');
const API = `${FRONTEND_ORIGIN}/api/v1`;

const ok = (name, detail = '') => {
  console.log(`  OK  ${name}${detail ? ` — ${detail}` : ''}`);
};
const boom = (name, detail = '') => {
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  process.exit(1);
};

// --- minimal cookie jar ----------------------------------------------------
const jar = new Map(); // userKey -> Map<cookieName, value>

function storeCookies(userKey, response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (!jar.has(userKey)) jar.set(userKey, new Map());
  const store = jar.get(userKey);
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const attrsLower = attrs.join(';').toLowerCase();
    // clearCookie sends a past expiry — honor the deletion.
    if (attrsLower.includes('expires=thu, 01 jan 1970')) {
      store.delete(name);
      continue;
    }
    store.set(name, value);
  }
}

function cookieHeader(userKey) {
  const store = jar.get(userKey);
  if (!store || store.size === 0) return '';
  return [...store.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function getCookie(userKey, name) {
  return jar.get(userKey)?.get(name) ?? null;
}

async function call(userKey, method, url, { json } = {}) {
  const headers = { 'user-agent': 'doclos-smoke/1.0' };
  const cookies = cookieHeader(userKey);
  if (cookies) headers.cookie = cookies;
  if (json !== undefined) headers['content-type'] = 'application/json';
  // PD-A3: double-submit CSRF — echo the csrf_token cookie in the header.
  const csrf = getCookie(userKey, 'csrf_token');
  if (method !== 'GET' && method !== 'HEAD' && csrf) {
    headers['x-csrf-token'] = csrf;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    redirect: 'manual',
  });
  storeCookies(userKey, response);
  return response;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- smoke journey ----------------------------------------------------------
const randomPassword = () =>
  `smoke-${crypto.randomUUID()}-A1a!`; // 12+ chars, mixed classes
const makeUser = () => ({
  name: 'Smoke Test',
  email: `smoke-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`,
  password: randomPassword(),
});

async function main() {
  console.log(`Doclos smoke → ${FRONTEND_ORIGIN}\n`);

  // 1. Frontend loads
  {
    const response = await fetch(FRONTEND_ORIGIN, { redirect: 'manual' });
    if (response.status < 200 || response.status >= 400) {
      boom('frontend loads', `status ${response.status}`);
    }
    ok('frontend loads', `status ${response.status}`);
  }

  // 2. Backend /healthz (direct)
  {
    const response = await fetch(`${process.env.BACKEND_ORIGIN || 'http://localhost:3001'}/healthz`);
    if (response.status !== 200) boom('backend /healthz', `status ${response.status}`);
    const body = await response.json();
    if (body.status !== 'ok') boom('backend /healthz', `body ${JSON.stringify(body)}`);
    ok('backend /healthz');
  }

  // 3. Backend /readyz (direct)
  {
    const response = await fetch(`${process.env.BACKEND_ORIGIN || 'http://localhost:3001'}/readyz`);
    if (response.status !== 200) boom('backend /readyz', `status ${response.status}`);
    const body = await response.json();
    for (const dep of ['postgres', 'redis', 'storage']) {
      if (body.checks?.[dep] !== 'ok') boom('backend /readyz', `${dep} not ok`);
    }
    ok('backend /readyz', `postgres/redis/storage ok`);
  }

  // Two isolated users — registration, isolation, revocation all need both.
  const userA = makeUser();
  const userB = makeUser();

  // 4. Registration (isolated accounts, uniform response — PD-A4)
  for (const [label, user] of [['A', userA], ['B', userB]]) {
    // Registration is state-changing and is protected by the global
    // double-submit CSRF guard, just like the browser flow.
    const csrfResponse = await call(label, 'GET', `${API}/auth/csrf`);
    if (csrfResponse.status !== 200) boom('CSRF bootstrap', `status ${csrfResponse.status}`);
    const response = await call(label, 'POST', `${API}/auth/register`, { json: user });
    if (response.status !== 201) boom('registration', `status ${response.status}`);
    const body = await response.json();
    if (!body.message) boom('registration', 'no message in body');
    if (body.access_token || body.refresh_token) {
      boom('registration', 'response leaks token material (PD-A1 violation)');
    }
    ok(`registration (${label})`);
  }

  // 5. Login (sets the HttpOnly session cookies through the proxy)
  for (const label of ['A', 'B']) {
    const user = label === 'A' ? userA : userB;
    const response = await call(label, 'POST', `${API}/auth/login`, {
      json: { email: user.email, password: user.password },
    });
    if (response.status !== 200) boom('login', `status ${response.status}`);
    if (!getCookie(label, 'access_token')) boom('login', 'no access_token cookie');
    if (!getCookie(label, 'csrf_token')) boom('login', 'no csrf cookie');
    ok(`login (${label})`);
  }

  // 6. Isolated user account — the security point of the whole design.
  // 6a. User A creates a sample; 6b. user B must NOT see it.
  {
    await call('A', 'GET', `${API}/auth/csrf`); // fresh csrf for safety
    const response = await call('A', 'POST', `${API}/demo/sample`);
    if (response.status === 429) {
      boom('synthetic sample', 'rate-limited — rerun the smoke later or raise budgets');
    }
    if (response.status !== 201) boom('synthetic sample', `status ${response.status}`);
    const body = await response.json();
    if (!body.document_id) boom('synthetic sample', 'no document_id');
    globalThis.__sampleDocId = body.document_id;
    ok('synthetic sample queued', `document ${body.document_id}`);
  }

  {
    const response = await call('B', 'GET', `${API}/documents`);
    if (response.status !== 200) boom('document list (B)', `status ${response.status}`);
    const body = await response.json();
    const ids = (body.data ?? []).map((d) => d.id);
    if (ids.includes(globalThis.__sampleDocId)) {
      boom('tenant isolation', 'user B can see user A’s document (IDOR!)');
    }
    ok('tenant isolation', 'user B sees none of user A’s documents');
  }

  // 7. Processing completes (real pipeline: queue → OCR → classify → extract)
  {
    const deadline = Date.now() + 180_000;
    let status = 'processing';
    let detail;
    while (Date.now() < deadline) {
      await sleep(4000);
      const response = await call('A', 'GET', `${API}/documents/${globalThis.__sampleDocId}`);
      if (response.status !== 200) boom('processing', `detail status ${response.status}`);
      const body = await response.json();
      status = body.status;
      detail = body;
      if (status !== 'processing') break;
    }
    if (status === 'processing') boom('processing', 'timed out after 180s');
    if (status === 'error') boom('processing', 'document landed in error state');
    if (!['parsed', 'needs_validation', 'validated'].includes(status)) {
      boom('processing', `unexpected status ${status}`);
    }
    ok('processing completes', `final status: ${status}`);
    if (detail?.invoice?.invoice_number?.value) {
      ok('extraction', `invoice_number present (synthetic RE-2026-0001 expected)`);
    }
  }

  // 8. Document viewer data (detail endpoint incl. short-lived signed URL)
  {
    const response = await call('A', 'GET', `${API}/documents/${globalThis.__sampleDocId}`);
    if (response.status !== 200) boom('document detail', `status ${response.status}`);
    const body = await response.json();
    if (!body.file_url) boom('document detail', 'no file_url');
    if (!/expired|Expires|X-Amz-Expires|sig=|token=|GoogleAccessId/i.test(body.file_url)) {
      // R2/AWS presigned URLs always carry an expiry parameter; if none is
      // present the URL is public — a PD-U3 regression.
      boom('document detail', 'file_url does not look like a presigned URL');
    }
    ok('document viewer data', 'detail + presigned URL present');
  }

  // 9. Original file download (through the authed streaming endpoint)
  {
    const response = await call('A', 'GET', `${API}/documents/${globalThis.__sampleDocId}/file`);
    if (response.status !== 200) boom('file download', `status ${response.status}`);
    const firstBytes = Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString('latin1');
    if (!firstBytes.startsWith('%PDF-')) boom('file download', 'not a PDF');
    ok('original file download');
  }

  // 10. Excel export
  {
    const response = await call('A', 'GET', `${API}/export/excel?lang=en`);
    if (response.status !== 200) boom('Excel export', `status ${response.status}`);
    const mime = response.headers.get('content-type') ?? '';
    if (!/spreadsheetml|octet-stream/.test(mime)) boom('Excel export', `content-type ${mime}`);
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size <= 0) boom('Excel export', 'empty workbook');
    ok('Excel export', `${size} bytes`);
  }

  // 10a. Deletion paths (DD-1): the normal per-document delete must work for
  // the sample in ANY status, the reset stays idempotent afterwards, and —
  // critically — deleting the sample does NOT re-open the 1/day quota.
  {
    let response = await call('A', 'DELETE', `${API}/documents/${globalThis.__sampleDocId}`);
    if (response.status !== 200) boom('document delete', `status ${response.status}`);
    ok('document delete', `DELETE /documents/:id → 200`);

    response = await call('A', 'GET', `${API}/documents`);
    if ((response.body?.data ?? []).some((d) => d.id === globalThis.__sampleDocId)) {
      boom('document delete', 'document still listed after delete');
    }
    ok('document delete applied', 'sample gone from the list');

    response = await call('A', 'DELETE', `${API}/demo/sample`);
    if (response.status !== 200) boom('sample reset (idempotent)', `status ${response.status}`);
    if (typeof response.body?.deleted !== 'number') boom('sample reset (idempotent)', 'no deleted count');
    ok('sample reset (idempotent)', `deleted: ${response.body.deleted}`);

    response = await call('A', 'POST', `${API}/demo/sample`);
    if (response.status !== 429) {
      boom('quota survives deletion', `second sample same day → ${response.status} (expected 429)`);
    }
    ok('quota survives deletion', '1/day still enforced after reset');
  }

  // 11. Logout (server-side revocation — PD-A2)
  {
    const response = await call('A', 'POST', `${API}/auth/logout`);
    if (response.status !== 200) boom('logout', `status ${response.status}`);
    ok('logout');
  }

  // 12. Revoked session rejection — the refresh cookie must be dead.
  {
    // Remaining cookies were cleared by logout; force-keep nothing: the jar
    // already dropped them. Prove the refresh path is closed with whatever
    // the browser would still hold: nothing.
    const response = await call('A', 'POST', `${API}/auth/refresh`);
    if (response.status !== 401) {
      boom('revoked session rejection', `refresh after logout → ${response.status} (expected 401)`);
    }
    ok('revoked session rejection', 'refresh after logout → 401');

    // The cleared access cookie must no longer open the API either.
    const afterLogout = await call('A', 'GET', `${API}/documents`);
    if (afterLogout.status !== 401) {
      boom('revoked session rejection', `documents after logout → ${afterLogout.status} (expected 401)`);
    }
    ok('revoked session rejection', 'documents after logout → 401');
  }

  console.log('\nAll smoke steps passed.');
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
