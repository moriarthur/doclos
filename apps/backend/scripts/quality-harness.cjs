#!/usr/bin/env node
/**
 * S4 quality harness (wave 5) — measures real field-level extraction accuracy.
 *
 * Stages (run in order):
 *   select   — deterministically pick sample sources from the PDF corpus
 *   scans    — rasterize the sample into noisy scan-like JPGs (OCR path)
 *   run      — upload text + scan arms to the API, wait for the pipeline,
 *              dump per-document results (label the run: --label baseline|after)
 *   report   — score results against scripts/quality-ground-truth.json;
 *              with --baseline <dir> prints a before/after table
 *   clean    — delete every document the harness created (from run manifests)
 *
 * No credentials in the repo: login comes from QUALITY_EMAIL / QUALITY_PASSWORD.
 * Corpus location: QUALITY_CORPUS_DIR (default: <repo>/1000+ PDF_Invoice_Folder).
 * Work dir: QUALITY_WORK_DIR (default: <os tmpdir>/doclos-quality).
 *
 * Usage:
 *   node scripts/quality-harness.cjs select
 *   node scripts/quality-harness.cjs scans
 *   node scripts/quality-harness.cjs run --label baseline
 *   node scripts/quality-harness.cjs report --baseline results/baseline
 *   node scripts/quality-harness.cjs clean
 */
'use strict';

const { execFileSync } = require('child_process');
const FS = require('fs');
const OS = require('os');
const PATH = require('path');

const REPO_ROOT = PATH.resolve(__dirname, '..', '..', '..');
const WORK_DIR = process.env.QUALITY_WORK_DIR || PATH.join(OS.tmpdir(), 'doclos-quality');
const CORPUS_DIR =
  process.env.QUALITY_CORPUS_DIR || PATH.join(REPO_ROOT, '1000+ PDF_Invoice_Folder');
const BASE_URL = process.env.QUALITY_BASE_URL || 'http://localhost:3001/api/v1';
const GROUND_TRUTH_PATH = PATH.join(__dirname, 'quality-ground-truth.json');

// Deterministic sample: every Nth file of the sorted corpus. Changing SAMPLE_n
// invalidates committed ground truth — treat both as one versioned pair.
const SAMPLE_STRIDE = 34; // 1007 files → 30 samples
const SCAN_COUNT = 15; // first SCAN_COUNT samples also become scans (paired arms)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

function sampleSources() {
  const files = FS.readdirSync(CORPUS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  const picked = [];
  for (let i = 0; i < files.length && picked.length < 30; i += SAMPLE_STRIDE) {
    picked.push(files[i]);
  }
  return picked;
}

async function apiLogin() {
  const email = process.env.QUALITY_EMAIL;
  const password = process.env.QUALITY_PASSWORD;
  must(email && password, 'QUALITY_EMAIL / QUALITY_PASSWORD env vars are required');
  const r = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  must(r.ok, `login failed: ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

// --- stages -----------------------------------------------------------------

function select() {
  must(FS.existsSync(CORPUS_DIR), `corpus dir not found: ${CORPUS_DIR}`);
  const sources = sampleSources();
  FS.mkdirSync(PATH.join(WORK_DIR, 'text'), { recursive: true });
  FS.writeFileSync(
    PATH.join(WORK_DIR, 'manifest.json'),
    JSON.stringify({ corpus: CORPUS_DIR, stride: SAMPLE_STRIDE, scanCount: SCAN_COUNT, sources }, null, 2),
  );
  for (const f of sources) {
    FS.copyFileSync(PATH.join(CORPUS_DIR, f), PATH.join(WORK_DIR, 'text', f));
  }
  console.log(`selected ${sources.length} sources → ${WORK_DIR}/text (scan first ${SCAN_COUNT})`);
}

function scans() {
  const manifest = JSON.parse(FS.readFileSync(PATH.join(WORK_DIR, 'manifest.json'), 'utf8'));
  const scanDir = PATH.join(WORK_DIR, 'scan');
  FS.mkdirSync(scanDir, { recursive: true });
  const sources = manifest.sources.slice(0, manifest.scanCount);
  sources.forEach((f, i) => {
    const out = PATH.join(scanDir, `${String(i).padStart(2, '0')}__${f.replace(/\.pdf$/i, '')}.jpg`);
    if (FS.existsSync(out)) return;
    const png = out.replace(/\.jpg$/, '.tmp.png');
    execFileSync('gs', ['-dNOPAUSE', '-dBATCH', '-q', '-sDEVICE=png16m', '-r150', `-o${png}`, PATH.join(WORK_DIR, 'text', f)]);
    execFileSync('convert', [png, '-rotate', '0.7', '-attenuate', '0.6', '+noise', 'Gaussian', '-quality', '80', out]);
    FS.unlinkSync(png);
    console.log('scan', f);
  });
  console.log(`scans ready in ${scanDir}`);
}

const TERMINAL = new Set(['parsed', 'needs_validation', 'error', 'failed', 'validated', 'archived']);

async function uploadOne(token, filePath) {
  const buf = FS.readFileSync(filePath);
  const mime = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), PATH.basename(filePath));
  const r = await fetch(`${BASE_URL}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`upload ${filePath}: ${r.status} ${await r.text()}`);
  return (await r.json()).document_id;
}

async function waitTerminal(token, id, timeoutMs = 8 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5000);
    const r = await fetch(`${BASE_URL}/documents/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) continue;
    const j = await r.json();
    if (TERMINAL.has(String(j.status).toLowerCase())) return j;
  }
  throw new Error(`timeout waiting for ${id}`);
}

async function run(label) {
  must(label, 'run requires --label <name>');
  const manifest = JSON.parse(FS.readFileSync(PATH.join(WORK_DIR, 'manifest.json'), 'utf8'));
  const token = await apiLogin();
  const outDir = PATH.join(WORK_DIR, 'results', label);
  FS.mkdirSync(outDir, { recursive: true });
  const results = {};
  const jobs = [];
  manifest.sources.forEach((f, i) => jobs.push({ name: `text__${f}`, path: PATH.join(WORK_DIR, 'text', f) }));
  manifest.sources.slice(0, manifest.scanCount).forEach((f, i) =>
    jobs.push({ name: `scan__${f}`, path: scanFile(i, f) }),
  );
  for (const job of jobs) {
    must(FS.existsSync(job.path), `missing file: ${job.path} (run the scans stage)`);
    const id = await uploadOne(token, job.path);
    console.log('uploaded', job.name, '->', id);
    const doc = await waitTerminal(token, id);
    results[job.name] = { document_id: id, doc };
    FS.writeFileSync(PATH.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    await sleep(4000); // gentle on free-tier rate limits
  }
  console.log(`run "${label}" complete: ${Object.keys(results).length} docs → ${outDir}/results.json`);
}

function scanFile(i, sourceName) {
  return PATH.join(WORK_DIR, 'scan', `${String(i).padStart(2, '0')}__${sourceName.replace(/\.pdf$/i, '')}.jpg`);
}

// --- scoring -----------------------------------------------------------------

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function fieldMatches(field, extracted, truth) {
  if (truth === null || truth === undefined) return extracted === null || extracted === undefined || extracted === '';
  if (extracted === null || extracted === undefined || extracted === '') return false;
  if (field === 'amount_total' || field === 'vat_amount') {
    const a = Number(extracted);
    return Number.isFinite(a) && Math.abs(a - Number(truth)) < 0.01;
  }
  return norm(extracted) === norm(truth);
}

/** Pull comparable field values out of an API document payload. */
function extractFields(doc) {
  const inv = doc.invoice || {};
  const val = (f) => {
    const v = inv[f];
    if (v === null || v === undefined) return null;
    return typeof v === 'object' && 'value' in v ? v.value : v;
  };
  return {
    invoice_number: val('invoice_number'),
    invoice_date: val('invoice_date'),
    due_date: val('due_date'),
    amount_total: val('amount_total'),
    vat_amount: val('vat_amount'),
    currency: val('currency'),
    supplier_name: val('supplier_name'),
    supplier_address: val('supplier_address'),
  };
}

function report(opts) {
  const truth = JSON.parse(FS.readFileSync(GROUND_TRUTH_PATH, 'utf8'));
  const loadRun = (dir) => {
    const p = dir ? PATH.resolve(dir) : null;
    const file = p && FS.existsSync(PATH.join(p, 'results.json')) ? PATH.join(p, 'results.json') : null;
    return file ? JSON.parse(FS.readFileSync(file, 'utf8')) : null;
  };
  const current = loadRun(opts.current);
  must(current, 'no current results (pass --current <dir> or run first)');
  const baseline = opts.baseline ? loadRun(opts.baseline) : null;

  const FIELDS = Object.keys(truth.docs[0].fields);
  const scoreRun = (run) => {
    const perField = Object.fromEntries(FIELDS.map((f) => [f, { match: 0, labeled: 0, fp: 0 }]));
    let parsed = 0;
    let needsValidation = 0;
    let errors = 0;
    const confs = [];
    for (const [name, { doc }] of Object.entries(run)) {
      const source = name.replace(/^(text|scan)__/, '');
      const t = truth.docs.find((d) => d.source === source);
      if (!t) continue;
      const st = String(doc.status).toLowerCase();
      if (st === 'parsed') parsed++;
      else if (st === 'needs_validation') needsValidation++;
      else errors++;
      if (typeof doc.extraction_confidence === 'number') confs.push(doc.extraction_confidence);
      const ex = extractFields(doc);
      for (const f of FIELDS) {
        const tv = t.fields[f];
        if (tv !== null && tv !== undefined) {
          perField[f].labeled++;
          if (fieldMatches(f, ex[f], tv)) perField[f].match++;
        } else if (ex[f] !== null && ex[f] !== undefined && ex[f] !== '') {
          perField[f].fp++; // invented a value where the source has none
        }
      }
    }
    const mean = confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : null;
    return { perField, parsed, needsValidation, errors, meanConf: mean, n: Object.keys(run).length };
  };

  const fmt = (r) =>
    `n=${r.n} parsed=${r.parsed} needs_validation=${r.needsValidation} error=${r.errors} meanConf=${
      r.meanConf === null ? '-' : r.meanConf.toFixed(3)
    }`;
  console.log(`CURRENT  (${opts.current || WORK_DIR + '/results/<current>'}): ${fmt(scoreRun(current))}`);
  if (baseline) console.log(`BASELINE (${opts.baseline}): ${fmt(scoreRun(baseline))}`);
  console.log('');
  const hdr = 'field'.padEnd(18) + (baseline ? 'baseline → current' : 'current');
  console.log(hdr);
  const cur = scoreRun(current);
  const base = baseline ? scoreRun(baseline) : null;
  for (const f of FIELDS) {
    const acc = (r) => {
      const x = r.perField[f];
      return x.labeled ? `${((x.match / x.labeled) * 100).toFixed(0)}% (${x.match}/${x.labeled})` : '-';
    };
    const fp = (r) => (r.perField[f].fp ? ` fp:${r.perField[f].fp}` : '');
    let line = f.padEnd(18) + acc(cur) + fp(cur);
    if (base) line = f.padEnd(18) + `${acc(base)} → ${acc(cur)}` + fp(cur);
    console.log(line);
  }
  if (baseline) {
    console.log(
      `\nparse rate: baseline ${((base.parsed / base.n) * 100).toFixed(0)}% → current ${((cur.parsed / cur.n) * 100).toFixed(0)}%`,
    );
  }
}

async function clean() {
  const token = await apiLogin();
  let ids = new Set();
  const resDir = PATH.join(WORK_DIR, 'results');
  if (FS.existsSync(resDir)) {
    for (const label of FS.readdirSync(resDir)) {
      const file = PATH.join(resDir, label, 'results.json');
      if (!FS.existsSync(file)) continue;
      const run = JSON.parse(FS.readFileSync(file, 'utf8'));
      for (const { document_id } of Object.values(run)) ids.add(document_id);
    }
  }
  console.log(`deleting ${ids.size} document(s)…`);
  for (const id of ids) {
    const r = await fetch(`${BASE_URL}/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    console.log(id, r.status);
  }
}

// --- cli ---------------------------------------------------------------------

const [, , cmd, ...rest] = process.argv;
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

(async () => {
  if (cmd === 'select') select();
  else if (cmd === 'scans') scans();
  else if (cmd === 'run') await run(opt('--label'));
  else if (cmd === 'report') report({ baseline: opt('--baseline'), current: opt('--current') });
  else if (cmd === 'clean') await clean();
  else {
    console.log('stages: select | scans | run --label <name> | report [--baseline <dir>] [--current <dir>] | clean');
    process.exit(cmd ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
