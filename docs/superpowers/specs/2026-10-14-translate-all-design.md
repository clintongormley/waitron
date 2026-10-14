# Translate all: suggested customer-facing names from Waitron Cloud

**Status:** design, approved in conversation with the owner on 2026-10-14; this file awaits the
owner's review.
**Companion spec (Cloud side):** `waitron-cloud/docs/superpowers/specs/2026-10-14-translate-all-design.md`.
**Wire contract:** `waitron-cloud/docs/waitron-integration-contract.md`, section "Translate all,
version 1". Both specs point there; neither restates it.
**Backlog entry this replaces:** "A 'Translate all' service from Waitron Cloud" in
`docs/backlog.md` (owner, 2026-10-06).

## What it is for

A venue's staff type internal names quickly ("BOCATA DE COLIFOR", "ESTRELLA GALLICIA 33ml"). A
venue that serves customers in several languages then has to write a customer-facing name for
every product, variant, option and menu section in each of them. **Translate all** asks Waitron
Cloud to write every missing customer-facing name, in every enabled content language, and puts
the results in front of a person as suggestions. Nothing a model wrote reaches a diner until a
person has saved it (owner, 2026-10-06: "a machine translation needs the venue's review before a
diner sees it").

## Owner decisions this design follows (2026-10-14)

1. **Free for now, for any venue whose box is connected to Waitron Cloud**, with a per-venue
   spending cap held in Cloud as a safety limit. A monthly allowance, recorded so that billing can
   use it, replaces this before the first live venue. Pricing and sign-up wording are out of scope.
2. **Scope: the nine kinds in the translation gap report** — product, variant, options list,
   options label, extras list, menu, menu section, included menu, unit
   (`TranslationGapKind`, `packages/catalogue/src/content-translation-report-types.ts`).
   Product descriptions and image names are later work.
3. **Review happens in the existing translations dialog.** Suggestions fill the empty fields as
   drafts. They are kept on the box until each is saved or discarded, so a venue can review a few
   dozen, save, and continue another day on any device.
4. **Cloud keeps nothing but usage counts.** The box sends the names and the house-style examples
   with each job; Cloud deletes the menu and the results once the box has collected them, or after
   24 hours at most.
5. **Translate all is always shown**, to advertise the Cloud service: a box that is not connected
   explains the service and links to the Cloud services screen.
6. **A notice in the dashboard's bell** says the results are ready.
7. **Prompt rules stay language-neutral.** A per-language grammar rule was tried and dropped
   ("that doesn't help us with arbitrary languages"); fluency comes from a second, review pass and
   from each venue's own saved names.

## How the method was chosen

The trial behind this design ran on 2026-10-14 in `~/workspace/experiments/llm-translate/` (outside
both repositories; the Cloud spec moves its harness into the Cloud repository). The owner graded
every name blind, in grading pages that hid which setup wrote it. In summary:

- On the 30-product tuning set, Luna at low effort (`gpt-6-luna`) with the first prompt had 16% of
  its names marked "needs work" or "wrong". The fourth prompt brought that to 7%. Adding a review
  pass brought it to 5–6%.
- On a blind set of 30 products the prompts were never tuned on, the first prompt scored 12% and
  the fourth 6%. The fourth plus a Luna review pass at medium effort scored 5%, with "wrong" down
  from 4% to 2%.
- Cost for the fourth prompt plus review was under one US cent per 100 products at OpenAI's
  published standard prices, read on 2026-10-14.
- Batching the whole Santet catalogue (358 products) in batches of 30, of 90, or in one request
  lost no product in any setup. Bigger batches were slightly more stable between runs (77% of
  names identical across two runs at 30, against 81–83% at 90 or for the whole menu). One request
  for the whole menu took about 90 s, against about 27 s for batches of 90 sent side by side.

What remains wrong in every setup is vocabulary in the default language: Catalan *cigaló* for
*carajillo*, for example. The house-style examples (below) are this design's answer to that, and
they are not yet measured.

## How the parts fit

```
Dashboard ──► Box (Waitron server) ──signed requests──► Waitron Cloud ──► OpenAI
 dialog        job runner + suggestions table           job queue + worker
```

The box never talks to OpenAI and never holds its key. Everything about the prompt, the batching,
the review pass, the spending cap and retention is Cloud's and is specified there.

## Box side

### 1. Seeing whether the service is available

Today the Cloud status reply returns exactly three services, and adding one "requires a negotiated
protocol version before changing that response" (`docs/developers/cloud-connection.md`; the parser
refuses any other count, `apps/server/src/cloud-installation.ts`). This feature adds a fourth
service, `content_translation`, through that negotiated version (the contract defines it). Cloud
switches the service on for every connected installation for now (decision 1), so the box can show
the allowance later without another protocol change.

### 2. Starting a job

A new route, `POST /management-api/content-suggestions/jobs`, gated by `catalogue.manage` like the
translations routes (`apps/server/src/catalogue-api.ts`), starts a job. It:

1. **Refuses when a job is already running** for the venue (`content.suggestion_job_running`,
   409). The dialog shows that job's progress instead.
2. **Collects what is missing:** every customer-facing name that is absent in an enabled content
   language, across the nine kinds, read through the same candidate query the gap report uses
   (`readContentTranslationCandidates`, `packages/catalogue/src/content-languages.ts`). It leaves
   out a name that already has a suggestion waiting, and it never asks for a language in which the
   item already has text.
3. **Sends with each name** what it belongs to, which Cloud needs both for grouping and for the
   model:
   - a product, its first category;
   - a variant, its product;
   - an options label, its options list;
   - a menu section, its menu.

   It also sends the item's staff name and any customer-facing text it already has in other
   languages.
4. **Adds the house-style examples:** up to 300 customer-facing names already saved in the venue,
   spread across categories and kinds. Every saved name was typed by a person or reviewed and saved
   by one, so the saved names are the house style; a name a person corrects and saves is in the
   next job automatically. No new data is recorded for this.
5. **Sends the venue's content languages** (codes, which is the default) and its country, and
   submits one job to Cloud. A job carries at most 1,000 items (an item is one product, variant,
   option or section with all its missing languages); a bigger menu is sent as
   consecutive jobs, one at a time, which the runner chains without the person pressing again.

A box that is not connected to Cloud gets `cloud.not_configured` (the existing code,
`apps/server/src/cloud-api.ts`), which the dialog turns into the explanation and link (decision 5).

### 3. The job runner

A runner on the box, on the primary only (as the existing Cloud worker, `apps/server/src/cloud-worker.ts`),
asks Cloud for the job's progress every five seconds while a job is open. That is 12 requests a
minute, under Cloud's limit of 30 per installation (Cloud's `packages/account-http/README.md`). When
the job finishes it collects the results, stores them as suggestions in one transaction, and then
tells Cloud it has them, which lets Cloud delete them. The job record (below) keeps the Cloud job
number, so a restarted box resumes polling where it left off.

### 4. What the box stores

Two tables in the catalogue module's migration set, both classified `state` (venue data that every
device reads and that travels with backups):

- **`content_suggestions`**: one row per suggested name — item kind and id, language, suggested
  text, the `expected` token of the name it was made from (the same token the translations routes
  already use against stale writes, `packages/catalogue/src/content-translation-types.ts`), an
  optional spelling fix, a placeholder flag, and the job it came from. A row is deleted when its
  suggestion is saved as a real name or discarded.
- **`content_suggestion_jobs`**: the open or last job — Cloud job number, state (running, done,
  partly done, failed, expired), counts, when it finished, and when anyone first opened its
  suggestions (which clears the notice).

What comes back is checked before it is stored: a suggestion for an item the box did not send, or
for a language in which the item already has text, is dropped and counted in the job record. A fix
to a name someone entered arrives only as a spelling suggestion, never as a replacement.

### 5. The routes the dialog uses

- `GET /management-api/content-suggestions?language=` — the waiting suggestions for one language,
  in the dialog's paging, plus the job's state and counts.
- `DELETE /management-api/content-suggestions/{id}` — discard one.
- Saving uses the existing `PUT /management-api/content-translations/:language` unchanged
  (`apps/server/src/content-translations-api.ts`); a saved name's suggestion is deleted in the same
  transaction as the write. A name changed since its suggestion was made fails the existing
  `expected` check (`content.translation_stale`, 409), and the dialog marks that suggestion out of
  date instead of saving over the change.

### 6. The dialog

In `apps/dashboard/src/widgets/content-translations-dialog.ts`:

- A **Translate all** button. Not connected: one sentence about the service and a link to the Cloud
  services screen (`apps/dashboard/src/screens/cloud-services-screen.ts`). Connected: it starts a
  job; while one runs it shows "Translating… 180 of 358".
- Waiting suggestions fill empty fields as drafts marked *Suggested*. Editing one is an ordinary
  draft edit; saving works as today, page by page (50 rows a page; a save carries at most 100 edits,
  `packages/catalogue/src/content-translations.ts`).
- A row with a spelling fix to the internal name shows it with a link to that item's editor. A
  spelling fix to a name someone entered shows **Use fix**, which puts the fix in that field as a
  draft. A placeholder ("the name doesn't say what it is") shows its note and no draft.
- **Discard** on a suggestion removes it.
- A partly done job says how many names could not be done; pressing Translate all again sends only
  those.

The dialog's existing draft scope, leave guard and stale-row choice apply unchanged
(`docs/developers/design-system.md`, Forms). Backlog job "translations: nothing required, every gap
reported, all languages side by side" (queued 2026-10-14) changes this dialog; Translate all works
with today's one-language dialog and gains from that change, and neither depends on the other.

### 7. The notice

A new alert source, `content.suggestions_ready`, computed from `content_suggestion_jobs`: open while
a finished job's suggestions have not been opened by anyone, closed once they have. It needs:

- a third alert level, *notice*, beside *error* and *warning*, drawn so that it does not read as a
  fault (the levels today are `AlertSeverity = "warning" | "error"`, `packages/module/src/alerts.ts`,
  labelled in `apps/dashboard/src/widgets/alert-format.ts`);
- its area claim and English and Spanish wording (`scripts/alert-codes.test.ts`);
- a link to the Content languages screen.

Wording: "Translations ready: 1,050 suggestions are waiting for review" ("Traducciones listas: 1050
sugerencias pendientes de revisar"); a partly done job adds "88 couldn't be done this time".

### 8. Error codes

New codes under the existing `content.` domain (siblings: `content.translation_stale`,
`content.translation_unavailable`, `content.language_required`):

| Code | When |
|---|---|
| `content.suggestion_job_running` | A job is already running for the venue. |
| `content.suggestion_consent_required` | The Cloud account has not yet agreed to menu text going to the named language-model providers (OpenAI, Anthropic, Google; Cloud spec, "Providers and consent"). The dialog links to the Cloud portal. |
| `content.suggestion_limit_reached` | Cloud refused the job, or stopped it, at the venue's spending cap. Carries how many names would fit. |
| `content.suggestion_service_unavailable` | Cloud accepted the job but the translation provider failed for all of it. |
| `content.suggestion_expired` | Cloud deleted an uncollected result after 24 hours. |
| `content.suggestion_not_found` | Discarding a suggestion that is gone. |

An unreachable Cloud keeps the existing `cloud.unavailable`.

## Testing

- **Collecting**: every missing name across the nine kinds is gathered with its family; an entered
  name is never included; a name with a waiting suggestion is not sent again.
- **Storing**: an unknown item or an already-filled language in a reply is dropped; saving a
  suggestion writes the name and deletes the suggestion in one transaction; a changed name marks
  its suggestion out of date.
- **The runner**, against a fake Cloud: it resumes after a restart; partly done, failed and expired
  jobs; an unreachable Cloud; a menu over 1,000 items chains its jobs.
- **Signing**: the body-fingerprint signature is checked against the test vectors the contract
  publishes, which Cloud's tests use too.
- **Dashboard, in real Chromium**: suggested drafts, spelling-fix and placeholder rows, Save,
  Discard, continuing later, the not-connected state; the notice level gets the token-painting and
  both-theme accessibility tests a new visual state needs.
- **End to end**: one run on the Santet real-data venue against a local Cloud.

## Out of scope

Billing, sign-up and the monthly allowance; product descriptions; image names; Cloud learning
across venues; machine translation of anything other than customer-facing names.
