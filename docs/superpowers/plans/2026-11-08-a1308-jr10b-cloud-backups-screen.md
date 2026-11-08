# A1308 jr10b — Waitron Cloud on the Backups screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** The dashboard's Backups screen offers Waitron Cloud as a destination, only on a box whose
Cloud connection is a test connection with the retained-snapshot service set up; shows jr10's
refusals under their fields; offers "Back up every day" when the schedule is less than daily; and
the Backups guide says how Cloud behaves. Split from jr10 so each stays one reviewable pull request;
the server already refuses the bad combinations, so the screen half adds no rule of its own.

**Spec:** jr10's spec; CLAUDE.md §3 (forms: required fields, inline field errors, one bottom
message; a screen change updates its guide in English and Spanish; help bubbles and guide sentences).
Slice rules apply.

## What it builds

1. In `apps/dashboard/src/screens/backup-screen.ts`: a "Waitron Cloud" choice beside the folder and
   bucket, shown only when the box says Cloud can take backups (a `cloudBackups: "available" | "unavailable"`
   field added to the backup status the screen already reads, `GET /api/backup/status`,
   `backup-api.ts:362`, computed from the same test-connection and service checks jr10's refusal
   uses); the request's `cloud` field.
2. `backup.cloud_needs_daily` shown under the schedule field with a button "Back up every day" /
   "Hacer copia cada día" that sets the schedule to every day and clears the refusal;
   `backup.cloud_unavailable` under the Cloud choice.
3. The Backups guide (English and Spanish, shared `{#id}` headings) gains two sentences: Cloud
   follows the venue's schedule, which must be every day while Cloud is chosen; the box does not
   delete Cloud's old copies, Cloud keeps them.
4. Cloud's destination outcome (jr10) appears in the screen's per-destination status like the folder's and bucket's.

## Files

- Modify: `apps/dashboard/src/screens/backup-screen.ts`, `backup-screen.test.ts`,
  `backup-screen.a11y.test.ts`, `backup-screen.save-state.test.ts`, `backup-screen.unsaved.test.ts`
  (if the new field joins the draft), `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/api/client.ts`
  (the status and apply types), `apps/server/src/backup-api.ts` (the status field), its route test,
  the Backups guide sources (English and Spanish)

## Size

Code ~110 (screen 70, status field 15, strings 15, client types 10); tests ~120; guide ~10. **~240.**

## Finish line

1. `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen.test.ts src/screens/backup-screen.a11y.test.ts src/screens/backup-screen.save-state.test.ts src/screens/backup-screen.unsaved.test.ts` — passes (browser mode; check free memory first).
2. `pnpm --filter @waitron/server exec vitest run src/backup-api.route.test.ts src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts` — pass.
3. Open the screen in both themes and at phone width (CLAUDE.md §4). Typecheck, format; protection list EQUAL.

## Expected protection-list difference

**EQUAL.**

## Stop points (beyond rules §5)

A form rule in `docs/developers/design-system.md` → Forms that the button cannot meet as described:
stop and ask.

## Needs

jr10.

## Global Constraints

- The Cloud choice is hidden, not disabled, where Cloud cannot take backups, so a production box
  never shows it.
- Field refusals appear under their field; the save stays disabled until the draft changes
  (`draftScopeFor`, `saveActionState`, CLAUDE.md §3).

## Review Focus

1. **Cloud chosen, schedule weekly.** The refusal under the schedule, the button sets every day.
2. **A box whose Cloud connection is revoked after Cloud was chosen.** The choice disappears; the
   saved setting stays, and jr10's outcome shows in the status.
3. **Phone width.** The new choice wraps with the others.
4. **Spanish.** Both new strings and the guide sentences exist in Spanish.
5. **Unsaved changes.** Ticking Cloud marks the draft changed; leaving asks as for any other field.

---

### Task 1: The screen, the status field, the guide

- [ ] **Step 1: Failing tests:** `"the Cloud choice is hidden when the box cannot take Cloud backups"`;
  `"choosing Cloud sends cloud: true"`; `"a cloud_needs_daily refusal shows under the schedule with Back up every day, which sets every day"`;
  `"Cloud's destination outcome shows in the status"`; an a11y case for the refusal state in both
  themes; the server route: `"the status says whether Cloud can take backups"`.
- [ ] **Step 2–4:** FAIL; implement; PASS; write the guide sentences. Run the Finish line. Commit:
  "Offer Waitron Cloud on the Backups screen".
