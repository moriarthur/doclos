# Doclos — Extraction Quality (wave 5, S4)

Measured 2026-09-24 on branch `feat/s4-quality`. This file is the quality
ledger: baseline before any wave-5 change, then the measured effect of the
deterministic source-verification guard (T-4) and the evidence-based assessor
prompt (T-5). Re-measure with:

```bash
cd apps/backend
node scripts/quality-harness.cjs select          # 30 deterministic corpus samples
node scripts/quality-harness.cjs scans           # first 15 → noisy scan JPGs (paired arms)
QUALITY_EMAIL=… QUALITY_PASSWORD=… node scripts/quality-harness.cjs run --label <name>
node scripts/quality-harness.cjs report --current after --baseline baseline
node scripts/quality-harness.cjs clean           # delete harness docs from the account
```

Setup: 30 text PDFs (deterministic spread over the 1007-doc corpus) + the same
first 15 rasterized to noisy scans → 45 documents per run, processed live
(GLM glm-4.5-flash, thinking=disabled). Ground truth: auto-labeled from the
embedded PDF text, three documents verified by eye — see
`apps/backend/scripts/quality-ground-truth.json`.

## Baseline (main `16e519a`, before wave 5)

| metric | text (n=30) | scan (n=15) |
|---|---|---|
| parsed | 28 | 1 |
| mean overall confidence | 0.84 | 0.67 |
| field accuracy inside parsed docs | 132/140 (94%) | 3/5 (60%) |

Field accuracy over all docs: invoice_number 65% (28/43), invoice_date 78%,
amount_total 76%, supplier_name 77%, currency 98%; 3 invented
supplier_address values. Full numbers: run `report --baseline results/baseline`.

Key baseline defect: **the assessor rewarded hallucinations** — the wave-4 A/B
showed a hallucinated invoice_number scored 1.0, and here a scan doc with 60%
field accuracy still auto-parsed.

## After wave 5 (guard + evidence-based assessor)

| metric | text (n=30) | scan (n=15) |
|---|---|---|
| parsed | 11 | 0 |
| mean overall confidence | 0.71 | 0.59 |
| field accuracy inside parsed docs | 54/55 (98%) | — (nothing false-parses) |

Field accuracy over all docs is unchanged within run variance (invoice_number
67%, invoice_date 78%, amount_total 76%, supplier_name 77%, currency 98%);
invented supplier_address dropped 3 → 2. The guard fired on 5 documents
(targeted warnings, each naming the unverified field).

**What improved:** auto-parse precision 94% → 98% on text, and the 60%-accurate
false-parsed scan document class is gone (0/15). Every auto-accepted document is
now (mechanically) source-grounded; everything else lands in needs_validation
with a bilingual reason naming the field.

**What it cost:** auto-accept recall dropped (28 → 11 of 30 text docs). The
evidence-based assessor scores more conservatively, so borderline-but-correct
extractions now route to manual validation instead of parsing. That is the
safe direction of error for an accounting product, but it is a real UX cost.

## T-5 rev 1 lesson (kept for the record)

The first prompt revision collapsed parse rate to 2% (meanConf 0.43) with
field accuracy unchanged: the assessor literally penalized `currency: "USD"`
because only `$` appears in the text, punished **null** fields as "extracted
but not present", and capped overall at the lowest field score. Rev 2 (shipped):
nulls are a normal result, symbol↔code equivalences count as evidence, and the
overall cap applies only when a core field lacks evidence. Lesson: constrain
what the assessor may reward, never turn it into a second, cruder guard.

## Scope limits & next-wave findings (documented, not fixed here)

1. **Assessor recall calibration.** Recovering auto-accept recall without
   giving back precision is the next quality lever: assessor score calibration
   on verified-grounded extractions, or a per-type threshold. Do NOT just lower
   `autoAcceptThreshold` (0.85) — that re-opens the scan-arm hole the guard closed.
2. **Wrong-but-present values verify fine.** The guard proves a value EXISTS in
   the text, not that it is the right value for the field (the corpus's Order ID
   `AB10015140` passes as invoice_number while the true number is `36258`).
   Semantic field selection stays with the assessor/prompt side.
3. **Extractor misses are untouched** (dates 78%, totals 76%): a missed value
   produces null, which the guard correctly does not flag. Prompt-side
   extraction quality is a separate wave (S4 continuation).
4. The corpus contains a degenerate blank invoice (`invoice_Barry Pond_40736`,
   $0.00, no number) — kept in ground truth as an honest edge case.
