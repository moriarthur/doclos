# MVP Follow-up Audit (MF wave)

> Opened: 2026-11-28. Lead review after the PD/DD waves closed (PRs #1–#12,
> `main` e3e9500). Source: user-reported observations plus a lead pass over the
> auth flow and deployment docs. Follows the audit-first discipline: findings
> are recorded here before any fix; one finding = one commit referencing its ID.

## Findings

### MF-1 (Medium) — duplicate registration race returns HTTP 500

`AuthService.register()` (`apps/backend/src/modules/auth/auth.service.ts`)
checks `findOne({ where: { email } })` before insert. Two concurrent
registrations with the same normalized email can both pass the check; the
second `save()` then hits the `users.email` unique constraint
(pg `23505`, unique_violation) and the unhandled `QueryFailedError` surfaces
as an opaque 500.

**Not a missing check, by design:** the silent duplicate handling itself is
PD-A4 — a duplicate registration returns the byte-identical 201
`REGISTER_SUCCESS_MESSAGE` (with a bcrypt round so timing matches), so the
endpoint leaks nothing about which emails exist. **Product decision recorded
2026-11-28 (user): keep PD-A4 as is.** The fix is limited to making the race
window return that same uniform response instead of 500:

- Catch the unique-violation on `save()` only; rethrow everything else.
- Return the same `{ message: REGISTER_SUCCESS_MESSAGE }` (no new oracle, no
  new status code).
- Integration test pins the catch path: the duplicate-insert case must answer
  201 with the uniform body, not 500.

Acceptance criteria: backend `tsc --noEmit` green; full Jest suite green;
duplicate-insert path returns 201 uniform body; normal registration,
login, and account-deletion suites unaffected.

### MF-2 (Low, ops) — Render Free cold starts; no production uptime check

Render Free services sleep after 15 idle minutes; the first visitor after a
lull waits out a cold start. There is also no scheduled production check —
outages surface only when someone visits.

**Decision recorded 2026-11-28 (user): mirror the Konfequem pattern** — a
GitHub Actions scheduled workflow pinging the deployed frontend and backend
every 30 minutes with retry to absorb cold starts.

Honest scope note (same as Konfequem's own comment): GitHub's scheduler
delays scheduled runs by hours at times, so the keep-awake side effect is
partial. The primary value is production monitoring — a failing run sends
GitHub's "first failure after success" email. A dedicated external pinger
(cron-job.org / UptimeRobot) would wake the service reliably but needs an
account and may press on Render Free instance-hour limits; deliberately NOT
part of this finding.

Acceptance criteria: workflow runs green via `workflow_dispatch` against the
deployed demo; steps assert `/healthz`, `/readyz` and the frontend page
content; no secrets in the workflow; failing endpoint → red run (verified
logic, not by breaking production).

### TODO-1 (unplanned) — no "forgot password" path on the login form

The login window has no password-recovery entry point. Explicitly deferred by
the user (2026-11-28): mark as TODO, do not implement in this wave. Note for
whoever picks it up: a real reset flow needs email sending (SMTP provider or
transactional service) plus single-use reset tokens — that is a new
infrastructure decision, not a frontend-only button.

## Guardrails (unchanged)

- No destructive commands against production.
- No smoke runs against production without explicit confirmation (single
  public `/healthz`-class liveness GETs to verify workflow URLs are fine).
- No `.env`, credentials, or the local `codex_audit` file in commits.
- No AI-tool names or attributions in git-visible artifacts.
