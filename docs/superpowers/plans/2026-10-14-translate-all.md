# Translate all (Waitron side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A venue presses **Translate all** in the translations dialog; the box sends every missing customer-facing name to Waitron Cloud, collects the results, keeps them as suggestions, and shows them as drafts a person saves or discards.

**Architecture:** The box talks only to Waitron Cloud, through the existing signed machine envelope (`waitron-cloud-machine-v1`) plus a fourth negotiated service. The catalogue module owns two new `state` tables (`content_suggestion_jobs`, `content_suggestions`) and every database rule (what is missing, what comes back, what is shown). A runner on the primary does every Cloud call (submit, poll every five seconds, collect, release), so a restart resumes from the job rows. The dashboard reads suggestions page by page beside the existing translation pages, and a new alert level, *notice*, tells the bell the results are ready.

**Tech Stack:** TypeScript, Hono, drizzle-orm on `node:sqlite` (drizzle-kit 0.31.11 for migrations), Lit web components, Vitest 4 (browser mode in real Chromium for the dashboard and `@waitron/ui`), Ed25519 from `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-10-14-translate-all-design.md`. Wire contract (read-only, another repository): `waitron-cloud/docs/waitron-integration-contract.md`, section "Translate all, version 1" (local checkout used while planning: `/Users/clintongormley/workspace/worktrees/cloud-auto-translate-spec/docs/waitron-integration-contract.md`).


---

## Global Constraints

Every task's requirements include these.

- **Waitron side only.** Waitron Cloud is a separate repository and will not exist in tested form while this is built. Every Waitron test talks to the fake Cloud from Task 3, which follows the contract exactly. Only Task 21 talks to a real (local) Cloud.
- "Nothing a model wrote reaches a diner until a person has saved it." Suggestions live only in `content_suggestions`; no code path copies one into a customer-facing name except the existing save route `PUT /management-api/content-translations/:language`.
- The box never talks to OpenAI and never holds its key.
- Service name `content_translation`; asked for with `"servicesVersion": 2` in the signed `configuration` body. Services in a reply are matched by name; their order is not significant.
- Endpoints: POST `/api/installations/translation-submit`, `translation-status`, `translation-collect`, `translation-release`. The signed action is the final path segment. The box always sends a JSON outer request; a non-JSON one would get 400 or 415.
- Submit signs `{ "version": 1, "jobSha256": "<SHA-256 hex of the UTF-8 bytes of body>", "jobBytes": <byte count> }` and sends `{ "payload", "signature", "body" }`. Status, collect and release sign `{"version":1,"jobId":"<uuid>"}` with a fresh operation ID.
- The signed body stays within 4,096 characters. A job body is at most 1 MiB (1,048,576 bytes) and at most 1,000 items, context items included. `houseStyle` holds at most 300 saved names. Every text field Cloud reads is 1 to 500 characters (JavaScript string length) and every `ref` and `family` 1 to 128 (contract, "Submit").
- The contract is the authority for everything on the wire: the job's field rules, the nine kinds, context items, the five `reason` values, collect and release in each state, and the refusals table with the Waitron code for each. This plan implements exactly it; where a sentence below seems to differ, the contract wins and the plan is wrong.
- Poll every five seconds at most (12 requests a minute, under Cloud's 30 per installation).
- Keep the submit body and operation ID until the result is known; a retry signs the same fingerprint with the same operation ID.
- Release only after the results are stored, and release a `failed` job too, so Cloud deletes its body at once. Cloud deletes an uncollected result 24 hours after it finished, or 24 hours after submit if it never finished (state `expired`).
- A context item (contract, "Submit"): a family head whose own names the box does not send for translation goes into the job with `missing: []` whenever one of its members is sent, so the model sees the product, list or menu a name belongs to. Cloud never returns names or a failure for it.
- `content_translation` with `state: "ready"` means available; only a `configuration` reply to `{"servicesVersion":2}` carries it.
- The consent control is at `<Cloud origin>/account` (contract, "Consent").
- Drop a result whose `ref` the box did not send, and a name for a language that was not missing. A fix to a name someone entered is a suggestion only, never a replacement.
- Dialog: 50 rows a page; a save carries at most 100 edits (`packages/catalogue/src/content-translations.ts`, `checkedBatch`).
- Error codes, all under the existing `content.` domain, in `packages/catalogue/src/errors.ts`: `content.suggestion_job_running`, `content.suggestion_consent_required`, `content.suggestion_limit_reached` (carries `fits`), `content.suggestion_service_unavailable`, `content.suggestion_expired`, `content.suggestion_not_found`. An unreachable Cloud keeps `cloud.unavailable`; a box not connected gets `cloud.not_configured`.
- Notice wording: "Translations ready: {count} suggestions are waiting for review" / "Traducciones listas: {count} sugerencias pendientes de revisar"; a partly done job adds "{failed} couldn't be done this time".
- Prompt rules are Cloud's; the box sends no per-language instructions.
- House rules (CLAUDE.md): migrations are generated with drizzle-kit and never hand-edited; each new table is classified in `CATALOGUE_CLASSIFICATION`; multi-table writes share one `withTransaction`, and a network call never runs inside one; every test of a refusal asserts the domain error code; coverage stays at 98/98/98/95 in every touched package; `@waitron/ui`'s mutation floor is 90; colours read `--wt-*` tokens; dashboard forms follow `docs/developers/design-system.md` → Forms with `draftScopeFor` and `saveActionState`.
- Every commit is `git commit -s` with a plain-English message. Run focused tests while working and `pnpm format:check` before each commit; never a whole-workspace run.
- Every implementer that passes about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover (done, left, files, each check's state). Tasks are sized for well under 100.

## Decisions this plan makes where the spec and the code differ

Each is stated at its site in the code too, where a rule requires it.

1. **Translate all asks for every enabled content language in which an item has no customer-facing text, the default language included, whether or not the item has text in other languages** (decided 2026-10-14). `readContentTranslationCandidates` is not the source: it filters out a wholly absent name (`packages/catalogue/src/content-languages.ts:87-89`). Collecting reads every gap in one query, `listTranslationGapRows`, which applies the paging query's own activity, ownership, role and blank-name filters for every enabled language, plus the names stored as null or `{}`. A one-language venue therefore gets suggestions for its empty names. Because the default-language page does not list those items, the dialog shows their suggestions as rows of their own (Task 16). Two exceptions, both from today's code: an extras list with no customer-facing name is left out (its name reaches no order or receipt, `content-translation-targets.ts`'s `extra_list` filter), and a unit is never absent (its name is required).
2. **The route only collects and records; the runner makes every Cloud call, the first submit included.** One place does the network, so a lost reply or a restart is always recovered the same way. A refusal at submit (consent, cap, a job already running in Cloud) reaches the dialog through the job record within a second, not through the POST's reply.
3. **A run never sends the same item twice.** Consecutive jobs for a big menu exclude every item an earlier job of the same run sent, so an item Cloud fails on, or answers unusably, is counted as "couldn't be done" instead of being resent in a loop. Pressing Translate all again starts a new run and sends those.
4. **A suggestion is out of date only when that item's text in that language changed** (or its owner changed, or it is gone). The stored `expected` token also covers the venue's language list, so comparing whole tokens would mark every suggestion out of date the moment someone enables another language. The comparison reads only `ref`, `language`, `owners`, `selectedText`, `effectiveSelectedText` and `inheritedSelectedText` from the two tokens.
5. **Untouched suggestions are not "unsaved changes".** They stay on the box, so closing the dialog loses nothing; the leave guard compares only a person's own edits, while Save opens enabled when suggestions are filled in (`saveActionState`'s existing `savableAtOpen` option, `packages/ui/src/leave-controller.ts:141`).
6. **"Use fix" for a name someone entered is not offered yet.** Today's dialog shows only the page language's field and, for a missing default, the default field (`apps/dashboard/src/widgets/content-translations-dialog.ts`, `#columns`), and it lists only items missing the page language (`blankIn`, `content-translation-targets.ts`). A fix to an *entered* name is always in a language whose field is not on screen. The dialog shows such a fix as a note with a link to the item's editor; the button waits for the side-by-side dialog (backlog "translations: nothing required, every gap reported, all languages side by side").
7. **The notice uses two codes from one source**, `content.suggestions_ready` and `content.suggestions_ready_partly` (new name), because the alert formatter fills slots and cannot add a sentence conditionally (`packages/dashboard-kit/src/alert-messages.ts:46-82`).
8. **A product has one category** (`products.category_id`, `packages/db/src/schema/catalogue.ts:49-51`); a product sends it and a variant sends its product's.
9. **A family head goes with its members as context.** When a job holds a variant, an options label or a menu section whose head (product, options list, menu) it does not send for translation, because the head's names are complete or an earlier job of the run sent it, the head goes in just before its first member with `missing: []` and its names in `existing`. It counts towards the job's 1,000 items and 1 MiB (`included` counts it), is not in `sent`, is never counted in a run's total, and may appear in several jobs of one run.
10. **Text outside Cloud's bounds stays out of the job, never shortened, never a reason to refuse the job.** An item whose staff name is blank or over 500 characters is left out; a category that is blank becomes `null`, and one over 500 characters leaves its item out; an existing name blank or over 500 characters is left out of `existing`; a house-style name outside the bounds is not chosen. Waitron allows names up to 4,096 bytes (`TRANSLATION_NAME_BYTES`, `packages/catalogue/src/content-translation-types.ts`).
11. **Cloud's `reason` reaches the dialog.** `partly_done` with `limit_reached` and `failed` with `limit_reached` show `content.suggestion_limit_reached` with `fits: 0`; `failed` with `consent_required` shows `content.suggestion_consent_required`; `failed` with `provider_unavailable` shows `content.suggestion_service_unavailable`; `partly_done` with `provider_failed` shows only the count that could not be done.
12. **A translation call does not hold the Cloud connection's lock across its HTTP exchange.** `refresh()` and `report()` refuse `cloud.busy` while the lock is held (`apps/server/src/cloud-client.ts:304-306`, `:429-450`), and a translation exchange can take 30 seconds. The lock is taken only to renew the control lease (Task 4).
13. **A job always ends.** Cloud can stop offering the service to this box mid-job (its `permission_denied` maps to `cloud.unavailable`, which the runner would otherwise retry for ever), and any refusal can recur. So the runner ends an open job when `translationService()` is no longer `on`, exactly as when the box is not connected, and ends any job 24 hours after it was created as `expired` — Cloud has deleted it by then anyway (Task 11). Either way the run stops refusing a new one.

   > **2026-10-15, A689's third PR:** "Cloud has deleted it by then anyway" is wrong: Cloud's
   > 24 hours run from its submit or the job's finish, so it can still hold the job. See the
   > backlog entry "a job the box ends itself is marked released without a call to Cloud".

14. **A run's total counts only items with languages to write.** `run_total` is the number of items sent plus those left for later jobs, never context heads (which Cloud's own `total` leaves out too); progress is `done + failed` summed over the run's jobs; and when the run's last job is stored the total is set to what was actually sent, so a name someone filled meanwhile does not leave the count short (Tasks 8 and 9).
15. **Rows the default-language page leaves out survive the dialog's live refreshes because the dialog passes them in as page rows.** `TranslationDrafts.snapshot()` keeps a row only when it holds a person's edit or is in the page scan (`apps/dashboard/src/widgets/content-translations-model.ts:54`). The dialog's scan therefore reads the waiting suggestions, resolves each one's item that the page did not list through the translations route's `targets` form, and appends those rows to what it hands the model (Task 16).

## Review Focus

The seven inputs most likely to bite a person that the spec implies but does not test. Each has its test in the owning task.

1. **A language enabled after a job ran** must not mark every waiting suggestion out of date (Decision 4). Test: Task 10, "a language added after the job leaves the suggestions current".
2. **A person types a name while the job is running**: the result for that language is dropped at store time, never stored beside the person's text. Test: Task 9, "a name entered during the job is not overwritten or suggested".
3. **The box restarts, or the submit reply is lost, between Cloud accepting a job and the box recording it**: the retry uses the same operation ID and fingerprint and Cloud holds one job, not two. Test: Task 11, "a lost submit reply is retried after a restart as the same job".
4. **A menu over 1,000 items, or one whose long names push the body past 1 MiB before 1,000 items**: consecutive jobs each stay inside both limits, and a persistently failing item is not resent within the run. Tests: Task 7, "stops adding items at 1 MiB, counting every byte the body holds"; Task 11, "chains a menu over 1,000 items within Cloud's limits and never resends an item".
5. **More than 100 suggestions in one language**: only 100 become drafts (the save limit), the rest are announced, and closing the dialog asks nothing. Test: Task 17, "fills at most 100 of 150 suggestions and closes without asking".
6. **A venue with one language**: its empty names are collected (Decision 1) and their suggestions shown although the default-language page does not list them, and they stay through a live refresh. Tests: Task 6, "a one-language venue gets its empty names in that language"; Task 16, "shows a one-language venue's suggestion for an empty name and saves it".
7. **Cloud stops offering the service, or keeps refusing, while a job is open**: the job ends and a new run can start. Tests: Task 11, "a job Cloud switched the service off for ends without a call, and the next run is not refused" and "a running job 24 hours old ends expired without asking Cloud".

---

## File map

New files:

| File | Responsibility |
| --- | --- |
| `apps/server/src/cloud-translation.ts` | Signing the four translation actions, the HTTP exchange, reply validation, refusal mapping |
| `apps/server/test/cloud-translation-vector.json` | Waitron's half of the shared signing vectors |
| `apps/server/scripts/cloud-translation-vectors.ts` | Prints the vectors from fixed keys (run once, output committed) |
| `apps/server/test/translation-cloud-fixture.ts` | The fake Cloud: translation jobs that follow the contract |
| `apps/server/src/content-suggestion-runner.ts` | The primary-only job runner |
| `apps/server/src/content-suggestions-api.ts` | `POST …/jobs`, `GET …`, `DELETE …/:id` |
| `packages/catalogue/src/schema/suggestions.ts` | The two tables |
| `packages/catalogue/src/content-suggestion-types.ts` | Browser-safe wire types (type definitions only) |
| `packages/catalogue/src/content-suggestion-collect.ts` | What is missing, the house style, the job body, pruning suggestions that are no longer needed |
| `packages/catalogue/src/content-suggestion-jobs.ts` | Run and job records, the run view |
| `packages/catalogue/src/content-suggestion-store.ts` | Storing results, listing, discarding, deleting on save |
| `packages/catalogue/test/suggestion-fixture.ts` | Shared database fixtures for the suggestion tests (outside coverage, like other `test/` helpers) |
| `apps/dashboard/src/widgets/content-suggestions-bar.ts` | The Translate all button and its states |

Modified: `apps/server/src/cloud-installation.ts`, `cloud-client.ts`, `boot.ts`, `alert-sources.ts`, `alerts.ts`; `apps/server/test/cloud-fixture.ts`, `cloud-installation-fixture.ts`; `packages/catalogue/src/classification.ts`, `errors.ts`, `index.ts`, `schema/index.ts`, `content-translations.ts`, `content-translation-targets.ts`; `packages/module/src/alerts.ts`; `packages/ui/src/components/wt-count-badge.ts`; `apps/dashboard/src/api/client.ts`, `api/live-queries.ts`, `i18n/strings.ts`, `i18n/codes.ts`, `i18n/alert-messages.ts`, `widgets/content-translations-model.ts`, `widgets/content-translations-dialog.ts`, `widgets/alerts-bell.ts`, `widgets/alert-format.ts`, `screens/cloud-services-screen.ts`; `docs/developers/cloud-connection.md`, `docs/developers/products.md`, `docs/backlog.md`. The bell's notice reaches the dashboard through the existing alert toast and list, so `apps/dashboard/src/dashboard-app.ts` is not changed.

Commands used throughout (run from the worktree root):

- Server: `pnpm --filter @waitron/server exec vitest run <path relative to apps/server>`
- Catalogue: `pnpm --filter @waitron/catalogue exec vitest run <path relative to packages/catalogue>`
- Dashboard (real Chromium): `pnpm --filter @waitron/dashboard exec vitest run <path relative to apps/dashboard>`
- UI (real Chromium): `pnpm --filter @waitron/ui exec vitest run <path relative to packages/ui>`
- Root guards: `pnpm exec vitest run scripts/<file>`
- Read the `Tests` count in every run; a run that prints none proved nothing.

## Tasks

1. Cloud status asks for, and keeps, the fourth service
2. The translation signer and Waitron's half of the shared test vectors
3. A fake Cloud that runs translation jobs by the contract
4. The four translation exchanges on the Cloud connection
5. Storage for suggestions and jobs
6. Collecting what is missing
7. House style, context heads and the job body
8. Run and job records
9. Storing results and chaining the next job
10. Listing, discarding, pruning, and deleting on save
11. The job runner
12. The routes, and starting the runner with the server
13. Dashboard client calls and the drafts model
14. The Translate all bar in the translations dialog
15. Suggestions as drafts: fill, Discard, Save
16. Notes, and the rows the page leaves out
17. The 100-draft limit, closing without asking, and continuing later
18. A third alert level, notice
19. The "translations ready" notice
20. Documentation and the backlog
21. End-to-end check on the Santet venue against a local Waitron Cloud

---

### Task 1: Cloud status asks for, and keeps, the fourth service

**Files:**
- Modify: `apps/server/src/cloud-installation.ts` (the `Service` type, `readView`, `installationClient.exchange`, `refresh`)
- Modify: `apps/server/test/cloud-installation-fixture.ts` (second parameter `options`)
- Modify: `apps/dashboard/src/api/client.ts:1570` (service union), `apps/dashboard/src/screens/cloud-services-screen.ts:162-166` (label map), `apps/dashboard/src/i18n/strings.ts` (`cloud.translation`, English and Spanish)
- Modify: `docs/developers/cloud-connection.md`
- Test: `apps/server/src/cloud-installation.test.ts`, `apps/dashboard/src/screens/cloud-services-screen.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFIGURATION_BODY` (new name, `'{"servicesVersion":2}'`), exported from `cloud-installation.ts`; `CloudObservation["service"]` now includes `"content_translation"`; `installationFixture(capture?, options: { servicesVersion2?: boolean; translation?: MachineHandler; translationState?: () => "unconfigured" | "provisioning" | "ready" | "failed" } = {})` where `MachineHandler` is the callback type of `cloudFixture`'s `machine` parameter. This task adds only `servicesVersion2` (default `true`); Task 3 adds `translation` and `translationState`.

Services in a reply are matched by name and their order is not significant (contract, "Seeing the service"). `readView` therefore checks names, never positions.

- [ ] **Step 1: Write the failing server tests**

Append to `apps/server/src/cloud-installation.test.ts` (it already imports `installationFixture` and `createCloudConnection`; add them to its imports if a later edit moved them):

```ts
it("asks for the fourth service and keeps it when a renewal or report answers three", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh(); // renew: no lease yet
    await f.client.refresh(); // configuration
    expect(f.requests.at(-1)![2]).toBe("configuration");
    expect(f.requests.at(-1)![7]).toBe('{"servicesVersion":2}');
    const services = (await f.client.status()).installation!.services.map((s) => s.service);
    expect(services).toContain("content_translation");
    await f.client.report([{ service: "remote_access", health: "healthy", failure: null }]);
    expect(f.requests.at(-1)![2]).toBe("report");
    expect((await f.client.status()).installation!.services.map((s) => s.service)).toContain(
      "content_translation",
    );
    const restarted = createCloudConnection(f.options);
    expect((await restarted.status()).installation!.services).toHaveLength(4);
  } finally {
    await f.close();
  }
});

it("an older Cloud answering three services to the fourth-service request leaves translation off", async () => {
  const f = await installationFixture(undefined, { servicesVersion2: false });
  try {
    await f.client.refresh();
    const status = await f.client.refresh();
    expect(status.installation?.state).toBe("active");
    expect(status.installation!.services.map((s) => s.service)).not.toContain(
      "content_translation",
    );
  } finally {
    await f.close();
  }
});

it("accepts the four services in any order", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh(); // renew
    await f.client.refresh(); // configuration, four services
    const four = (f.replies.get(String(f.requests.at(-1)![4])) as { services: unknown[] }).services;
    f.patch({ services: [four[3], four[2], four[0], four[1]] });
    const status = await f.client.refresh();
    expect(status.installation!.services.map((s) => s.service).sort()).toEqual([
      "content_translation",
      "continuous_backup",
      "remote_access",
      "retained_snapshots",
    ]);
  } finally {
    await f.close();
  }
});

it.each([
  ["an unknown fourth service", (s: unknown[]) => [s[0], s[1], s[2], { ...(s[3] as object), service: "telepathy" }]],
  ["a service listed twice", (s: unknown[]) => [s[0], s[1], s[2], s[0]]],
  ["an original service missing", (s: unknown[]) => [s[3], s[1], s[2]]],
])("refuses a reply with %s", async (_name, change) => {
  const f = await installationFixture();
  try {
    await f.client.refresh(); // renew
    await f.client.refresh(); // configuration, four services
    const four = (f.replies.get(String(f.requests.at(-1)![4])) as { services: unknown[] }).services;
    expect(four).toHaveLength(4);
    f.patch({ services: change(four) });
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    await f.close();
  }
});
```

Every changed list keeps a length the new parse accepts (four, four and three), so each case reaches the check it names rather than the length check.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-installation.test.ts`
Expected: FAIL. The first and third cases fail because the configuration body is `{}` (`expected '{}' to be '{"servicesVersion":2}'`); the `it.each` cases fail at `expect(four).toHaveLength(4)`, because the box does not yet ask for the fourth entry; the "older Cloud" case may pass already, since today's box never sees a fourth entry.

- [ ] **Step 3: Make the fixture answer four services to a version-2 request**

In `apps/server/test/cloud-installation-fixture.ts`, change the signature and the services list (the `capture` routing for `backup-` stays as it is):

```ts
type MachineHandler = NonNullable<Parameters<typeof cloudFixture>[0]>;
export async function installationFixture(
  capture?: MachineHandler,
  options: { servicesVersion2?: boolean } = {},
) {
```

and, inside, beside the other `let` declarations:

```ts
  const services = (body: unknown) => {
    const four =
      (options.servicesVersion2 ?? true) &&
      typeof body === "string" &&
      (JSON.parse(body) as { servicesVersion?: unknown }).servicesVersion === 2;
    return [
      "continuous_backup",
      "remote_access",
      "retained_snapshots",
      ...(four ? ["content_translation"] : []),
    ].map((service) => ({
      service,
      state: service === "content_translation" ? "ready" : "unconfigured",
      configuration: { secret: "adapter-only" },
      health: "unknown",
      failure: null,
      observedAt: null,
    }));
  };
```

In the reply built for a new operation, replace the `services: [...].map(...)` literal with `services: values[2] === "configuration" ? services(values[7]) : services(undefined),`.

- [ ] **Step 4: Implement the negotiated parse in `cloud-installation.ts`**

Replace the `Service` type and add the constants above `readView`:

```ts
type Service =
  | "continuous_backup"
  | "remote_access"
  | "retained_snapshots"
  | "content_translation";
const ORIGINAL_SERVICES = ["continuous_backup", "remote_access", "retained_snapshots"] as const;
/** Asks Cloud for the fourth service, `content_translation` (contract, "Translate all, version 1"). */
export const CONFIGURATION_BODY = JSON.stringify({ servicesVersion: 2 });
```

In `readView`, replace `value.services.length !== 3` with `(value.services.length !== 3 && value.services.length !== 4)`, replace the service-name check `!["continuous_backup", "remote_access", "retained_snapshots"].includes(String(s.service))` with `![...ORIGINAL_SERVICES, "content_translation"].includes(String(s.service))`, and after the `for` loop, before `return`:

```ts
  if (!ORIGINAL_SERVICES.every((name) => services.some((s) => s.service === name))) unavailable();
```

With repeats already refused inside the loop (`services.some((v) => v.service === s.service)`), a four-entry list that holds the three originals has `content_translation` as its fourth.

In `installationClient`'s `exchange`, replace `c.view = view;` with:

```ts
      // Only a version-2 `configuration` reply carries the fourth entry; keep it across the others.
      const kept = c.view?.services.find((s) => s.service === "content_translation");
      if (
        p.action !== "configuration" &&
        kept &&
        !view.services.some((s) => s.service === "content_translation")
      )
        view.services.push(kept);
      c.view = view;
```

In `refresh`, replace `await prepare(needsRenew ? "renew" : "configuration");` with:

```ts
      await prepare(needsRenew ? "renew" : "configuration", needsRenew ? "{}" : CONFIGURATION_BODY);
```

- [ ] **Step 5: Run the server tests, then a control**

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-installation.test.ts src/cloud-worker.test.ts src/cloud-api.test.ts src/cloud-backup.test.ts src/cloud-snapshot-worker.test.ts src/cloud-replacement.test.ts`
Expected: all PASS (the literal machine-vector test signs body `{}` for a `renew` and is unaffected).

Control: delete the `ORIGINAL_SERVICES.every(...)` line and re-run `src/cloud-installation.test.ts`; "refuses a reply with an original service missing" must FAIL (the reply is accepted). Restore the line.

- [ ] **Step 6: Dashboard label — failing test, then code**

In `apps/dashboard/src/screens/cloud-services-screen.test.ts`, add (the file's own style: a `DashboardApi` over a fake `fetch`, `mountWidget`, `flush`):

```ts
for (const [locale, label] of [
  ["en", "Translate all"],
  ["es", "Traducir todo"],
] as const)
  it(`${locale} names the Translate all service`, async () => {
    setLocale(locale);
    const service = (name: string) => ({
      service: name,
      state: name === "content_translation" ? "ready" : "unconfigured",
      health: "unknown",
      failure: null,
      observedAt: null,
    });
    const api = new DashboardApi("", async () =>
      Response.json({
        state: "complete",
        configured: true,
        isPrimary: true,
        code: "",
        legalBusinessName: "Sol SL",
        installation: {
          state: "active",
          revision: 1,
          lastContactAt: new Date().toISOString(),
          leaseExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          services: [
            "remote_access",
            "continuous_backup",
            "retained_snapshots",
            "content_translation",
          ].map(service),
        },
      }),
    );
    const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
    });
    await flush(el);
    expect([...el.shadowRoot!.querySelectorAll("dt")].map((dt) => dt.textContent!.trim())).toContain(
      label,
    );
  });
```

Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/cloud-services-screen.test.ts` and see it FAIL (the label map has no entry for the fourth service). Then add `"content_translation"` to the service union at `apps/dashboard/src/api/client.ts:1570`, `content_translation: "cloud.translation"` to the `names` map in `cloud-services-screen.ts:162-166`, and `"cloud.translation": "Translate all"` / `"cloud.translation": "Traducir todo"` beside `cloud.snapshots` in the English and Spanish tables of `strings.ts`. Re-run: PASS.

- [ ] **Step 7: Correct the doc that this change retires**

`docs/developers/cloud-connection.md`, paragraph beginning "Version 1 returns exactly three services": replace its first two sentences with: "A `configuration` request signed with `{"servicesVersion":2}` receives a fourth service, `content_translation`; every other request, and a Cloud that does not know the version, answers the three. Services are matched by name, in any order. The box keeps the last fourth entry it was given when a renewal or report answers three." Then run `grep -rn "three services\|exactly three" docs apps/server/src` and fix each hit that describes the old behaviour.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add apps/server/src/cloud-installation.ts apps/server/src/cloud-installation.test.ts apps/server/test/cloud-installation-fixture.ts apps/dashboard/src/api/client.ts apps/dashboard/src/screens/cloud-services-screen.ts apps/dashboard/src/screens/cloud-services-screen.test.ts apps/dashboard/src/i18n/strings.ts docs/developers/cloud-connection.md
git commit -s -m "Cloud status asks for the Translate all service and keeps it between answers"
```

---

### Task 2: The translation signer and Waitron's half of the shared test vectors

**Files:**
- Create: `apps/server/src/cloud-translation.ts` (signing part only in this task)
- Create: `apps/server/scripts/cloud-translation-vectors.ts`
- Create: `apps/server/test/cloud-translation-vector.json`
- Modify: `apps/server/src/cloud-installation.ts` (`machinePayload`'s parameter type)
- Test: `apps/server/src/cloud-translation.test.ts`

**Interfaces:**
- Consumes: `machinePayload(state, pending, now)` from `cloud-installation.ts`; the fixed keys and lease in `apps/server/test/cloud-installation-vector.json`.
- Produces (all new names, exported from `cloud-translation.ts`):
  - `type TranslationAction = "translation-submit" | "translation-status" | "translation-collect" | "translation-release"`
  - `jobFingerprint(body: string): { jobSha256: string; jobBytes: number }`
  - `submitSignedBody(body: string): string` — `JSON.stringify({ version: 1, jobSha256, jobBytes })`, keys in that order
  - `translationEnvelope(state: Pick<SavedCloudState, "origin" | "view" | "privateKey">, action: TranslationAction, input: { operationId: string; lease: string; signedBody: string }, now?: number): { payload: string; signature: string }`

**How the two halves are reconciled.** The contract's "Shared test vectors" section fixes one document for both sides: its fields, the four case names (`valid`, `changed_body`, `wrong_length`, `replayed_operation`), their `expect` strings, the one operation ID, and its inputs, which are the keys, lease, origin, installation ID and proof time of Cloud's `packages/registration/test/installation-vector.json`. Waitron's `apps/server/test/cloud-installation-vector.json` is byte-identical to that file (checked with `cmp` on 2026-10-14), and Ed25519 signatures are deterministic, so a correct signer on either side reproduces the same bytes. Step 1 decides which copy this is:

- **If the contract section already holds the `json` block** (Cloud landed first), copy it byte for byte into `apps/server/test/cloud-translation-vector.json`, add `"source": "contract"` as the last top-level field, skip Step 4, and make the signer reproduce it. A mismatch is a protocol disagreement: stop and report it; do not edit the vector to fit the code.
- **If it does not**, generate the same document with Step 4's script, which follows the contract's description field for field, commit it with `"source": "waitron"`, and say in the task's handover and the PR description that Cloud's generator must print the same document (Cloud plan, Task 1). Neither side pastes its own variant into the contract.

- [ ] **Step 1: Read the contract's vector section**

Run: `sed -n '/### Shared test vectors/,$p' /Users/clintongormley/workspace/worktrees/cloud-auto-translate-spec/docs/waitron-integration-contract.md` (or the Cloud repository's `main` if that worktree is gone). Note whether it holds a `json` block.

- [ ] **Step 2: Write the failing vector test**

`apps/server/src/cloud-translation.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobFingerprint, submitSignedBody, translationEnvelope } from "./cloud-translation.js";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/${name}`, import.meta.url), "utf8"));
const v = read("cloud-translation-vector.json") as {
  origin: string;
  installationId: string;
  operationId: string;
  issuedAt: number;
  lease: unknown;
  cases: {
    name: string;
    expect: string;
    envelope: { payload: string; signature: string; body: string };
  }[];
};
const keys = read("cloud-installation-vector.json") as { privateKey: string };
const state = {
  origin: v.origin,
  privateKey: keys.privateKey,
  view: { registration: { installationId: v.installationId } },
} as Parameters<typeof translationEnvelope>[0];
const byName = (name: string) => v.cases.find((c) => c.name === name)!.envelope;
const signed = (signedBody: string) =>
  translationEnvelope(
    state,
    "translation-submit",
    { operationId: v.operationId, lease: JSON.stringify(v.lease), signedBody },
    v.issuedAt,
  );
const sent = (e: { payload: string; signature: string }) => ({
  payload: e.payload,
  signature: e.signature,
});

describe("translation submit signing matches the shared vectors", () => {
  it("has the four cases the contract names, each with its outcome", () => {
    expect(v.cases.map((c) => [c.name, c.expect])).toEqual([
      ["valid", "accepted"],
      ["changed_body", "401 invalid_proof"],
      ["wrong_length", "401 invalid_proof"],
      ["replayed_operation", "409 conflict after valid"],
    ]);
  });
  it("signs the fingerprint of the valid body, keys in the contract's order", () => {
    const body = byName("valid").body;
    const { jobSha256, jobBytes } = jobFingerprint(body);
    expect(submitSignedBody(body)).toBe(JSON.stringify({ version: 1, jobSha256, jobBytes }));
  });
  it("reproduces the valid envelope byte for byte", () => {
    const e = byName("valid");
    expect(signed(submitSignedBody(e.body))).toEqual(sent(e));
  });
  it("reproduces the wrong-length envelope, whose jobBytes is one more than the body's", () => {
    const e = byName("wrong_length");
    const f = jobFingerprint(e.body);
    expect(e.body).toBe(byName("valid").body);
    expect(
      signed(JSON.stringify({ version: 1, jobSha256: f.jobSha256, jobBytes: f.jobBytes + 1 })),
    ).toEqual(sent(e));
  });
  it("reproduces the replayed envelope: the valid case's operation ID, another fingerprint", () => {
    const e = byName("replayed_operation");
    expect(signed(submitSignedBody(e.body))).toEqual(sent(e));
    expect(jobFingerprint(e.body).jobSha256).not.toBe(jobFingerprint(byName("valid").body).jobSha256);
  });
  it("a changed byte keeps the valid envelope and changes the hash, not the length", () => {
    const valid = byName("valid");
    const changed = byName("changed_body");
    expect(sent(changed)).toEqual(sent(valid));
    expect(jobFingerprint(changed.body).jobBytes).toBe(jobFingerprint(valid.body).jobBytes);
    expect(jobFingerprint(changed.body).jobSha256).not.toBe(jobFingerprint(valid.body).jobSha256);
  });
  it("counts bytes, not characters", () => {
    expect(jobFingerprint("Cigaló").jobBytes).toBe(7);
  });
});
```

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-translation.test.ts`
Expected: FAIL — `cloud-translation.js` does not exist.

- [ ] **Step 3: Implement the signer**

In `cloud-installation.ts`, widen only the `machinePayload` parameter so a translation action can be signed without entering the lifecycle's `Action` union (which `readCloudInstallation` validates for saved pending requests):

```ts
export function machinePayload(
  state: Pick<SavedCloudState, "origin" | "view">,
  pending: { action: string; operationId: string; lease: string; body: string },
  now = Date.now(),
): Buffer {
```

`apps/server/src/cloud-translation.ts`:

```ts
import { createHash, createPrivateKey, sign } from "node:crypto";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import "./errors.js";

export type TranslationAction =
  | "translation-submit"
  | "translation-status"
  | "translation-collect"
  | "translation-release";

export function jobFingerprint(body: string): { jobSha256: string; jobBytes: number } {
  const bytes = Buffer.from(body, "utf8");
  return { jobSha256: createHash("sha256").update(bytes).digest("hex"), jobBytes: bytes.length };
}

/** The contract fixes this key order; the shared vectors pin it. */
export function submitSignedBody(body: string): string {
  const { jobSha256, jobBytes } = jobFingerprint(body);
  return JSON.stringify({ version: 1, jobSha256, jobBytes });
}

export function translationEnvelope(
  state: Pick<SavedCloudState, "origin" | "view" | "privateKey">,
  action: TranslationAction,
  input: { operationId: string; lease: string; signedBody: string },
  now = Date.now(),
): { payload: string; signature: string } {
  const bytes = machinePayload(
    state,
    { action, operationId: input.operationId, lease: input.lease, body: input.signedBody },
    now,
  );
  const key = createPrivateKey({
    key: Buffer.from(state.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return { payload: bytes.toString("base64url"), signature: sign(null, bytes, key).toString("base64url") };
}
```

- [ ] **Step 4: Generate the vectors (only when the contract has none)**

`apps/server/scripts/cloud-translation-vectors.ts` prints the document the contract describes, field for field and in its order, so that Cloud's `make-submit-vectors.ts` prints the same bytes:

```ts
// Prints the contract's "Shared test vectors" document from the fixed keys of
// test/cloud-installation-vector.json. Run once; commit the output as test/cloud-translation-vector.json.
import { readFileSync } from "node:fs";
import { jobFingerprint, submitSignedBody, translationEnvelope } from "../src/cloud-translation.js";

const base = JSON.parse(
  readFileSync(new URL("../test/cloud-installation-vector.json", import.meta.url), "utf8"),
);
const origin = base.claims.origin as string;
const installationId = base.claims.installationId as string;
const issuedAt = base.claims.issuedAt as number;
const lease = base.lease as object;
const operationId = "52345678-1234-4234-8234-123456789abc";
const state = { origin, privateKey: base.privateKey, view: { registration: { installationId } } } as never;
const job = (staffName: string) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es", "en"] },
    items: [
      {
        ref: "variant:812",
        kind: "variant",
        family: "product:640",
        category: "TAP BEERS",
        staffName,
        existing: { en: "Pint" },
        missing: ["ca", "es"],
      },
    ],
    houseStyle: [{ kind: "product", staffName: "CARAJILLO", names: { ca: "Cigaló", es: "Carajillo" } }],
  });
const envelope = (signedBody: string, body: string) => ({
  ...translationEnvelope(
    state,
    "translation-submit",
    { operationId, lease: JSON.stringify(lease), signedBody },
    issuedAt,
  ),
  body,
});
const valid = job("PINTA");
const f = jobFingerprint(valid);
const other = job("CANYA");
console.log(
  JSON.stringify(
    {
      origin,
      installationId,
      operationId,
      issuedAt,
      publicKey: base.publicKey,
      issuerPublicKey: base.issuerPublicKey,
      issuerKeyId: base.issuerKeyId,
      lease,
      cases: [
        { name: "valid", expect: "accepted", envelope: envelope(submitSignedBody(valid), valid) },
        {
          name: "changed_body",
          expect: "401 invalid_proof",
          envelope: { ...envelope(submitSignedBody(valid), valid), body: valid.replace("PINTA", "PINTO") },
        },
        {
          name: "wrong_length",
          expect: "401 invalid_proof",
          envelope: envelope(
            JSON.stringify({ version: 1, jobSha256: f.jobSha256, jobBytes: f.jobBytes + 1 }),
            valid,
          ),
        },
        {
          name: "replayed_operation",
          expect: "409 conflict after valid",
          envelope: envelope(submitSignedBody(other), other),
        },
      ],
      source: "waitron",
    },
    null,
    2,
  ),
);
```

Run: `pnpm --filter @waitron/server exec tsx scripts/cloud-translation-vectors.ts > test/cloud-translation-vector.json` (from `apps/server`; or with `--dir apps/server` from the root). Open the file and check it has the four cases in the contract's order and `"source": "waitron"`.

- [ ] **Step 5: Run the test and the existing machine vector test**

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-translation.test.ts src/cloud-installation.test.ts`
Expected: PASS. Control: change one character of the `valid` case's `signature` in a scratch copy of the vector (`mktemp -d`, never in place), point the test at it, and confirm "reproduces the valid envelope byte for byte" fails; then discard the copy.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/server/src/cloud-translation.ts apps/server/src/cloud-translation.test.ts apps/server/src/cloud-installation.ts apps/server/scripts/cloud-translation-vectors.ts apps/server/test/cloud-translation-vector.json
git commit -s -m "Sign Translate all submissions by fingerprint, tested against shared vectors"
```

---

### Task 3: A fake Cloud that runs translation jobs by the contract

**Files:**
- Modify: `apps/server/test/cloud-fixture.ts` (a request that is not JSON gets 400; the machine handler receives the parsed request as a fifth argument; `MachineHandler` exported)
- Modify: `apps/server/test/cloud-installation-fixture.ts` (options `translation` and `translationState`; `translation-*` actions go to `options.translation`)
- Create: `apps/server/test/translation-cloud-fixture.ts`
- Test: `apps/server/src/translation-cloud-fixture.test.ts`

**Interfaces:**
- Consumes: `installationFixture(capture?, options?)` with `servicesVersion2` and its `services` helper, and `refresh()` sending `CONFIGURATION_BODY` (Task 1); `TranslationAction`, `translationEnvelope`, `submitSignedBody` and `jobFingerprint` from `apps/server/src/cloud-translation.ts`, and `apps/server/test/cloud-translation-vector.json` (Task 2).
- Produces:
  - From `cloud-fixture.ts`: `export type MachineHandler = (values: unknown[], saved: Record<string, unknown>, req: IncomingMessage, res: ServerResponse, sent: Record<string, unknown>) => Promise<void>`, where `sent` is the parsed outer request. Existing four-argument handlers still fit it.
  - From `cloud-installation-fixture.ts`: `export type ServiceState = "unconfigured" | "provisioning" | "ready" | "failed"`; `installationFixture(capture?: MachineHandler, options: { servicesVersion2?: boolean; translation?: MachineHandler; translationState?: () => ServiceState } = {})`. `translationState` (default `() => "ready"`) gives the fourth entry's `state` in a version-2 `configuration` reply.
  - From `translation-cloud-fixture.ts`: `translationCloudFixture(options?: { servicesVersion2?: boolean })`; `type TranslationCloud` (what it resolves to); the types `FakeItem`, `FakeJobBody`, `FakeResult`, `FakeJob`; `verifySubmitVector(c: { body: string; signedBody: string }): boolean`. `TranslationCloud` is everything `installationFixture` returns plus:
    - `jobs: Map<string, FakeJob>`; `calls: { action: string; operationId: string; at: number }[]` (every translation request that reached the fake, refused or not); `submissions: { operationId: string; body: string }[]` (every submit body that passed the fingerprint check; never deleted).
    - `signedRequest(action: TranslationAction, input: { signedBody: string; body?: string; operationId?: string; extra?: Record<string, unknown>; lease?: string; issuedAt?: number }): Promise<{ status: number; json: unknown }>` — reads `stateDir/cloud-connection.json`, signs with `translationEnvelope` using the saved private key, the saved lease (`JSON.stringify(saved.lifecycle.lease)`, or `""` when there is none) unless `lease` is given, a fresh `randomUUID()` operation ID unless given, and `Date.now()` unless `issuedAt` is given; POSTs `{ payload, signature, ...(body === undefined ? {} : { body }), ...extra }` to `${origin}/api/installations/${action}`. `json` is the parsed reply, or its text when it does not parse.
    - Switches: `consent(given)`, `cap(fits | null)`, `hold(on)`, `failRefs(refs)`, `providerDown(on)`, `capStop(on)`, `consentWithdrawn(on)`, `service(state: ServiceState)`, `expire(jobId)`, `offline()`, `online()`, `loseNext(action)`, `stall(action): { reached: Promise<void>; release: () => void }`, `statusOverride(patch | null)`, `translator(fn)`. The switches stay as set until changed; `loseNext` and `stall` apply to the next request of their action only.
  - Default translator: `names[lang] = lang.toUpperCase() + " " + staffName` (cut to 500 characters) for each `missing` language, so `PINTA` missing `ca` gives `"CA PINTA"`; a staff name starting `?` gives `placeholder: true` and `names: {}`; one containing `ZURRITO` adds `{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }`.

**Why the tests sign the vector envelopes again.** `cloudFixture` checks every machine request's signature with `expect(verify(…)).toBe(true)` against the key the box generated (`apps/server/test/cloud-fixture.ts:42-53`). The vector envelopes are signed with the fixed key in `cloud-installation-vector.json`, so one posted unchanged makes that `expect` throw inside the server's request handler. Measured 2026-10-14 in a scratch copy of `apps/server` with the current plan's Task 1 and Task 2 code applied: the `changed_body` envelope posted as it is got no reply at all (the client's 3-second timeout fired) and Vitest reported an unhandled rejection, `AssertionError: expected false to be true`. So every request test here signs again with the fixture's key through `signedRequest`, keeping the vector's signed body (the payload's eighth field, `machinePayload` in `apps/server/src/cloud-installation.ts:217-234`) and its outer `body`. What the vector pins, the fingerprint against the body, is the same under either signature. The base check stays: it is what catches a box signing with the wrong key.

**How the fake answers, in the contract's order** (contract, "Translate all, version 1": "Submit", "Status, collect and release", "Refusals"):

Every translation request is first recorded in `calls`; then a pending `stall` for its action holds it until released; then, while `offline()` is on, its socket is destroyed. Then:

1. The proof, else `401 {"error":"invalid_proof"}`: the action is one of the four and was posted to its own path; the origin and installation ID are this box's; the operation ID is a UUID; the proof time is within 60 seconds of now; the lease is one this fake issued and it has not expired; the outer request holds exactly `payload`, `signature` and `body` with `body` a string (submit), or exactly `payload` and `signature` (the other three). The signature itself is the base fixture's check.

Submit, then:

2. The signed body must be the fingerprint, exactly `version: 1`, a lowercase 64-character `jobSha256` and a whole `jobBytes`, else 401. `jobBytes` over 1,048,576 → `413 {"error":"translation_job_too_large"}`, before any hashing.
3. `verifySubmitVector`: `jobBytes` and `jobSha256` against `body` → a mismatch is 401 `invalid_proof`. From here the body is kept in `submissions`.
4. The job's fields (`readJob`: every rule in the contract's list, including a context item's empty `missing` only for a head of a member that has languages to write, and a head listed before its members) → `400 {"error":"invalid_request"}`, a body that is not JSON included; more than 1,000 items → 413 `translation_job_too_large`.
5. An operation ID this installation already used: the same fingerprint → that job's submit reply with its current state, nothing further checked; another fingerprint → `409 {"error":"conflict"}`.
6. The service not `ready` → `403 {"error":"permission_denied"}`; consent withheld → `403 {"error":"translation_consent_required"}`; a job `queued` or `running` → `409 {"error":"translation_job_running"}`; `cap` set and `total` over it → `409 {"error":"translation_limit_reached","fits":<cap>}`; otherwise a new job and `{ version: 1, jobId, state: "queued", total }`, where `total` counts only items with languages to write.

Status, collect and release, then:

2. The signed body not exactly `{"version":1,"jobId":"<uuid>"}` → 400 `invalid_request`.
3. The service not `ready` → 403 `permission_denied`.
4. An unknown job → `404 {"error":"translation_job_not_found"}`.
5. Status: the first poll moves `queued` to `running` with `done` half of `total`, rounded down; the next poll finishes the job unless `hold` is on. Finishing gives `done`; `failRefs` matching some items gives `partly_done` with `provider_failed`, matching all gives `failed` with `provider_unavailable`; `capStop` gives `partly_done` with `limit_reached` and the second half of the items failed, or `failed` with `limit_reached` for a one-item job; `providerDown` gives `failed` with `provider_unavailable`; `consentWithdrawn` gives `failed` with `consent_required` (later in this list wins). `reason` appears only on `partly_done` and `failed`. `statusOverride` is merged over every status reply. Collect: `queued`, `running` or `failed` → `409 {"error":"translation_not_ready"}`; `collected` or `expired` → `410 {"error":"translation_expired"}`; otherwise `{ version: 1, jobId, state, results, failed }`, a context item in neither list. Release: `queued` or `running` → 409 `translation_not_ready`; `expired` → 410 `translation_expired`; otherwise the job's body and results are deleted, the state becomes `collected`, and the reply is `{ version: 1, jobId, state: "collected" }`, again on every later release.

`loseNext(action)`: the next reply to that action is never sent; whatever that request changed stays changed, and the socket is destroyed.

**Where the contract is silent and the fake chooses** (so no later task takes these for the contract):

- A request that is not JSON gets 400 (the contract allows 400 or 415; the box maps both to `cloud.request_invalid`). An outer request whose `payload` or `signature` is not a string gets 401.
- For status, collect and release, an outer key besides `payload` and `signature` is 401 (the contract says this for submit), and `permission_denied` comes after the signed-body check and before the job lookup.
- Any unexpired lease this fake issued is accepted, not only the one the box saved last: Cloud accepts a lease by its signature and expiry, so a call signed just before a renewal replaced the saved lease is still a good call.
- `offline()` also turns on `installationFixture`'s own `offline`, so while it is on, renewals and configuration requests answer 503 and translation requests fail at the socket.
- A `translator` function's answer is returned as written, not limited to `missing`, so a test can make Cloud send what the box must drop.

Not modelled: the request size and time limits (413 `invalid_input`, 408), 429 `rate_limited`, 503 `temporarily_unavailable`, 403 `forbidden` for a browser Origin, another installation's job, and a monthly cap that runs down (`cap` is a fixed number).

- [ ] **Step 1: Write the failing fixture tests**

`apps/server/src/translation-cloud-fixture.test.ts` — the tests drive the fake through signed requests, so a fake that accepts everything fails them:

```ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type TranslationCloud,
  translationCloudFixture,
  verifySubmitVector,
} from "../test/translation-cloud-fixture.js";
import { jobFingerprint, submitSignedBody } from "./cloud-translation.js";

interface VectorCase {
  name: string;
  expect: string;
  envelope: { payload: string; signature: string; body: string };
}
const v = JSON.parse(
  readFileSync(new URL("../test/cloud-translation-vector.json", import.meta.url), "utf8"),
) as { operationId: string; cases: VectorCase[] };
const vector = (name: string) => v.cases.find((c) => c.name === name)!.envelope;
const singleCases = v.cases.filter((c) => c.name !== "replayed_operation");
// The signed body is the last field of the machine payload (`machinePayload`, cloud-installation.ts).
const signedBodyOf = (payload: string) =>
  (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown[])[7] as string;

const item = (
  ref: string,
  staffName: string,
  missing: string[],
  family = ref,
  kind = family === ref ? "product" : "variant",
) => ({ ref, kind, family, category: null, staffName, existing: {}, missing });
const job = (items: unknown[]) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es"] },
    items,
    houseStyle: [],
  });
const one = job([item("product:1", "PINTA", ["ca", "es"])]);
const two = job([
  item("product:1", "PINTA", ["ca", "es"]),
  item("product:2", "CANYA", ["ca", "es"]),
]);

type Lookup = "translation-status" | "translation-collect" | "translation-release";
const submit = (f: TranslationCloud, body: string, operationId?: string) =>
  f.signedRequest("translation-submit", { signedBody: submitSignedBody(body), body, operationId });
const ask = (f: TranslationCloud, action: Lookup, jobId: string) =>
  f.signedRequest(action, { signedBody: JSON.stringify({ version: 1, jobId }) });
const jobIdOf = (answer: { json: unknown }) => (answer.json as { jobId: string }).jobId;
const refused = (status: number, error: string) => ({ status, json: { error } });

async function withCloud(
  run: (f: TranslationCloud) => Promise<void>,
  options?: { servicesVersion2?: boolean },
) {
  const f = await translationCloudFixture(options);
  try {
    await f.client.refresh(); // renew: the box's first lease
    await run(f);
  } finally {
    await f.close();
  }
}

it.each(singleCases)("the fake's fingerprint check gives the vector's answer for $name", (c) => {
  expect(
    verifySubmitVector({ body: c.envelope.body, signedBody: signedBodyOf(c.envelope.payload) }),
  ).toBe(c.expect === "accepted");
});

it.each(singleCases)(
  "the $name envelope, re-signed with the fixture's key, is answered $expect",
  (c) =>
    withCloud(async (f) => {
      const answer = await f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(c.envelope.payload),
        body: c.envelope.body,
      });
      if (c.expect === "accepted")
        expect(answer).toMatchObject({
          status: 200,
          json: { version: 1, state: "queued", total: 1 },
        });
      else expect(answer).toEqual(refused(401, "invalid_proof"));
    }),
);

it("a fingerprint mismatch is 401 invalid_proof and makes no job", () =>
  withCloud(async (f) => {
    const valid = vector("valid");
    const changed = vector("changed_body");
    expect(signedBodyOf(changed.payload)).toBe(signedBodyOf(valid.payload));
    expect(changed.body).not.toBe(valid.body);
    expect(
      await f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(changed.payload),
        body: changed.body,
      }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect(f.submissions).toEqual([]);
  }));

it("the replayed-operation vector is a conflict after the valid one, which replays as the same job", () =>
  withCloud(async (f) => {
    const valid = vector("valid");
    const replayed = vector("replayed_operation");
    const send = (e: VectorCase["envelope"]) =>
      f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(e.payload),
        body: e.body,
        operationId: v.operationId,
      });
    const first = await send(valid);
    expect(first.status).toBe(200);
    expect(await send(replayed)).toEqual(refused(409, "conflict"));
    expect(await send(valid)).toEqual(first);
    expect(f.jobs.size).toBe(1);
  }));

it("a request body that is not JSON is 400 invalid_request before anything else", () =>
  withCloud(async (f) => {
    const before = f.requests.length;
    const response = await fetch(`${f.options.origin}/api/installations/translation-submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(f.requests).toHaveLength(before);
    expect(f.calls).toEqual([]);
  }));

it("an outer request holding other keys than the contract's is an invalid proof, and each is recorded", () =>
  withCloud(async (f) => {
    const signedBody = submitSignedBody(two);
    expect(
      await f.signedRequest("translation-submit", { signedBody, body: two, extra: { note: "x" } }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(await f.signedRequest("translation-submit", { signedBody })).toEqual(
      refused(401, "invalid_proof"),
    );
    expect(await f.signedRequest("translation-submit", { signedBody, extra: { body: 5 } })).toEqual(
      refused(401, "invalid_proof"),
    );
    expect(
      await f.signedRequest("translation-status", {
        signedBody: JSON.stringify({ version: 1, jobId: randomUUID() }),
        body: "{}",
      }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect(f.submissions).toEqual([]);
    expect(f.calls.map((c) => c.action)).toEqual([
      "translation-submit",
      "translation-submit",
      "translation-submit",
      "translation-status",
    ]);
    expect((await f.signedRequest("translation-submit", { signedBody, body: two })).status).toBe(
      200,
    );
  }));

it("a lease the fake did not issue, or a proof time over 60 seconds away, is an invalid proof", () =>
  withCloud(async (f) => {
    const signedBody = submitSignedBody(two);
    for (const input of [
      { lease: "" },
      { lease: JSON.stringify({ payload: "eA", signature: "eA" }) },
      { issuedAt: Date.now() - 61_000 },
      { issuedAt: Date.now() + 61_000 },
    ])
      expect(
        await f.signedRequest("translation-submit", { signedBody, body: two, ...input }),
      ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect((await f.signedRequest("translation-submit", { signedBody, body: two })).status).toBe(
      200,
    );
  }));

it("checks the size before the fingerprint, and the fingerprint before reading the job", () =>
  withCloud(async (f) => {
    const oversized = JSON.stringify({
      version: 1,
      jobSha256: jobFingerprint("x").jobSha256,
      jobBytes: 1_048_577,
    });
    expect(
      await f.signedRequest("translation-submit", { signedBody: oversized, body: "x" }),
    ).toEqual(refused(413, "translation_job_too_large"));
    expect(
      await f.signedRequest("translation-submit", {
        signedBody: submitSignedBody("x"),
        body: "not json",
      }),
    ).toEqual(refused(401, "invalid_proof"));
    const upperCase = JSON.stringify({
      version: 1,
      jobSha256: jobFingerprint(two).jobSha256.toUpperCase(),
      jobBytes: jobFingerprint(two).jobBytes,
    });
    expect(
      await f.signedRequest("translation-submit", { signedBody: upperCase, body: two }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(await submit(f, "not json")).toEqual(refused(400, "invalid_request"));
    expect(f.submissions.map((s) => s.body)).toEqual(["not json"]);
  }));

it.each([
  ["a kind outside the nine", job([{ ...item("product:1", "PINTA", ["ca"]), kind: "telepathy" }])],
  ["a staff name over 500 characters", job([item("product:1", "P".repeat(501), ["ca"])])],
  [
    "an empty missing on an item that heads no other",
    job([item("product:1", "PINTA", []), item("product:2", "CANYA", ["ca"])]),
  ],
  [
    "a member listed before its head",
    job([item("variant:2", "CANYA", ["ca"], "product:1"), item("product:1", "PINTA", [])]),
  ],
  ["a missing language that is not enabled", job([item("product:1", "PINTA", ["fr"])])],
  ["a key the contract does not name", job([{ ...item("product:1", "PINTA", ["ca"]), note: "x" }])],
  [
    "a category on an options list",
    job([{ ...item("option_list:1", "SIZES", ["ca"]), kind: "option_list", category: "BEERS" }]),
  ],
  ["a repeated ref", job([item("product:1", "PINTA", ["ca"]), item("product:1", "CANYA", ["es"])])],
])("a job with %s is 400 invalid_request", (_name, body) =>
  withCloud(async (f) => {
    expect(await submit(f, body)).toEqual(refused(400, "invalid_request"));
    expect(f.jobs.size).toBe(0);
  }),
);

it("accepts a context head listed before its member, and counts only items with languages to write", () =>
  withCloud(async (f) => {
    const body = job([
      item("product:1", "PINTA", []),
      item("variant:2", "PINTA CANYA", ["ca"], "product:1"),
    ]);
    expect(await submit(f, body)).toMatchObject({
      status: 200,
      json: { version: 1, state: "queued", total: 1 },
    });
  }));

it("over 1,000 valid items is 413 translation_job_too_large", () =>
  withCloud(async (f) => {
    const body = job(Array.from({ length: 1001 }, (_, i) => item(`product:${i}`, `P${i}`, ["ca"])));
    expect(await submit(f, body)).toEqual(refused(413, "translation_job_too_large"));
    expect(f.jobs.size).toBe(0);
  }));

it("checks the service, consent, an open job and the cap in the contract's order", () =>
  withCloud(async (f) => {
    f.service("provisioning");
    f.consent(false);
    f.cap(0);
    expect(await submit(f, two)).toEqual(refused(403, "permission_denied"));
    f.service("ready");
    expect(await submit(f, two)).toEqual(refused(403, "translation_consent_required"));
    f.consent(true);
    expect(await submit(f, two)).toEqual({
      status: 409,
      json: { error: "translation_limit_reached", fits: 0 },
    });
    f.cap(2);
    expect((await submit(f, two)).status).toBe(200);
    f.cap(0);
    expect(await submit(f, two)).toEqual(refused(409, "translation_job_running"));
    expect(f.jobs.size).toBe(1);
  }));

it("a repeated operation ID is answered at step 5, before the service and consent are checked", () =>
  withCloud(async (f) => {
    const operationId = randomUUID();
    const first = await submit(f, two, operationId);
    await ask(f, "translation-status", jobIdOf(first));
    f.service("failed");
    f.consent(false);
    expect(await submit(f, two, operationId)).toEqual({
      status: 200,
      json: { ...(first.json as object), state: "running" },
    });
    expect(await submit(f, one, operationId)).toEqual(refused(409, "conflict"));
    expect(f.jobs.size).toBe(1);
  }));

it("status, collect and release answer permission_denied while the service is not ready", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    f.service("unconfigured");
    for (const action of [
      "translation-status",
      "translation-collect",
      "translation-release",
    ] as const)
      expect(await ask(f, action, id)).toEqual(refused(403, "permission_denied"));
    expect(f.jobs.get(id)!.state).toBe("queued");
    f.service("ready");
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "running" });
  }));

it("the version-2 configuration reply carries the service's state", () =>
  withCloud(async (f) => {
    const state = async () =>
      (await f.client.refresh()).installation!.services.find(
        (s) => s.service === "content_translation",
      )?.state;
    expect(await state()).toBe("ready");
    f.service("provisioning");
    expect(await state()).toBe("provisioning");
  }));

it("a Cloud without version 2 lists only the three original services", () =>
  withCloud(
    async (f) => {
      const services = (await f.client.refresh()).installation!.services.map((s) => s.service);
      expect(services).toHaveLength(3);
      expect(services).not.toContain("content_translation");
    },
    { servicesVersion2: false },
  ));

it("runs a job queued, running, done, and collects the default translator's answers", () =>
  withCloud(async (f) => {
    const body = job([
      item("product:1", "PINTA", []),
      item("variant:2", "?", ["ca", "es"], "product:1"),
      { ...item("product:3", "ZURRITO", ["ca"]), existing: { es: "Zurito" } },
    ]);
    const submitted = await submit(f, body);
    const id = jobIdOf(submitted);
    expect(submitted).toEqual({
      status: 200,
      json: { version: 1, jobId: id, state: "queued", total: 2 },
    });
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "running",
      total: 2,
      done: 1,
      failed: 0,
    });
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
    });
    expect(await ask(f, "translation-collect", id)).toEqual({
      status: 200,
      json: {
        version: 1,
        jobId: id,
        state: "done",
        results: [
          { ref: "variant:2", names: {}, placeholder: true, corrections: [] },
          {
            ref: "product:3",
            names: { ca: "CA ZURRITO" },
            placeholder: false,
            corrections: [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }],
          },
        ],
        failed: [],
      },
    });
  }));

interface Ending {
  name: string;
  arrange: (f: TranslationCloud) => void;
  body: string;
  state: "partly_done" | "failed";
  reason: string;
  failed: string[];
}
it.each<Ending>([
  {
    name: "the cap stopping a two-item job",
    arrange: (f) => f.capStop(true),
    body: two,
    state: "partly_done",
    reason: "limit_reached",
    failed: ["product:2"],
  },
  {
    name: "the cap stopping a one-item job",
    arrange: (f) => f.capStop(true),
    body: one,
    state: "failed",
    reason: "limit_reached",
    failed: ["product:1"],
  },
  {
    name: "the provider failing one item",
    arrange: (f) => f.failRefs(["product:1"]),
    body: two,
    state: "partly_done",
    reason: "provider_failed",
    failed: ["product:1"],
  },
  {
    name: "the provider failing every item",
    arrange: (f) => f.failRefs(["product:1", "product:2"]),
    body: two,
    state: "failed",
    reason: "provider_unavailable",
    failed: ["product:1", "product:2"],
  },
  {
    name: "the provider down",
    arrange: (f) => f.providerDown(true),
    body: two,
    state: "failed",
    reason: "provider_unavailable",
    failed: ["product:1", "product:2"],
  },
  {
    name: "consent withdrawn",
    arrange: (f) => f.consentWithdrawn(true),
    body: two,
    state: "failed",
    reason: "consent_required",
    failed: ["product:1", "product:2"],
  },
])(
  "a job ended by $name is $state with reason $reason",
  ({ arrange, body, state, reason, failed }) =>
    withCloud(async (f) => {
      arrange(f);
      const id = jobIdOf(await submit(f, body));
      await ask(f, "translation-status", id);
      const total = (JSON.parse(body) as { items: unknown[] }).items.length;
      expect((await ask(f, "translation-status", id)).json).toEqual({
        version: 1,
        jobId: id,
        state,
        total,
        done: total - failed.length,
        failed: failed.length,
        reason,
      });
      const collected = await ask(f, "translation-collect", id);
      if (state === "failed") expect(collected).toEqual(refused(409, "translation_not_ready"));
      else expect(collected.json).toMatchObject({ state, failed });
    }),
);

it("hold keeps a job running, and statusOverride is merged into every later status", () =>
  withCloud(async (f) => {
    f.hold(true);
    const id = jobIdOf(await submit(f, two));
    for (let poll = 0; poll < 3; poll++)
      expect((await ask(f, "translation-status", id)).json).toMatchObject({
        state: "running",
        done: 1,
      });
    f.statusOverride({ state: "done", reason: "limit_reached" });
    expect((await ask(f, "translation-status", id)).json).toMatchObject({
      state: "done",
      reason: "limit_reached",
    });
    expect(f.jobs.get(id)!.state).toBe("running");
    f.statusOverride(null);
    f.hold(false);
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
    });
  }));

it("collect and release answer by state, and release deletes the job but keeps the submission", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    expect(await ask(f, "translation-collect", id)).toEqual(refused(409, "translation_not_ready"));
    expect(await ask(f, "translation-release", id)).toEqual(refused(409, "translation_not_ready"));
    await ask(f, "translation-status", id);
    expect(await ask(f, "translation-release", id)).toEqual(refused(409, "translation_not_ready"));
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-collect", id)).status).toBe(200);
    const collected = { status: 200, json: { version: 1, jobId: id, state: "collected" } };
    expect(await ask(f, "translation-release", id)).toEqual(collected);
    expect(await ask(f, "translation-release", id)).toEqual(collected);
    expect(f.jobs.get(id)).toMatchObject({ state: "collected", job: null, results: null });
    expect(f.submissions.map((s) => s.body)).toEqual([two]);
    expect(await ask(f, "translation-collect", id)).toEqual(refused(410, "translation_expired"));
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "collected" });
  }));

it("an expired job's collect and release are 410 translation_expired", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    f.expire(id);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "expired" });
    expect(await ask(f, "translation-collect", id)).toEqual(refused(410, "translation_expired"));
    expect(await ask(f, "translation-release", id)).toEqual(refused(410, "translation_expired"));
    expect(f.jobs.get(id)).toMatchObject({ job: null, results: null });
  }));

it("a failed job is not ready to collect, and releasing it deletes it", () =>
  withCloud(async (f) => {
    f.providerDown(true);
    const id = jobIdOf(await submit(f, two));
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "failed" });
    expect(await ask(f, "translation-collect", id)).toEqual(refused(409, "translation_not_ready"));
    expect(await ask(f, "translation-release", id)).toEqual({
      status: 200,
      json: { version: 1, jobId: id, state: "collected" },
    });
    expect(f.jobs.get(id)).toMatchObject({ state: "collected", job: null });
  }));

it.each(["translation-status", "translation-collect", "translation-release"] as const)(
  "%s of an unknown job is 404 translation_job_not_found",
  (action) =>
    withCloud(async (f) => {
      expect(await ask(f, action, randomUUID())).toEqual(refused(404, "translation_job_not_found"));
    }),
);

it.each([
  ["its keys in the other order", (id: string) => JSON.stringify({ jobId: id, version: 1 })],
  ["a job ID that is not a UUID", () => JSON.stringify({ version: 1, jobId: "job-1" })],
  ["version 2", (id: string) => JSON.stringify({ version: 2, jobId: id })],
  [
    "a key the contract does not name",
    (id: string) => JSON.stringify({ version: 1, jobId: id, x: 1 }),
  ],
])("a status signed body with %s is 400 invalid_request", (_name, signed) =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    expect(await f.signedRequest("translation-status", { signedBody: signed(id) })).toEqual(
      refused(400, "invalid_request"),
    );
    expect(f.jobs.get(id)!.state).toBe("queued");
  }),
);

it("loseNext commits and then drops the reply; the same operation ID returns the same job", () =>
  withCloud(async (f) => {
    const operationId = randomUUID();
    f.loseNext("translation-submit");
    await expect(submit(f, two, operationId)).rejects.toThrow("fetch failed");
    expect(f.jobs.size).toBe(1);
    const again = await submit(f, two, operationId);
    expect(again.status).toBe(200);
    expect(f.jobs.get(jobIdOf(again))!.operationId).toBe(operationId);
    expect(f.submissions).toEqual([
      { operationId, body: two },
      { operationId, body: two },
    ]);
    f.loseNext("translation-status");
    await expect(ask(f, "translation-status", jobIdOf(again))).rejects.toThrow("fetch failed");
    expect(f.jobs.get(jobIdOf(again))!.state).toBe("running");
  }));

it("stall holds the next request of an action, already recorded, until it is released", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    await ask(f, "translation-status", id);
    const stalled = f.stall("translation-status");
    const pending = ask(f, "translation-status", id);
    await stalled.reached;
    expect(f.calls.at(-1)).toMatchObject({ action: "translation-status" });
    expect(f.jobs.get(id)!.state).toBe("running");
    f.hold(true);
    stalled.release();
    expect((await pending).json).toMatchObject({ state: "running" });
    f.hold(false);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "done" });
  }));

it("offline fails translation requests at the socket, and online brings them back", () =>
  withCloud(async (f) => {
    f.offline();
    await expect(submit(f, two)).rejects.toThrow("fetch failed");
    expect(f.calls.map((c) => c.action)).toEqual(["translation-submit"]);
    expect(f.jobs.size).toBe(0);
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.online();
    expect((await submit(f, two)).status).toBe(200);
  }));

it("a translator's answer reaches collect as written, so a test can make Cloud misbehave", () =>
  withCloud(async (f) => {
    f.translator((i) => ({
      names: { fr: `FR ${i.staffName}` },
      placeholder: false,
      corrections: [],
    }));
    const id = jobIdOf(await submit(f, one));
    await ask(f, "translation-status", id);
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-collect", id)).json).toMatchObject({
      results: [
        { ref: "product:1", names: { fr: "FR PINTA" }, placeholder: false, corrections: [] },
      ],
    });
  }));
```

`signedBodyOf` reads the layout `machinePayload` writes (`apps/server/src/cloud-installation.ts:217-234`, the signed body last, at index 7). `withCloud` refreshes once first because a fresh connection holds no lease (`installationClient(...).refresh` renews when `leaseExpiry(c.lease)` is within ten minutes, `cloud-installation.ts:331-333`), and without one every translation request is 401.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/translation-cloud-fixture.test.ts`
Expected: FAIL — `Error: Cannot find module '../test/translation-cloud-fixture.js'`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Let the base fixtures answer a non-JSON request and pass the whole request on**

In `apps/server/test/cloud-fixture.ts`:

```diff
--- a/apps/server/test/cloud-fixture.ts
+++ b/apps/server/test/cloud-fixture.ts
@@ -5,14 +5,15 @@ import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { expect } from "vitest";
 
-export async function cloudFixture(
-  machine?: (
-    values: unknown[],
-    saved: Record<string, unknown>,
-    req: IncomingMessage,
-    res: ServerResponse,
-  ) => Promise<void>,
-) {
+export type MachineHandler = (
+  values: unknown[],
+  saved: Record<string, unknown>,
+  req: IncomingMessage,
+  res: ServerResponse,
+  sent: Record<string, unknown>,
+) => Promise<void>;
+
+export async function cloudFixture(machine?: MachineHandler) {
   const stateDir = await mkdtemp(join(tmpdir(), "waitron-cloud-client-"));
   const requests: unknown[][] = [];
   let replyPatch: Record<string, unknown> = {};
@@ -32,10 +33,27 @@ export async function cloudFixture(
   const server = createServer(async (req, res) => {
     const chunks: Buffer[] = [];
     for await (const chunk of req) chunks.push(Buffer.from(chunk));
-    const { payload, signature } = JSON.parse(Buffer.concat(chunks).toString()) as {
-      payload: string;
-      signature: string;
-    };
+    let parsed: unknown;
+    try {
+      parsed = JSON.parse(Buffer.concat(chunks).toString());
+    } catch {
+      res.writeHead(400, { "content-type": "application/json" });
+      res.end('{"error":"invalid_request"}');
+      return;
+    }
+    const sent = parsed as Record<string, unknown>;
+    if (
+      !parsed ||
+      typeof parsed !== "object" ||
+      Array.isArray(parsed) ||
+      typeof sent.payload !== "string" ||
+      typeof sent.signature !== "string"
+    ) {
+      res.writeHead(401, { "content-type": "application/json" });
+      res.end('{"error":"invalid_proof"}');
+      return;
+    }
+    const { payload, signature } = sent as { payload: string; signature: string };
     const values = JSON.parse(Buffer.from(payload, "base64url").toString()) as string[];
     if (values[0] === "waitron-cloud-machine-v1" && machine) {
       const saved = JSON.parse(await readFile(join(stateDir, "cloud-connection.json"), "utf8"));
@@ -51,7 +69,7 @@ export async function cloudFixture(
           Buffer.from(signature, "base64url"),
         ),
       ).toBe(true);
-      await machine(values, saved, req, res);
+      await machine(values, saved, req, res, sent);
       return;
     }
     expect(
```

`apps/server/test/cloud-installation-fixture.ts`: Task 1 added the `options` parameter with `servicesVersion2`, the `services(body)` helper and `services: services(values[7])` in the reply. Make the top of the file, down to the lifecycle `expect(req.url)` line, read as follows (the import, `ServiceState`, the two new options, the fourth entry's `state` and `configuration: {}` as the contract's "Seeing the service" shows it, the fifth argument, and the `translation-` routing are this task's; leave `services: services(values[7])` and everything below the `expect` lines as they are):

```ts
import { generateKeyPairSync, randomUUID, sign, createHash } from "node:crypto";
import { expect } from "vitest";
import { cloudFixture, type MachineHandler } from "./cloud-fixture.js";
import { createCloudConnection } from "../src/cloud-client.js";
export type ServiceState = "unconfigured" | "provisioning" | "ready" | "failed";
export async function installationFixture(
  capture?: MachineHandler,
  options: {
    servicesVersion2?: boolean;
    translation?: MachineHandler;
    translationState?: () => ServiceState;
  } = {},
) {
  const issuer = generateKeyPairSync("ed25519");
  const keyId = createHash("sha256")
    .update(issuer.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const requests: unknown[][] = [];
  const replies = new Map<string, unknown>();
  let lose = false,
    offline = false,
    revoked = false,
    patch: Record<string, unknown> = {},
    delay = async () => {},
    failure = "";
  const services = (body: unknown) => {
    const four =
      (options.servicesVersion2 ?? true) &&
      typeof body === "string" &&
      (JSON.parse(body) as { servicesVersion?: unknown }).servicesVersion === 2;
    return [
      ...["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
        service,
        state: "unconfigured",
        configuration: { secret: "adapter-only" },
        health: "unknown",
        failure: null,
        observedAt: null,
      })),
      ...(four
        ? [
            {
              service: "content_translation",
              state: (options.translationState ?? (() => "ready"))(),
              configuration: {},
              health: "unknown",
              failure: null,
              observedAt: null,
            },
          ]
        : []),
    ];
  };
  const f = await cloudFixture(async (values, saved, req, res, sent) => {
    requests.push(values);
    if (String(values[2]).startsWith("backup-") && capture) {
      await capture(values, saved, req, res, sent);
      return;
    }
    if (String(values[2]).startsWith("translation-") && options.translation) {
      await options.translation(values, saved, req, res, sent);
      return;
    }
    expect(req.url).toBe(`/api/installations/${values[2]}`);
    const lifecycle = saved.lifecycle as { pending: { operationId: string } };
    expect(lifecycle.pending.operationId).toBe(values[4]);
```

The `translation-` branch sits after `requests.push(values)`, so translation requests also appear in `requests`, and before the lifecycle checks, which expect the saved pending lifecycle request's operation ID (`cloud-installation-fixture.ts:24-26` before Task 1).

- [ ] **Step 4: Run the existing Cloud suites against the changed fixtures**

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-client.test.ts src/cloud-installation.test.ts src/cloud-backup.test.ts src/cloud-api.test.ts src/cloud-worker.test.ts src/cloud-replacement.test.ts`
Expected: PASS, every file; read the `Tests` count (58 in the scratch measurement, before Task 1's new cases).

- [ ] **Step 5: Write the fake**

`apps/server/test/translation-cloud-fixture.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { SavedCloudState } from "../src/cloud-client.js";
import { type TranslationAction, translationEnvelope } from "../src/cloud-translation.js";
import { installationFixture, type ServiceState } from "./cloud-installation-fixture.js";

export interface FakeItem {
  ref: string;
  kind: string;
  family: string;
  category: string | null;
  staffName: string;
  existing: Record<string, string>;
  missing: string[];
}
export interface FakeJobBody {
  version: 1;
  country: string;
  languages: { default: string; enabled: string[] };
  items: FakeItem[];
  houseStyle: { kind: string; staffName: string; names: Record<string, string> }[];
}
export interface FakeResult {
  ref: string;
  names: Record<string, string>;
  placeholder: boolean;
  corrections: { field: string; wrong: string; right: string }[];
}
export interface FakeJob {
  jobId: string;
  operationId: string;
  jobSha256: string;
  job: FakeJobBody | null;
  state: "queued" | "running" | "done" | "partly_done" | "failed" | "collected" | "expired";
  total: number;
  done: number;
  failed: string[];
  results: FakeResult[] | null;
  reason?: "limit_reached" | "provider_failed" | "provider_unavailable" | "consent_required";
}
type Answer = (status: number, body: unknown) => void;

const ACTIONS: readonly string[] = [
  "translation-submit",
  "translation-status",
  "translation-collect",
  "translation-release",
];
const KINDS = new Set([
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_BYTES = 1_048_576;
const JOB_ITEMS = 1000;
const HOUSE_STYLE = 300;
const PROOF_WINDOW_MS = 60_000;

const keysAre = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === [...keys].sort().join();
const text = (v: unknown, max = 500): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= max;
const namesIn = (v: unknown, enabled: Set<string>) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.entries(v).every(([language, name]) => enabled.has(language) && text(name));

/** The fake's fingerprint check (contract, "Submit", step 3). */
export function verifySubmitVector(c: { body: string; signedBody: string }): boolean {
  const signed = JSON.parse(c.signedBody) as { jobSha256: string; jobBytes: number };
  const bytes = Buffer.from(c.body, "utf8");
  return (
    signed.jobBytes === bytes.length &&
    signed.jobSha256 === createHash("sha256").update(bytes).digest("hex")
  );
}

function fingerprintOf(signedBody: string): { jobSha256: string; jobBytes: number } | null {
  let v: unknown;
  try {
    v = JSON.parse(signedBody);
  } catch {
    return null;
  }
  if (
    !keysAre(v, ["version", "jobSha256", "jobBytes"]) ||
    v.version !== 1 ||
    typeof v.jobSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.jobSha256) ||
    typeof v.jobBytes !== "number" ||
    !Number.isSafeInteger(v.jobBytes) ||
    v.jobBytes < 0
  )
    return null;
  return { jobSha256: v.jobSha256, jobBytes: v.jobBytes };
}

function jobIdIn(signedBody: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(signedBody);
  } catch {
    return null;
  }
  return keysAre(v, ["version", "jobId"]) &&
    typeof v.jobId === "string" &&
    UUID.test(v.jobId) &&
    signedBody === JSON.stringify({ version: 1, jobId: v.jobId })
    ? v.jobId
    : null;
}

/** Null when the job breaks a field rule (contract, "Submit"); the caller checks the 1,000-item bound. */
function readJob(body: string): FakeJobBody | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    !keysAre(v, ["version", "country", "languages", "items", "houseStyle"]) ||
    v.version !== 1 ||
    typeof v.country !== "string" ||
    !/^[A-Z]{2}$/.test(v.country)
  )
    return null;
  const l = v.languages;
  if (
    !keysAre(l, ["default", "enabled"]) ||
    !Array.isArray(l.enabled) ||
    l.enabled.length < 1 ||
    l.enabled.length > 20 ||
    !l.enabled.every((t) => typeof t === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(t)) ||
    new Set(l.enabled).size !== l.enabled.length ||
    !l.enabled.includes(l.default)
  )
    return null;
  const enabled = new Set(l.enabled as string[]);
  if (!Array.isArray(v.items) || v.items.length === 0) return null;
  const position = new Map<string, number>();
  for (const [index, item] of (v.items as unknown[]).entries()) {
    if (
      !keysAre(item, ["ref", "kind", "family", "category", "staffName", "existing", "missing"]) ||
      !text(item.ref, 128) ||
      position.has(item.ref) ||
      !KINDS.has(String(item.kind)) ||
      !text(item.family, 128) ||
      !(
        item.category === null ||
        ((item.kind === "product" || item.kind === "variant") && text(item.category))
      ) ||
      !text(item.staffName) ||
      !namesIn(item.existing, enabled) ||
      !Array.isArray(item.missing) ||
      new Set(item.missing).size !== item.missing.length ||
      !item.missing.every(
        (m) => typeof m === "string" && enabled.has(m) && !(m in (item.existing as object)),
      )
    )
      return null;
    position.set(item.ref, index);
  }
  const items = v.items as FakeItem[];
  for (const [index, item] of items.entries()) {
    const head = position.get(item.family);
    if (item.family !== item.ref && head !== undefined && head > index) return null;
    if (
      item.missing.length === 0 &&
      !items.some((m) => m.ref !== item.ref && m.family === item.ref && m.missing.length > 0)
    )
      return null;
  }
  if (
    !Array.isArray(v.houseStyle) ||
    v.houseStyle.length > HOUSE_STYLE ||
    !v.houseStyle.every(
      (h) =>
        keysAre(h, ["kind", "staffName", "names"]) &&
        KINDS.has(String(h.kind)) &&
        text(h.staffName) &&
        namesIn(h.names, enabled),
    )
  )
    return null;
  return v as unknown as FakeJobBody;
}

function defaultTranslator(item: FakeItem): Omit<FakeResult, "ref"> {
  if (item.staffName.startsWith("?")) return { names: {}, placeholder: true, corrections: [] };
  return {
    names: Object.fromEntries(
      item.missing.map((language) => [
        language,
        `${language.toUpperCase()} ${item.staffName}`.slice(0, 500),
      ]),
    ),
    placeholder: false,
    corrections: item.staffName.includes("ZURRITO")
      ? [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }]
      : [],
  };
}

export async function translationCloudFixture(options: { servicesVersion2?: boolean } = {}) {
  const jobs = new Map<string, FakeJob>();
  const byOperation = new Map<string, FakeJob>();
  const calls: { action: string; operationId: string; at: number }[] = [];
  const submissions: { operationId: string; body: string }[] = [];
  const lost = new Set<string>();
  const stalls = new Map<string, { reach: () => void; released: Promise<void> }>();
  let serviceState: ServiceState = "ready";
  let consentGiven = true;
  let capFits: number | null = null;
  let holding = false;
  let failing = new Set<string>();
  let providerIsDown = false;
  let capStops = false;
  let consentGone = false;
  let isOffline = false;
  let override: Record<string, unknown> = {};
  let translate: (item: FakeItem) => Omit<FakeResult, "ref"> = defaultTranslator;

  /** Any unexpired lease this fake issued, as Cloud accepts any live lease it signed. */
  function leaseIssued(lease: unknown): boolean {
    for (const reply of base.replies.values()) {
      const issued = (reply as { lease?: { payload: string } }).lease;
      if (issued && JSON.stringify(issued) === lease)
        return (
          (JSON.parse(Buffer.from(issued.payload, "base64url").toString()) as number[])[9]! >
          Date.now()
        );
    }
    return false;
  }

  async function handler(
    values: unknown[],
    saved: Record<string, unknown>,
    req: IncomingMessage,
    res: ServerResponse,
    sent: Record<string, unknown>,
  ): Promise<void> {
    const action = String(values[2]);
    const operationId = String(values[4]);
    calls.push({ action, operationId, at: Date.now() });
    const stalled = stalls.get(action);
    if (stalled) {
      stalls.delete(action);
      stalled.reach();
      await stalled.released;
    }
    if (isOffline) {
      req.socket.destroy();
      return;
    }
    const answer: Answer = (status, body) => {
      if (lost.delete(action)) {
        req.socket.destroy();
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const registration = (saved.view as { registration?: { installationId?: unknown } } | undefined)
      ?.registration;
    const issuedAt = values[5];
    const submitting = action === "translation-submit";
    if (
      !ACTIONS.includes(action) ||
      req.url !== `/api/installations/${action}` ||
      values[1] !== base.options.origin ||
      values[3] !== registration?.installationId ||
      !UUID.test(operationId) ||
      typeof issuedAt !== "number" ||
      Math.abs(Date.now() - issuedAt) > PROOF_WINDOW_MS ||
      !leaseIssued(values[6]) ||
      !keysAre(sent, submitting ? ["payload", "signature", "body"] : ["payload", "signature"]) ||
      (submitting && typeof sent.body !== "string")
    )
      return answer(401, { error: "invalid_proof" });
    const signedBody = String(values[7]);
    if (submitting) return submit(String(sent.body), signedBody, operationId, answer);
    const jobId = jobIdIn(signedBody);
    if (!jobId) return answer(400, { error: "invalid_request" });
    if (serviceState !== "ready") return answer(403, { error: "permission_denied" });
    const job = jobs.get(jobId);
    if (!job) return answer(404, { error: "translation_job_not_found" });
    if (action === "translation-status") return status(job, answer);
    if (action === "translation-collect") return collect(job, answer);
    return release(job, answer);
  }

  const submitReply = (j: FakeJob) => ({
    version: 1,
    jobId: j.jobId,
    state: j.state,
    total: j.total,
  });

  function submit(body: string, signedBody: string, operationId: string, answer: Answer) {
    const fingerprint = fingerprintOf(signedBody);
    if (!fingerprint) return answer(401, { error: "invalid_proof" });
    if (fingerprint.jobBytes > JOB_BYTES)
      return answer(413, { error: "translation_job_too_large" });
    if (!verifySubmitVector({ body, signedBody })) return answer(401, { error: "invalid_proof" });
    submissions.push({ operationId, body });
    const job = readJob(body);
    if (!job) return answer(400, { error: "invalid_request" });
    if (job.items.length > JOB_ITEMS) return answer(413, { error: "translation_job_too_large" });
    const earlier = byOperation.get(operationId);
    if (earlier)
      return earlier.jobSha256 === fingerprint.jobSha256
        ? answer(200, submitReply(earlier))
        : answer(409, { error: "conflict" });
    if (serviceState !== "ready") return answer(403, { error: "permission_denied" });
    if (!consentGiven) return answer(403, { error: "translation_consent_required" });
    if ([...jobs.values()].some((j) => j.state === "queued" || j.state === "running"))
      return answer(409, { error: "translation_job_running" });
    const total = job.items.filter((i) => i.missing.length > 0).length;
    if (capFits !== null && total > capFits)
      return answer(409, { error: "translation_limit_reached", fits: capFits });
    const created: FakeJob = {
      jobId: randomUUID(),
      operationId,
      jobSha256: fingerprint.jobSha256,
      job,
      state: "queued",
      total,
      done: 0,
      failed: [],
      results: null,
    };
    jobs.set(created.jobId, created);
    byOperation.set(operationId, created);
    return answer(200, submitReply(created));
  }

  function finish(j: FakeJob) {
    const writable = j.job!.items.filter((i) => i.missing.length > 0);
    const refs = writable.map((i) => i.ref);
    let failed = refs.filter((ref) => failing.has(ref));
    let reason: FakeJob["reason"] =
      failed.length === 0
        ? undefined
        : failed.length === refs.length
          ? "provider_unavailable"
          : "provider_failed";
    if (capStops) {
      failed = refs.length === 1 ? refs : refs.slice(Math.ceil(refs.length / 2));
      reason = "limit_reached";
    }
    if (providerIsDown) {
      failed = refs;
      reason = "provider_unavailable";
    }
    if (consentGone) {
      failed = refs;
      reason = "consent_required";
    }
    const failedRefs = new Set(failed);
    j.results = writable
      .filter((i) => !failedRefs.has(i.ref))
      .map((i) => ({ ref: i.ref, ...translate(i) }));
    j.failed = failed;
    j.done = j.results.length;
    j.state =
      failed.length === 0 ? "done" : failed.length === refs.length ? "failed" : "partly_done";
    if (reason) j.reason = reason;
    else delete j.reason;
  }

  function status(j: FakeJob, answer: Answer) {
    if (j.state === "queued") {
      j.state = "running";
      j.done = Math.floor(j.total / 2);
    } else if (j.state === "running" && !holding) finish(j);
    const ended = j.state === "partly_done" || j.state === "failed";
    answer(200, {
      version: 1,
      jobId: j.jobId,
      state: j.state,
      total: j.total,
      done: j.done,
      failed: j.failed.length,
      ...(ended && j.reason ? { reason: j.reason } : {}),
      ...override,
    });
  }

  function collect(j: FakeJob, answer: Answer) {
    if (j.state === "queued" || j.state === "running" || j.state === "failed")
      return answer(409, { error: "translation_not_ready" });
    if (j.state === "collected" || j.state === "expired")
      return answer(410, { error: "translation_expired" });
    answer(200, {
      version: 1,
      jobId: j.jobId,
      state: j.state,
      results: j.results,
      failed: j.failed,
    });
  }

  function release(j: FakeJob, answer: Answer) {
    if (j.state === "queued" || j.state === "running")
      return answer(409, { error: "translation_not_ready" });
    if (j.state === "expired") return answer(410, { error: "translation_expired" });
    j.state = "collected";
    j.job = null;
    j.results = null;
    answer(200, { version: 1, jobId: j.jobId, state: "collected" });
  }

  function stall(action: TranslationAction) {
    let reach = () => {};
    let free = () => {};
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const released = new Promise<void>((resolve) => {
      free = resolve;
    });
    stalls.set(action, { reach, released });
    return { reached, release: () => free() };
  }

  function expire(jobId: string) {
    const j = jobs.get(jobId);
    if (!j) throw new Error(`the fake Cloud holds no job ${jobId}`);
    j.state = "expired";
    j.job = null;
    j.results = null;
  }

  async function signedRequest(
    action: TranslationAction,
    input: {
      signedBody: string;
      body?: string;
      operationId?: string;
      extra?: Record<string, unknown>;
      lease?: string;
      issuedAt?: number;
    },
  ): Promise<{ status: number; json: unknown }> {
    const saved = JSON.parse(
      await readFile(join(base.stateDir, "cloud-connection.json"), "utf8"),
    ) as SavedCloudState;
    const lease =
      input.lease ?? (saved.lifecycle?.lease ? JSON.stringify(saved.lifecycle.lease) : "");
    const envelope = translationEnvelope(
      saved,
      action,
      { operationId: input.operationId ?? randomUUID(), lease, signedBody: input.signedBody },
      input.issuedAt ?? Date.now(),
    );
    const response = await fetch(`${base.options.origin}/api/installations/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...envelope,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...input.extra,
      }),
    });
    const raw = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
    return { status: response.status, json };
  }

  const base = await installationFixture(undefined, {
    servicesVersion2: options.servicesVersion2 ?? true,
    translation: handler,
    translationState: () => serviceState,
  });
  return {
    ...base,
    jobs,
    calls,
    submissions,
    signedRequest,
    consent: (given: boolean) => {
      consentGiven = given;
    },
    cap: (fits: number | null) => {
      capFits = fits;
    },
    hold: (on: boolean) => {
      holding = on;
    },
    failRefs: (refs: string[]) => {
      failing = new Set(refs);
    },
    providerDown: (on: boolean) => {
      providerIsDown = on;
    },
    capStop: (on: boolean) => {
      capStops = on;
    },
    consentWithdrawn: (on: boolean) => {
      consentGone = on;
    },
    service: (state: ServiceState) => {
      serviceState = state;
    },
    expire,
    offline: () => {
      isOffline = true;
      base.offline();
    },
    online: () => {
      isOffline = false;
      base.online();
    },
    loseNext: (action: TranslationAction) => {
      lost.add(action);
    },
    stall,
    statusOverride: (patch: Record<string, unknown> | null) => {
      override = patch ?? {};
    },
    translator: (fn: (item: FakeItem) => Omit<FakeResult, "ref">) => {
      translate = fn;
    },
  };
}
export type TranslationCloud = Awaited<ReturnType<typeof translationCloudFixture>>;
```

- [ ] **Step 6: Run the tests, then the controls**

Run: `pnpm --filter @waitron/server exec vitest run src/translation-cloud-fixture.test.ts src/cloud-installation.test.ts src/cloud-backup.test.ts`
Expected: PASS; the fixture file alone is `Tests  49 passed (49)`.

Controls, each undone before the next (the file is not committed yet, so undo by deleting the line you added, then re-run to see 49 pass). Measured 2026-10-14 in the scratch copy described above:

1. Make the fake's fingerprint check always pass: add `return true;` as the first line of `verifySubmitVector`. Expected `Tests  6 failed | 43 passed (49)`: the two `verifySubmitVector` cases for `changed_body` and `wrong_length` print `AssertionError: expected true to be false`; the two re-signed envelope cases for those vectors, "a fingerprint mismatch is 401 invalid_proof and makes no job", and "checks the size before the fingerprint, and the fingerprint before reading the job" each print `expected { status: 200, …(1) } to deeply equal { status: 401, …(1) }` (the last one `status: 400`, because the job is then read and is not JSON).
2. Make the lease check accept anything: add `return true;` as the first line of `leaseIssued`. Expected `Tests  1 failed | 48 passed (49)`: "a lease the fake did not issue, or a proof time over 60 seconds away, is an invalid proof" prints `expected { status: 200, …(1) } to deeply equal { status: 401, …(1) }`.
3. Remove the first check of step 6, the `if (serviceState !== "ready") return answer(403, { error: "permission_denied" });` line in `submit`. Expected `Tests  1 failed | 48 passed (49)`: "checks the service, consent, an open job and the cap in the contract's order" prints `expected { status: 403, …(1) } to deeply equal { status: 403, …(1) }` (the diff shows `translation_consent_required` where `permission_denied` was expected).

A control that passes means the case it names does not test what its title says; fix the case before going on.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add apps/server/test/cloud-fixture.ts apps/server/test/cloud-installation-fixture.ts apps/server/test/translation-cloud-fixture.ts apps/server/src/translation-cloud-fixture.test.ts
git commit -s -m "Add a fake Waitron Cloud that runs Translate all jobs the way the contract describes"
```

---

### Task 4: The four translation exchanges on the Cloud connection

**Files:**
- Modify: `apps/server/src/cloud-translation.ts` (exchange, reply checks, refusal mapping)
- Modify: `apps/server/src/cloud-installation.ts` (`hasLiveLease`, `installationClient(...).ensureLease`)
- Modify: `apps/server/src/cloud-client.ts` (`translation` methods, `translationService`)
- Modify: `packages/catalogue/src/errors.ts` (the six codes — this task's file throws four of them)
- Create: `packages/catalogue/src/content-suggestion-types.ts` (the `SuggestionResult` and `SuggestionResults` types only in this task; later tasks add the rest)
- Modify: `apps/dashboard/src/i18n/codes.ts` (English and Spanish for the six codes)
- Test: `apps/server/src/cloud-translation.exchange.test.ts`, `apps/dashboard/src/i18n/codes.test.ts`

**Interfaces:**
- Consumes: `translationEnvelope`, `submitSignedBody` (Task 2); `translationCloudFixture` and its switches `consent`, `cap`, `hold`, `failRefs`, `providerDown`, `capStop`, `consentWithdrawn`, `service`, `expire`, `offline`, `loseNext`, `stall`, `statusOverride`, `translator`, `calls` (Task 3).
- Produces:
  - In `packages/catalogue/src/content-suggestion-types.ts` (new, type definitions only, a browser-safe leaf):
    ```ts
    export interface SuggestionResult {
      ref: string;
      names: Record<string, string>;
      placeholder: boolean;
      corrections: { field: string; wrong: string; right: string }[];
    }
    export interface SuggestionResults {
      state: "done" | "partly_done";
      results: SuggestionResult[];
      failed: string[];
      /** Copied by the runner from the status reply; collect's reply carries no reason. */
      reason?: "limit_reached" | "provider_failed";
    }
    ```
  - From `cloud-translation.ts`: `type CloudJobState = "queued" | "running" | "done" | "partly_done" | "failed" | "collected" | "expired"`; `type CloudReason = "limit_reached" | "provider_failed" | "provider_unavailable" | "consent_required"`; `interface TranslationStatus { jobId: string; state: CloudJobState; total: number; done: number; failed: number; reason?: CloudReason }`; `refusalOf(status: number, value: unknown): AppError`; `submitTranslation(state, operationId, body, signal?)`; `translationStatus(state, jobId, signal?)`; `collectTranslation(state, jobId, signal?)`; `releaseTranslation(state, jobId, signal?)`.
  - From `cloud-installation.ts`: `hasLiveLease(state: SavedCloudState, now?: number): boolean`.
  - On `CloudConnection`: `translation: { submit(operationId: string, body: string, signal?: AbortSignal): Promise<{ jobId: string; state: CloudJobState; total: number }>; status(jobId: string, signal?: AbortSignal): Promise<TranslationStatus>; collect(jobId: string, signal?: AbortSignal): Promise<SuggestionResults>; release(jobId: string, signal?: AbortSignal): Promise<void> }` and `translationService(): Promise<"on" | "off" | "not_connected">` (reads the saved file, no network).
  - Error codes in `packages/catalogue/src/errors.ts`, inside `ErrorParams`:
    ```ts
    /** A Translate all job is already submitting or running for the venue. */
    "content.suggestion_job_running": Record<string, never>;
    /** The Cloud account has not agreed to menu text going to the named language-model providers. */
    "content.suggestion_consent_required": Record<string, never>;
    /** Cloud refused the job at the venue's spending cap; `fits` is how many items would fit. */
    "content.suggestion_limit_reached": { fits: number };
    /** Cloud accepted the job but the translation provider failed for all of it. */
    "content.suggestion_service_unavailable": Record<string, never>;
    /** Cloud deleted the job's results before the box collected them, or no longer knows the job. */
    "content.suggestion_expired": Record<string, never>;
    /** The suggestion being discarded is gone. */
    "content.suggestion_not_found": { suggestionId: string };
    ```

**The connection's lock is not held for the HTTP exchange.** `createCloudConnection`'s `run(work, wait)` lets one call at a time touch the saved state; `refresh()` and `report()` call it with `wait = false` and refuse `cloud.busy` when it is held (`cloud-client.ts:304-306`, `:429-450`), which the 60-second Cloud worker logs as `cloud.refresh_failed` and the Cloud services screen shows as a 409. A translation exchange can take 30 seconds. So a translation call reads the saved state without the lock and, when the lease is live (more than ten minutes left, no pending lifecycle request), uses it as it is; only when the lease needs renewing does it take the lock, renew, re-read and let go, before its own `fetch`. A renewal that a concurrent `refresh` makes between that read and the request leaves the call holding the previous lease; Cloud may refuse it as an invalid proof, which maps to `cloud.unavailable` and the runner retries five seconds later.

Refusal mapping (`refusalOf`) is the "Waitron's code" column of the contract's refusals table, row for row:

| HTTP and Cloud code | Thrown |
| --- | --- |
| 403 `translation_consent_required` | `content.suggestion_consent_required` |
| 409 `translation_job_running` | `content.suggestion_job_running` |
| 409 `translation_limit_reached` with a whole `fits` ≥ 0 | `content.suggestion_limit_reached { fits }` |
| 410 `translation_expired`, 404 `translation_job_not_found` | `content.suggestion_expired` |
| 400, 413, 415, 409 `conflict` | `cloud.request_invalid` (a request Cloud will never take: the runner stops that job) |
| anything else (401, 403 `revoked`/`permission_denied`/`forbidden`, 408, 409 `translation_not_ready`, 429, 503), a network failure, a bad or oversized reply | `cloud.unavailable` (the runner retries) |

415 is the contract's answer to an outer request that is not JSON; the box always sends JSON with `content-type: application/json`, so it maps 415 with 400. If the contract's table names another Waitron code for it, the contract wins.

Reply checks: every reply has `version: 1` and the expected `jobId` (status, collect, release) or a UUID `jobId` (submit); counts are safe whole numbers ≥ 0; `state` is from the contract's list (collect: `done` or `partly_done`; release: `collected`); a status carries `reason` exactly when its state is `partly_done` (`limit_reached` or `provider_failed`) or `failed` (`provider_unavailable`, `consent_required` or `limit_reached`); a result has a string `ref`, a string-to-string `names` map, a boolean `placeholder` and `corrections` of three strings each; `failed` is a string array. Reply size limits: collect 4 MiB, the others 64 KiB. Deadlines: submit and collect 30 s, status and release 8 s.

- [ ] **Step 1: Write the failing exchange tests**

`apps/server/src/cloud-translation.exchange.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { translationCloudFixture } from "../test/translation-cloud-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
import { refusalOf } from "./cloud-translation.js";

type Fake = Awaited<ReturnType<typeof translationCloudFixture>>;
const body = (items: number) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es"] },
    items: Array.from({ length: items }, (_, i) => ({
      ref: `product:${i}`,
      kind: "product",
      family: `product:${i}`,
      category: null,
      staffName: `PRODUCT ${i}`,
      existing: {},
      missing: ["ca", "es"],
    })),
    houseStyle: [],
  });
const op = () => crypto.randomUUID();
async function withFake(test: (f: Fake) => Promise<void>, options?: { servicesVersion2?: boolean }) {
  const f = await translationCloudFixture(options);
  try {
    await test(f);
  } finally {
    await f.close();
  }
}
afterEach(() => {
  vi.useRealTimers();
});

it("submits, polls, collects and releases one job", () =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(2));
    expect(job).toMatchObject({ state: "queued", total: 2 });
    expect((await f.client.translation.status(job.jobId)).state).toBe("running");
    const done = await f.client.translation.status(job.jobId);
    expect(done).toEqual({ jobId: job.jobId, state: "done", total: 2, done: 2, failed: 0 });
    expect(Object.hasOwn(done, "reason")).toBe(false);
    const results = await f.client.translation.collect(job.jobId);
    expect(results.results.map((r) => r.names)).toEqual([
      { ca: "CA PRODUCT 0", es: "ES PRODUCT 0" },
      { ca: "CA PRODUCT 1", es: "ES PRODUCT 1" },
    ]);
    await f.client.translation.release(job.jobId);
    await f.client.translation.release(job.jobId);
    expect(f.jobs.get(job.jobId)!.state).toBe("collected");
  }));

it("a lost submit reply retried with the same operation ID returns the same job", () =>
  withFake(async (f) => {
    const id = op();
    f.loseNext("translation-submit");
    await expect(f.client.translation.submit(id, body(1))).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const again = await createCloudConnection(f.options).translation.submit(id, body(1));
    expect(f.jobs.size).toBe(1);
    expect(f.jobs.get(again.jobId)!.operationId).toBe(id);
  }));

it.each([
  ["consent withheld", (f: Fake) => f.consent(false), "content.suggestion_consent_required", {}],
  ["the cap", (f: Fake) => f.cap(1), "content.suggestion_limit_reached", { fits: 1 }],
])("maps %s at submit to its domain code", (_n, arrange, code, params) =>
  withFake(async (f) => {
    arrange(f);
    await expect(f.client.translation.submit(op(), body(2))).rejects.toMatchObject({
      code,
      params,
    });
  }),
);

it("a service Cloud has not made ready for this installation is cloud.unavailable", () =>
  withFake(async (f) => {
    f.service("unconfigured");
    await expect(f.client.translation.submit(op(), body(1))).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(f.calls.at(-1)!.action).toBe("translation-submit");
    expect(f.jobs.size).toBe(0);
  }));

it("refuses a second job while one runs", () =>
  withFake(async (f) => {
    f.hold(true);
    await f.client.translation.submit(op(), body(1));
    await expect(f.client.translation.submit(op(), body(1))).rejects.toMatchObject({
      code: "content.suggestion_job_running",
    });
  }));

it("an expired job's collect is content.suggestion_expired, and an unknown job's status too", () =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(1));
    f.expire(job.jobId);
    await expect(f.client.translation.collect(job.jobId)).rejects.toMatchObject({
      code: "content.suggestion_expired",
    });
    await expect(f.client.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "content.suggestion_expired",
    });
  }));

it("a reused operation ID with another body is cloud.request_invalid", () =>
  withFake(async (f) => {
    const id = op();
    await f.client.translation.submit(id, body(1));
    await expect(f.client.translation.submit(id, body(2))).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
    expect(f.jobs.size).toBe(1);
  }));

it.each([
  ["the cap", (f: Fake) => f.capStop(true), "partly_done", "limit_reached"],
  ["a provider failure on some items", (f: Fake) => f.failRefs(["product:0"]), "partly_done", "provider_failed"],
  ["the provider down", (f: Fake) => f.providerDown(true), "failed", "provider_unavailable"],
  ["consent withdrawn", (f: Fake) => f.consentWithdrawn(true), "failed", "consent_required"],
])("a job stopped by %s reports its reason", (_n, arrange, state, reason) =>
  withFake(async (f) => {
    arrange(f);
    const job = await f.client.translation.submit(op(), body(2));
    await f.client.translation.status(job.jobId);
    expect(await f.client.translation.status(job.jobId)).toMatchObject({
      jobId: job.jobId,
      state,
      total: 2,
      reason,
    });
  }),
);

it.each([
  ["done with a reason", { state: "done", reason: "limit_reached" }],
  ["partly done without one", { state: "partly_done", reason: undefined }],
  ["failed with a partly-done reason", { state: "failed", reason: "provider_failed" }],
  ["an unknown state", { state: "paused" }],
  ["a negative count", { done: -1 }],
  ["another job's id", { jobId: "00000000-0000-4000-8000-000000000099" }],
])("refuses a status reply with %s", (_n, patch) =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(2));
    f.statusOverride(patch);
    await expect(f.client.translation.status(job.jobId)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }),
);

it("a body over 1,000 items is cloud.request_invalid", () =>
  withFake(async (f) => {
    await expect(f.client.translation.submit(op(), body(1001))).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
  }));

it("an unreachable Cloud is cloud.unavailable and a never-connected box is cloud.not_configured", async () => {
  await withFake(async (f) => {
    await f.client.translation.status(crypto.randomUUID()).catch(() => undefined); // gets a lease
    f.offline();
    await expect(f.client.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  });
  const empty = await mkdtemp(join(tmpdir(), "waitron-translation-empty-"));
  try {
    const none = createCloudConnection({
      stateDir: empty,
      origin: "https://cloud.example",
      localVenueId: crypto.randomUUID(),
      environment: "test",
    });
    await expect(none.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    await expect(none.translationService()).resolves.toBe("not_connected");
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

it("translationService reads on and off from the saved reply without a network call", async () => {
  await withFake(async (f) => {
    await f.client.refresh(); // renew
    await f.client.refresh(); // configuration, content_translation ready
    const before = f.requests.length + f.calls.length;
    await expect(f.client.translationService()).resolves.toBe("on");
    expect(f.requests.length + f.calls.length).toBe(before);
    f.service("unconfigured");
    await f.client.refresh();
    await expect(f.client.translationService()).resolves.toBe("off");
  });
  await withFake(
    async (f) => {
      await f.client.refresh();
      await f.client.refresh();
      await expect(f.client.translationService()).resolves.toBe("off");
    },
    { servicesVersion2: false },
  );
});

it("a refresh and a report run while a status call waits on Cloud", () =>
  withFake(async (f) => {
    await f.client.refresh(); // renew: the lease is live from here on
    const job = await f.client.translation.submit(op(), body(1));
    const held = f.stall("translation-status");
    const status = f.client.translation.status(job.jobId);
    await held.reached;
    await expect(f.client.refresh()).resolves.toMatchObject({ state: "complete" });
    await expect(
      f.client.report([{ service: "remote_access", health: "healthy", failure: null }]),
    ).resolves.toMatchObject({ state: "complete" });
    held.release();
    await expect(status).resolves.toMatchObject({ jobId: job.jobId, state: "running" });
  }));

it("renews a lease with ten minutes or less left before a translation call, and reuses a live one", () =>
  withFake(async (f) => {
    await f.client.refresh(); // renew
    const job = await f.client.translation.submit(op(), body(1));
    const renewals = () => f.requests.filter((r) => r[2] === "renew").length;
    const before = renewals();
    await f.client.translation.status(job.jobId);
    expect(renewals()).toBe(before);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 51 * 60_000 });
    await f.client.translation.status(job.jobId);
    expect(renewals()).toBe(before + 1);
  }));

it("refuses a collect reply with a result whose names are not text", () =>
  withFake(async (f) => {
    f.translator(() => ({ names: { ca: 5 as never }, placeholder: false, corrections: [] }));
    const job = await f.client.translation.submit(op(), body(1));
    await f.client.translation.status(job.jobId);
    await f.client.translation.status(job.jobId);
    await expect(f.client.translation.collect(job.jobId)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }));

it.each([
  [403, { error: "translation_consent_required" }, "content.suggestion_consent_required"],
  [409, { error: "translation_job_running" }, "content.suggestion_job_running"],
  [409, { error: "translation_limit_reached", fits: 6 }, "content.suggestion_limit_reached"],
  [409, { error: "translation_limit_reached", fits: -1 }, "cloud.unavailable"],
  [410, { error: "translation_expired" }, "content.suggestion_expired"],
  [404, { error: "translation_job_not_found" }, "content.suggestion_expired"],
  [400, { error: "invalid_request" }, "cloud.request_invalid"],
  [413, { error: "translation_job_too_large" }, "cloud.request_invalid"],
  [413, { error: "invalid_input" }, "cloud.request_invalid"],
  [415, undefined, "cloud.request_invalid"],
  [409, { error: "conflict" }, "cloud.request_invalid"],
  [401, { error: "invalid_proof" }, "cloud.unavailable"],
  [403, { error: "permission_denied" }, "cloud.unavailable"],
  [403, { error: "revoked" }, "cloud.unavailable"],
  [403, { error: "forbidden" }, "cloud.unavailable"],
  [408, { error: "invalid_input" }, "cloud.unavailable"],
  [409, { error: "translation_not_ready" }, "cloud.unavailable"],
  [429, { error: "rate_limited" }, "cloud.unavailable"],
  [503, { error: "temporarily_unavailable" }, "cloud.unavailable"],
])("maps %i %j to %s", (status, value, code) => {
  expect(refusalOf(status, value)).toMatchObject({ code });
});
it("carries the number that would fit", () => {
  expect(refusalOf(409, { error: "translation_limit_reached", fits: 6 }).params).toEqual({ fits: 6 });
});
```

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-translation.exchange.test.ts`
Expected: FAIL — `refusalOf` is not exported and `f.client.translation` is undefined.

- [ ] **Step 2: Add `hasLiveLease` and `ensureLease` to `cloud-installation.ts`**

Beside `leaseExpiry`:

```ts
/** A lease a call outside this client may use as it is: more than ten minutes left, nothing pending. */
export function hasLiveLease(state: SavedCloudState, now = Date.now()): boolean {
  const c = state.lifecycle;
  return !!c && !c.revoked && !c.pending && !!c.lease && leaseExpiry(c.lease) > now + 600000;
}
```

In the object `installationClient` returns, beside `refresh`:

```ts
    /** Leaves the state holding a live control lease, renewing with ten minutes or less left. */
    async ensureLease(signal?: AbortSignal) {
      if (c.revoked) throw new AppError("cloud.not_configured", {});
      if (c.pending) await exchange(signal);
      if (!c.revoked && (!c.lease || leaseExpiry(c.lease) <= Date.now() + 600000)) {
        await prepare("renew");
        await exchange(signal);
      }
      if (c.revoked || !c.lease) throw new AppError("cloud.not_configured", {});
    },
```

- [ ] **Step 3: Implement the exchange in `cloud-translation.ts`**

Add to the imports and below `translationEnvelope`:

```ts
import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type {
  SuggestionResult,
  SuggestionResults,
} from "@waitron/catalogue/src/content-suggestion-types.js";
import "@waitron/catalogue/src/errors.js";

export type CloudJobState =
  | "queued"
  | "running"
  | "done"
  | "partly_done"
  | "failed"
  | "collected"
  | "expired";
export type CloudReason =
  | "limit_reached"
  | "provider_failed"
  | "provider_unavailable"
  | "consent_required";
export interface TranslationStatus {
  jobId: string;
  state: CloudJobState;
  total: number;
  done: number;
  failed: number;
  reason?: CloudReason;
}

const JOB_STATES: readonly string[] = [
  "queued",
  "running",
  "done",
  "partly_done",
  "failed",
  "collected",
  "expired",
];
// The contract's reasons table: which reasons each finished state may carry.
const REASONS: Partial<Record<CloudJobState, readonly CloudReason[]>> = {
  partly_done: ["limit_reached", "provider_failed"],
  failed: ["provider_unavailable", "consent_required", "limit_reached"],
};
const LIMITS: Record<TranslationAction, { reply: number; ms: number }> = {
  "translation-submit": { reply: 65536, ms: 30000 },
  "translation-status": { reply: 65536, ms: 8000 },
  "translation-collect": { reply: 4 * 1048576, ms: 30000 },
  "translation-release": { reply: 65536, ms: 8000 },
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}

/** The contract's refusals table, "Waitron's code" column. */
export function refusalOf(status: number, value: unknown): AppError {
  const code = object(value) && typeof value.error === "string" ? value.error : "";
  if (status === 403 && code === "translation_consent_required")
    return new AppError("content.suggestion_consent_required", {});
  if (status === 409 && code === "translation_job_running")
    return new AppError("content.suggestion_job_running", {});
  if (status === 409 && code === "translation_limit_reached" && object(value) && whole(value.fits))
    return new AppError("content.suggestion_limit_reached", { fits: value.fits });
  if (
    (status === 410 && code === "translation_expired") ||
    (status === 404 && code === "translation_job_not_found")
  )
    return new AppError("content.suggestion_expired", {});
  if (status === 400 || status === 413 || status === 415 || (status === 409 && code === "conflict"))
    return new AppError("cloud.request_invalid", {});
  return new AppError("cloud.unavailable", {});
}

async function exchange(
  state: SavedCloudState,
  action: TranslationAction,
  operationId: string,
  signedBody: string,
  extra: { body?: string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const lease = state.lifecycle?.lease;
  if (!state.view?.registration || state.lifecycle?.revoked || !lease)
    throw new AppError("cloud.not_configured", {});
  if (signedBody.length > 4096) throw new AppError("cloud.request_invalid", {});
  const limits = LIMITS[action];
  try {
    const envelope = translationEnvelope(state, action, {
      operationId,
      lease: JSON.stringify(lease),
      signedBody,
    });
    const response = await fetch(`${state.origin}/api/installations/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...envelope, ...extra }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(limits.ms)])
        : AbortSignal.timeout(limits.ms),
    });
    if (!response.body) unavailable();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limits.reply) unavailable();
      chunks.push(chunk);
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      if (response.ok) unavailable();
    }
    if (!response.ok) throw refusalOf(response.status, value);
    if (!object(value) || value.version !== 1) unavailable();
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return unavailable();
  }
}

const jobBody = (jobId: string) => JSON.stringify({ version: 1, jobId });

export async function submitTranslation(
  state: SavedCloudState,
  operationId: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ jobId: string; state: CloudJobState; total: number }> {
  const v = await exchange(state, "translation-submit", operationId, submitSignedBody(body), { body }, signal);
  if (!uuid(v.jobId) || !JOB_STATES.includes(String(v.state)) || !whole(v.total)) unavailable();
  return { jobId: v.jobId, state: v.state as CloudJobState, total: v.total };
}

export async function translationStatus(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<TranslationStatus> {
  const v = await exchange(state, "translation-status", randomUUID(), jobBody(jobId), {}, signal);
  if (
    v.jobId !== jobId ||
    !JOB_STATES.includes(String(v.state)) ||
    !whole(v.total) ||
    !whole(v.done) ||
    !whole(v.failed)
  )
    unavailable();
  const jobState = v.state as CloudJobState;
  const allowed = REASONS[jobState];
  if (allowed ? !allowed.includes(v.reason as CloudReason) : Object.hasOwn(v, "reason"))
    unavailable();
  return {
    jobId,
    state: jobState,
    total: v.total,
    done: v.done,
    failed: v.failed,
    ...(allowed ? { reason: v.reason as CloudReason } : {}),
  };
}

function readResult(value: unknown): SuggestionResult {
  if (
    !object(value) ||
    typeof value.ref !== "string" ||
    !object(value.names) ||
    typeof value.placeholder !== "boolean" ||
    !Array.isArray(value.corrections)
  )
    unavailable();
  const names: Record<string, string> = {};
  for (const [language, text] of Object.entries(value.names)) {
    if (typeof text !== "string") unavailable();
    names[language] = text;
  }
  const corrections = value.corrections.map((c: unknown) => {
    if (
      !object(c) ||
      typeof c.field !== "string" ||
      typeof c.wrong !== "string" ||
      typeof c.right !== "string"
    )
      unavailable();
    return { field: c.field, wrong: c.wrong, right: c.right };
  });
  return { ref: value.ref, names, placeholder: value.placeholder, corrections };
}

export async function collectTranslation(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<SuggestionResults> {
  const v = await exchange(state, "translation-collect", randomUUID(), jobBody(jobId), {}, signal);
  if (
    v.jobId !== jobId ||
    (v.state !== "done" && v.state !== "partly_done") ||
    !Array.isArray(v.results) ||
    !Array.isArray(v.failed) ||
    !v.failed.every((ref: unknown) => typeof ref === "string")
  )
    unavailable();
  return { state: v.state, results: v.results.map(readResult), failed: v.failed as string[] };
}

export async function releaseTranslation(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  const v = await exchange(state, "translation-release", randomUUID(), jobBody(jobId), {}, signal);
  if (v.jobId !== jobId || v.state !== "collected") unavailable();
}
```

Merge the new `node:crypto` import into the existing one (`createHash, createPrivateKey, randomUUID, sign`).

- [ ] **Step 4: Expose them on the connection**

In `cloud-client.ts`, import `hasLiveLease` beside `installationClient` from `./cloud-installation.js`, and `collectTranslation`, `releaseTranslation`, `submitTranslation`, `translationStatus` from `./cloud-translation.js`. Inside `createCloudConnection`, after `captureState`:

```ts
  // Holds the shared lock only to renew the lease, never across a translation exchange.
  async function leaseState(signal?: AbortSignal): Promise<SavedCloudState> {
    const current = await read();
    if (!current?.view?.registration || current.lifecycle?.revoked)
      throw new AppError("cloud.not_configured", {});
    if (hasLiveLease(current)) return current;
    return run(
      async () => {
        const state = await read();
        if (!state?.view?.registration || state.lifecycle?.revoked)
          throw new AppError("cloud.not_configured", {});
        await installationClient(state, save).ensureLease(signal);
        return state;
      },
      true,
      signal,
    );
  }
```

and in the returned object:

```ts
    translation: {
      submit: async (operationId: string, body: string, signal?: AbortSignal) =>
        submitTranslation(await leaseState(signal), operationId, body, signal),
      status: async (jobId: string, signal?: AbortSignal) =>
        translationStatus(await leaseState(signal), jobId, signal),
      collect: async (jobId: string, signal?: AbortSignal) =>
        collectTranslation(await leaseState(signal), jobId, signal),
      release: async (jobId: string, signal?: AbortSignal) =>
        releaseTranslation(await leaseState(signal), jobId, signal),
    },
    async translationService(): Promise<"on" | "off" | "not_connected"> {
      const state = await read();
      if (!state?.view?.registration || state.lifecycle?.revoked) return "not_connected";
      return state.lifecycle?.view?.services.some(
        (s) => s.service === "content_translation" && s.state === "ready",
      )
        ? "on"
        : "off";
    },
```

(The contract says `state: "ready"` means available, "Seeing the service".) Add the six codes of **Interfaces** to `packages/catalogue/src/errors.ts` beside `content.translation_stale`.

- [ ] **Step 5: Dashboard wording for the six codes — failing test, then the strings**

Append to `apps/dashboard/src/i18n/codes.test.ts`:

```ts
it("words the six Translate all codes in both languages", () => {
  for (const code of [
    "content.suggestion_job_running",
    "content.suggestion_consent_required",
    "content.suggestion_limit_reached",
    "content.suggestion_service_unavailable",
    "content.suggestion_expired",
    "content.suggestion_not_found",
  ])
    for (const locale of ["en", "es"] as const)
      expect(codeMessage(code, locale)).not.toBe(codeMessage("unknown.code", locale));
  expect(codeMessage("content.suggestion_limit_reached", "en")).toBe(
    "This month's translation limit is reached.",
  );
  expect(codeMessage("content.suggestion_limit_reached", "es")).toBe(
    "Se ha alcanzado el límite de traducción de este mes.",
  );
});
```

Run `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts` — FAIL. Then add to `CODE_MESSAGES` in `apps/dashboard/src/i18n/codes.ts`, beside `content.translation_stale`:

```ts
  "content.suggestion_job_running": {
    en: "Translate all is already running.",
    es: "Traducir todo ya está en marcha.",
  },
  "content.suggestion_consent_required": {
    en: "Your Waitron Cloud account must first agree to menu names going to its translation providers.",
    es: "Tu cuenta de Waitron Cloud debe aceptar primero que los nombres de la carta se envíen a sus proveedores de traducción.",
  },
  "content.suggestion_limit_reached": {
    en: "This month's translation limit is reached.",
    es: "Se ha alcanzado el límite de traducción de este mes.",
  },
  "content.suggestion_service_unavailable": {
    en: "The translation service failed. Try again later.",
    es: "El servicio de traducción ha fallado. Vuelve a intentarlo más tarde.",
  },
  "content.suggestion_expired": {
    en: "The results were deleted before Waitron collected them. Press Translate all again.",
    es: "Los resultados se borraron antes de que Waitron los recogiera. Pulsa Traducir todo de nuevo.",
  },
  "content.suggestion_not_found": {
    en: "That suggestion is no longer there.",
    es: "Esa sugerencia ya no existe.",
  },
```

`codeMessage` fills no slots (`packages/dashboard-kit/src/codes.ts:23-29`), so the number that would fit is shown by the bar's own string (Task 14, `suggestions.fits`). Re-run: PASS.

- [ ] **Step 6: Run the tests, then a control**

Run: `pnpm --filter @waitron/server exec vitest run src/cloud-translation.exchange.test.ts src/cloud-translation.test.ts src/cloud-installation.test.ts src/cloud-backup.test.ts src/cloud-worker.test.ts` and `pnpm exec vitest run scripts/errors-reachable.test.ts`
Expected: PASS.

Control for the lock: in `leaseState`, temporarily wrap the whole call instead — change `status` to `run(async () => translationStatus(await leaseState(signal), jobId, signal), true, signal)` — and re-run "a refresh and a report run while a status call waits on Cloud": it must FAIL with `cloud.busy` from `refresh()`. Restore.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add apps/server/src/cloud-translation.ts apps/server/src/cloud-translation.exchange.test.ts apps/server/src/cloud-installation.ts apps/server/src/cloud-client.ts packages/catalogue/src/errors.ts packages/catalogue/src/content-suggestion-types.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/codes.test.ts
git commit -s -m "Send, poll, collect and release Translate all jobs without holding the Cloud connection's lock"
```

---

### Task 5: Storage for suggestions and jobs

**Files:**
- Create: `packages/catalogue/src/schema/suggestions.ts`
- Modify: `packages/catalogue/src/schema/index.ts` (`export * from "./suggestions.js";`)
- Modify: `packages/catalogue/src/classification.ts`
- Generated: `packages/catalogue/drizzle/0032_content_suggestions.sql` and `packages/catalogue/drizzle/meta/*` (by drizzle-kit, never edited)
- Test: `packages/catalogue/src/schema/suggestions.db.test.ts`

**Interfaces:**
- Produces (new names): tables `contentSuggestionJobs`, `contentSuggestions`; constants `SUGGESTION_KINDS`, `SUGGESTION_JOB_STATES`, `SUGGESTION_REFUSALS`, `SUGGESTION_FAILURES`; types `SuggestionJobRow = typeof contentSuggestionJobs.$inferSelect`, `SuggestionRow = typeof contentSuggestions.$inferSelect`.

- [ ] **Step 1: Write the failing database test**

`packages/catalogue/src/schema/suggestions.db.test.ts`:

```ts
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "../migrations.js";
import { contentSuggestionJobs, contentSuggestions } from "./suggestions.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const job = { runId: crypto.randomUUID(), position: 1, state: "submitting" as const, sent: {}, runTotal: 1 };

it("deleting a job keeps its suggestions and clears their job", async () => {
  await withTransaction(suite.db, async (tx) => {
    const [j] = await tx.insert(contentSuggestionJobs).values(job).returning();
    await tx.insert(contentSuggestions).values({
      jobId: j!.id, kind: "product", itemId: "p1", language: "ca", text: "Pa", expected: "{}",
    });
    await tx.delete(contentSuggestionJobs);
    const [s] = await tx.select().from(contentSuggestions);
    expect(s).toMatchObject({ jobId: null, text: "Pa" });
  });
});

it("refuses a second suggestion for the same item and language", async () => {
  const insert = () =>
    withTransaction(suite.db, (tx) =>
      tx.insert(contentSuggestions).values({ kind: "unit", itemId: "u1", language: "es", text: "Kilo", expected: "{}" }),
    );
  await insert();
  await expect(insert()).rejects.toThrow(/UNIQUE constraint failed: content_suggestions/);
});

it("refuses a named suggestion without the token it was made from", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.insert(contentSuggestions).values({ kind: "unit", itemId: "u2", language: "es", text: "Kilo" }),
    ),
  ).rejects.toThrow(/content_suggestions_name_ck/);
});

it("refuses a job state outside the list", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.insert(contentSuggestionJobs).values({ ...job, state: "paused" as never }),
    ),
  ).rejects.toThrow(/content_suggestion_jobs_state_ck/);
});
```

(These three refusals are the engine's own constraints, not domain refusals, so they assert the constraint's name, which is what tells them apart.)

Run: `pnpm --filter @waitron/catalogue exec vitest run src/schema/suggestions.db.test.ts`
Expected: FAIL — `./suggestions.js` does not exist.

- [ ] **Step 2: Write the schema**

`packages/catalogue/src/schema/suggestions.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  count, enumCheck, enumType, flag, id, json, label, labelList, newId, nowIso, table, tsString,
} from "@waitron/db";
import type { TranslationGapKind } from "../content-translation-report-types.js";

export const SUGGESTION_KINDS = [
  "product", "variant", "option_list", "option_label", "extra_list", "menu", "section", "included_menu", "unit",
] as const satisfies readonly TranslationGapKind[];
export const SUGGESTION_JOB_STATES = [
  "submitting", "running", "done", "partly_done", "failed", "expired", "refused",
] as const;
export const SUGGESTION_REFUSALS = ["consent", "limit", "job_running"] as const;
// provider: Cloud's provider_unavailable; consent: consent_required; limit: limit_reached (contract's reasons).
export const SUGGESTION_FAILURES = ["provider", "not_connected", "rejected", "consent", "limit"] as const;

const kind = enumType(SUGGESTION_KINDS);
const jobState = enumType(SUGGESTION_JOB_STATES);
const refusal = enumType(SUGGESTION_REFUSALS);
const failure = enumType(SUGGESTION_FAILURES);

export const contentSuggestionJobs = table(
  "content_suggestion_jobs",
  {
    // Also the submit's operation ID: Cloud answers a retried submit with the same job.
    id: id("id").primaryKey().$defaultFn(newId),
    runId: id("run_id").notNull(),
    position: count("position").notNull(),
    state: jobState("state").notNull(),
    refusal: refusal("refusal"),
    fits: count("fits"),
    failure: failure("failure"),
    cloudJobId: id("cloud_job_id"),
    body: label("body"),
    sent: json<Record<string, string[]>>("sent").notNull(),
    runTotal: count("run_total").notNull(),
    total: count("total").notNull().default(0),
    done: count("done").notNull().default(0),
    failed: count("failed").notNull().default(0),
    dropped: count("dropped").notNull().default(0),
    failedRefs: labelList("failed_refs").notNull().$defaultFn(() => []),
    released: flag("released").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    finishedAt: tsString("finished_at"),
    openedAt: tsString("opened_at"),
  },
  (t) => [
    unique("content_suggestion_jobs_run_position_key").on(t.runId, t.position),
    check("content_suggestion_jobs_state_ck", enumCheck(t.state)),
    check("content_suggestion_jobs_refusal_ck", enumCheck(t.refusal)),
    check("content_suggestion_jobs_failure_ck", enumCheck(t.failure)),
  ],
);

export const contentSuggestions = table(
  "content_suggestions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    jobId: id("job_id"),
    kind: kind("kind").notNull(),
    // A row of the table `kind` names, so no foreign key can hold it. A suggestion for a deleted item
    // is never listed (listing resolves each against the live item) and the next run start prunes it.
    itemId: id("item_id").notNull(),
    // Null on the item's own row: a placeholder, or a spelling fix to the staff name.
    language: label("language"),
    text: label("text"),
    expected: label("expected"),
    fixField: label("fix_field"),
    fixWrong: label("fix_wrong"),
    fixRight: label("fix_right"),
    placeholder: flag("placeholder").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.jobId],
      foreignColumns: [contentSuggestionJobs.id],
      name: "content_suggestions_job_fk",
    }).onDelete("set null"),
    unique("content_suggestions_item_language_key").on(t.kind, t.itemId, t.language),
    index("content_suggestions_language_idx").on(t.language),
    index("content_suggestions_job_idx").on(t.jobId),
    check("content_suggestions_kind_ck", enumCheck(t.kind)),
    check("content_suggestions_name_ck", sql`${t.text} is null or ${t.expected} is not null`),
  ],
);
```

- [ ] **Step 3: Classify the tables**

In `packages/catalogue/src/classification.ts`:

```ts
const SUGGESTIONS = "translation suggestions waiting for a person's review; copied to a standby, never drained back";
// …inside CATALOGUE_CLASSIFICATION:
  classify("content_suggestion_jobs", "state", SUGGESTIONS),
  classify("content_suggestions", "state", SUGGESTIONS),
```

(`CATALOGUE_CHANGE_SOURCES` is derived from this list, so both tables become change-feed sources the dashboard can subscribe to.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/catalogue db:generate --name content_suggestions`
Expected: a new `drizzle/0032_content_suggestions.sql` with two `CREATE TABLE`s and their indexes and no table rebuild. Open it and check it creates exactly the two tables. Never edit it.

- [ ] **Step 5: Run the tests and the guards**

Run:
`pnpm --filter @waitron/catalogue exec vitest run src/schema/suggestions.db.test.ts src/schema/schema-conformance.test.ts src/migrations.test.ts`
`pnpm exec vitest run scripts/classification-complete.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/two-file-foreign-keys.test.ts scripts/column-vocabulary.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/schema/suggestions.ts packages/catalogue/src/schema/suggestions.db.test.ts packages/catalogue/src/schema/index.ts packages/catalogue/src/classification.ts packages/catalogue/drizzle
git commit -s -m "Add tables for Translate all jobs and the suggestions waiting for review"
```

---

### Task 6: Collecting what is missing

**Files:**
- Modify: `packages/catalogue/src/content-translation-targets.ts` (two shared SQL fragments, `listAbsentTranslationRefs`)
- Modify: `packages/catalogue/src/content-suggestion-types.ts` (`SuggestionItem`, `HouseStyleExample`)
- Create: `packages/catalogue/src/content-suggestion-collect.ts`
- Modify: `packages/catalogue/src/index.ts`
- Test: `packages/catalogue/src/content-suggestion-collect.test.ts`

**Interfaces:**
- Consumes: `listTranslationTargets`, `resolveTranslationTargets`, `ResolvedTranslationTarget`, `TranslationContext` (`content-translation-targets.ts:14-35, 320-391`); `readContentLanguages` (`content-languages.ts`); `menuRoots` (`menu-structure.ts:51`); `batches` (`batches.ts`); `contentSuggestions` (Task 5); `products`, `categories` from `@waitron/db`.
- Produces:
  ```ts
  // content-suggestion-types.ts (type definitions only; the file stays a browser-safe leaf)
  export interface SuggestionItem {
    ref: string;
    kind: TranslationGapKind;
    family: string;
    category: string | null;
    staffName: string;
    existing: Record<string, string>;
    missing: string[];
  }
  export interface HouseStyleExample {
    kind: TranslationGapKind;
    staffName: string;
    names: Record<string, string>;
  }
  // content-translation-targets.ts
  export async function listAbsentTranslationRefs(tx: Transaction): Promise<TranslationRef[]>;
  // content-suggestion-collect.ts
  export const TEXT_LIMIT = 500;
  export function suggestionRef(ref: { kind: string; id: string }): string;
  export function parseSuggestionRef(ref: string): TranslationRef | null;
  export function isLiveTarget(
    entry: ResolvedTranslationTarget,
  ): entry is Extract<ResolvedTranslationTarget, { state: "present" }>;
  export async function readSuggestionGaps(
    tx: Transaction,
    context: TranslationContext,
  ): Promise<Map<string, { target: TranslationTarget; missing: Set<string> }>>;
  export async function collectSuggestionItems(
    tx: Transaction,
    context: TranslationContext,
    exclude: ReadonlySet<string>,
  ): Promise<SuggestionItem[]>;
  ```
- `isLiveTarget` checks `state === "present"`, `target.eligible`, `structure.active` and `structure.ownerActive`. It does not test `structure.childActive` or `structure.rootMatched` separately: `eligible` already requires `rootMatched` for every kind (`content-translation-targets.ts:233`) and the three activity flags for every kind but a product and a variant (`:235-237`), and a product's or variant's `childActive` is the constant `1` (`:118, :122`). A separate `childActive` test could never decide a case, and no test could show it doing anything.

**What the code does today, checked before writing this task:** `resolveTranslationTargets` marks a deleted product, a deleted variant and a variant of a deleted product eligible. `unavailableReason` checks `active`, `ownerActive` and `childActive` only when the kind is neither `product` nor `variant` (`content-translation-targets.ts:235-237`), and a deleted product is a row with `active = 0` (`packages/db/src/schema/catalogue.ts`, the `active` comment; `deactivateProduct` → `archiveProducts`, `packages/catalogue/src/archive.ts:122-145`, which also switches off the product's variants). The dialog never sees one because its listing query filters `active = 1 and owner_active = 1 …` in SQL (`content-translation-targets.ts:362`). Collecting reads through `resolveTranslationTargets`, so it needs both the same SQL filter on its extra read and `isLiveTarget` on every resolve.

Rules, each with a test below:

1. **Every enabled language with no customer-facing text, the default included** (Decision 1). The candidates are every row `listTranslationTargets(tx, L, { after }, context)` lists for each enabled language `L` (walked until `next` is null), plus `listAbsentTranslationRefs(tx)`: the products, variants, options lists, options labels, menus and sections whose customer-facing name is stored as null or `{}`, under the listing's own activity, ownership and role filter, which this task moves into a shared fragment so the two reads cannot drift apart. The listing leaves those out under the default language only (`content-translation-targets.ts:369`), so in a venue with one language they would otherwise never be found. Extras lists, includes and units are never in the absent read: an absent extras list's name reaches no order or receipt, an include with no fixed names is listed under the included menu, and a unit's name is required.
2. Every candidate is resolved with `resolveTranslationTargets` in the default language, 100 refs a call, and kept only when `isLiveTarget` is true. Its `missing` is every enabled language, in the venue's order, in which its effective customer-facing text (`{ ...inheritedNames, ...names }`) is blank once trimmed. That is exactly the set of pages that list it, because a page lists an item when its text in that language is blank once trimmed (`blankIn`, `content-translation-targets.ts`), and an absent item is blank in every language. `readSuggestionGaps` returns this, keyed by `suggestionRef`, before rules 3 and 4.
3. A language for which a suggestion with text is waiting (a `content_suggestions` row for that kind, id and language with non-null `text`) is taken out of `missing`; a waiting placeholder row for the item takes out all of them. A spelling-fix row (text null, not a placeholder) changes nothing, because it is about a name the item already has.
4. Every item whose ref is in `exclude` is left out, and so is an item left with nothing missing.
5. `family`: a variant's product (`product:<parentId>`), an options label's list (`option_list:<listId>`), a section's menu (`menu:<root section id>`, read with `menuRoots` for `owners.menuId`); every other kind, its own ref.
6. `category`: the name of `products.category_id` of the product itself, or of a variant's product (Decision 8); `null` for every other kind and for an uncategorised product.
7. `staffName`: the target's `name` (a unit's own name in the default language, as the dialog shows it).
8. **The contract's bounds** (contract "Submit": every text field 1 to 500 characters, counted as JavaScript string length; Decision 10). An item whose staff name is blank once trimmed, or over 500 characters, is left out. A category blank once trimmed is sent as `null`; one over 500 characters leaves the item out. A name in `existing` that is over 500 characters is left out of `existing`. Nothing is shortened, and none of these refuses the whole job.
9. `existing`: the item's effective names in enabled languages that are not in `missing`, in the venue's order, within rule 8.
10. Items are sorted in the dialog's kind order (`product`, `variant`, `option_list`, `option_label`, `extra_list`, `menu`, `section`, `included_menu`, `unit`), then by id. That puts every family head before its members, which Task 7 relies on.

- [ ] **Step 1: Add the two types**

In `packages/catalogue/src/content-suggestion-types.ts`, add at the top (Task 4's types import nothing, so the line is not there yet; check with `grep -n TranslationGapKind packages/catalogue/src/content-suggestion-types.ts` first):

```ts
import type { TranslationGapKind } from "./content-translation-report-types.js";
```

and at the end:

```ts
/** One item of a job's `items` (contract, "Submit"); a context head has `missing: []`. */
export interface SuggestionItem {
  ref: string;
  kind: TranslationGapKind;
  family: string;
  category: string | null;
  staffName: string;
  existing: Record<string, string>;
  missing: string[];
}

/** One saved name of the job's `houseStyle`. */
export interface HouseStyleExample {
  kind: TranslationGapKind;
  staffName: string;
  names: Record<string, string>;
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/catalogue/src/content-suggestion-collect.test.ts`. The suite's database starts with no units, as `content-translation-report.test.ts`'s exact lists also rely on. A unit has no staff or kitchen name, so its fixture has only customer-facing text.

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  categories,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCategory } from "./categories.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
} from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import {
  listAbsentTranslationRefs,
  resolveTranslationTargets,
} from "./content-translation-targets.js";
import type { TranslationRef } from "./content-translation-types.js";
import type { SuggestionItem } from "./content-suggestion-types.js";
import { setIncludeFolder } from "./include-folder.js";
import { addMember } from "./sections.js";
import { menuDetails } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  collectSuggestionItems,
  isLiveTarget,
  parseSuggestionRef,
  readSuggestionGaps,
  suggestionRef,
  TEXT_LIMIT,
} from "./content-suggestion-collect.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const THREE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "es", "en"] };
const ONE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca"] };
const context = { fallbackLanguage: "ca", required: [] };
const KINDS = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
];

interface Lunch {
  menuId: string;
  rootId: string;
}

async function rootOf(tx: Transaction, menuId: string): Promise<string> {
  const [row] = await tx
    .select({ root: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.root;
}

/** Seeds the taxpayer, saves the languages and makes Lunch, whose own names are complete. */
async function inVenue<T>(
  config: ContentLanguages,
  body: (tx: Transaction, lunch: Lunch) => Promise<T>,
): Promise<T> {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, config);
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: Object.fromEntries(
        config.languages.map((language) => [language, `CLIENT-${language.toUpperCase()} Dinar`]),
      ),
    });
    return body(tx, { menuId: menu.id, rootId: await rootOf(tx, menu.id) });
  });
}

async function product(
  tx: Transaction,
  lunch: Lunch,
  name: string,
  customerName: Record<string, string> | null,
  categoryId: string | null = null,
): Promise<string> {
  const created = await createProduct(tx, {
    catalogueId: lunch.menuId,
    categoryId,
    unitId: null,
    name: `STAFF ${name}`,
    kitchenName: `KITCHEN ${name}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return created.id;
}

/** Written directly: the variant editor refuses a customer-facing name with no default-language text. */
async function variant(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: lunch.menuId,
      parentId,
      name: `STAFF ${name}`,
      kitchenName: `KITCHEN ${name}`,
      customerName,
    })
    .returning({ id: products.id });
  return row!.id;
}

async function optionList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLists.id });
  return row!.id;
}

async function optionLabel(
  tx: Transaction,
  listId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLabels)
    .values({ listId, name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLabels.id });
  return row!.id;
}

async function extraList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(extraLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: extraLists.id });
  return row!.id;
}

async function section(
  tx: Transaction,
  menuId: string,
  name: string,
  names: Record<string, string>,
): Promise<string> {
  const [row] = await tx
    .insert(sections)
    .values({ internalName: `STAFF ${name}`, names, ownerMenuId: menuId })
    .returning({ id: sections.id });
  return row!.id;
}

async function rename(tx: Transaction, productId: string, name: string): Promise<void> {
  await tx.update(products).set({ name }).where(eq(products.id, productId));
}

const position = (ref: string) => KINDS.indexOf(ref.slice(0, ref.indexOf(":")));
const compareRefs = (a: string, b: string) => position(a) - position(b) || (a < b ? -1 : 1);
const sortRefs = (refs: string[]) => [...refs].sort(compareRefs);
const inListOrder = <T extends { ref: string }>(rows: T[]) =>
  [...rows].sort((a, b) => compareRefs(a.ref, b.ref));

describe("suggestion refs", () => {
  it("writes a ref as kind and id, and reads back only a well-formed one", () => {
    expect(suggestionRef({ kind: "option_label", id: "abc" })).toBe("option_label:abc");
    expect(parseSuggestionRef("option_label:abc")).toEqual({ kind: "option_label", id: "abc" });
    expect(parseSuggestionRef("section:a:b")).toEqual({ kind: "section", id: "a:b" });
    for (const ref of ["", "product", "product:", ":abc", "widget:abc"])
      expect(parseSuggestionRef(ref)).toBeNull();
  });
});

describe("what counts as still there", () => {
  it("lists the live items with no customer-facing name at all, in the dialog's order, and nothing else", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const oli = await product(tx, lunch, "Oli", {});
      const vi = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const copa = await variant(tx, lunch, vi, "Copa", null);
      const punt = await optionList(tx, "Punt", null);
      const poc = await optionLabel(tx, punt, "Poc", {});
      await extraList(tx, "Salses", null);
      await tx
        .insert(units)
        .values({ name: { ca: "CLIENT-CA Ració" }, abbreviation: { ca: "r." }, precision: 0 });
      const bar = await createCatalogue(tx, { name: "STAFF Bar", names: { ca: "CLIENT-CA Bar" } });
      const barRoot = await rootOf(tx, bar.id);
      await tx.update(sections).set({ names: {} }).where(eq(sections.id, barRoot));
      const plats = await section(tx, lunch.menuId, "Plats", {});
      const coca = await product(tx, lunch, "Coca", null);
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
      await variant(tx, lunch, vermut, "Vermut gran", null);
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const spice = await optionList(tx, "Picant", { ca: "CLIENT-CA Picant" });
      await optionLabel(tx, spice, "Molt", null);
      await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, spice));
      const terrace = await createCatalogue(tx, {
        name: "STAFF Terrassa",
        names: { ca: "CLIENT-CA Terrassa" },
      });
      await section(tx, terrace.id, "Postres", {});
      await deactivateCatalogue(tx, terrace.id);

      expect((await listAbsentTranslationRefs(tx)).map(suggestionRef)).toEqual(
        sortRefs([
          `product:${pa}`,
          `product:${oli}`,
          `variant:${copa}`,
          `option_list:${punt}`,
          `option_label:${poc}`,
          `menu:${barRoot}`,
          `section:${plats}`,
        ]),
      );
    });
  });

  it("treats only a present, eligible item whose own row and owner are active as live", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const coca = await product(tx, lunch, "Coca", null);
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", null);
      const gran = await variant(tx, lunch, vermut, "Vermut gran", null);
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const drinks = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { ca: "CLIENT-CA Begudes" },
      });
      const include = await addMember(tx, lunch.rootId, {
        kind: "section",
        sectionId: await rootOf(tx, drinks.id),
      });
      await deactivateCatalogue(tx, drinks.id);
      const refs: TranslationRef[] = [
        { kind: "product", id: pa },
        { kind: "product", id: "no-such-product" },
        { kind: "product", id: gran },
        { kind: "product", id: coca },
        { kind: "variant", id: gran },
        { kind: "included_menu", id: include.id },
      ];
      const { targets } = await resolveTranslationTargets(tx, "ca", refs, context);
      expect(targets.map((entry) => isLiveTarget(entry))).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
      // Each refusal above rests on one flag alone: a variant asked for as a product on
      // `eligible`, the deleted product on `active`, the variant of the deleted product on
      // `ownerActive`. The include of a switched-off menu is already not eligible.
      expect(
        targets.map(
          (entry) =>
            entry.state === "present" && {
              eligible: entry.target.eligible,
              active: entry.structure.active,
              ownerActive: entry.structure.ownerActive,
            },
        ),
      ).toEqual([
        { eligible: true, active: true, ownerActive: true },
        false,
        { eligible: false, active: true, ownerActive: true },
        { eligible: true, active: false, ownerActive: true },
        { eligible: true, active: true, ownerActive: false },
        { eligible: false, active: true, ownerActive: true },
      ]);
    });
  });
});

describe("collecting what is missing", () => {
  it("collects every missing name across the nine kinds with its family, its category and its staff name", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const beers = await createCategory(tx, { name: "TAP BEERS" });
      const cana = await product(tx, lunch, "Caña", { ca: "CLIENT-CA Canya" }, beers.id);
      const pinta = await variant(tx, lunch, cana, "Pinta", { en: "CLIENT-EN Pint" });
      const punto = await optionList(tx, "Punto", { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" });
      const poco = await optionLabel(tx, punto, "Poco", { ca: "CLIENT-CA Poc" });
      const sides = await extraList(tx, "Guarnición", { ca: "CLIENT-CA Guarnició" });
      const drinks = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
      });
      const drinksRoot = await rootOf(tx, drinks.id);
      const plats = await section(tx, lunch.menuId, "Plats", { ca: "CLIENT-CA Plats" });
      const include = await addMember(tx, lunch.rootId, { kind: "section", sectionId: drinksRoot });
      await setIncludeFolder(
        tx,
        lunch.rootId,
        include.id,
        {
          showAsFolder: false,
          overrides: {
            names: { ca: "CLIENT-CA Begudes de la casa" },
            color: "#123456",
            image: null,
          },
        },
        "ca",
      );
      const [racio] = await tx
        .insert(units)
        .values({
          name: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
          abbreviation: { ca: "r." },
          precision: 0,
        })
        .returning({ id: units.id });

      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        {
          ref: `product:${cana}`,
          kind: "product",
          family: `product:${cana}`,
          category: "TAP BEERS",
          staffName: "STAFF Caña",
          existing: { ca: "CLIENT-CA Canya" },
          missing: ["es", "en"],
        },
        {
          ref: `variant:${pinta}`,
          kind: "variant",
          family: `product:${cana}`,
          category: "TAP BEERS",
          staffName: "STAFF Pinta",
          existing: { en: "CLIENT-EN Pint" },
          missing: ["ca", "es"],
        },
        {
          ref: `option_list:${punto}`,
          kind: "option_list",
          family: `option_list:${punto}`,
          category: null,
          staffName: "STAFF Punto",
          existing: { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" },
          missing: ["en"],
        },
        {
          ref: `option_label:${poco}`,
          kind: "option_label",
          family: `option_list:${punto}`,
          category: null,
          staffName: "STAFF Poco",
          existing: { ca: "CLIENT-CA Poc" },
          missing: ["es", "en"],
        },
        {
          ref: `extra_list:${sides}`,
          kind: "extra_list",
          family: `extra_list:${sides}`,
          category: null,
          staffName: "STAFF Guarnición",
          existing: { ca: "CLIENT-CA Guarnició" },
          missing: ["es", "en"],
        },
        {
          ref: `menu:${drinksRoot}`,
          kind: "menu",
          family: `menu:${drinksRoot}`,
          category: null,
          staffName: "STAFF Drinks",
          existing: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
          missing: ["en"],
        },
        {
          ref: `section:${plats}`,
          kind: "section",
          family: `menu:${lunch.rootId}`,
          category: null,
          staffName: "STAFF Plats",
          existing: { ca: "CLIENT-CA Plats" },
          missing: ["es", "en"],
        },
        {
          ref: `included_menu:${include.id}`,
          kind: "included_menu",
          family: `included_menu:${include.id}`,
          category: null,
          staffName: "STAFF Drinks",
          existing: { ca: "CLIENT-CA Begudes de la casa", es: "CLIENT-ES Bebidas" },
          missing: ["en"],
        },
        {
          ref: `unit:${racio!.id}`,
          kind: "unit",
          family: `unit:${racio!.id}`,
          category: null,
          staffName: "CLIENT-CA Ració",
          existing: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
          missing: ["en"],
        },
      ]);
    });
  });

  it("asks for every enabled language, the default included, for a name with no customer-facing text", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        {
          ref: `product:${pa}`,
          kind: "product",
          family: `product:${pa}`,
          category: null,
          staffName: "STAFF Pa",
          existing: {},
          missing: ["ca", "es", "en"],
        },
      ]);
    });
  });

  it("a one-language venue gets its empty names in that language", async () => {
    await inVenue(ONE, async (tx, lunch) => {
      const blank = await product(tx, lunch, "Pa", null);
      const empty = await product(tx, lunch, "Oli", {});
      const named = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const glass = await variant(tx, lunch, named, "Copa", null);
      const doneness = await optionList(tx, "Punt", null);
      const rare = await optionLabel(tx, doneness, "Poc", {});
      await extraList(tx, "Salses", null);
      const bar = await createCatalogue(tx, { name: "STAFF Bar", names: { ca: "CLIENT-CA Bar" } });
      const barRoot = await rootOf(tx, bar.id);
      await tx.update(sections).set({ names: {} }).where(eq(sections.id, barRoot));
      const mains = await section(tx, lunch.menuId, "Plats", {});
      const expected = (
        kind: SuggestionItem["kind"],
        id: string,
        family: string,
        staffName: string,
      ): SuggestionItem => ({
        ref: `${kind}:${id}`,
        kind,
        family,
        category: null,
        staffName,
        existing: {},
        missing: ["ca"],
      });
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual(
        inListOrder([
          expected("product", blank, `product:${blank}`, "STAFF Pa"),
          expected("product", empty, `product:${empty}`, "STAFF Oli"),
          expected("variant", glass, `product:${named}`, "STAFF Copa"),
          expected("option_list", doneness, `option_list:${doneness}`, "STAFF Punt"),
          expected("option_label", rare, `option_list:${doneness}`, "STAFF Poc"),
          expected("menu", barRoot, `menu:${barRoot}`, "STAFF Bar"),
          expected("section", mains, `menu:${lunch.rootId}`, "STAFF Plats"),
        ]),
      );
    });
  });

  it("a name blank in every language is asked for in every language", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: " ", es: "" });
      const [item] = await collectSuggestionItems(tx, context, new Set());
      expect(item).toMatchObject({ ref: `product:${pa}`, existing: {}, missing: ["ca", "es", "en"] });
    });
  });

  it("leaves out an extras list with no customer-facing name and keeps a partly named one", async () => {
    await inVenue(THREE, async (tx) => {
      await extraList(tx, "Salses", null);
      await extraList(tx, "Postres", {});
      const sides = await extraList(tx, "Guarnició", { ca: "CLIENT-CA Guarnició" });
      expect(
        (await collectSuggestionItems(tx, context, new Set())).map(({ ref, missing }) => ({
          ref,
          missing,
        })),
      ).toEqual([{ ref: `extra_list:${sides}`, missing: ["es", "en"] }]);
    });
  });

  it("never asks for a language the item already has, and sends only enabled languages as existing", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa", fr: "CLIENT-FR Pain" });
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        expect.objectContaining({
          ref: `product:${pa}`,
          existing: { ca: "CLIENT-CA Pa" },
          missing: ["es", "en"],
        }),
      ]);
    });
  });

  it("leaves out a language with a waiting suggestion and an item with a waiting placeholder, and reads the gaps before either", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const half = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const placeholder = await product(tx, lunch, "Oli", { ca: "CLIENT-CA Oli" });
      const fixed = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const covered = await product(tx, lunch, "Sal", { ca: "CLIENT-CA Sal" });
      const complete = await product(tx, lunch, "Mel", {
        ca: "CLIENT-CA Mel",
        es: "CLIENT-ES Miel",
        en: "CLIENT-EN Honey",
      });
      await tx.insert(contentSuggestions).values([
        { kind: "product", itemId: half, language: "es", text: "CLIENT-ES Pan", expected: "{}" },
        { kind: "product", itemId: placeholder, language: null, placeholder: true },
        {
          kind: "product",
          itemId: fixed,
          language: null,
          fixField: "internal",
          fixWrong: "Vi",
          fixRight: "Vino",
        },
        { kind: "product", itemId: covered, language: "es", text: "CLIENT-ES Sal", expected: "{}" },
        {
          kind: "product",
          itemId: covered,
          language: "en",
          text: "CLIENT-EN Salt",
          expected: "{}",
        },
        {
          kind: "product",
          itemId: complete,
          language: "es",
          text: "CLIENT-ES Miel nueva",
          expected: "{}",
        },
      ]);

      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items.map(({ ref, missing }) => ({ ref, missing }))).toEqual(
        inListOrder([
          { ref: `product:${half}`, missing: ["en"] },
          { ref: `product:${fixed}`, missing: ["es", "en"] },
        ]),
      );
      const gaps = await readSuggestionGaps(tx, context);
      expect(sortRefs([...gaps.keys()])).toEqual(
        sortRefs([half, placeholder, fixed, covered].map((id) => `product:${id}`)),
      );
      for (const gap of gaps.values()) expect([...gap.missing]).toEqual(["es", "en"]);
    });
  });

  it("walks every page of the listing and resolves past one batch of 100", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      await tx.insert(products).values(
        Array.from({ length: 120 }, (_, index) => ({
          catalogueId: lunch.menuId,
          name: `STAFF Item ${index}`,
          kitchenName: `KITCHEN Item ${index}`,
          customerName: { ca: `CLIENT-CA Item ${index}` },
          pricingUnit: "each",
          unitPrice: 300,
          vatClass: "reduced",
        })),
      );
      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items).toHaveLength(120);
      expect(new Set(items.map((item) => item.ref)).size).toBe(120);
      expect(items.every((item) => item.missing.join() === "es,en")).toBe(true);
    });
  });

  it("leaves out every excluded ref", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const oli = await product(tx, lunch, "Oli", null);
      const items = await collectSuggestionItems(tx, context, new Set([`product:${pa}`]));
      expect(items.map((item) => item.ref)).toEqual([`product:${oli}`]);
    });
  });

  it.each<[string, ContentLanguages]>([
    ["a one-language venue", ONE],
    ["a three-language venue", THREE],
  ])("leaves out a deleted product and every variant of a deleted product in %s", async (_, config) => {
    await inVenue(config, async (tx, lunch) => {
      const live = await product(tx, lunch, "Pa", null);
      const gone = await product(tx, lunch, "Coca", null);
      await variant(tx, lunch, gone, "Coca petita", null);
      await deactivateProduct(tx, gone);
      const closed = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
      await variant(tx, lunch, closed, "Vermut gran", null);
      // The variant row stays active: only its product's flag says the family is gone.
      await tx.update(products).set({ active: false }).where(eq(products.id, closed));
      expect(
        (await collectSuggestionItems(tx, context, new Set())).map((item) => item.ref),
      ).toEqual([`product:${live}`]);
    });
  });

  it("leaves out an item Cloud would refuse, and a name or a category it would refuse, without refusing the rest", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const blankStaff = await product(tx, lunch, "Blank", { ca: "CLIENT-CA Blanc" });
      await rename(tx, blankStaff, "   ");
      const longStaff = await product(tx, lunch, "Long", { ca: "CLIENT-CA Llarg" });
      await rename(tx, longStaff, "S".repeat(TEXT_LIMIT + 1));
      const edge = await product(tx, lunch, "Edge", { ca: "CLIENT-CA Vora" });
      await rename(tx, edge, "S".repeat(TEXT_LIMIT));
      const longName = await product(tx, lunch, "Pa", {
        ca: "C".repeat(TEXT_LIMIT + 1),
        es: "CLIENT-ES Pan",
      });
      const blankCategory = await createCategory(tx, { name: "Blank" });
      await tx
        .update(categories)
        .set({ name: "   " })
        .where(eq(categories.id, blankCategory.id));
      const unnamed = await product(tx, lunch, "Oli", { ca: "CLIENT-CA Oli" }, blankCategory.id);
      const unnamedVariant = await variant(tx, lunch, unnamed, "Oli petit", {
        ca: "CLIENT-CA Oli petit",
      });
      const longCategory = await createCategory(tx, { name: "Long" });
      await tx
        .update(categories)
        .set({ name: "C".repeat(TEXT_LIMIT + 1) })
        .where(eq(categories.id, longCategory.id));
      const shut = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" }, longCategory.id);
      await variant(tx, lunch, shut, "Vi negre", { ca: "CLIENT-CA Vi negre" });

      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items.map((item) => item.ref)).toEqual(
        sortRefs([
          `product:${edge}`,
          `product:${longName}`,
          `product:${unnamed}`,
          `variant:${unnamedVariant}`,
        ]),
      );
      const byRef = new Map(items.map((item) => [item.ref, item]));
      expect(byRef.get(`product:${edge}`)!.staffName).toBe("S".repeat(TEXT_LIMIT));
      expect(byRef.get(`product:${longName}`)).toMatchObject({ missing: ["en"] });
      expect(byRef.get(`product:${longName}`)!.existing).toEqual({ es: "CLIENT-ES Pan" });
      expect(byRef.get(`product:${unnamed}`)!.category).toBeNull();
      expect(byRef.get(`variant:${unnamedVariant}`)!.category).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-collect.test.ts`
Expected: FAIL — the file's import of `./content-suggestion-collect.js` cannot be resolved, so no test runs.

- [ ] **Step 4: Share the listing's filter, and add the absent read**

In `packages/catalogue/src/content-translation-targets.ts`, add after `checkedRefs` (line 88):

```ts
// What the translations dialog lists at all: a live row in its right role. The absent read below
// applies the same fragment, so the two cannot drift apart.
const LIVE_CANDIDATE = sql`active = 1 and owner_active = 1 and child_active = 1 and root_matched = 1
      and (kind not in ('product', 'variant', 'menu', 'section', 'included_menu') or
        (kind = 'product' and role = 'product') or (kind = 'variant' and role = 'variant') or
        (kind = 'menu' and role = 'menu_root') or (kind = 'section' and role = 'section') or
        (kind = 'included_menu' and role = 'menu_root' and parent_role in ('menu_root', 'section')))`;
const POSITION = sql`case kind when 'product' then 0 when 'variant' then 1 when 'option_list' then 2
      when 'option_label' then 3 when 'extra_list' then 4 when 'menu' then 5 when 'section' then 6
      when 'included_menu' then 7 else 8 end`;
```

In `listTranslationTargets`, replace

```ts
  const projection = sql`with candidates as (${namedRows()}), gaps as (
    select kind, id, case kind when 'product' then 0 when 'variant' then 1 when 'option_list' then 2
      when 'option_label' then 3 when 'extra_list' then 4 when 'menu' then 5 when 'section' then 6
      when 'included_menu' then 7 else 8 end as position
    from candidates where active = 1 and owner_active = 1 and child_active = 1 and root_matched = 1
      and (kind not in ('product', 'variant', 'menu', 'section', 'included_menu') or
        (kind = 'product' and role = 'product') or (kind = 'variant' and role = 'variant') or
        (kind = 'menu' and role = 'menu_root') or (kind = 'section' and role = 'section') or
        (kind = 'included_menu' and role = 'menu_root' and parent_role in ('menu_root', 'section')))
      and (kind <> 'extra_list' or (names is not null and names <> '{}'))
```

with

```ts
  const projection = sql`with candidates as (${namedRows()}), gaps as (
    select kind, id, ${POSITION} as position
    from candidates where ${LIVE_CANDIDATE}
      and (kind <> 'extra_list' or (names is not null and names <> '{}'))
```

(the three lines after it, from `and (kind <> 'included_menu' …` to the closing `)` of `gaps`, stay as they are). Then add after `listTranslationTargets`:

```ts
/**
 * The live products, variants, options lists, options labels, menus and sections whose
 * customer-facing name is stored as null or `{}`, in the dialog's order. Under the default language
 * {@link listTranslationTargets} leaves these out, so a venue with one language would never see
 * them. Extras lists, includes and units are never absent here: an absent extras list's name reaches
 * no order or receipt, an include fixing no name is listed under the included menu, and a unit's
 * name is required.
 */
export async function listAbsentTranslationRefs(tx: Transaction): Promise<TranslationRef[]> {
  const result = await tx.execute<{ kind: TranslationGapKind; id: string }>(sql`
    with candidates as (${namedRows()})
    select kind, id from candidates
    where ${LIVE_CANDIDATE}
      and kind in ('product', 'variant', 'option_list', 'option_label', 'menu', 'section')
      and (names is null or names = '{}')
    order by ${POSITION}, id`);
  return result.rows.map(({ kind, id }) => ({ kind, id }));
}
```

- [ ] **Step 5: Write the collecting module**

Create `packages/catalogue/src/content-suggestion-collect.ts`:

```ts
import { categories, products, type Transaction } from "@waitron/db";
import type { ContentLanguages } from "@waitron/shared";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { batches } from "./batches.js";
import { readContentLanguages } from "./content-languages.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import {
  listAbsentTranslationRefs,
  listTranslationTargets,
  resolveTranslationTargets,
  type ResolvedTranslationTarget,
  type TranslationContext,
} from "./content-translation-targets.js";
import type { TranslationRef, TranslationTarget } from "./content-translation-types.js";
import type { SuggestionItem } from "./content-suggestion-types.js";
import { menuRoots } from "./menu-structure.js";
import { contentSuggestions } from "./schema/suggestions.js";

/** Cloud's bound on every text field, counted as JavaScript string length (contract, "Submit"). */
export const TEXT_LIMIT = 500;

const KIND_ORDER: readonly TranslationGapKind[] = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
];

type LiveTarget = Extract<ResolvedTranslationTarget, { state: "present" }>;
type Gap = { entry: LiveTarget; missing: Set<string> };

export function suggestionRef(ref: { kind: string; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseSuggestionRef(ref: string): TranslationRef | null {
  const colon = ref.indexOf(":");
  const kind = ref.slice(0, colon) as TranslationGapKind;
  const id = ref.slice(colon + 1);
  return colon > 0 && id !== "" && KIND_ORDER.includes(kind) ? { kind, id } : null;
}

/**
 * Whether a resolved item is still on the venue. `resolveTranslationTargets` marks a deleted
 * product or variant, and a variant of a deleted product, eligible, so `eligible` alone is not
 * enough; for every other kind `eligible` already covers the activity flags.
 */
export function isLiveTarget(entry: ResolvedTranslationTarget): entry is LiveTarget {
  return (
    entry.state === "present" &&
    entry.target.eligible &&
    entry.structure.active &&
    entry.structure.ownerActive
  );
}

function fits(text: string): boolean {
  return text.trim() !== "" && text.length <= TEXT_LIMIT;
}

function effectiveNames(entry: LiveTarget): Record<string, string> {
  return { ...entry.inheritedNames, ...entry.names };
}

async function resolveLive(
  tx: Transaction,
  language: string,
  refs: readonly TranslationRef[],
  context: TranslationContext,
): Promise<LiveTarget[]> {
  const live: LiveTarget[] = [];
  for (const chunk of batches(refs, 100))
    live.push(
      ...(await resolveTranslationTargets(tx, language, chunk, context)).targets.filter(
        isLiveTarget,
      ),
    );
  return live;
}

async function readGaps(
  tx: Transaction,
  context: TranslationContext,
  config: ContentLanguages,
): Promise<Map<string, Gap>> {
  const refs = new Map<string, TranslationRef>();
  for (const language of config.languages) {
    let after: string | null = null;
    do {
      const page = await listTranslationTargets(
        tx,
        language,
        after === null ? {} : { after },
        context,
      );
      for (const row of page.rows) refs.set(suggestionRef(row), { kind: row.kind, id: row.id });
      after = page.next;
    } while (after !== null);
  }
  for (const ref of await listAbsentTranslationRefs(tx)) refs.set(suggestionRef(ref), ref);
  const gaps = new Map<string, Gap>();
  // Every candidate is blank in at least one language: a page lists an item only where its text is
  // blank, and an absent item is blank everywhere.
  for (const entry of await resolveLive(tx, config.defaultLanguage, [...refs.values()], context)) {
    const effective = effectiveNames(entry);
    gaps.set(suggestionRef(entry.target), {
      entry,
      missing: new Set(
        config.languages.filter((language) => !(effective[language] ?? "").trim()),
      ),
    });
  }
  return gaps;
}

/** Every live item and the enabled languages it has no customer-facing text in, before the
 * waiting suggestions and any exclusion are taken away. */
export async function readSuggestionGaps(
  tx: Transaction,
  context: TranslationContext,
): Promise<Map<string, { target: TranslationTarget; missing: Set<string> }>> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const gaps = await readGaps(tx, context, config);
  return new Map(
    [...gaps].map(([ref, gap]) => [ref, { target: gap.entry.target, missing: gap.missing }]),
  );
}

function productOf(target: TranslationTarget): string | null {
  const owners = target.owners!;
  if (owners.kind === "product") return target.id;
  return owners.kind === "variant" ? owners.parentId : null;
}

function familyOf(target: TranslationTarget, roots: ReadonlyMap<string, string>): string {
  const owners = target.owners!;
  switch (owners.kind) {
    case "variant":
      return suggestionRef({ kind: "product", id: owners.parentId });
    case "option_label":
      return suggestionRef({ kind: "option_list", id: owners.listId });
    case "section":
      return suggestionRef({ kind: "menu", id: roots.get(owners.menuId)! });
    default:
      return suggestionRef(target);
  }
}

async function readCategoryNames(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (const batch of batches(productIds)) {
    const rows = await tx
      .select({ id: products.id, name: categories.name })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(inArray(products.id, batch));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
}

/** Turns live items into job items, leaving out what Cloud's bounds would refuse (rule 8). */
async function describeItems(
  tx: Transaction,
  config: ContentLanguages,
  wanted: readonly { entry: LiveTarget; missing: string[] }[],
): Promise<SuggestionItem[]> {
  const productIds = new Set<string>();
  const menuIds = new Set<string>();
  for (const { entry } of wanted) {
    const productId = productOf(entry.target);
    if (productId !== null) productIds.add(productId);
    const owners = entry.target.owners!;
    if (owners.kind === "section") menuIds.add(owners.menuId);
  }
  const categoryNames = await readCategoryNames(tx, [...productIds]);
  const roots = await menuRoots(tx, [...menuIds]);
  const items: SuggestionItem[] = [];
  for (const { entry, missing } of wanted) {
    const productId = productOf(entry.target);
    const category = productId === null ? null : (categoryNames.get(productId) ?? null);
    if (!fits(entry.target.name) || (category !== null && category.length > TEXT_LIMIT)) continue;
    const effective = effectiveNames(entry);
    items.push({
      ref: suggestionRef(entry.target),
      kind: entry.target.kind,
      family: familyOf(entry.target, roots),
      category: category !== null && category.trim() !== "" ? category : null,
      staffName: entry.target.name,
      existing: Object.fromEntries(
        config.languages
          .filter((language) => !missing.includes(language) && fits(effective[language] ?? ""))
          .map((language) => [language, effective[language]!]),
      ),
      missing,
    });
  }
  return items.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.ref < b.ref ? -1 : 1),
  );
}

/**
 * What a job may ask Cloud for: every missing name less the waiting suggestions and `exclude`, in
 * the dialog's kind order then id, so a family's head comes before its members.
 */
export async function collectSuggestionItems(
  tx: Transaction,
  context: TranslationContext,
  exclude: ReadonlySet<string>,
): Promise<SuggestionItem[]> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const gaps = await readGaps(tx, context, config);
  const waiting = await tx
    .select({
      kind: contentSuggestions.kind,
      itemId: contentSuggestions.itemId,
      language: contentSuggestions.language,
      placeholder: contentSuggestions.placeholder,
    })
    .from(contentSuggestions)
    .where(
      or(
        eq(contentSuggestions.placeholder, true),
        and(isNotNull(contentSuggestions.text), isNotNull(contentSuggestions.language)),
      ),
    );
  for (const row of waiting) {
    const gap = gaps.get(suggestionRef({ kind: row.kind, id: row.itemId }));
    if (gap === undefined) continue;
    if (row.placeholder) gap.missing.clear();
    else gap.missing.delete(row.language!);
  }
  const wanted = [...gaps]
    .filter(([ref, gap]) => gap.missing.size > 0 && !exclude.has(ref))
    .map(([, gap]) => ({
      entry: gap.entry,
      missing: config.languages.filter((language) => gap.missing.has(language)),
    }));
  return describeItems(tx, config, wanted);
}
```

In `packages/catalogue/src/index.ts`, after `export * from "./content-translations.js";` (line 161), add:

```ts
export * from "./content-suggestion-collect.js";
export type * from "./content-suggestion-types.js";
```

(Task 4 created `content-suggestion-types.ts` but did not export it from the barrel; this is its first export.)

- [ ] **Step 6: Run the tests, the listing's own suites and the controls**

Run:
`pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-collect.test.ts src/content-translation-targets.test.ts src/content-translations.test.ts src/content-translation-report.test.ts`
Expected: PASS. Read the `Tests` count: the new file holds 15 cases (the deleted-product case runs twice), beside the three existing files' own counts.

Then the per-file coverage of the new module:
`pnpm --filter @waitron/catalogue exec vitest run --coverage --coverage.include=src/content-suggestion-collect.ts src/content-suggestion-collect.test.ts`
Expected: PASS, and the table shows `content-suggestion-collect.ts` at or above 98/98/98/95. Read the per-file row, not the exit status.

Controls, each undone afterwards, each with the case it must fail. Before each one, the failing output to look for is that case's name in red with an `expected … to deeply equal …` diff; a run that stays green means the control proved nothing:
1. In `readGaps`, replace `config.languages` in the `for` loop with `[config.defaultLanguage]`. "collects every missing name across the nine kinds…" fails (the Caña product, missing only `es` and `en`, is no longer found).
2. Delete the `for (const ref of await listAbsentTranslationRefs(tx))` line. "a one-language venue gets its empty names in that language" fails with an empty list.
3. Delete `active = 1 and ` from `LIVE_CANDIDATE`. "lists the live items with no customer-facing name at all…" fails, listing the deleted Coca.
4. Delete `entry.structure.active &&` from `isLiveTarget`. "treats only a present, eligible item…" fails on its fourth entry.
5. Delete `entry.structure.ownerActive` (and the `&&` before it) from `isLiveTarget`. The same case fails on its fifth entry.
6. Delete the `for (const row of waiting)` loop. "leaves out a language with a waiting suggestion…" fails.
7. Replace `category !== null && category.trim() !== "" ? category : null` with `category`. "leaves out an item Cloud would refuse…" fails on the two `toBeNull` checks.
8. In `readGaps`, replace `after = page.next;` with `after = null;`. "walks every page of the listing…" fails with 50 items, the listing's first page.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-translation-targets.ts packages/catalogue/src/content-suggestion-types.ts packages/catalogue/src/content-suggestion-collect.ts packages/catalogue/src/content-suggestion-collect.test.ts packages/catalogue/src/index.ts
git commit -s -m "Collect every customer-facing name a live item is missing, in every enabled language, for Translate all"
```

---

### Task 7: House style, context heads and the job body

**Files:**
- Modify: `packages/catalogue/src/content-suggestion-collect.ts`
- Test: `packages/catalogue/src/content-suggestion-job.test.ts`

**Interfaces:**
- Consumes: `collectSuggestionItems`, `parseSuggestionRef`, and the module's private `resolveLive`, `describeItems`, `fits`, `KIND_ORDER` (Task 6); `readContentLanguages`; `tenants` from `@waitron/db`.
- Produces:
  ```ts
  export const JOB_ITEM_LIMIT = 1000;
  export const JOB_BYTE_LIMIT = 1_048_576;
  export const HOUSE_STYLE_LIMIT = 300;
  export const HOUSE_STYLE_BYTE_LIMIT = 262_144;
  export async function readHouseStyle(
    tx: Transaction,
    languages: readonly string[],
    limit?: number,
  ): Promise<HouseStyleExample[]>;
  export interface SuggestionJobDraft {
    body: string;
    sent: Record<string, string[]>;
    included: number;
    heads: number;
    remaining: number;
    bytes: number;
  }
  export async function buildSuggestionJob(
    tx: Transaction,
    context: TranslationContext,
    exclude: ReadonlySet<string>,
  ): Promise<SuggestionJobDraft | null>;
  ```
- `included` counts every entry of the job's `items`, context heads included, which is what Cloud counts towards its 1,000. `heads` counts the context heads among them, so `Object.keys(sent).length === included - heads`. `remaining` counts the items with languages to write left for a later job, never heads. `bytes` is the running total the 1 MiB limit was checked against, which always equals `Buffer.byteLength(body)`; a test holds that.
- Two names beyond the shared interface list: `HOUSE_STYLE_BYTE_LIMIT` and `bytes`. Without a byte bound on the house style, 300 examples with twenty 500-character names each can pass 1 MiB on their own, and the job would hold no item at all. `bytes` is there so the accounting is checked, not trusted.

Rules, each with a test below:

1. **House style** (spec section 2, step 4): up to `limit` (300) saved customer-facing names of live products, variants, options lists, options labels, extras lists, menus and sections. "Live" is the listing's own rule written for these tables: a product is top level and active; a variant is active and so is its product; an options list or extras list is active; an options label's list is active; a menu or section belongs to an active menu, and a menu is its menu's root. A name is kept only in an enabled language and within the 500-character bound; an example whose staff name is blank or over 500 characters, or which has no name left, is not chosen. Examples are grouped by kind and category (a variant takes its product's category), each group in id order, and taken one from each group in turn.
2. **Context heads** (Decision 9, contract "Submit", "Context items"): before a variant, an options label or a section whose family head is not already in this job, the head goes in with `missing: []`, its own ref as `family`, its category (a product's), and its effective names within the bounds as `existing`. This happens whether the head's names are complete, an earlier job of the run sent it (its ref is in `exclude`), or its own gaps all have waiting suggestions. A head is never in `sent` and is the only kind of entry that may appear in several jobs of one run. A head that Cloud's bounds would refuse (for example, a staff name over 500 characters) is not sent; its members still are, naming it as their `family`. The contract does not require a family's head to be in the job: it requires only that a head comes before its members and that an item with `missing: []` heads another item in the job.
3. **Limits:** entries go in order, each item with its head first when rule 2 adds one, until the next would take the job past 1,000 entries or past 1,048,576 bytes of `JSON.stringify(body)`. A head and its member go in together or not at all, so a job never ends on a lone head. The house style is cut, in the order rule 1 chose it, to at most 262,144 bytes (a quarter of the job).
4. **Body:** `{ version: 1, country, languages: { default, enabled }, items, houseStyle }`, with no other key; `country` from `tenants.country` (the one row, id 1). Null when nothing is missing.

Not handled here: a venue with more than 20 enabled languages. Cloud refuses such a job with 400 (contract, "`languages.enabled` holds 1 to 20"), which reaches the dialog as `cloud.request_invalid`.

- [ ] **Step 1: Write the failing tests**

Create `packages/catalogue/src/content-suggestion-job.test.ts`. The bulk helpers insert rows directly, 100 a statement, because a thousand `createProduct` calls would take far longer than the 30-second test bound (`packages/catalogue/vitest.config.ts`).

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCategory } from "./categories.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
} from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import type { HouseStyleExample, SuggestionItem } from "./content-suggestion-types.js";
import { menuDetails } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import {
  buildSuggestionJob,
  collectSuggestionItems,
  HOUSE_STYLE_BYTE_LIMIT,
  HOUSE_STYLE_LIMIT,
  JOB_BYTE_LIMIT,
  JOB_ITEM_LIMIT,
  readHouseStyle,
  TEXT_LIMIT,
  type SuggestionJobDraft,
} from "./content-suggestion-collect.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const THREE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "es", "en"] };
const context = { fallbackLanguage: "ca", required: [] };
const LUNCH_NAMES = { ca: "CLIENT-CA Dinar", es: "CLIENT-ES Dinar", en: "CLIENT-EN Dinar" };

interface Lunch {
  menuId: string;
  rootId: string;
}
interface Job {
  version: number;
  country: string;
  languages: { default: string; enabled: string[] };
  items: SuggestionItem[];
  houseStyle: HouseStyleExample[];
}

async function rootOf(tx: Transaction, menuId: string): Promise<string> {
  const [row] = await tx
    .select({ root: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.root;
}

/** Seeds the taxpayer (country "ES"), saves ca, es and en, and makes Lunch with complete names. */
async function inVenue<T>(body: (tx: Transaction, lunch: Lunch) => Promise<T>): Promise<T> {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, THREE);
    const menu = await createCatalogue(tx, { name: "STAFF Lunch", names: LUNCH_NAMES });
    return body(tx, { menuId: menu.id, rootId: await rootOf(tx, menu.id) });
  });
}

const all = (name: string) => ({
  ca: `CLIENT-CA ${name}`,
  es: `CLIENT-ES ${name}`,
  en: `CLIENT-EN ${name}`,
});

async function product(
  tx: Transaction,
  lunch: Lunch,
  name: string,
  customerName: Record<string, string> | null,
  categoryId: string | null = null,
): Promise<string> {
  const created = await createProduct(tx, {
    catalogueId: lunch.menuId,
    categoryId,
    unitId: null,
    name: `STAFF ${name}`,
    kitchenName: `KITCHEN ${name}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return created.id;
}

/** Written directly: the variant editor refuses a customer-facing name with no default-language text. */
async function variant(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: lunch.menuId,
      parentId,
      name: `STAFF ${name}`,
      kitchenName: `KITCHEN ${name}`,
      customerName,
    })
    .returning({ id: products.id });
  return row!.id;
}

async function manyProducts(
  tx: Transaction,
  lunch: Lunch,
  count: number,
  make: (index: number) => {
    name: string;
    customerName: Record<string, string> | null;
    categoryId?: string;
  },
): Promise<void> {
  for (let start = 0; start < count; start += 100) {
    const rows = Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
      const { name, customerName, categoryId = null } = make(start + offset);
      return {
        catalogueId: lunch.menuId,
        categoryId,
        name,
        kitchenName: `KITCHEN ${start + offset}`,
        customerName,
        pricingUnit: "each",
        unitPrice: 300,
        vatClass: "reduced",
      };
    });
    await tx.insert(products).values(rows);
  }
}

async function manyVariants(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  count: number,
  make: (index: number) => { name: string; customerName: Record<string, string> | null },
): Promise<void> {
  for (let start = 0; start < count; start += 100) {
    const rows = Array.from({ length: Math.min(100, count - start) }, (_, offset) => ({
      catalogueId: lunch.menuId,
      parentId,
      kitchenName: `KITCHEN variant ${start + offset}`,
      ...make(start + offset),
    }));
    await tx.insert(products).values(rows);
  }
}

async function optionList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLists.id });
  return row!.id;
}

async function optionLabel(
  tx: Transaction,
  listId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLabels)
    .values({ listId, name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLabels.id });
  return row!.id;
}

async function extraList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(extraLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: extraLists.id });
  return row!.id;
}

async function section(
  tx: Transaction,
  menuId: string,
  name: string,
  names: Record<string, string>,
): Promise<string> {
  const [row] = await tx
    .insert(sections)
    .values({ internalName: `STAFF ${name}`, names, ownerMenuId: menuId })
    .returning({ id: sections.id });
  return row!.id;
}

async function rename(tx: Transaction, productId: string, name: string): Promise<void> {
  await tx.update(products).set({ name }).where(eq(products.id, productId));
}

const parsed = (draft: SuggestionJobDraft | null): Job => JSON.parse(draft!.body) as Job;

describe("the house style", () => {
  it("spreads the house style across kinds and categories and stops at 300", async () => {
    await inVenue(async (tx, lunch) => {
      const a = await createCategory(tx, { name: "CAT A" });
      const b = await createCategory(tx, { name: "CAT B" });
      await manyProducts(tx, lunch, 400, (index) => ({
        name: `STAFF A-${index}`,
        customerName: { ca: `CLIENT-CA A-${index}` },
        categoryId: a.id,
      }));
      await manyProducts(tx, lunch, 5, (index) => ({
        name: `STAFF B-${index}`,
        customerName: { ca: `CLIENT-CA B-${index}` },
        categoryId: b.id,
      }));
      const list = await optionList(tx, "Punt", { ca: "CLIENT-CA Punt" });
      for (let index = 0; index < 5; index += 1)
        await optionLabel(tx, list, `Label ${index}`, { ca: `CLIENT-CA Label ${index}` });

      const examples = await readHouseStyle(tx, THREE.languages);
      expect(examples).toHaveLength(HOUSE_STYLE_LIMIT);
      expect(examples.filter((example) => example.staffName.startsWith("STAFF B-"))).toHaveLength(
        5,
      );
      expect(examples.filter((example) => example.kind === "option_label")).toHaveLength(5);
      expect(examples.filter((example) => example.kind === "option_list")).toHaveLength(1);
      expect(examples.filter((example) => example.kind === "menu")).toHaveLength(1);
    });
  });

  it("takes one example from each group in turn, each group in id order, and the limit cuts the list", async () => {
    await inVenue(async (tx, lunch) => {
      const a = await createCategory(tx, { name: "CAT A" });
      const b = await createCategory(tx, { name: "CAT B" });
      const firstA = await product(tx, lunch, "A1", { ca: "CLIENT-CA A1" }, a.id);
      const secondA = await product(tx, lunch, "A2", { ca: "CLIENT-CA A2" }, a.id);
      await product(tx, lunch, "B1", { ca: "CLIENT-CA B1" }, b.id);
      const [earlier, later] =
        firstA < secondA ? ["STAFF A1", "STAFF A2"] : ["STAFF A2", "STAFF A1"];

      expect((await readHouseStyle(tx, THREE.languages)).map((example) => example.staffName)).toEqual(
        ["STAFF Lunch", earlier, "STAFF B1", later],
      );
      expect(
        (await readHouseStyle(tx, THREE.languages, 2)).map((example) => example.staffName),
      ).toEqual(["STAFF Lunch", earlier]);
    });
  });

  it("leaves out a name Cloud would refuse, a language the venue does not use, and anything gone", async () => {
    await inVenue(async (tx, lunch) => {
      const blankStaff = await product(tx, lunch, "Blank", { ca: "CLIENT-CA Blanc" });
      await rename(tx, blankStaff, "   ");
      const longStaff = await product(tx, lunch, "Long", { ca: "CLIENT-CA Llarg" });
      await rename(tx, longStaff, "S".repeat(TEXT_LIMIT + 1));
      await product(tx, lunch, "Pa", {
        ca: "C".repeat(TEXT_LIMIT + 1),
        es: "CLIENT-ES Pan",
        fr: "CLIENT-FR Pain",
      });
      await product(tx, lunch, "Oli", { ca: "  " });
      await product(tx, lunch, "Sal", null);
      const coca = await product(tx, lunch, "Coca", { ca: "CLIENT-CA Coca" });
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
      await variant(tx, lunch, vermut, "Vermut gran", { ca: "CLIENT-CA Vermut gran" });
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const vi = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      await variant(tx, lunch, vi, "Copa", { ca: "CLIENT-CA Copa" });
      const spice = await optionList(tx, "Picant", { ca: "CLIENT-CA Picant" });
      await optionLabel(tx, spice, "Molt", { ca: "CLIENT-CA Molt" });
      await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, spice));
      const terrace = await createCatalogue(tx, {
        name: "STAFF Terrassa",
        names: { ca: "CLIENT-CA Terrassa" },
      });
      await section(tx, terrace.id, "Postres", { ca: "CLIENT-CA Postres" });
      await deactivateCatalogue(tx, terrace.id);
      await extraList(tx, "Salses", { ca: "CLIENT-CA Salses" });
      await tx
        .insert(units)
        .values({ name: { ca: "CLIENT-CA Ració" }, abbreviation: { ca: "r." }, precision: 0 });

      const byName = (a: HouseStyleExample, b: HouseStyleExample) =>
        a.staffName < b.staffName ? -1 : 1;
      expect([...(await readHouseStyle(tx, THREE.languages))].sort(byName)).toEqual(
        [
          { kind: "variant", staffName: "STAFF Copa", names: { ca: "CLIENT-CA Copa" } },
          { kind: "menu", staffName: "STAFF Lunch", names: LUNCH_NAMES },
          { kind: "product", staffName: "STAFF Pa", names: { es: "CLIENT-ES Pan" } },
          { kind: "extra_list", staffName: "STAFF Salses", names: { ca: "CLIENT-CA Salses" } },
          { kind: "product", staffName: "STAFF Vi", names: { ca: "CLIENT-CA Vi" } },
        ].sort(byName),
      );
    });
  });
});

describe("the job body", () => {
  it("carries the venue's country and languages, and the keys the contract names and no others", async () => {
    await inVenue(async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const draft = await buildSuggestionJob(tx, context, new Set());
      const job = parsed(draft);
      expect(Object.keys(job)).toEqual(["version", "country", "languages", "items", "houseStyle"]);
      expect(job).toMatchObject({
        version: 1,
        country: "ES",
        languages: { default: "ca", enabled: ["ca", "es", "en"] },
      });
      expect(job.items).toEqual([
        {
          ref: `product:${pa}`,
          kind: "product",
          family: `product:${pa}`,
          category: null,
          staffName: "STAFF Pa",
          existing: { ca: "CLIENT-CA Pa" },
          missing: ["es", "en"],
        },
      ]);
      expect(Object.keys(job.items[0]!)).toEqual([
        "ref",
        "kind",
        "family",
        "category",
        "staffName",
        "existing",
        "missing",
      ]);
      expect(job.houseStyle).toEqual([
        { kind: "menu", staffName: "STAFF Lunch", names: LUNCH_NAMES },
        { kind: "product", staffName: "STAFF Pa", names: { ca: "CLIENT-CA Pa" } },
      ]);
      expect(draft).toMatchObject({
        sent: { [`product:${pa}`]: ["es", "en"] },
        included: 1,
        heads: 0,
        remaining: 0,
      });
      expect(Buffer.byteLength(draft!.body)).toBe(draft!.bytes);
    });
  });

  it("returns null when nothing is missing", async () => {
    await inVenue(async (tx) => {
      expect(await buildSuggestionJob(tx, context, new Set())).toBeNull();
    });
  });

  it("sends a complete family head as context, once, with nothing missing, before its first member", async () => {
    await inVenue(async (tx, lunch) => {
      const beers = await createCategory(tx, { name: "TAP BEERS" });
      const cana = await product(tx, lunch, "Caña", all("Caña"), beers.id);
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });
      const quinto = await variant(tx, lunch, cana, "Quinto", {
        ca: "CLIENT-CA Quint",
        en: "CLIENT-EN Fifth",
      });
      const punto = await optionList(tx, "Punto", all("Punto"));
      const poco = await optionLabel(tx, punto, "Poco", {
        ca: "CLIENT-CA Poc",
        es: "CLIENT-ES Poco",
      });
      const plats = await section(tx, lunch.menuId, "Plats", {
        ca: "CLIENT-CA Plats",
        en: "CLIENT-EN Mains",
      });

      const draft = await buildSuggestionJob(tx, context, new Set());
      const items = parsed(draft).items;
      const [first, second] = [`variant:${pinta}`, `variant:${quinto}`].sort();
      expect(items.map((item) => item.ref)).toEqual([
        `product:${cana}`,
        first,
        second,
        `option_list:${punto}`,
        `option_label:${poco}`,
        `menu:${lunch.rootId}`,
        `section:${plats}`,
      ]);
      expect(items[0]).toEqual({
        ref: `product:${cana}`,
        kind: "product",
        family: `product:${cana}`,
        category: "TAP BEERS",
        staffName: "STAFF Caña",
        existing: all("Caña"),
        missing: [],
      });
      expect(items[3]).toEqual({
        ref: `option_list:${punto}`,
        kind: "option_list",
        family: `option_list:${punto}`,
        category: null,
        staffName: "STAFF Punto",
        existing: all("Punto"),
        missing: [],
      });
      expect(items[5]).toEqual({
        ref: `menu:${lunch.rootId}`,
        kind: "menu",
        family: `menu:${lunch.rootId}`,
        category: null,
        staffName: "STAFF Lunch",
        existing: LUNCH_NAMES,
        missing: [],
      });
      expect(draft!.sent).toEqual({
        [`variant:${pinta}`]: ["es"],
        [`variant:${quinto}`]: ["es"],
        [`option_label:${poco}`]: ["en"],
        [`section:${plats}`]: ["es"],
      });
      expect(draft).toMatchObject({ included: 7, heads: 3, remaining: 0 });
      expect(Object.keys(draft!.sent)).toHaveLength(draft!.included - draft!.heads);
    });
  });

  it("sends an excluded head again as context, and a head with its own gaps once, as an item", async () => {
    await inVenue(async (tx, lunch) => {
      const cana = await product(tx, lunch, "Caña", {
        ca: "CLIENT-CA Canya",
        en: "CLIENT-EN Half pint",
      });
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });

      const later = await buildSuggestionJob(tx, context, new Set([`product:${cana}`]));
      expect(parsed(later).items).toEqual([
        {
          ref: `product:${cana}`,
          kind: "product",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Caña",
          existing: { ca: "CLIENT-CA Canya", en: "CLIENT-EN Half pint" },
          missing: [],
        },
        {
          ref: `variant:${pinta}`,
          kind: "variant",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Pinta",
          existing: { ca: "CLIENT-CA Pinta", en: "CLIENT-EN Pint" },
          missing: ["es"],
        },
      ]);
      expect(later!.sent).toEqual({ [`variant:${pinta}`]: ["es"] });
      expect(later).toMatchObject({ included: 2, heads: 1, remaining: 0 });

      const first = await buildSuggestionJob(tx, context, new Set());
      expect(parsed(first).items.map(({ ref, missing }) => ({ ref, missing }))).toEqual([
        { ref: `product:${cana}`, missing: ["es"] },
        { ref: `variant:${pinta}`, missing: ["es"] },
      ]);
      expect(first).toMatchObject({ included: 2, heads: 0 });
    });
  });

  it("sends a member without its head when Cloud would refuse the head", async () => {
    await inVenue(async (tx, lunch) => {
      const cana = await product(tx, lunch, "Caña", all("Caña"));
      await rename(tx, cana, "S".repeat(TEXT_LIMIT + 1));
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });
      const draft = await buildSuggestionJob(tx, context, new Set());
      expect(parsed(draft).items.map((item) => [item.ref, item.family])).toEqual([
        [`variant:${pinta}`, `product:${cana}`],
      ]);
      expect(draft).toMatchObject({ included: 1, heads: 0 });
    });
  });
});

describe("the job's limits", () => {
  it("stops adding items at 1,000 and leaves the rest for the next job", async () => {
    await inVenue(async (tx, lunch) => {
      await manyProducts(tx, lunch, JOB_ITEM_LIMIT + 1, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: `CLIENT-CA Item ${index}`, en: `CLIENT-EN Item ${index}` },
      }));
      const first = await buildSuggestionJob(tx, context, new Set());
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT, heads: 0, remaining: 1 });
      expect(Object.keys(first!.sent)).toHaveLength(JOB_ITEM_LIMIT);
      expect(parsed(first).items).toHaveLength(JOB_ITEM_LIMIT);
      const second = await buildSuggestionJob(tx, context, new Set(Object.keys(first!.sent)));
      expect(second).toMatchObject({ included: 1, heads: 0, remaining: 0 });
    });
  });

  it("counts a context head among the job's 1,000 items, and sends it again beside a member a later job carries", async () => {
    await inVenue(async (tx, lunch) => {
      const glass = await product(tx, lunch, "Copa", all("Copa"));
      await manyVariants(tx, lunch, glass, JOB_ITEM_LIMIT - 1, (index) => ({
        name: `STAFF Copa ${index}`,
        customerName: { ca: `CLIENT-CA Copa ${index}`, en: `CLIENT-EN Glass ${index}` },
      }));
      const bread = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa", en: "CLIENT-EN Bread" });

      const first = await buildSuggestionJob(tx, context, new Set());
      expect(
        parsed(first)
          .items.slice(0, 2)
          .map((item) => [item.ref, item.missing]),
      ).toEqual([
        [`product:${bread}`, ["es"]],
        [`product:${glass}`, []],
      ]);
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT, heads: 1, remaining: 1 });
      expect(Object.keys(first!.sent)).toHaveLength(JOB_ITEM_LIMIT - 1);

      const second = await buildSuggestionJob(tx, context, new Set(Object.keys(first!.sent)));
      expect(parsed(second).items[0]!.ref).toBe(`product:${glass}`);
      expect(second).toMatchObject({ included: 2, heads: 1, remaining: 0 });
    });
  });

  it("does not split a context head from its member at the item limit", async () => {
    await inVenue(async (tx, lunch) => {
      await manyProducts(tx, lunch, JOB_ITEM_LIMIT - 1, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: `CLIENT-CA Item ${index}`, en: `CLIENT-EN Item ${index}` },
      }));
      const glass = await product(tx, lunch, "Copa", all("Copa"));
      await variant(tx, lunch, glass, "Copa gran", {
        ca: "CLIENT-CA Copa gran",
        en: "CLIENT-EN Large glass",
      });
      const first = await buildSuggestionJob(tx, context, new Set());
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT - 1, heads: 0, remaining: 1 });
      expect(parsed(first).items.some((item) => item.ref === `product:${glass}`)).toBe(false);
    });
  });

  it("stops adding items at 1 MiB, counting every byte the body holds", async () => {
    await inVenue(async (tx, lunch) => {
      const wide = "é".repeat(TEXT_LIMIT);
      await manyProducts(tx, lunch, 800, (index) => ({
        name: `${"é".repeat(TEXT_LIMIT - 3)}${String(index).padStart(3, "0")}`,
        customerName: { es: wide, en: wide },
      }));
      const draft = (await buildSuggestionJob(tx, context, new Set()))!;
      const job = parsed(draft);
      expect(Buffer.byteLength(draft.body)).toBe(draft.bytes);
      expect(draft.bytes).toBeLessThanOrEqual(JOB_BYTE_LIMIT);
      expect(draft.included).toBeLessThan(800);
      expect(draft).toMatchObject({ heads: 0, remaining: 800 - draft.included });
      expect(Object.keys(draft.sent)).toHaveLength(draft.included);
      const [next] = await collectSuggestionItems(tx, context, new Set(Object.keys(draft.sent)));
      expect(draft.bytes + 1 + Buffer.byteLength(JSON.stringify(next))).toBeGreaterThan(
        JOB_BYTE_LIMIT,
      );
      for (const item of job.items) {
        expect(item.staffName.length).toBeLessThanOrEqual(TEXT_LIMIT);
        for (const text of Object.values(item.existing))
          expect(text.length).toBeLessThanOrEqual(TEXT_LIMIT);
      }
      expect(Buffer.byteLength(JSON.stringify(job.houseStyle))).toBeLessThanOrEqual(
        HOUSE_STYLE_BYTE_LIMIT,
      );
    });
  });

  it("keeps the house style to a quarter of the job, in the order it was chosen", async () => {
    await inVenue(async (tx, lunch) => {
      const wide = "ü".repeat(TEXT_LIMIT);
      await manyProducts(tx, lunch, HOUSE_STYLE_LIMIT, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: wide, es: wide, en: wide },
      }));
      await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const full = await readHouseStyle(tx, THREE.languages);
      const job = parsed(await buildSuggestionJob(tx, context, new Set()));
      const kept = job.houseStyle.length;
      expect(full).toHaveLength(HOUSE_STYLE_LIMIT);
      expect(kept).toBeGreaterThan(0);
      expect(job.houseStyle).toEqual(full.slice(0, kept));
      expect(Buffer.byteLength(JSON.stringify(job.houseStyle))).toBeLessThanOrEqual(
        HOUSE_STYLE_BYTE_LIMIT,
      );
      expect(Buffer.byteLength(JSON.stringify(full.slice(0, kept + 1)))).toBeGreaterThan(
        HOUSE_STYLE_BYTE_LIMIT,
      );
      expect(job.items).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-job.test.ts`
Expected: FAIL — every case; `readHouseStyle` and `buildSuggestionJob` are not exported yet, so each call fails with `TypeError: … is not a function`.

- [ ] **Step 3: Implement**

In `packages/catalogue/src/content-suggestion-collect.ts`, change the imports to:

```ts
import { categories, products, tenants, type Transaction } from "@waitron/db";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { HouseStyleExample, SuggestionItem } from "./content-suggestion-types.js";
```

(the other import lines stay), and add at the end of the file:

```ts
export const JOB_ITEM_LIMIT = 1000;
export const JOB_BYTE_LIMIT = 1_048_576;
export const HOUSE_STYLE_LIMIT = 300;
export const HOUSE_STYLE_BYTE_LIMIT = 262_144;

type HouseStyleRow = {
  kind: TranslationGapKind;
  id: string;
  staff_name: string;
  names: string;
  category: string | null;
};

/**
 * Saved customer-facing names of live items, one from each kind-and-category group in turn. Every
 * saved name was typed, or reviewed and saved, by a person, so they are the venue's house style.
 */
export async function readHouseStyle(
  tx: Transaction,
  languages: readonly string[],
  limit: number = HOUSE_STYLE_LIMIT,
): Promise<HouseStyleExample[]> {
  const result = await tx.execute<HouseStyleRow>(sql`
    select * from (
      select 'product' as kind, p.id, p.name as staff_name, p.customer_name as names,
          c.name as category
        from products p left join categories c on c.id = p.category_id
        where p.parent_id is null and p.active = 1
      union all select 'variant', v.id, v.name, v.customer_name, c.name
        from products v join products p on p.id = v.parent_id
          left join categories c on c.id = p.category_id
        where v.active = 1 and p.active = 1
      union all select 'option_list', id, name, customer_name, null
        from option_lists where active = 1
      union all select 'option_label', l.id, l.name, l.customer_name, null
        from option_labels l join option_lists o on o.id = l.list_id where o.active = 1
      union all select 'extra_list', id, name, customer_name, null
        from extra_lists where active = 1
      union all select 'menu', s.id, s.internal_name, s.names, null
        from sections s join menu_details d on d.root_section_id = s.id
          join catalogues c on c.id = s.owner_menu_id
        where s.role = 'menu_root' and c.active = 1
      union all select 'section', s.id, s.internal_name, s.names, null
        from sections s join catalogues c on c.id = s.owner_menu_id
        where s.role = 'section' and c.active = 1
    ) where names is not null and names <> '{}'
    order by kind, category, id`);
  const groups = new Map<string, HouseStyleExample[]>();
  for (const row of result.rows) {
    if (!fits(row.staff_name)) continue;
    const saved = JSON.parse(row.names) as Record<string, string>;
    const names = Object.fromEntries(
      languages
        .filter((language) => fits(saved[language] ?? ""))
        .map((language) => [language, saved[language]!]),
    );
    if (Object.keys(names).length === 0) continue;
    const key = `${row.kind}:${row.category ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push({ kind: row.kind, staffName: row.staff_name, names });
    groups.set(key, group);
  }
  const lists = [...groups.values()];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const spread: HouseStyleExample[] = [];
  for (let round = 0; round < longest; round += 1)
    for (const list of lists) if (round < list.length) spread.push(list[round]!);
  return spread.slice(0, limit);
}

function fitHouseStyle(examples: readonly HouseStyleExample[]): HouseStyleExample[] {
  const kept: HouseStyleExample[] = [];
  let bytes = 2;
  for (const example of examples) {
    const size = Buffer.byteLength(JSON.stringify(example)) + (kept.length === 0 ? 0 : 1);
    if (bytes + size > HOUSE_STYLE_BYTE_LIMIT) break;
    kept.push(example);
    bytes += size;
  }
  return kept;
}

/** The family heads the items name but do not include, as context entries keyed by ref. */
async function readContextHeads(
  tx: Transaction,
  context: TranslationContext,
  config: ContentLanguages,
  items: readonly SuggestionItem[],
): Promise<Map<string, SuggestionItem>> {
  const listed = new Set(items.map((item) => item.ref));
  const families = [...new Set(items.map((item) => item.family))].filter(
    (family) => !listed.has(family),
  );
  const live = await resolveLive(
    tx,
    config.defaultLanguage,
    families.map((family) => parseSuggestionRef(family)!),
    context,
  );
  const heads = await describeItems(
    tx,
    config,
    live.map((entry) => ({ entry, missing: [] })),
  );
  return new Map(heads.map((head) => [head.ref, head]));
}

export interface SuggestionJobDraft {
  body: string;
  sent: Record<string, string[]>;
  included: number;
  heads: number;
  remaining: number;
  bytes: number;
}

/** The next job of a run: what is missing, less `exclude`, inside Cloud's item and byte limits. */
export async function buildSuggestionJob(
  tx: Transaction,
  context: TranslationContext,
  exclude: ReadonlySet<string>,
): Promise<SuggestionJobDraft | null> {
  const items = await collectSuggestionItems(tx, context, exclude);
  if (items.length === 0) return null;
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  const [tenant] = await tx
    .select({ country: tenants.country })
    .from(tenants)
    .where(eq(tenants.id, 1));
  const heads = await readContextHeads(tx, context, config, items);
  const job = {
    version: 1,
    country: tenant!.country,
    languages: { default: config.defaultLanguage, enabled: config.languages },
    items: [] as SuggestionItem[],
    houseStyle: fitHouseStyle(await readHouseStyle(tx, config.languages)),
  };
  // The first item always fits: the house style takes at most a quarter of the job, and an item
  // with its head is two entries of at most 22 fields of 500 characters (staff name, category and
  // Cloud's 20 languages), under 140 KB even with every character escaped as six bytes.
  let bytes = Buffer.byteLength(JSON.stringify(job));
  const sent: Record<string, string[]> = {};
  const inJob = new Set<string>();
  let headCount = 0;
  let next = 0;
  for (; next < items.length; next += 1) {
    const item = items[next]!;
    const head = inJob.has(item.family) ? undefined : heads.get(item.family);
    const adding = head === undefined ? [item] : [head, item];
    const size =
      adding.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0) +
      adding.length -
      (job.items.length === 0 ? 1 : 0);
    if (job.items.length + adding.length > JOB_ITEM_LIMIT || bytes + size > JOB_BYTE_LIMIT) break;
    for (const entry of adding) {
      job.items.push(entry);
      inJob.add(entry.ref);
    }
    sent[item.ref] = item.missing;
    headCount += adding.length - 1;
    bytes += size;
  }
  return {
    body: JSON.stringify(job),
    sent,
    included: job.items.length,
    heads: headCount,
    remaining: items.length - next,
    bytes,
  };
}
```

`size` counts each entry's own bytes plus the comma before it; the first entry of the array has none, because `bytes` began with the empty `[]` already counted.

- [ ] **Step 4: Run the tests, both files' coverage, the read guards and the controls**

Run:
`pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-job.test.ts src/content-suggestion-collect.test.ts`
Expected: PASS. Read the `Tests` count: 13 in the new file, 15 in Task 6's.

`pnpm --filter @waitron/catalogue exec vitest run --coverage --coverage.include=src/content-suggestion-collect.ts src/content-suggestion-job.test.ts src/content-suggestion-collect.test.ts`
Expected: PASS, with `content-suggestion-collect.ts` at or above 98/98/98/95 in the per-file row.

`pnpm exec vitest run scripts/write-path-tables.test.ts scripts/module-seams.test.ts`
Expected: PASS (the module now reads `tenants`, a table request code may read and never write).

Controls, each undone afterwards. The failing output to look for is the named case in red; a green run means the control proved nothing:
1. Replace `heads.get(item.family)` with `undefined`. "sends a complete family head as context…" fails (the job starts with a variant, not the product).
2. In the limit check, replace `job.items.length + adding.length` with `Object.keys(sent).length + 1`, so heads stop counting. "counts a context head among the job's 1,000 items…" fails: the job holds 1,001 entries.
3. Replace `job.items.length + adding.length > JOB_ITEM_LIMIT` with `job.items.length + 1 > JOB_ITEM_LIMIT`. "does not split a context head from its member at the item limit" fails: the job holds 1,001 entries, the last two the Copa head and its variant.
4. Delete `+ adding.length - (job.items.length === 0 ? 1 : 0)` from `size`. "stops adding items at 1 MiB…" fails on `Buffer.byteLength(draft.body)` against `draft.bytes`.
5. Replace `fitHouseStyle(await readHouseStyle(tx, config.languages))` with `await readHouseStyle(tx, config.languages)`. "keeps the house style to a quarter of the job…" fails.
6. Replace the round-robin loop with `for (const list of lists) spread.push(...list);`. "spreads the house style across kinds and categories…" fails: the five CAT B products are not all chosen.
7. Delete `and p.active = 1` from the house style's variant branch. "leaves out a name Cloud would refuse…" fails, listing STAFF Vermut gran.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-suggestion-collect.ts packages/catalogue/src/content-suggestion-job.test.ts
git commit -s -m "Build a Translate all job: the house style, family heads as context, and Cloud's item and size limits"
```

---

### Task 8: Run and job records

**Files:**
- Create: `packages/catalogue/src/content-suggestion-jobs.ts`
- Create: `packages/catalogue/test/suggestion-fixture.ts` (shared by Tasks 8, 9 and 10; `test/**` is outside the package's coverage, `packages/catalogue/vitest.config.ts`)
- Modify: `packages/catalogue/src/content-suggestion-types.ts` (`SuggestionRunState`, `SuggestionRunView`)
- Modify: `packages/catalogue/src/index.ts`
- Test: `packages/catalogue/src/content-suggestion-jobs.test.ts`

**Interfaces:**
- Consumes: `contentSuggestionJobs`, `contentSuggestions`, `SUGGESTION_FAILURES`, `SUGGESTION_REFUSALS`, `SuggestionJobRow` (Task 5, `./schema/suggestions.js`); `buildSuggestionJob` and `SuggestionJobDraft` (Task 7, `./content-suggestion-collect.js`); the error code `content.suggestion_job_running` (Task 4, `errors.ts`); `TranslationContext` (`content-translation-targets.ts:14`).
- Produces:
  ```ts
  // content-suggestion-types.ts
  export type SuggestionRunState = "sending" | "running" | "done" | "partly_done" | "failed" | "expired" | "refused";
  export interface SuggestionRunView {
    state: SuggestionRunState; total: number; progress: number; done: number; failed: number;
    code: string | null; fits: number | null; waiting: number; finishedAt: string | null; opened: boolean;
  }
  // content-suggestion-jobs.ts
  export type SuggestionFailure = (typeof SUGGESTION_FAILURES)[number];
  export type SuggestionRefusal = (typeof SUGGESTION_REFUSALS)[number];
  export async function readActiveSuggestionJob(tx: Transaction): Promise<SuggestionJobRow | undefined>;
  export async function startSuggestionRun(tx: Transaction, context: TranslationContext, now?: Date): Promise<SuggestionRunView | null>;
  export async function recordSuggestionJobSubmitted(tx: Transaction, jobId: string, reply: { jobId: string; total: number }): Promise<void>;
  export async function recordSuggestionJobProgress(tx: Transaction, jobId: string, status: { done: number; failed: number }): Promise<void>;
  export async function recordSuggestionJobRefused(tx: Transaction, jobId: string, refusal: SuggestionRefusal, fits: number | null, now?: Date): Promise<void>;
  export async function recordSuggestionJobEnded(tx: Transaction, jobId: string, state: "failed" | "expired", failure: SuggestionFailure | null, now?: Date): Promise<void>;
  export async function recordSuggestionJobReleased(tx: Transaction, jobId: string): Promise<void>;
  export async function readSuggestionRun(tx: Transaction): Promise<SuggestionRunView | null>;
  export async function markSuggestionRunOpened(tx: Transaction, now?: Date): Promise<void>;
  export async function sentInRun(tx: Transaction, runId: string): Promise<Set<string>>;
  ```
- Test fixture (`packages/catalogue/test/suggestion-fixture.ts`): `context`, `suggestionSuite()`, `ref(productId)`, `addProduct(tx, menuId, label, customerName)`, `seedSuggestionVenue(db)`, `allJobs(tx)`, `sortedSent(sent)`, `startedJob(db, now?)`, `submitJob(db, job)`, `runningJob(db, now?)`.

Only one run is ever in the table: `startSuggestionRun` deletes every older job row before it inserts the new run's first job, so "the run" is every row of `content_suggestion_jobs`, ordered by `position`.

Rules, each with a test below:

1. **Active job** (`readActiveSuggestionJob`): the lowest position among jobs that are `submitting` or `running`, or `done`, `partly_done` or `failed` with a `cloud_job_id` and `released` false (the runner still has to release it).
2. **Starting** (`startSuggestionRun`): an active job refuses `content.suggestion_job_running`. Then `buildSuggestionJob(tx, context, new Set())`; null returns null and changes nothing (the last run stays readable). Otherwise every job row is deleted (suggestions keep their rows; the key sets their `job_id` null, Task 5) and position 1 is inserted as `submitting` with `body`, `sent`, a fresh `run_id`, `created_at = now` and `run_total = Object.keys(sent).length + remaining` (items with languages to write, never context heads). Returns `readSuggestionRun`.
3. **Recording**: submitted moves a `submitting` job to `running` with Cloud's job ID and `total`, and clears `body` (the submit's result is known; nothing will resend it). Progress writes Cloud's `done` and `failed` on a `running` job only. Refused moves a `submitting` job to `refused` with `refusal`, `fits`, `released` true, `body` null and `finished_at`. Ended writes `state`, `failure`, `body` null and `finished_at`, and sets `released` true when `state` is `expired`, when `failure` is `not_connected` or `rejected`, or when the job has no `cloud_job_id`; otherwise `released` stays false, so the runner releases a job Cloud failed. Released sets `released` true.
4. **Run view** (`readSuggestionRun`, null when there is no job): `state` is `sending` when the active job is `submitting`; `running` when the active job is `running`, `done` or `partly_done`; otherwise the last job's state when that is `refused`, `failed` or `expired`; otherwise `partly_done` when any job of the run is `partly_done` or has `failed > 0`, else `done`. `total` is the first job's `run_total`; `done` and `failed` are sums over the run's jobs; `progress = done + failed`; `waiting` counts `content_suggestions` rows with text; `finishedAt` is the last job's `finished_at` once the state is neither `sending` nor `running`, else null; `opened` is whether the first job's `opened_at` is set.
5. **Run view code** (the contract's "Waitron shows" column): refused `consent` → `content.suggestion_consent_required`, `limit` → `content.suggestion_limit_reached` with the job's `fits`, `job_running` → `content.suggestion_job_running`; failed `provider` → `content.suggestion_service_unavailable`, `consent` → `content.suggestion_consent_required`, `limit` → `content.suggestion_limit_reached` with `fits` 0, `not_connected` → `cloud.not_configured`, `rejected` → `cloud.request_invalid`; `partly_done` with any job's failure `limit` → `content.suggestion_limit_reached` with `fits` 0; `expired` → `content.suggestion_expired`; anything else null code and null fits.
6. **Opened** (`markSuggestionRunOpened`): sets the first job's `opened_at` to `now` only when the run has no active job and `opened_at` is still null.
7. **Sent in a run** (`sentInRun`): every key of every `sent` map of the run's jobs.

- [ ] **Step 1: Write the shared test fixture**

`packages/catalogue/test/suggestion-fixture.ts`:

```ts
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "../src/migrations.js";
import { createCatalogue, createProduct } from "../src/operations.js";
import { writeContentLanguages } from "../src/content-languages.js";
import {
  readActiveSuggestionJob,
  recordSuggestionJobSubmitted,
  startSuggestionRun,
} from "../src/content-suggestion-jobs.js";
import type { TranslationContext } from "../src/content-translation-targets.js";
import { contentSuggestionJobs, type SuggestionJobRow } from "../src/schema/suggestions.js";

export const context: TranslationContext = { fallbackLanguage: "ca", required: [] };

export function suggestionSuite() {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);
  return { suite, app };
}

export const ref = (productId: string): string => `product:${productId}`;

export async function addProduct(
  tx: Transaction,
  menuId: string,
  label: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const product = await createProduct(tx, {
    catalogueId: menuId,
    categoryId: null,
    unitId: null,
    name: `STAFF ${label}`,
    kitchenName: `KITCHEN ${label}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return product.id;
}

export interface SuggestionVenue {
  menuId: string;
  /** Named in ca only: missing es and en. */
  bread: string;
  /** No customer-facing name at all: missing ca, es and en. */
  wine: string;
  /** Named in ca and es: missing en. */
  cheese: string;
  /** Named in every language: never sent. */
  water: string;
}

/** A venue in ca (the default), es and en, whose menu is named in all three. */
export async function seedSuggestionVenue(db: Database): Promise<SuggestionVenue> {
  await seedTenant(db);
  return withTransaction(db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Carta",
      names: { ca: "CLIENT-CA Carta", es: "CLIENT-ES Carta", en: "CLIENT-EN Menu" },
    });
    const bread = await addProduct(tx, menu.id, "Bread", { ca: "CLIENT-CA Pa" });
    const wine = await addProduct(tx, menu.id, "Wine", null);
    const cheese = await addProduct(tx, menu.id, "Cheese", {
      ca: "CLIENT-CA Formatge",
      es: "CLIENT-ES Queso",
    });
    const water = await addProduct(tx, menu.id, "Water", {
      ca: "CLIENT-CA Aigua",
      es: "CLIENT-ES Agua",
      en: "CLIENT-EN Water",
    });
    return { menuId: menu.id, bread, wine, cheese, water };
  });
}

export async function allJobs(tx: Transaction): Promise<SuggestionJobRow[]> {
  return await tx.select().from(contentSuggestionJobs).orderBy(asc(contentSuggestionJobs.position));
}

export function sortedSent(sent: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(sent).map(([key, languages]) => [key, [...languages].sort()]),
  );
}

export async function startedJob(db: Database, now?: Date): Promise<SuggestionJobRow> {
  return withTransaction(db, async (tx) => {
    await startSuggestionRun(tx, context, now);
    return (await readActiveSuggestionJob(tx))!;
  });
}

export async function submitJob(db: Database, job: SuggestionJobRow): Promise<SuggestionJobRow> {
  return withTransaction(db, async (tx) => {
    await recordSuggestionJobSubmitted(tx, job.id, {
      jobId: randomUUID(),
      total: Object.keys(job.sent).length,
    });
    return (await allJobs(tx)).find((row) => row.id === job.id)!;
  });
}

export async function runningJob(db: Database, now?: Date): Promise<SuggestionJobRow> {
  return submitJob(db, await startedJob(db, now));
}
```

- [ ] **Step 2: Write the failing tests**

`packages/catalogue/src/content-suggestion-jobs.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { products } from "@waitron/db";
import {
  markSuggestionRunOpened,
  readActiveSuggestionJob,
  readSuggestionRun,
  recordSuggestionJobEnded,
  recordSuggestionJobProgress,
  recordSuggestionJobRefused,
  recordSuggestionJobReleased,
  recordSuggestionJobSubmitted,
  sentInRun,
  startSuggestionRun,
} from "./content-suggestion-jobs.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";
import {
  allJobs,
  context,
  ref,
  runningJob,
  seedSuggestionVenue,
  sortedSent,
  startedJob,
  suggestionSuite,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
const at = new Date("2026-10-14T09:00:00.000Z");
const later = new Date("2026-10-14T10:00:00.000Z");

it("has no run before the first Translate all", async () => {
  await seedSuggestionVenue(suite.db);
  expect(await app(readSuggestionRun)).toBeNull();
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it("starts a run as one submitting job holding the body and what it sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const view = await app((tx) => startSuggestionRun(tx, context, at));
  expect(view).toEqual({
    state: "sending",
    total: 3,
    progress: 0,
    done: 0,
    failed: 0,
    code: null,
    fits: null,
    waiting: 0,
    finishedAt: null,
    opened: false,
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    position: 1,
    state: "submitting",
    runTotal: 3,
    cloudJobId: null,
    released: false,
    createdAt: at.toISOString(),
    finishedAt: null,
  });
  expect(sortedSent(jobs[0]!.sent)).toEqual({
    [ref(venue.bread)]: ["en", "es"],
    [ref(venue.wine)]: ["ca", "en", "es"],
    [ref(venue.cheese)]: ["en"],
  });
  const body = JSON.parse(jobs[0]!.body!) as { version: number; items: { ref: string }[] };
  expect(body.version).toBe(1);
  expect(body.items.map((item) => item.ref).sort()).toEqual(
    [ref(venue.bread), ref(venue.wine), ref(venue.cheese)].sort(),
  );
  expect((await app(readActiveSuggestionJob))?.id).toBe(jobs[0]!.id);
});

it("refuses a second run while a job is active", async () => {
  await seedSuggestionVenue(suite.db);
  await startedJob(suite.db);
  await expect(app((tx) => startSuggestionRun(tx, context))).rejects.toMatchObject({
    code: "content.suggestion_job_running",
  });
  expect(await app(allJobs)).toHaveLength(1);
});

it("returns null and keeps the last run when nothing is missing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    await recordSuggestionJobEnded(tx, job.id, "failed", "rejected", at);
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Ple", es: "CLIENT-ES Lleno", en: "CLIENT-EN Full" } })
      .where(inArray(products.id, [venue.bread, venue.wine, venue.cheese]));
  });
  expect(await app((tx) => startSuggestionRun(tx, context))).toBeNull();
  expect((await app(allJobs)).map((row) => row.id)).toEqual([job.id]);
});

it("starting a run removes the last run's jobs and keeps its suggestions", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  await app(async (tx) => {
    await tx.insert(contentSuggestions).values([
      {
        jobId: first.id,
        kind: "product",
        itemId: venue.bread,
        language: "es",
        text: "CLIENT-ES Pan sugerido",
        expected: "{}",
      },
      {
        jobId: first.id,
        kind: "product",
        itemId: venue.bread,
        language: "ca",
        fixField: "ca",
        fixWrong: "Pa",
        fixRight: "Pà",
      },
    ]);
    await recordSuggestionJobEnded(tx, first.id, "failed", "rejected", at);
  });
  expect(await app((tx) => startSuggestionRun(tx, context, later))).toMatchObject({
    state: "sending",
    waiting: 1,
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.id).not.toBe(first.id);
  expect(jobs[0]!.runId).not.toBe(first.runId);
  expect(sortedSent(jobs[0]!.sent)[ref(venue.bread)]).toEqual(["en"]);
  const kept = await app((tx) => tx.select().from(contentSuggestions));
  expect(
    kept
      .map(({ language, text, jobId }) => ({ language, text, jobId }))
      .sort((a, b) => (a.language! < b.language! ? -1 : 1)),
  ).toEqual([
    { language: "ca", text: null, jobId: null },
    { language: "es", text: "CLIENT-ES Pan sugerido", jobId: null },
  ]);
});

it("records Cloud's job and progress, and clears the body once Cloud holds it", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  const cloudJobId = randomUUID();
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: cloudJobId, total: 3 }));
  expect((await app(allJobs))[0]).toMatchObject({
    state: "running",
    cloudJobId,
    total: 3,
    body: null,
  });
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", progress: 0 });
  await app((tx) => recordSuggestionJobProgress(tx, job.id, { done: 2, failed: 0 }));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "running",
    total: 3,
    done: 2,
    failed: 0,
    progress: 2,
  });
});

it("ignores progress for a job not running and a second submit reply", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  await app((tx) => recordSuggestionJobProgress(tx, job.id, { done: 2, failed: 1 }));
  expect((await app(allJobs))[0]).toMatchObject({ state: "submitting", done: 0, failed: 0 });
  const cloudJobId = randomUUID();
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: cloudJobId, total: 3 }));
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: randomUUID(), total: 9 }));
  expect((await app(allJobs))[0]).toMatchObject({ state: "running", cloudJobId, total: 3 });
});

it.each([
  ["consent", null, "content.suggestion_consent_required"],
  ["limit", 6, "content.suggestion_limit_reached"],
  ["job_running", null, "content.suggestion_job_running"],
] as const)("a run whose submit was refused with %s shows its code", async (refusal, fits, code) => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  await app((tx) => recordSuggestionJobRefused(tx, job.id, refusal, fits, at));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "refused",
    code,
    fits,
    finishedAt: at.toISOString(),
  });
  expect((await app(allJobs))[0]).toMatchObject({
    state: "refused",
    refusal,
    fits,
    released: true,
    body: null,
  });
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it.each([
  ["provider", "content.suggestion_service_unavailable", null, false],
  ["consent", "content.suggestion_consent_required", null, false],
  ["limit", "content.suggestion_limit_reached", 0, false],
  ["not_connected", "cloud.not_configured", null, true],
  ["rejected", "cloud.request_invalid", null, true],
] as const)(
  "a job Cloud held that failed with %s shows %s",
  async (failure, code, fits, released) => {
    await seedSuggestionVenue(suite.db);
    const job = await runningJob(suite.db);
    await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", failure, at));
    expect(await app(readSuggestionRun)).toMatchObject({
      state: "failed",
      code,
      fits,
      finishedAt: at.toISOString(),
    });
    expect((await app(allJobs))[0]).toMatchObject({ state: "failed", failure, released, body: null });
    expect((await app(readActiveSuggestionJob))?.id).toBe(released ? undefined : job.id);
  },
);

it("a job that ended before Cloud held it is released at once", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", "provider", at));
  expect((await app(allJobs))[0]).toMatchObject({ state: "failed", released: true, body: null });
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it("an expired job is released and its run shows content.suggestion_expired", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "expired", null, at));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "expired",
    code: "content.suggestion_expired",
    fits: null,
    finishedAt: at.toISOString(),
  });
  expect((await app(allJobs))[0]).toMatchObject({ released: true });
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

// Task 9's storeSuggestionResults writes these states; a direct update stands in for it here.
it.each([
  ["limit", "content.suggestion_limit_reached", 0],
  [null, null, null],
] as const)(
  "a partly done run with failure %s shows code %s and keeps its counts",
  async (failure, code, fits) => {
    await seedSuggestionVenue(suite.db);
    const job = await runningJob(suite.db);
    await app(async (tx) => {
      await tx
        .update(contentSuggestionJobs)
        .set({ state: "partly_done", failure, done: 2, failed: 1, finishedAt: at.toISOString() })
        .where(eq(contentSuggestionJobs.id, job.id));
      await recordSuggestionJobReleased(tx, job.id);
    });
    expect(await app(readSuggestionRun)).toEqual({
      state: "partly_done",
      total: 3,
      progress: 3,
      done: 2,
      failed: 1,
      code,
      fits,
      waiting: 0,
      finishedAt: at.toISOString(),
      opened: false,
    });
  },
);

it("a done run with items the box could not use shows partly done", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 2, failed: 1, released: true, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect(await app(readSuggestionRun)).toMatchObject({ state: "partly_done", code: null });
});

it("a done job not yet released still counts as active", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 3, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect((await app(readActiveSuggestionJob))?.id).toBe(job.id);
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", finishedAt: null });
  await expect(app((tx) => startSuggestionRun(tx, context))).rejects.toMatchObject({
    code: "content.suggestion_job_running",
  });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 3,
    progress: 3,
    finishedAt: at.toISOString(),
  });
});

it("the last job's refusal wins over an earlier job's success", async () => {
  await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  await app(async (tx) => {
    await tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 3, released: true, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, first.id));
    const [second] = await tx
      .insert(contentSuggestionJobs)
      .values({
        runId: first.runId,
        position: 2,
        state: "submitting",
        body: "{}",
        sent: { "product:later": ["es"] },
        runTotal: 4,
      })
      .returning();
    await recordSuggestionJobRefused(tx, second!.id, "limit", 0, later);
  });
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "refused",
    code: "content.suggestion_limit_reached",
    fits: 0,
    total: 3,
    done: 3,
    finishedAt: later.toISOString(),
  });
});

it("sums done and failed across a run's jobs, keeps the first job's total, and knows what the run sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  const other = randomUUID();
  await app(async (tx) => {
    await tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 2, failed: 1, runTotal: 5, released: true, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, first.id));
    await tx.insert(contentSuggestionJobs).values({
      runId: first.runId,
      position: 2,
      state: "running",
      cloudJobId: randomUUID(),
      sent: { [`product:${other}`]: ["es"], [`unit:${other}`]: ["en"] },
      runTotal: 9,
      done: 1,
      failed: 0,
    });
  });
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "running",
    total: 5,
    done: 3,
    failed: 1,
    progress: 4,
  });
  expect([...(await app((tx) => sentInRun(tx, first.runId)))].sort()).toEqual(
    [ref(venue.bread), ref(venue.wine), ref(venue.cheese), `product:${other}`, `unit:${other}`].sort(),
  );
  expect(await app((tx) => sentInRun(tx, randomUUID()))).toEqual(new Set());
});

it("opened is set once, and only after the run has finished", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => markSuggestionRunOpened(tx, at));
  expect(await app(readSuggestionRun)).toMatchObject({ opened: false });
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", "provider", at));
  await app((tx) => markSuggestionRunOpened(tx, at));
  expect(await app(readSuggestionRun)).toMatchObject({ state: "failed", opened: false });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  await app((tx) => markSuggestionRunOpened(tx, at));
  await app((tx) => markSuggestionRunOpened(tx, later));
  expect(await app(readSuggestionRun)).toMatchObject({ opened: true });
  expect((await app(allJobs))[0]!.openedAt).toBe(at.toISOString());
});
```

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-jobs.test.ts`
Expected: FAIL — `./content-suggestion-jobs.js` cannot be resolved (and the fixture's import of it with it). No `Tests` count passes.

- [ ] **Step 3: Add the run view types**

Append to `packages/catalogue/src/content-suggestion-types.ts`:

```ts
export type SuggestionRunState =
  | "sending"
  | "running"
  | "done"
  | "partly_done"
  | "failed"
  | "expired"
  | "refused";

export interface SuggestionRunView {
  state: SuggestionRunState;
  /** Items with languages to write across the run; context heads are never counted. */
  total: number;
  /** `done + failed`, summed over the run's jobs. */
  progress: number;
  done: number;
  failed: number;
  code: string | null;
  fits: number | null;
  /** Suggestions with text waiting in the table. */
  waiting: number;
  finishedAt: string | null;
  opened: boolean;
}
```

- [ ] **Step 4: Implement the records**

`packages/catalogue/src/content-suggestion-jobs.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { buildSuggestionJob } from "./content-suggestion-collect.js";
import type { SuggestionRunState, SuggestionRunView } from "./content-suggestion-types.js";
import type { TranslationContext } from "./content-translation-targets.js";
import {
  contentSuggestionJobs as jobs,
  contentSuggestions,
  type SUGGESTION_FAILURES,
  type SUGGESTION_REFUSALS,
  type SuggestionJobRow,
} from "./schema/suggestions.js";
import "./errors.js";

export type SuggestionFailure = (typeof SUGGESTION_FAILURES)[number];
export type SuggestionRefusal = (typeof SUGGESTION_REFUSALS)[number];

const REFUSAL_CODES: Record<SuggestionRefusal, string> = {
  consent: "content.suggestion_consent_required",
  limit: "content.suggestion_limit_reached",
  job_running: "content.suggestion_job_running",
};
const FAILURE_CODES: Record<SuggestionFailure, string> = {
  provider: "content.suggestion_service_unavailable",
  consent: "content.suggestion_consent_required",
  limit: "content.suggestion_limit_reached",
  not_connected: "cloud.not_configured",
  rejected: "cloud.request_invalid",
};

export async function readActiveSuggestionJob(
  tx: Transaction,
): Promise<SuggestionJobRow | undefined> {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(
      or(
        inArray(jobs.state, ["submitting", "running"]),
        and(
          inArray(jobs.state, ["done", "partly_done", "failed"]),
          isNotNull(jobs.cloudJobId),
          eq(jobs.released, false),
        ),
      ),
    )
    .orderBy(asc(jobs.position))
    .limit(1);
  return job;
}

export async function startSuggestionRun(
  tx: Transaction,
  context: TranslationContext,
  now: Date = new Date(),
): Promise<SuggestionRunView | null> {
  if (await readActiveSuggestionJob(tx)) throw new AppError("content.suggestion_job_running", {});
  const draft = await buildSuggestionJob(tx, context, new Set());
  if (!draft) return null;
  await tx.delete(jobs);
  await tx.insert(jobs).values({
    runId: randomUUID(),
    position: 1,
    state: "submitting",
    body: draft.body,
    sent: draft.sent,
    runTotal: Object.keys(draft.sent).length + draft.remaining,
    createdAt: now.toISOString(),
  });
  return readSuggestionRun(tx);
}

export async function recordSuggestionJobSubmitted(
  tx: Transaction,
  jobId: string,
  reply: { jobId: string; total: number },
): Promise<void> {
  await tx
    .update(jobs)
    .set({ state: "running", cloudJobId: reply.jobId, total: reply.total, body: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "submitting")));
}

export async function recordSuggestionJobProgress(
  tx: Transaction,
  jobId: string,
  status: { done: number; failed: number },
): Promise<void> {
  await tx
    .update(jobs)
    .set({ done: status.done, failed: status.failed })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "running")));
}

export async function recordSuggestionJobRefused(
  tx: Transaction,
  jobId: string,
  refusal: SuggestionRefusal,
  fits: number | null,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      state: "refused",
      refusal,
      fits,
      released: true,
      body: null,
      finishedAt: now.toISOString(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "submitting")));
}

export async function recordSuggestionJobEnded(
  tx: Transaction,
  jobId: string,
  state: "failed" | "expired",
  failure: SuggestionFailure | null,
  now: Date = new Date(),
): Promise<void> {
  // Cloud has already deleted an expired job, refused a rejected one, and cannot be reached for
  // one that is not connected (it deletes the job after 24 hours itself), so none is released.
  const nothingToRelease =
    state === "expired" || failure === "not_connected" || failure === "rejected";
  await tx
    .update(jobs)
    .set({
      state,
      failure,
      body: null,
      finishedAt: now.toISOString(),
      released: nothingToRelease ? true : sql<boolean>`${jobs.cloudJobId} is null`,
    })
    .where(eq(jobs.id, jobId));
}

export async function recordSuggestionJobReleased(tx: Transaction, jobId: string): Promise<void> {
  await tx.update(jobs).set({ released: true }).where(eq(jobs.id, jobId));
}

function outcome(
  state: SuggestionRunState,
  last: SuggestionJobRow,
  run: readonly SuggestionJobRow[],
): { code: string | null; fits: number | null } {
  if (state === "refused" && last.refusal !== null)
    return { code: REFUSAL_CODES[last.refusal], fits: last.refusal === "limit" ? last.fits : null };
  if (state === "failed" && last.failure !== null)
    return { code: FAILURE_CODES[last.failure], fits: last.failure === "limit" ? 0 : null };
  if (state === "partly_done" && run.some((job) => job.failure === "limit"))
    return { code: FAILURE_CODES.limit, fits: 0 };
  if (state === "expired") return { code: "content.suggestion_expired", fits: null };
  return { code: null, fits: null };
}

export async function readSuggestionRun(tx: Transaction): Promise<SuggestionRunView | null> {
  const run = await tx.select().from(jobs).orderBy(asc(jobs.position));
  const first = run[0];
  if (!first) return null;
  const last = run.at(-1)!;
  const active = await readActiveSuggestionJob(tx);
  const [counted] = await tx
    .select({ waiting: sql<number>`count(*)` })
    .from(contentSuggestions)
    .where(isNotNull(contentSuggestions.text));
  let state: SuggestionRunState;
  if (active?.state === "submitting") state = "sending";
  else if (active && active.state !== "failed") state = "running";
  else if (last.state === "refused" || last.state === "failed" || last.state === "expired")
    state = last.state;
  else
    state = run.some((job) => job.state === "partly_done" || job.failed > 0) ? "partly_done" : "done";
  const done = run.reduce((sum, job) => sum + job.done, 0);
  const failed = run.reduce((sum, job) => sum + job.failed, 0);
  return {
    state,
    total: first.runTotal,
    progress: done + failed,
    done,
    failed,
    ...outcome(state, last, run),
    waiting: Number(counted!.waiting),
    finishedAt: state === "sending" || state === "running" ? null : last.finishedAt,
    opened: first.openedAt !== null,
  };
}

export async function markSuggestionRunOpened(tx: Transaction, now: Date = new Date()): Promise<void> {
  if (await readActiveSuggestionJob(tx)) return;
  await tx
    .update(jobs)
    .set({ openedAt: now.toISOString() })
    .where(and(eq(jobs.position, 1), isNull(jobs.openedAt)));
}

export async function sentInRun(tx: Transaction, runId: string): Promise<Set<string>> {
  const rows = await tx.select({ sent: jobs.sent }).from(jobs).where(eq(jobs.runId, runId));
  return new Set(rows.flatMap((row) => Object.keys(row.sent)));
}
```

> **2026-10-15, as landed in A689's third PR.** The comment in `recordSuggestionJobEnded` above was
> cut: a job the box ends on its own 24-hour clock can still be held by Cloud. See the backlog
> entry "a job the box ends itself is marked released without a call to Cloud".

In `packages/catalogue/src/index.ts`, after the `content-suggestion-collect.js` export Task 6 added:

```ts
export * from "./content-suggestion-jobs.js";
```

(The types file is already exported, by Task 6.)

- [ ] **Step 5: Run the tests, then the control**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-jobs.test.ts`
Expected: PASS, `Tests` 24 passed (14 cases plus the `it.each` tables' 3, 5 and 2 rows).
Run: `pnpm --filter @waitron/catalogue typecheck`
Expected: exit 0.

Control: in `readActiveSuggestionJob`, delete the `and(...)` branch so only `submitting` and `running` count. Run the file again; "a done job not yet released still counts as active" and the `provider`, `consent` and `limit` rows of "a job Cloud held that failed" must FAIL (an unreleased job reads as finished). Restore and run again: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-suggestion-jobs.ts packages/catalogue/src/content-suggestion-jobs.test.ts packages/catalogue/test/suggestion-fixture.ts packages/catalogue/src/content-suggestion-types.ts packages/catalogue/src/index.ts
git commit -s -m "Record Translate all runs and their jobs, and summarise a run for the dialog"
```

---

### Task 9: Storing results and chaining the next job

**Files:**
- Create: `packages/catalogue/src/content-suggestion-store.ts`
- Modify: `packages/catalogue/test/suggestion-fixture.ts` (`result`, `translateAll`, `suggestionRows`, `inOrder`, `addPlainProducts`)
- Modify: `packages/catalogue/src/index.ts`
- Test: `packages/catalogue/src/content-suggestion-store.test.ts`

**Interfaces:**
- Consumes: `SuggestionResult`, `SuggestionResults` (Task 4, `content-suggestion-types.ts`); `contentSuggestionJobs`, `contentSuggestions` (Task 5); `isLiveTarget`, `suggestionRef`, `parseSuggestionRef` (Task 6) and `buildSuggestionJob` (Task 7), all from `./content-suggestion-collect.js`; `sentInRun`, `readSuggestionRun`, `recordSuggestionJobReleased`, `recordSuggestionJobSubmitted` (Task 8); `resolveTranslationTargets`, `ResolvedTranslationTarget`, `TranslationContext` (`content-translation-targets.ts:26-35,320`); `readContentLanguages` (`content-languages.ts:151`).
- Produces: `storeSuggestionResults(tx: Transaction, jobId: string, results: SuggestionResults, context: TranslationContext, now?: Date): Promise<void>` in `content-suggestion-store.ts`.

Rules, each with a test below. Everything happens in the caller's one transaction; nothing here calls Cloud.

1. Read the job; do nothing unless it is `running` (a retry after a crash finds it already `done` or `partly_done`).
2. **What the contract drops** (each counted in `dropped`): a result whose `ref` is not in `sent` (a context head is never in `sent`), is in Cloud's own `failed` list, or repeats an earlier result; a name for a language not in that ref's `sent` list, blank once trimmed, or over 4,096 bytes (the save route's own bound, `TRANSLATION_NAME_BYTES`, `packages/catalogue/src/content-translation-types.ts`, so a suggestion can always be saved); a correction whose `field` is neither `internal` nor an enabled language the item was not missing, whose `wrong` or `right` is blank, or whose `wrong` equals its `right`.
3. **What the box no longer wants** (also counted in `dropped`): everything for an item that is no longer there (`isLiveTarget` false — a deleted product is still "present" and eligible, `content-translation-targets.ts:235-237`); a name in a language the venue has since disabled; a name in a language the item now has text in (someone typed it during the job: `effectiveSelectedText` non-blank when resolved in that language); a correction to a language the item has no entered text in (that language may hold another suggestion waiting); a second fix for the same row.
4. **Rows**: each kept name replaces the row for that kind, id and language with `{ jobId, text: trimmed, expected: <the target's token in that language> }`. A placeholder and an `internal` fix share the item's own row (`language` null), replacing any earlier one; a fix to an entered name is a row for that language with `text` null. `content_suggestions_item_row_key` keeps the item's own row single, so every replacement deletes the old row first.
5. **Counts**: `dropped` counts one per thrown-away result, name, correction or placeholder. `failed` = sent refs Cloud listed as failed, sent refs that came back with nothing valid by the contract (no name, no correction, no placeholder), and sent refs that did not come back at all. A sent item whose output the box dropped only for its own reasons (rule 3) is done, not failed: Cloud did it, and the venue no longer needs it. `done = Object.keys(sent).length − failed`. The job takes `state` from `results.state`, `failure: "limit"` when `results.reason` is `limit_reached` (otherwise unchanged), `finished_at`, `failed_refs` (sorted), `failed`, `dropped`, `done`; `released` stays false for the runner.
6. **Chain**: `exclude = await sentInRun(tx, job.runId)`; `buildSuggestionJob(tx, context, exclude)`; a draft is inserted at `position + 1` as `submitting` with its `body`, `sent` and `created_at = now`. Then the first job's `run_total` becomes `exclude.size + (draft ? Object.keys(draft.sent).length + draft.remaining : 0)`, so a name someone filled meanwhile does not leave the count short.

- [ ] **Step 1: Add the fixture helpers**

Add to the imports of `packages/catalogue/test/suggestion-fixture.ts`:

```ts
import { products } from "@waitron/db";
import type { SuggestionResult } from "../src/content-suggestion-types.js";
import { contentSuggestions } from "../src/schema/suggestions.js";
```

(merge `contentSuggestions` into the existing `../src/schema/suggestions.js` import line and `products` into the `@waitron/db` one). Append:

```ts
export function result(
  ref: string,
  names: Record<string, string>,
  extra: Partial<Pick<SuggestionResult, "placeholder" | "corrections">> = {},
): SuggestionResult {
  return { ref, names, placeholder: false, corrections: [], ...extra };
}

/** A result naming every language the job asked for. */
export function translateAll(sent: Record<string, string[]>): SuggestionResult[] {
  return Object.entries(sent).map(([key, missing]) =>
    result(key, Object.fromEntries(missing.map((language) => [language, `${language.toUpperCase()} ${key}`]))),
  );
}

export function inOrder<T extends { itemId: string; language: string | null }>(rows: readonly T[]): T[] {
  const key = (row: T) => `${row.itemId} ${row.language ?? ""}`;
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export async function suggestionRows(tx: Transaction) {
  const rows = await tx.select().from(contentSuggestions);
  return inOrder(
    rows.map(({ itemId, language, text, placeholder, fixField, fixWrong, fixRight }) => ({
      itemId,
      language,
      text,
      placeholder,
      fix: fixField === null ? null : { field: fixField, wrong: fixWrong, right: fixRight },
    })),
  );
}

/** `count` products named in ca and es, so each is missing en; inserted directly for speed. */
export async function addPlainProducts(
  tx: Transaction,
  menuId: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < count; start += 100) {
    const rows = Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
      const n = start + offset;
      return {
        catalogueId: menuId,
        name: `STAFF Tapa ${n}`,
        kitchenName: `KITCHEN Tapa ${n}`,
        customerName: { ca: `CLIENT-CA Tapa ${n}`, es: `CLIENT-ES Tapa ${n}` },
      };
    });
    const inserted = await tx.insert(products).values(rows).returning({ id: products.id });
    ids.push(...inserted.map((row) => row.id));
  }
  return ids;
}
```

- [ ] **Step 2: Write the failing tests**

`packages/catalogue/src/content-suggestion-store.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@waitron/db";
import { deactivateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import { saveContentTranslations } from "./content-translations.js";
import { setProductVariants } from "./variants.js";
import { readSuggestionRun, recordSuggestionJobReleased } from "./content-suggestion-jobs.js";
import { storeSuggestionResults } from "./content-suggestion-store.js";
import type { SuggestionResults } from "./content-suggestion-types.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  addPlainProducts,
  addProduct,
  allJobs,
  context,
  inOrder,
  ref,
  result,
  runningJob,
  seedSuggestionVenue,
  sortedSent,
  startedJob,
  submitJob,
  suggestionRows,
  suggestionSuite,
  translateAll,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
const at = new Date("2026-10-14T09:00:00.000Z");
const store = (jobId: string, results: SuggestionResults) =>
  app((tx) => storeSuggestionResults(tx, jobId, results, context, at));
const done = (results: SuggestionResults["results"], failed: string[] = []): SuggestionResults => ({
  state: "done",
  results,
  failed,
});
const text = (itemId: string, language: string, value: string) => ({
  itemId,
  language,
  text: value,
  placeholder: false,
  fix: null,
});

it("stores each name with the token of the item it was made from", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "  CLIENT-ES Pan  ", en: "CLIENT-EN Bread" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino"),
      text(venue.wine, "en", "CLIENT-EN Wine"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  await app(async (tx) => {
    for (const row of await tx.select().from(contentSuggestions)) {
      const { targets } = await resolveTranslationTargets(
        tx,
        row.language!,
        [{ kind: row.kind, id: row.itemId }],
        context,
      );
      expect(row).toMatchObject({
        jobId: job.id,
        expected: targets[0]!.target.expected,
        createdAt: at.toISOString(),
      });
    }
  });
  expect((await app(allJobs))[0]).toMatchObject({
    state: "done",
    done: 3,
    failed: 0,
    dropped: 0,
    failedRefs: [],
    failure: null,
    released: false,
    finishedAt: at.toISOString(),
  });
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", waiting: 6 });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 3,
    progress: 3,
    done: 3,
    failed: 0,
    waiting: 6,
    finishedAt: at.toISOString(),
  });
  expect(await app(allJobs)).toHaveLength(1);
});

it("drops a result for an item it did not send and a name for a language that was not missing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result("product:unknown", { es: "CLIENT-ES Nada" }),
      result(ref(venue.bread), { ca: "CLIENT-CA Pa nou", es: "CLIENT-ES Pan" }),
      result(ref(venue.bread), { en: "CLIENT-EN Bread again" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "   ", en: "x".repeat(4097) }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 5, failed: 0, done: 3 });
  const [bread] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.bread)));
  expect(bread!.customerName).toEqual({ ca: "CLIENT-CA Pa" });
});

it("a name entered during the job is not overwritten or suggested", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    const { targets } = await resolveTranslationTargets(
      tx,
      "es",
      [{ kind: "product", id: venue.bread }],
      context,
    );
    await saveContentTranslations(
      tx,
      "es",
      {
        edits: [
          {
            kind: "product",
            id: venue.bread,
            expected: targets[0]!.target.expected,
            text: "CLIENT-ES Pan de la casa",
          },
        ],
      },
      context,
    );
  });
  await store(
    job.id,
    done(
      [result(ref(venue.bread), { es: "CLIENT-ES Pan sugerido", en: "CLIENT-EN Bread" })],
      [ref(venue.wine), ref(venue.cheese)],
    ),
  );
  expect((await app(suggestionRows)).filter((row) => row.itemId === venue.bread)).toEqual([
    text(venue.bread, "en", "CLIENT-EN Bread"),
  ]);
  const [bread] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.bread)));
  expect(bread!.customerName).toEqual({ ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan de la casa" });
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 1, done: 1, failed: 2 });
});

it("drops names in a language the venue disabled during the job, and counts the items done", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es"] }));
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 3, failed: 0, done: 3 });
});

it("drops everything for a product deleted during the job, and counts it done", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => deactivateProduct(tx, venue.wine));
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(
        ref(venue.wine),
        { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" },
        { corrections: [{ field: "internal", wrong: "Wine", right: "Vine" }] },
      ),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect((await app(suggestionRows)).map((row) => row.itemId)).not.toContain(venue.wine);
  expect(await app(suggestionRows)).toHaveLength(3);
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 4, failed: 0, done: 3 });
});

it("keeps a placeholder and an internal spelling fix on the item's own row, and a fix to an entered name on that language's row", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result(
        ref(venue.bread),
        { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" },
        {
          corrections: [
            { field: "internal", wrong: "Bread", right: "Bred" },
            { field: "ca", wrong: "Pa", right: "Pà" },
          ],
        },
      ),
      result(ref(venue.wine), {}, { placeholder: true }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      {
        itemId: venue.bread,
        language: "ca",
        text: null,
        placeholder: false,
        fix: { field: "ca", wrong: "Pa", right: "Pà" },
      },
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      { itemId: venue.wine, language: null, text: null, placeholder: true, fix: null },
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 0, failed: 0, done: 3 });
  expect(await app(readSuggestionRun)).toMatchObject({ waiting: 3 });
});

it("drops a fix to a missing or unentered language, a fix that changes nothing, and a second fix for one row", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) =>
    tx.insert(contentSuggestions).values({
      kind: "product",
      itemId: venue.wine,
      language: "es",
      text: "CLIENT-ES Vino esperando",
      expected: "{}",
    }),
  );
  const job = await runningJob(suite.db);
  expect(sortedSent(job.sent)[ref(venue.wine)]).toEqual(["ca", "en"]);
  await store(
    job.id,
    done([
      result(
        ref(venue.bread),
        { es: "CLIENT-ES Pan" },
        {
          corrections: [
            { field: "es", wrong: "Pan", right: "Pa" },
            { field: "fr", wrong: "Pain", right: "Pains" },
            { field: "internal", wrong: "Bread", right: "Bread" },
            { field: "internal", wrong: "Bread", right: "Bred" },
            { field: "internal", wrong: "STAFF", right: "STAF" },
          ],
        },
      ),
      result(
        ref(venue.wine),
        { ca: "CLIENT-CA Vi", en: "CLIENT-EN Wine" },
        { corrections: [{ field: "es", wrong: "Vino", right: "Vinos" }] },
      ),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino esperando"),
      text(venue.wine, "en", "CLIENT-EN Wine"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 5, failed: 0, done: 3 });
});

it("counts sent items with nothing usable, or not answered, as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, {
    state: "partly_done",
    reason: "provider_failed",
    results: [result(ref(venue.bread), { es: "   " })],
    failed: [ref(venue.wine), "product:unknown"],
  });
  const [stored] = await app(allJobs);
  expect(stored).toMatchObject({
    state: "partly_done",
    failure: null,
    done: 0,
    failed: 3,
    dropped: 1,
  });
  expect(stored!.failedRefs).toEqual([ref(venue.bread), ref(venue.wine), ref(venue.cheese)].sort());
  expect(await app(suggestionRows)).toEqual([]);
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "partly_done",
    code: null,
    fits: null,
    failed: 3,
    progress: 3,
  });
});

it("drops a name returned for a context head and does not count the head as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const { beer, pint } = await app(async (tx) => {
    const beer = await addProduct(tx, venue.menuId, "Beer", {
      ca: "CLIENT-CA Cervesa",
      es: "CLIENT-ES Cerveza",
      en: "CLIENT-EN Beer",
    });
    const [pint] = await setProductVariants(
      tx,
      beer,
      [
        {
          name: "STAFF Pint",
          kitchenName: "KITCHEN Pint",
          customerName: { ca: "CLIENT-CA Pinta" },
          unitPrice: "4.00",
          image: null,
          available: true,
        },
      ],
      "ca",
    );
    return { beer, pint: pint!.id };
  });
  const started = await startedJob(suite.db);
  const items = (JSON.parse(started.body!) as { items: { ref: string; missing: string[] }[] }).items;
  expect(items.find((item) => item.ref === ref(beer))).toMatchObject({ missing: [] });
  expect(started.sent).not.toHaveProperty(ref(beer));
  const job = await submitJob(suite.db, started);
  await store(
    job.id,
    done(
      [
        result(ref(beer), { es: "CLIENT-ES Cerveza nueva" }),
        result(`variant:${pint}`, { es: "CLIENT-ES Pinta", en: "CLIENT-EN Pint" }),
      ],
      [ref(venue.bread), ref(venue.wine), ref(venue.cheese)],
    ),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([text(pint, "es", "CLIENT-ES Pinta"), text(pint, "en", "CLIENT-EN Pint")]),
  );
  const [stored] = await app(allJobs);
  expect(stored).toMatchObject({ dropped: 1, failed: 3, done: 1 });
  expect(stored!.failedRefs).not.toContain(ref(beer));
});

it("records a cap-stopped partly done job's failure as limit", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, {
    state: "partly_done",
    reason: "limit_reached",
    results: [result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" })],
    failed: [ref(venue.wine), ref(venue.cheese)],
  });
  expect((await app(allJobs))[0]).toMatchObject({
    state: "partly_done",
    failure: "limit",
    done: 1,
    failed: 2,
  });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "partly_done",
    code: "content.suggestion_limit_reached",
    fits: 0,
  });
});

it("chains the next job of the run, never including an item the run already sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const olives = await app((tx) => addProduct(tx, venue.menuId, "Olives", { ca: "CLIENT-CA Olives" }));
  await store(job.id, {
    state: "partly_done",
    reason: "provider_failed",
    results: [
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ],
    failed: [ref(venue.wine)],
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  expect(jobs[1]).toMatchObject({
    runId: job.runId,
    position: 2,
    state: "submitting",
    cloudJobId: null,
    createdAt: at.toISOString(),
  });
  expect(sortedSent(jobs[1]!.sent)).toEqual({ [ref(olives)]: ["en", "es"] });
  expect(jobs[0]!.runTotal).toBe(4);
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", total: 4, progress: 3 });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "sending",
    total: 4,
    progress: 3,
    done: 2,
    failed: 1,
  });
});

it("brings progress to the run's total across a menu over 1,000 items", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) => addPlainProducts(tx, venue.menuId, 1000));
  const first = await runningJob(suite.db);
  expect(Object.keys(first.sent)).toHaveLength(1000);
  expect(first.runTotal).toBe(1003);
  await store(first.id, done(translateAll(first.sent)));
  let jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  expect(Object.keys(jobs[1]!.sent)).toHaveLength(3);
  expect(Object.keys(jobs[1]!.sent).some((key) => Object.hasOwn(first.sent, key))).toBe(false);
  expect(jobs[0]!.runTotal).toBe(1003);
  await app((tx) => recordSuggestionJobReleased(tx, first.id));
  const second = await submitJob(suite.db, jobs[1]!);
  await store(second.id, done(translateAll(second.sent)));
  jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  await app((tx) => recordSuggestionJobReleased(tx, second.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 1003,
    progress: 1003,
    done: 1003,
    failed: 0,
    waiting: 1006,
  });
}, 120_000);

it("a retried store after a crash, or a store for an unknown job, changes nothing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done(
      [result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" })],
      [ref(venue.wine), ref(venue.cheese)],
    ),
  );
  const before = { rows: await app(suggestionRows), jobs: await app(allJobs) };
  await store(job.id, done([result(ref(venue.wine), { ca: "CLIENT-CA Vi" })]));
  await store(randomUUID(), done([result(ref(venue.wine), { ca: "CLIENT-CA Vi" })]));
  expect({ rows: await app(suggestionRows), jobs: await app(allJobs) }).toEqual(before);
});
```

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts`
Expected: FAIL — `./content-suggestion-store.js` cannot be resolved.

- [ ] **Step 3: Implement storing**

`packages/catalogue/src/content-suggestion-store.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readContentLanguages } from "./content-languages.js";
import {
  buildSuggestionJob,
  isLiveTarget,
  parseSuggestionRef,
  suggestionRef,
} from "./content-suggestion-collect.js";
import { sentInRun } from "./content-suggestion-jobs.js";
import type { SuggestionResult, SuggestionResults } from "./content-suggestion-types.js";
import {
  resolveTranslationTargets,
  type ResolvedTranslationTarget,
  type TranslationContext,
} from "./content-translation-targets.js";
import type { TranslationRef } from "./content-translation-types.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";

type LiveTarget = Extract<ResolvedTranslationTarget, { state: "present" }>;
type Fix = SuggestionResult["corrections"][number];
interface PlannedRow {
  language: string | null;
  text: string | null;
  expected: string | null;
  placeholder: boolean;
  fix: Fix | null;
}

// The save route's own bound (`checkedBatch`, content-translations.ts), so a suggestion can be saved.
const NAME_BYTES = 4096;

async function resolveLive(
  tx: Transaction,
  language: string,
  refs: readonly TranslationRef[],
  context: TranslationContext,
): Promise<Map<string, LiveTarget>> {
  const live = new Map<string, LiveTarget>();
  for (let start = 0; start < refs.length; start += 100) {
    const { targets } = await resolveTranslationTargets(
      tx,
      language,
      refs.slice(start, start + 100),
      context,
    );
    for (const entry of targets) if (isLiveTarget(entry)) live.set(suggestionRef(entry.target), entry);
  }
  return live;
}

function emptyRow(language: string | null): PlannedRow {
  return { language, text: null, expected: null, placeholder: false, fix: null };
}

function validFix(fix: Fix, missing: readonly string[], languages: readonly string[]): boolean {
  return (
    (fix.field === "internal" || (languages.includes(fix.field) && !missing.includes(fix.field))) &&
    fix.wrong.trim() !== "" &&
    fix.right.trim() !== "" &&
    fix.wrong !== fix.right
  );
}

export async function storeSuggestionResults(
  tx: Transaction,
  jobId: string,
  results: SuggestionResults,
  context: TranslationContext,
  now: Date = new Date(),
): Promise<void> {
  const [job] = await tx
    .select()
    .from(contentSuggestionJobs)
    .where(eq(contentSuggestionJobs.id, jobId));
  if (!job || job.state !== "running") return;
  const { defaultLanguage, languages } = await readContentLanguages(tx, context.fallbackLanguage);
  const failed = new Set(results.failed.filter((key) => Object.hasOwn(job.sent, key)));
  const answered = new Map<string, { ref: TranslationRef; result: SuggestionResult }>();
  let dropped = 0;
  for (const result of results.results) {
    const ref = Object.hasOwn(job.sent, result.ref) ? parseSuggestionRef(result.ref) : null;
    if (!ref || failed.has(result.ref) || answered.has(result.ref)) dropped += 1;
    else answered.set(result.ref, { ref, result });
  }
  const current = await resolveLive(
    tx,
    defaultLanguage,
    [...answered.values()].map(({ ref }) => ref),
    context,
  );
  const planned = new Map<string, { ref: TranslationRef; rows: Map<string | null, PlannedRow> }>();
  const named = new Map<string, TranslationRef[]>();
  for (const [key, { ref, result }] of answered) {
    const missing = job.sent[key]!;
    const entry = current.get(key);
    const rows = new Map<string | null, PlannedRow>();
    let usable = result.placeholder;
    for (const [language, name] of Object.entries(result.names)) {
      const trimmed = name.trim();
      if (!missing.includes(language) || !trimmed || Buffer.byteLength(trimmed, "utf8") > NAME_BYTES) {
        dropped += 1;
        continue;
      }
      usable = true;
      if (!entry || !languages.includes(language)) {
        dropped += 1;
        continue;
      }
      rows.set(language, { ...emptyRow(language), text: trimmed });
      named.set(language, [...(named.get(language) ?? []), ref]);
    }
    const effective: Record<string, string> = entry
      ? { ...entry.inheritedNames, ...(entry.names ?? {}) }
      : {};
    for (const fix of result.corrections) {
      if (!validFix(fix, missing, languages)) {
        dropped += 1;
        continue;
      }
      usable = true;
      const language = fix.field === "internal" ? null : fix.field;
      const entered = language === null || (effective[language] ?? "").trim() !== "";
      if (!entry || !entered || rows.get(language)?.fix) {
        dropped += 1;
        continue;
      }
      rows.set(language, { ...(rows.get(language) ?? emptyRow(language)), fix });
    }
    if (result.placeholder) {
      if (entry) rows.set(null, { ...(rows.get(null) ?? emptyRow(null)), placeholder: true });
      else dropped += 1;
    }
    if (usable) planned.set(key, { ref, rows });
    else failed.add(key);
  }
  for (const [language, refs] of named) {
    // Liveness never reads the language (`content-translation-targets.ts:224-239`), so every ref
    // live above resolves live here.
    const targets = await resolveLive(tx, language, refs, context);
    for (const ref of refs) {
      const key = suggestionRef(ref);
      const target = targets.get(key)!.target;
      const rows = planned.get(key)!.rows;
      if ((target.effectiveSelectedText ?? "").trim()) {
        dropped += 1;
        rows.delete(language);
      } else rows.set(language, { ...rows.get(language)!, expected: target.expected });
    }
  }
  for (const { ref, rows } of planned.values())
    for (const row of rows.values()) {
      await tx
        .delete(contentSuggestions)
        .where(
          and(
            eq(contentSuggestions.kind, ref.kind),
            eq(contentSuggestions.itemId, ref.id),
            row.language === null
              ? isNull(contentSuggestions.language)
              : eq(contentSuggestions.language, row.language),
          ),
        );
      await tx.insert(contentSuggestions).values({
        jobId,
        kind: ref.kind,
        itemId: ref.id,
        language: row.language,
        text: row.text,
        expected: row.expected,
        placeholder: row.placeholder,
        fixField: row.fix?.field ?? null,
        fixWrong: row.fix?.wrong ?? null,
        fixRight: row.fix?.right ?? null,
        createdAt: now.toISOString(),
      });
    }
  for (const key of Object.keys(job.sent)) if (!answered.has(key)) failed.add(key);
  const failedRefs = [...failed].sort();
  await tx
    .update(contentSuggestionJobs)
    .set({
      state: results.state,
      ...(results.reason === "limit_reached" ? { failure: "limit" as const } : {}),
      finishedAt: now.toISOString(),
      failedRefs,
      failed: failedRefs.length,
      dropped,
      done: Object.keys(job.sent).length - failedRefs.length,
    })
    .where(eq(contentSuggestionJobs.id, jobId));
  const sent = await sentInRun(tx, job.runId);
  const next = await buildSuggestionJob(tx, context, sent);
  const runTotal = sent.size + (next ? Object.keys(next.sent).length + next.remaining : 0);
  if (next)
    await tx.insert(contentSuggestionJobs).values({
      runId: job.runId,
      position: job.position + 1,
      state: "submitting",
      body: next.body,
      sent: next.sent,
      runTotal,
      createdAt: now.toISOString(),
    });
  await tx
    .update(contentSuggestionJobs)
    .set({ runTotal })
    .where(and(eq(contentSuggestionJobs.runId, job.runId), eq(contentSuggestionJobs.position, 1)));
}
```

In `packages/catalogue/src/index.ts`, below the `content-suggestion-jobs.js` line:

```ts
export * from "./content-suggestion-store.js";
```

- [ ] **Step 4: Run the tests, then the controls**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts src/content-suggestion-jobs.test.ts`
Expected: PASS, `Tests` 37 passed (13 here, 24 from Task 8).
Run: `pnpm --filter @waitron/catalogue typecheck`
Expected: exit 0.

Controls, each restored before the next:
1. Review Focus 2: delete the `if ((target.effectiveSelectedText ?? "").trim()) { … }` branch so every name keeps its token. "a name entered during the job is not overwritten or suggested" must FAIL (an `es` row appears beside the typed name).
2. A deleted product: in `resolveLive`, replace `isLiveTarget(entry)` with `entry.state === "present" && entry.target.eligible`. "drops everything for a product deleted during the job" must FAIL (rows for the deleted wine appear), because a deleted product resolves eligible (`content-translation-targets.ts:235-237`).
3. The total: delete the final `update(...).set({ runTotal })`. "chains the next job of the run" must FAIL (`runTotal` stays 3, not 4).

Run the file once more after restoring: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-suggestion-store.ts packages/catalogue/src/content-suggestion-store.test.ts packages/catalogue/test/suggestion-fixture.ts packages/catalogue/src/index.ts
git commit -s -m "Store Translate all results as suggestions and send the rest of a big menu as the next job"
```

---

### Task 10: Listing, discarding, pruning, and deleting on save

**Files:**
- Modify: `packages/catalogue/src/content-suggestion-store.ts` (`listContentSuggestions`, `discardContentSuggestion`, `deleteSavedSuggestions`, `suggestionStale`)
- Modify: `packages/catalogue/src/content-suggestion-collect.ts` (`pruneSuggestions`, beside the `readSuggestionGaps` it reads; kept out of the store module so `content-suggestion-jobs.ts`, which calls it, and `content-suggestion-store.ts`, which imports from the jobs module, do not import each other)
- Modify: `packages/catalogue/src/content-suggestion-jobs.ts` (`startSuggestionRun` prunes first)
- Modify: `packages/catalogue/src/content-translations.ts` (`saveContentTranslations` deletes the saved names' suggestions, `:318-320`)
- Modify: `packages/catalogue/src/content-suggestion-types.ts` (`ContentSuggestionView`, `ContentSuggestionPage`, `ContentSuggestionRead`)
- Test: `packages/catalogue/src/content-suggestion-list.test.ts`

**Interfaces:**
- Consumes: `readSuggestionGaps`, `suggestionRef` (Task 6); `storeSuggestionResults` and the file's private `resolveLive` (Task 9); `readSuggestionRun`, `recordSuggestionJobReleased`, `startSuggestionRun` (Task 8); `TranslationEdit` (`content-translation-types.ts:47`); the code `content.suggestion_not_found { suggestionId }` (Task 4) and the existing `content.languages_invalid` (`errors.ts:41`).
- Produces:
  ```ts
  // content-suggestion-types.ts
  export interface ContentSuggestionView {
    id: string; kind: TranslationGapKind; itemId: string; language: string | null; text: string | null;
    placeholder: boolean; fix: { field: string; wrong: string; right: string } | null; stale: boolean;
  }
  export interface ContentSuggestionPage {
    language: string; run: SuggestionRunView | null; suggestions: ContentSuggestionView[]; next: string | null;
  }
  export interface ContentSuggestionRead extends ContentSuggestionPage {
    service: "on" | "off" | "not_connected"; cloudOrigin: string | null;
  }
  // content-suggestion-store.ts
  export async function listContentSuggestions(tx: Transaction, language: string, query: { after?: string }, context: TranslationContext): Promise<ContentSuggestionPage>;
  export async function discardContentSuggestion(tx: Transaction, id: string): Promise<void>;
  export async function deleteSavedSuggestions(tx: Transaction, language: string, defaultLanguage: string, edits: readonly Pick<TranslationEdit, "kind" | "id" | "defaultText">[]): Promise<void>;
  export function suggestionStale(stored: string, current: string): boolean;
  // content-suggestion-collect.ts
  export async function pruneSuggestions(tx: Transaction, context: TranslationContext): Promise<void>;
  ```
  (`deleteSavedSuggestions` takes `TranslationEdit`'s `kind`, a `TranslationGapKind`, rather than a plain string, because drizzle's `eq` on the `kind` column takes the column's own union.)

Rules, each with a test below:

1. **Listing** (`listContentSuggestions`): refuse `content.languages_invalid` for a language the venue has not enabled. Read 100 rows a page, by id after the cursor: rows in the page language, rows in the default language, rows with `language` null, and every row with `text` null (fixes to entered names). A row whose item is no longer there (`isLiveTarget`, through `resolveLive`) is left out of the page; the next run start deletes it. `next` is the last row's id when 100 rows were read, else null. `run` is `readSuggestionRun`.
2. **Out of date** (Decision 4): a row with text is `stale` when `suggestionStale(row.expected, <the item's current token in that language>)`. `suggestionStale` parses both tokens and compares only `ref`, `language`, `owners`, `selectedText`, `effectiveSelectedText` and `inheritedSelectedText`; a token that does not parse as an object is stale. The token also carries the venue's language list (`content-translation-targets.ts:200`), so comparing whole tokens would mark every suggestion out of date the moment someone enables a language. A row without text is never stale.
3. **Discarding** (`discardContentSuggestion`): delete by id; nothing deleted → `content.suggestion_not_found { suggestionId }`.
4. **Deleting on save** (`deleteSavedSuggestions`): at the end of `saveContentTranslations`, after the writers (and on the retried path, which writes nothing), in the caller's transaction, delete each edit's row for the page language, and, for an edit carrying `defaultText`, its row for the default language.
5. **Pruning** (`pruneSuggestions`, at the start of `startSuggestionRun`, after the refusal and before the job is built): read `readSuggestionGaps(tx, context)` (live items only, before the waiting-suggestion filter). Delete every row of an item with no gap, and every row with text whose language that item is no longer missing.

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/content-suggestion-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { products } from "@waitron/db";
import { deactivateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import type { TranslationBatch } from "./content-translation-types.js";
import { saveContentTranslations } from "./content-translations.js";
import { recordSuggestionJobReleased, startSuggestionRun } from "./content-suggestion-jobs.js";
import {
  discardContentSuggestion,
  listContentSuggestions,
  storeSuggestionResults,
  suggestionStale,
} from "./content-suggestion-store.js";
import type { ContentSuggestionView } from "./content-suggestion-types.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  addPlainProducts,
  context,
  inOrder,
  ref,
  result,
  runningJob,
  seedSuggestionVenue,
  suggestionRows,
  suggestionSuite,
  type SuggestionVenue,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();

/** One finished, released job that wrote every missing name, an internal fix for Bread and a fix
 * to Cheese's entered Catalan name. */
async function storedVenue(): Promise<SuggestionVenue> {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    await storeSuggestionResults(
      tx,
      job.id,
      {
        state: "done",
        failed: [],
        results: [
          result(
            ref(venue.bread),
            { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" },
            { corrections: [{ field: "internal", wrong: "Bread", right: "Bred" }] },
          ),
          result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" }),
          result(
            ref(venue.cheese),
            { en: "CLIENT-EN Cheese" },
            { corrections: [{ field: "ca", wrong: "Formatge", right: "Formatges" }] },
          ),
        ],
      },
      context,
    );
    await recordSuggestionJobReleased(tx, job.id);
  });
  return venue;
}
const page = (language: string, after?: string) =>
  app((tx) => listContentSuggestions(tx, language, after === undefined ? {} : { after }, context));
const summary = (views: readonly ContentSuggestionView[]) =>
  inOrder(
    views.map(({ itemId, language, text, placeholder, fix, stale }) => ({
      itemId,
      language,
      text,
      placeholder,
      fix,
      stale,
    })),
  );
const named = (itemId: string, language: string, text: string) => ({
  itemId,
  language,
  text,
  placeholder: false,
  fix: null,
  stale: false,
});

it("lists the page language, the default language and the item rows", async () => {
  const venue = await storedVenue();
  const listed = await page("es");
  expect(listed.language).toBe("es");
  expect(listed.next).toBeNull();
  expect(listed.run).toMatchObject({ state: "done", waiting: 6 });
  expect(listed.suggestions.every((view) => view.kind === "product")).toBe(true);
  expect(summary(listed.suggestions)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
        stale: false,
      },
      named(venue.bread, "es", "CLIENT-ES Pan"),
      named(venue.wine, "ca", "CLIENT-CA Vi"),
      named(venue.wine, "es", "CLIENT-ES Vino"),
      {
        itemId: venue.cheese,
        language: "ca",
        text: null,
        placeholder: false,
        fix: { field: "ca", wrong: "Formatge", right: "Formatges" },
        stale: false,
      },
    ]),
  );
  expect((await page("ca")).suggestions.map((view) => view.language).sort()).toEqual([
    "ca",
    "ca",
    null,
  ]);
});

it("lists 100 suggestions a page, by id", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const ids = await app(async (tx) => {
    const created = await addPlainProducts(tx, venue.menuId, 120);
    await tx.insert(contentSuggestions).values(
      created.map((itemId) => ({
        kind: "product" as const,
        itemId,
        language: "en",
        text: "CLIENT-EN Tapa",
        expected: "{}",
      })),
    );
    return created;
  });
  const first = await page("en");
  expect(first.suggestions).toHaveLength(100);
  expect(first.next).toBe(first.suggestions.at(-1)!.id);
  const second = await page("en", first.next!);
  expect(second.suggestions).toHaveLength(20);
  expect(second.next).toBeNull();
  expect([...first.suggestions, ...second.suggestions].map((view) => view.itemId).sort()).toEqual(
    [...ids].sort(),
  );
});

it("refuses a language the venue has not enabled with content.languages_invalid", async () => {
  await seedSuggestionVenue(suite.db);
  await expect(page("fr")).rejects.toMatchObject({ code: "content.languages_invalid" });
});

it("a language added after the job leaves the suggestions current", async () => {
  const venue = await storedVenue();
  await app((tx) =>
    writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en", "fr"] }),
  );
  const [stored] = await app((tx) =>
    tx
      .select()
      .from(contentSuggestions)
      .where(and(eq(contentSuggestions.itemId, venue.bread), eq(contentSuggestions.language, "es"))),
  );
  const { targets } = await app((tx) =>
    resolveTranslationTargets(tx, "es", [{ kind: "product", id: venue.bread }], context),
  );
  expect(stored!.expected).not.toBe(targets[0]!.target.expected);
  const { suggestions } = await page("es");
  expect(suggestions.find((view) => view.itemId === venue.bread && view.language === "es")).toMatchObject({
    text: "CLIENT-ES Pan",
    stale: false,
  });
  expect(suggestions.filter((view) => view.text !== null).every((view) => !view.stale)).toBe(true);
});

it("marks a suggestion stale once that item's text in that language changes, and only then", async () => {
  const venue = await storedVenue();
  await app((tx) =>
    tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", en: "CLIENT-EN Bread typed" } })
      .where(eq(products.id, venue.bread)),
  );
  const english = (await page("en")).suggestions;
  expect(english.find((view) => view.itemId === venue.bread && view.language === "en")).toMatchObject({
    stale: true,
  });
  const spanish = (await page("es")).suggestions;
  expect(spanish.find((view) => view.itemId === venue.bread && view.language === "es")).toMatchObject({
    stale: false,
  });
});

it("a suggestion for a deleted product is neither listed nor kept by the next run", async () => {
  const venue = await storedVenue();
  await app((tx) => deactivateProduct(tx, venue.wine));
  const listed = (await page("es")).suggestions.map((view) => view.itemId);
  expect(listed).not.toContain(venue.wine);
  expect(listed).toContain(venue.bread);
  await app((tx) => startSuggestionRun(tx, context));
  const rows = await app(suggestionRows);
  expect(rows.map((row) => row.itemId)).not.toContain(venue.wine);
  expect(rows.filter((row) => row.itemId === venue.bread)).toHaveLength(3);
});

it("starting a run prunes suggestions for names that were filled elsewhere", async () => {
  const venue = await storedVenue();
  await app(async (tx) => {
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan del editor" } })
      .where(eq(products.id, venue.bread));
    await tx
      .update(products)
      .set({
        customerName: {
          ca: "CLIENT-CA Formatge",
          es: "CLIENT-ES Queso",
          en: "CLIENT-EN Cheese typed",
        },
      })
      .where(eq(products.id, venue.cheese));
  });
  await app((tx) => startSuggestionRun(tx, context));
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      { itemId: venue.bread, language: "en", text: "CLIENT-EN Bread", placeholder: false, fix: null },
      { itemId: venue.wine, language: "ca", text: "CLIENT-CA Vi", placeholder: false, fix: null },
      { itemId: venue.wine, language: "es", text: "CLIENT-ES Vino", placeholder: false, fix: null },
      { itemId: venue.wine, language: "en", text: "CLIENT-EN Wine", placeholder: false, fix: null },
    ]),
  );
});

it("discarding a suggestion deletes it, and discarding it again is content.suggestion_not_found", async () => {
  const venue = await storedVenue();
  const [row] = await app((tx) =>
    tx
      .select()
      .from(contentSuggestions)
      .where(and(eq(contentSuggestions.itemId, venue.bread), eq(contentSuggestions.language, "es"))),
  );
  await app((tx) => discardContentSuggestion(tx, row!.id));
  expect(
    (await app(suggestionRows)).filter((r) => r.itemId === venue.bread).map((r) => r.language),
  ).toEqual([null, "en"]);
  await expect(app((tx) => discardContentSuggestion(tx, row!.id))).rejects.toMatchObject({
    code: "content.suggestion_not_found",
    params: { suggestionId: row!.id },
  });
});

describe("saving a name", () => {
  async function saveWine(id: string): Promise<TranslationBatch> {
    return app(async (tx) => {
      const { targets } = await resolveTranslationTargets(tx, "es", [{ kind: "product", id }], context);
      return {
        edits: [
          {
            kind: "product",
            id,
            expected: targets[0]!.target.expected,
            text: "CLIENT-ES Vino de la casa",
            defaultText: "CLIENT-CA Vi de la casa",
          },
        ],
      };
    });
  }
  const wineLanguages = async (venue: SuggestionVenue) =>
    (await app(suggestionRows)).filter((row) => row.itemId === venue.wine).map((row) => row.language);

  it("deletes its suggestion and its default companion's", async () => {
    const venue = await storedVenue();
    const request = await saveWine(venue.wine);
    await app((tx) => saveContentTranslations(tx, "es", request, context));
    expect(await wineLanguages(venue)).toEqual(["en"]);
  });

  it("puts both suggestions back when the transaction around the save fails after it", async () => {
    const venue = await storedVenue();
    const request = await saveWine(venue.wine);
    await expect(
      app(async (tx) => {
        await saveContentTranslations(tx, "es", request, context);
        expect((await suggestionRows(tx)).filter((row) => row.itemId === venue.wine)).toHaveLength(1);
        throw new Error("refused after the save");
      }),
    ).rejects.toThrow("refused after the save");
    expect(await wineLanguages(venue)).toEqual(["ca", "en", "es"]);
    const [wine] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.wine)));
    expect(wine!.customerName).toBeNull();
  });
});

describe("suggestionStale", () => {
  const token = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      ref: { kind: "product", id: "p1" },
      language: "es",
      inheritedSelectedText: null,
      inheritedDefaultText: null,
      owners: { kind: "product", parentId: null },
      selectedText: null,
      defaultText: "CLIENT-CA Pa",
      effectiveSelectedText: null,
      effectiveDefaultText: "CLIENT-CA Pa",
      config: { defaultLanguage: "ca", languages: ["ca", "es"] },
      required: [],
      ...fields,
    });

  it("ignores the language list, the required languages and the default language's text", () => {
    expect(
      suggestionStale(
        token(),
        token({
          config: { defaultLanguage: "ca", languages: ["ca", "en", "es"] },
          required: ["ca"],
          defaultText: "CLIENT-CA Pa nou",
          effectiveDefaultText: "CLIENT-CA Pa nou",
        }),
      ),
    ).toBe(false);
  });
  it.each(["selectedText", "effectiveSelectedText", "inheritedSelectedText"])(
    "is stale once %s changes",
    (key) => {
      expect(suggestionStale(token(), token({ [key]: "CLIENT-ES Pan" }))).toBe(true);
    },
  );
  it("is stale once the owner, the item or the language changes", () => {
    expect(suggestionStale(token(), token({ owners: { kind: "variant", parentId: "p0" } }))).toBe(true);
    expect(suggestionStale(token(), token({ ref: { kind: "product", id: "p2" } }))).toBe(true);
    expect(suggestionStale(token(), token({ language: "en" }))).toBe(true);
  });
  it.each(["", "not json", "null", "[]", "3"])(
    "treats a token that is not an object (%j) as stale",
    (bad) => {
      expect(suggestionStale(bad, token())).toBe(true);
      expect(suggestionStale(token(), bad)).toBe(true);
    },
  );
});
```

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-list.test.ts`
Expected: FAIL — `listContentSuggestions`, `discardContentSuggestion` and `suggestionStale` are not exported from `./content-suggestion-store.js`.

- [ ] **Step 2: Add the view types**

Append to `packages/catalogue/src/content-suggestion-types.ts` (`TranslationGapKind` is already imported there for Task 6's `SuggestionItem`):

```ts
export interface ContentSuggestionView {
  id: string;
  kind: TranslationGapKind;
  itemId: string;
  language: string | null;
  text: string | null;
  placeholder: boolean;
  fix: { field: string; wrong: string; right: string } | null;
  stale: boolean;
}

export interface ContentSuggestionPage {
  language: string;
  run: SuggestionRunView | null;
  suggestions: ContentSuggestionView[];
  next: string | null;
}

/** The GET route's reply; Task 12 fills the two fields the catalogue cannot know. */
export interface ContentSuggestionRead extends ContentSuggestionPage {
  service: "on" | "off" | "not_connected";
  cloudOrigin: string | null;
}
```

- [ ] **Step 3: Implement listing, discarding, staleness and deleting on save**

In `packages/catalogue/src/content-suggestion-store.ts`, change the drizzle import and add these imports:

```ts
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { readSuggestionRun, sentInRun } from "./content-suggestion-jobs.js";
import type {
  ContentSuggestionPage,
  ContentSuggestionView,
  SuggestionResult,
  SuggestionResults,
} from "./content-suggestion-types.js";
import type { TranslationEdit, TranslationRef } from "./content-translation-types.js";
import "./errors.js";
```

(replacing the existing `sentInRun`, `content-suggestion-types.js` and `content-translation-types.js` import lines). Append:

```ts
const SUGGESTION_PAGE = 100;
const COMPARED = [
  "ref",
  "language",
  "owners",
  "selectedText",
  "effectiveSelectedText",
  "inheritedSelectedText",
] as const;

function readToken(token: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(token);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function suggestionStale(stored: string, current: string): boolean {
  const before = readToken(stored);
  const after = readToken(current);
  if (!before || !after) return true;
  return COMPARED.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export async function listContentSuggestions(
  tx: Transaction,
  language: string,
  query: { after?: string },
  context: TranslationContext,
): Promise<ContentSuggestionPage> {
  const config = await readContentLanguages(tx, context.fallbackLanguage);
  if (!config.languages.includes(language)) throw new AppError("content.languages_invalid", {});
  const shown = or(
    inArray(contentSuggestions.language, [...new Set([language, config.defaultLanguage])]),
    isNull(contentSuggestions.language),
    isNull(contentSuggestions.text),
  );
  const rows = await tx
    .select()
    .from(contentSuggestions)
    .where(query.after === undefined ? shown : and(shown, gt(contentSuggestions.id, query.after)))
    .orderBy(asc(contentSuggestions.id))
    .limit(SUGGESTION_PAGE);
  const keyOf = (row: (typeof rows)[number]) => suggestionRef({ kind: row.kind, id: row.itemId });
  const refs = new Map<string, TranslationRef>();
  for (const row of rows) refs.set(keyOf(row), { kind: row.kind, id: row.itemId });
  const live = await resolveLive(tx, config.defaultLanguage, [...refs.values()], context);
  const byLanguage = new Map<string, TranslationRef[]>();
  for (const row of rows)
    if (row.text !== null && row.language !== null && live.has(keyOf(row)))
      byLanguage.set(row.language, [
        ...(byLanguage.get(row.language) ?? []),
        { kind: row.kind, id: row.itemId },
      ]);
  const tokens = new Map<string, string>();
  for (const [textLanguage, languageRefs] of byLanguage)
    for (const [key, entry] of await resolveLive(tx, textLanguage, languageRefs, context))
      tokens.set(`${textLanguage} ${key}`, entry.target.expected);
  const suggestions: ContentSuggestionView[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (!live.has(key)) continue;
    suggestions.push({
      id: row.id,
      kind: row.kind,
      itemId: row.itemId,
      language: row.language,
      text: row.text,
      placeholder: row.placeholder,
      fix:
        row.fixField === null
          ? null
          : { field: row.fixField, wrong: row.fixWrong ?? "", right: row.fixRight ?? "" },
      stale:
        row.text !== null &&
        suggestionStale(row.expected ?? "", tokens.get(`${row.language} ${key}`) ?? ""),
    });
  }
  return {
    language,
    run: await readSuggestionRun(tx),
    suggestions,
    next: rows.length === SUGGESTION_PAGE ? rows.at(-1)!.id : null,
  };
}

export async function discardContentSuggestion(tx: Transaction, id: string): Promise<void> {
  const deleted = await tx
    .delete(contentSuggestions)
    .where(eq(contentSuggestions.id, id))
    .returning({ id: contentSuggestions.id });
  if (deleted.length === 0) throw new AppError("content.suggestion_not_found", { suggestionId: id });
}

export async function deleteSavedSuggestions(
  tx: Transaction,
  language: string,
  defaultLanguage: string,
  edits: readonly Pick<TranslationEdit, "kind" | "id" | "defaultText">[],
): Promise<void> {
  for (const edit of edits)
    await tx
      .delete(contentSuggestions)
      .where(
        and(
          eq(contentSuggestions.kind, edit.kind),
          eq(contentSuggestions.itemId, edit.id),
          inArray(
            contentSuggestions.language,
            edit.defaultText === undefined ? [language] : [language, defaultLanguage],
          ),
        ),
      );
}
```

In `packages/catalogue/src/content-translations.ts`, add the import:

```ts
import { deleteSavedSuggestions } from "./content-suggestion-store.js";
```

and change the end of `saveContentTranslations` (`:318-320`) to:

```ts
  if (!retried)
    for (const entry of proposed) await writers[entry.target.kind](tx, entry, entry.names!);
  await deleteSavedSuggestions(tx, language, resolution.config.defaultLanguage, edits);
  return { saved: proposed.map((entry) => entry.target) };
```

- [ ] **Step 4: Implement pruning and call it when a run starts**

In `packages/catalogue/src/content-suggestion-collect.ts`, add `inArray` to its `drizzle-orm` import (it already imports `contentSuggestions`, `Transaction` and `TranslationContext` for Task 6's waiting-suggestion filter) and append:

```ts
export async function pruneSuggestions(tx: Transaction, context: TranslationContext): Promise<void> {
  const gaps = await readSuggestionGaps(tx, context);
  const rows = await tx
    .select({
      id: contentSuggestions.id,
      kind: contentSuggestions.kind,
      itemId: contentSuggestions.itemId,
      language: contentSuggestions.language,
      text: contentSuggestions.text,
    })
    .from(contentSuggestions);
  const gone = rows
    .filter((row) => {
      const gap = gaps.get(suggestionRef({ kind: row.kind, id: row.itemId }));
      return (
        !gap ||
        gap.missing.size === 0 ||
        (row.text !== null && !gap.missing.has(row.language ?? ""))
      );
    })
    .map((row) => row.id);
  for (let start = 0; start < gone.length; start += 500)
    await tx
      .delete(contentSuggestions)
      .where(inArray(contentSuggestions.id, gone.slice(start, start + 500)));
}
```

In `packages/catalogue/src/content-suggestion-jobs.ts`, import it beside `buildSuggestionJob`:

```ts
import { buildSuggestionJob, pruneSuggestions } from "./content-suggestion-collect.js";
```

and in `startSuggestionRun`, between the refusal and `buildSuggestionJob`:

```ts
  if (await readActiveSuggestionJob(tx)) throw new AppError("content.suggestion_job_running", {});
  await pruneSuggestions(tx, context);
  const draft = await buildSuggestionJob(tx, context, new Set());
```

- [ ] **Step 5: Run the tests, then the controls**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-list.test.ts src/content-suggestion-store.test.ts src/content-suggestion-jobs.test.ts src/content-suggestion-collect.test.ts src/content-translations.test.ts`
Expected: PASS; read the `Tests` count (20 in the new file, 13 and 24 from Tasks 9 and 8, plus the unchanged Task 6/7 and save suites).
Run: `pnpm --filter @waitron/server exec vitest run src/content-translations-api.test.ts`
Expected: PASS (the save route now also deletes suggestions; the table exists wherever the catalogue set is migrated).
Run: `pnpm --filter @waitron/catalogue typecheck`
Expected: exit 0.

Controls, each restored before the next:
1. Review Focus 1: make `suggestionStale` compare whole tokens (`return stored !== current;`). "a language added after the job leaves the suggestions current" must FAIL with `stale: true` — its first assertion has already shown the two tokens differ, so this run discriminates. The `suggestionStale` "ignores the language list" case fails too.
2. A deleted product in listing: in `resolveLive`, replace `isLiveTarget(entry)` with `entry.state === "present" && entry.target.eligible`. "a suggestion for a deleted product is neither listed nor kept by the next run" must FAIL at the listing assertion.
3. Deleting on save: remove the `deleteSavedSuggestions(...)` line from `saveContentTranslations`. Both "saving a name" cases must FAIL ("deletes its suggestion" finds three rows; "puts both suggestions back" fails its assertion inside the transaction, which shows the delete runs in the caller's transaction rather than after it).
4. Pruning: remove the `await pruneSuggestions(tx, context);` line. "starting a run prunes suggestions for names that were filled elsewhere" must FAIL.

Run the five files once more after restoring: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-suggestion-store.ts packages/catalogue/src/content-suggestion-collect.ts packages/catalogue/src/content-suggestion-jobs.ts packages/catalogue/src/content-translations.ts packages/catalogue/src/content-suggestion-types.ts packages/catalogue/src/content-suggestion-list.test.ts
git commit -s -m "List and discard Translate all suggestions, mark changed ones out of date, and clear them when a name is saved or filled elsewhere"
```

---

### Task 11: The job runner

**Files:**
- Create: `apps/server/src/content-suggestion-runner.ts`
- Test: `apps/server/src/content-suggestion-runner.test.ts`

**Interfaces:**
- Consumes: `CloudConnection["translation"]` and `CloudConnection["translationService"]`, `CloudReason` from `apps/server/src/cloud-translation.ts` (Task 4); `SuggestionResults` from `packages/catalogue/src/content-suggestion-types.ts` (Task 4); `translationCloudFixture`, `FakeJobBody` and the switches `consent`, `cap`, `hold`, `failRefs`, `providerDown`, `capStop`, `consentWithdrawn`, `service`, `expire`, `offline`, `online`, `loseNext`, `statusOverride`, plus `jobs`, `calls`, `submissions` (Task 3); `contentSuggestionJobs`, `contentSuggestions`, `SuggestionJobRow` (Task 5); `readActiveSuggestionJob`, `startSuggestionRun`, `recordSuggestionJobSubmitted`, `recordSuggestionJobProgress`, `recordSuggestionJobRefused`, `recordSuggestionJobEnded`, `recordSuggestionJobReleased`, `readSuggestionRun` (Task 8); `storeSuggestionResults` (Task 9). All catalogue names are imported from the `@waitron/catalogue` barrel, which Tasks 5, 8 and 9 export them from.
- Produces (new names):
  ```ts
  export type RunnerStep = "idle" | "wait" | "again";
  export const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000;
  export interface ContentSuggestionRunnerDeps {
    db: Database;
    connection: Pick<CloudConnection, "translation" | "translationService">;
    context: TranslationContext;
    isPrimary: () => boolean;
    now?: () => Date;
  }
  export function createContentSuggestionRunner(deps: ContentSuggestionRunnerDeps): {
    step(signal?: AbortSignal): Promise<RunnerStep>;
    run(
      signal: AbortSignal,
      options?: {
        sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
        onError?: (error: unknown) => void;
      },
    ): Promise<void>;
    wake(): void;
  };
  ```

What one `step` does, in this order. It makes at most one Cloud exchange (two for a finished job: status, then collect), never inside a transaction:

| Active job (`readActiveSuggestionJob`) | Cloud call | Recorded, and the step's answer |
| --- | --- | --- |
| this node is not the primary | — | nothing, `idle` |
| none | — | nothing, `idle` |
| any, `createdAt` 24 hours ago or more | — | `submitting` / `running`: ended `expired` (released). A finished job not yet released: released, its state kept. `again` |
| any, `translationService()` is `off` or `not_connected` | — | `submitting` / `running`: ended `failed`, failure `not_connected` (released). A finished job not yet released: released, its state kept. `again` |
| `submitting` | `submit(job.id, job.body)` | `running` with Cloud's job ID; refused consent / limit (with `fits`) / job running: `refused`; `cloud.request_invalid`: ended `failed` (`rejected`). `again` |
| `submitting` with no body, or `running` with no Cloud job ID | — | ended `failed` (`rejected`), `again` |
| `running` | `status(cloudJobId)` | `queued` / `running`: progress, `wait`. `done` / `partly_done`: `collect`, then `storeSuggestionResults` with the status's `reason` copied in, `again`. `failed`: ended `failed` with failure `provider` (`provider_unavailable`), `consent` (`consent_required`) or `limit` (`limit_reached`), left unreleased so the next step releases it, `again`. `expired` / `collected`: ended `expired`, `again`. A status or collect refused `content.suggestion_expired`: ended `expired`; refused `cloud.request_invalid`: ended `failed` (`rejected`). `again` |
| `done` / `partly_done` / `failed` with a Cloud job, not released | `release(cloudJobId)` | released (also when refused `content.suggestion_expired`: Cloud has already deleted it), `again` |
| anything else thrown (`cloud.unavailable` among them) | — | rethrown; `run` backs off |

Why the first two checks come before any call: once Cloud switches the service off it answers every translation call `403 {"error":"permission_denied"}`, which Task 4 maps to `cloud.unavailable`, so without the check the job would be retried for good and `startSuggestionRun` would refuse every new run meanwhile. The 24-hour check bounds the same thing for any other refusal that keeps coming back. A finished job keeps its state when either check releases it, because its suggestions are already stored and its run view must still say so.

`run(signal, options)`: loops until `signal` aborts. After `again`, no pause; after `wait`, 5 s; after `idle` (which includes "not the primary"), 60 s or until `wake()`; after an error, `onError(error)` then 5 s, doubling to at most 60 s, back to 5 s after the next step that does not throw. A `wake()` that arrives while a step is running skips the next idle pause.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/content-suggestion-runner.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  CATALOGUE_MIGRATIONS,
  contentSuggestionJobs,
  contentSuggestions,
  createCatalogue,
  createProduct,
  readActiveSuggestionJob,
  readSuggestionRun,
  startSuggestionRun,
  writeContentLanguages,
  type TranslationContext,
} from "@waitron/catalogue";
import { codeOf } from "@waitron/server-kit";
import { translationCloudFixture, type FakeJobBody } from "../test/translation-cloud-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
import {
  createContentSuggestionRunner,
  JOB_LIFETIME_MS,
  type ContentSuggestionRunnerDeps,
  type RunnerStep,
} from "./content-suggestion-runner.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context: TranslationContext = { fallbackLanguage: "es-ES", required: [] };
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
type Fake = Awaited<ReturnType<typeof translationCloudFixture>>;

const SUBMIT = "translation-submit";
const STATUS = "translation-status";
const COLLECT = "translation-collect";
const RELEASE = "translation-release";

/** A connected fake Cloud whose last configuration reply carried the translation service. */
async function connected(): Promise<Fake> {
  const f = await translationCloudFixture();
  await f.client.refresh(); // renew: no lease yet
  await f.client.refresh(); // configuration, four services
  expect(await f.client.translationService()).toBe("on");
  return f;
}

/** A venue in Spanish and English with one complete menu and a product per staff name, each missing English. */
async function venue(staffNames: readonly string[]): Promise<string[]> {
  await seedTenant(suite.db);
  return inTx(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT-es Almuerzo", en: "CLIENT-en Lunch" },
    });
    const ids: string[] = [];
    for (const name of staffNames) {
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        unitId: null,
        name,
        kitchenName: name.replace("STAFF", "KITCHEN"),
        customerName: { es: name.replace("STAFF", "CLIENT-es") },
        unitPrice: "3.00",
        vatClass: "reduced",
      });
      ids.push(product.id);
    }
    return ids;
  });
}

function deps(f: Fake, overrides: Partial<ContentSuggestionRunnerDeps> = {}): ContentSuggestionRunnerDeps {
  return { db: suite.db, connection: f.client, context, isPrimary: () => true, ...overrides };
}

/** A runner whose clock reads `ms` later than the real one. */
function later(f: Fake, ms: number) {
  return createContentSuggestionRunner(deps(f, { now: () => new Date(Date.now() + ms) }));
}

async function runToIdle(
  runner: ReturnType<typeof createContentSuggestionRunner>,
  limit = 20,
): Promise<RunnerStep[]> {
  const steps: RunnerStep[] = [];
  for (let i = 0; i < limit; i++) {
    const next = await runner.step();
    steps.push(next);
    if (next === "idle") return steps;
  }
  throw new Error(`still busy after ${limit} steps: ${steps.join(", ")}`);
}

const actions = (f: Fake) => f.calls.map((call) => call.action);
const runView = () => inTx((tx) => readSuggestionRun(tx));
const suggestions = () =>
  inTx((tx) =>
    tx
      .select({
        itemId: contentSuggestions.itemId,
        language: contentSuggestions.language,
        text: contentSuggestions.text,
      })
      .from(contentSuggestions)
      .orderBy(contentSuggestions.text),
  );

/** A job body the fake accepts, for a job this box did not record. */
const OTHER_BODY = JSON.stringify({
  version: 1,
  country: "ES",
  languages: { default: "es", enabled: ["es", "en"] },
  items: [
    {
      ref: "product:other",
      kind: "product",
      family: "product:other",
      category: null,
      staffName: "STAFF Other",
      existing: {},
      missing: ["en"],
    },
  ],
  houseStyle: [],
} satisfies FakeJobBody);

it("runs a job from submit to release and stores its suggestions", async () => {
  const f = await connected();
  try {
    const [bread, wine] = await venue(["STAFF Bread", "STAFF Wine"]);
    await inTx((tx) => startSuggestionRun(tx, context));

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual([
      "again",
      "wait",
      "again",
      "again",
      "idle",
    ]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
    expect(await suggestions()).toEqual([
      { itemId: bread, language: "en", text: "EN STAFF Bread" },
      { itemId: wine, language: "en", text: "EN STAFF Wine" },
    ]);
    expect(await runView()).toMatchObject({
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
      progress: 2,
      waiting: 2,
      code: null,
    });
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
  } finally {
    await f.close();
  }
});

it("a lost submit reply is retried after a restart as the same job", async () => {
  const f = await connected();
  try {
    const [bread] = await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const job = (await inTx((tx) => readActiveSuggestionJob(tx)))!;
    f.loseNext(SUBMIT);
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });

    const restarted = createContentSuggestionRunner(
      deps(f, { connection: createCloudConnection(f.options) }),
    );
    expect(await runToIdle(restarted)).toEqual(["again", "wait", "again", "again", "idle"]);
    expect(f.jobs.size).toBe(1);
    expect(f.submissions.map((s) => s.operationId)).toEqual([job.id, job.id]);
    expect(f.submissions[1]!.body).toBe(f.submissions[0]!.body);
    expect(await suggestions()).toEqual([{ itemId: bread, language: "en", text: "EN STAFF Bread" }]);
  } finally {
    await f.close();
  }
});

it("a restarted box resumes polling the job it already submitted", async () => {
  const f = await connected();
  try {
    const [bread] = await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const first = createContentSuggestionRunner(deps(f));
    expect(await first.step()).toBe("again");
    expect(await first.step()).toBe("wait");

    const restarted = createContentSuggestionRunner(
      deps(f, { connection: createCloudConnection(f.options) }),
    );
    expect(await runToIdle(restarted)).toEqual(["again", "again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
    expect(f.jobs.size).toBe(1);
    expect(await suggestions()).toEqual([{ itemId: bread, language: "en", text: "EN STAFF Bread" }]);
  } finally {
    await f.close();
  }
});

const partly: [string, (f: Fake, refs: string[]) => void, string | null, number | null][] = [
  ["some items failed", (f, refs) => f.failRefs([refs[0]!]), null, null],
  ["the spending cap stopped it", (f) => f.capStop(true), "content.suggestion_limit_reached", 0],
];
it.each(partly)(
  "a job Cloud left partly done because %s keeps what was done",
  async (_name, arrange, code, fits) => {
    const f = await connected();
    try {
      const ids = await venue(["STAFF Bread", "STAFF Wine"]);
      arrange(f, ids.map((id) => `product:${id}`).sort());
      await inTx((tx) => startSuggestionRun(tx, context));

      await runToIdle(createContentSuggestionRunner(deps(f)));
      expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
      expect(await runView()).toMatchObject({
        state: "partly_done",
        code,
        fits,
        total: 2,
        done: 1,
        failed: 1,
        progress: 2,
        waiting: 1,
      });
      expect(await suggestions()).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

const failed: [string, (f: Fake) => void, string][] = [
  ["the provider was down", (f) => f.providerDown(true), "content.suggestion_service_unavailable"],
  ["consent was withdrawn", (f) => f.consentWithdrawn(true), "content.suggestion_consent_required"],
];
it.each(failed)(
  "a job Cloud failed because %s shows why and is released so Cloud deletes it",
  async (_name, arrange, code) => {
    const f = await connected();
    try {
      await venue(["STAFF Bread", "STAFF Wine"]);
      arrange(f);
      await inTx((tx) => startSuggestionRun(tx, context));

      expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual([
        "again",
        "wait",
        "again",
        "again",
        "idle",
      ]);
      expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, RELEASE]);
      expect([...f.jobs.values()].map((job) => job.state)).toEqual(["collected"]);
      expect(await runView()).toMatchObject({ state: "failed", code });
      expect(await suggestions()).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

const gone: [string, (f: Fake, jobId: string) => void][] = [
  ["has expired it", (f, jobId) => f.expire(jobId)],
  ["reports it collected", (f) => f.statusOverride({ state: "collected" })],
];
it.each(gone)("a running job Cloud %s ends expired without a collect", async (_name, arrange) => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    arrange(f, [...f.jobs.values()][0]!.jobId);

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS]);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a collect refused as expired ends the job expired", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    f.expire([...f.jobs.values()][0]!.jobId);
    f.statusOverride({ state: "done" });

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, COLLECT]);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a release refused as expired is recorded as released, and the suggestions stay", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    f.expire([...f.jobs.values()][0]!.jobId);

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f).at(-1)).toBe(RELEASE);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1 });
  } finally {
    await f.close();
  }
});

const refusals: [string, (f: Fake) => Promise<unknown> | void, string, number | null][] = [
  ["consent is missing", (f) => f.consent(false), "content.suggestion_consent_required", null],
  ["the spending cap", (f) => f.cap(1), "content.suggestion_limit_reached", 1],
  [
    "another job is running in Cloud",
    (f) => {
      f.hold(true);
      return f.client.translation.submit(randomUUID(), OTHER_BODY);
    },
    "content.suggestion_job_running",
    null,
  ],
];
it.each(refusals)(
  "a submit refused because of %s is recorded as refused and does not block the next run",
  async (_name, arrange, code, fits) => {
    const f = await connected();
    try {
      await venue(["STAFF Bread", "STAFF Wine"]);
      await arrange(f);
      await inTx((tx) => startSuggestionRun(tx, context));
      const before = f.calls.length;

      expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
      expect(actions(f).slice(before)).toEqual([SUBMIT]);
      expect(await runView()).toMatchObject({ state: "refused", code, fits });
      await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
        state: "sending",
      });
    } finally {
      await f.close();
    }
  },
);

it("a body Cloud will never accept ends the job as rejected", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const other = JSON.parse(OTHER_BODY) as FakeJobBody;
    await inTx((tx) =>
      tx.update(contentSuggestionJobs).set({
        body: JSON.stringify({ ...other, items: [{ ...other.items[0]!, kind: "telepathy" }] }),
      }),
    );

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

const broken: [string, { state?: "running"; body: null }][] = [
  ["a submitting job with no body", { body: null }],
  ["a running job with no Cloud job", { state: "running", body: null }],
];
it.each(broken)("%s ends rejected without a call", async (_name, patch) => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    await inTx((tx) => tx.update(contentSuggestionJobs).set(patch));

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(f.calls).toEqual([]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

it("a job Cloud switched the service off for ends without a call, and the next run is not refused", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    f.service("unconfigured");
    await f.client.refresh();
    expect(await f.client.translationService()).toBe("off");
    const before = f.calls.length;

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.not_configured" });
    await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
      state: "sending",
    });
  } finally {
    await f.close();
  }
});

it("a stored job waiting for its release when the service goes off is released without a call", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    f.service("unconfigured");
    await f.client.refresh();
    const before = f.calls.length;

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(f.calls).toHaveLength(before);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1, code: null });
  } finally {
    await f.close();
  }
});

it("a running job 24 hours old ends expired without asking Cloud", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.hold(true);
    expect(await createContentSuggestionRunner(deps(f)).step()).toBe("again");
    // The control: a minute short of the lifetime, the runner still polls.
    expect(await later(f, JOB_LIFETIME_MS - 60_000).step()).toBe("wait");
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
      state: "sending",
    });
  } finally {
    await f.close();
  }
});

it("a job Cloud never took ends expired after 24 hours instead of being retried for good", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.offline();
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a stored job 24 hours old is released without a call and keeps its state", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1 });
  } finally {
    await f.close();
  }
});

it("an unreachable Cloud keeps the job and backs off from 5 to 60 seconds, starting again at 5 after a success", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.offline();
    const controller = new AbortController();
    const sleeps: number[] = [];
    const errors: string[] = [];

    await createContentSuggestionRunner(deps(f)).run(controller.signal, {
      onError: (error) => errors.push(codeOf(error)),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 6) f.online();
        if (sleeps.length === 7) f.offline();
        if (sleeps.length === 8) controller.abort();
      },
    });
    // Six failed submits, a submit and a poll that succeed, then a failed poll.
    expect(sleeps).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 5000, 5000]);
    expect(errors).toEqual(Array(7).fill("cloud.unavailable"));
    expect(f.jobs.size).toBe(1);
    expect(await runView()).toMatchObject({ state: "running" });
  } finally {
    await f.close();
  }
});

it("polls no more than once every five seconds while Cloud runs the job", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread", "STAFF Wine"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.hold(true);
    const controller = new AbortController();
    const sleeps: number[] = [];

    await createContentSuggestionRunner(deps(f)).run(controller.signal, {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (actions(f).filter((action) => action === STATUS).length === 3) controller.abort();
      },
    });
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, STATUS]);
    expect(sleeps).toEqual([5000, 5000, 5000]);
    expect(await runView()).toMatchObject({ state: "running", total: 2, progress: 1 });
  } finally {
    await f.close();
  }
});

it("chains a menu over 1,000 items within Cloud's limits and never resends an item", async () => {
  const f = await connected();
  try {
    const ids = await venue(
      Array.from({ length: 1005 }, (_, i) => `STAFF Dish ${String(i).padStart(4, "0")}`),
    );
    const refs = ids.map((id) => `product:${id}`).sort();
    // The first ref in the job order, so it is in the first job.
    f.failRefs([refs[0]!]);
    await inTx((tx) => startSuggestionRun(tx, context));

    await runToIdle(createContentSuggestionRunner(deps(f)));
    expect(f.submissions).toHaveLength(2);
    const sent = f.submissions.map((submission) => {
      expect(Buffer.byteLength(submission.body, "utf8")).toBeLessThanOrEqual(1_048_576);
      const items = (JSON.parse(submission.body) as FakeJobBody).items;
      expect(items.length).toBeLessThanOrEqual(1000);
      return items.map((item) => item.ref);
    });
    expect(sent.flat()).toHaveLength(1005);
    expect(new Set(sent.flat())).toEqual(new Set(refs));
    expect(sent.flat().filter((ref) => ref === refs[0])).toHaveLength(1);
    expect(await runView()).toMatchObject({
      state: "partly_done",
      total: 1005,
      done: 1004,
      failed: 1,
      progress: 1005,
      waiting: 1004,
    });
  } finally {
    await f.close();
  }
}, 120_000);

it("does nothing on a node that is not the primary, and waits a minute between looks", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f, { isPrimary: () => false }));
    expect(await runner.step()).toBe("idle");

    const controller = new AbortController();
    const sleeps: number[] = [];
    await runner.run(controller.signal, {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) controller.abort();
      },
    });
    expect(sleeps).toEqual([60000, 60000]);
    expect(f.calls).toEqual([]);
    expect(await runView()).toMatchObject({ state: "sending" });
  } finally {
    await f.close();
  }
});

it("wakes at once when a run starts", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    const runner = createContentSuggestionRunner(deps(f));
    const controller = new AbortController();
    let idle = () => {};
    const idling = new Promise<void>((resolve) => {
      idle = resolve;
    });
    const loop = runner.run(controller.signal, {
      sleep: (ms, signal) => {
        if (ms !== 60000) return Promise.resolve();
        idle();
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    await idling;
    await inTx((tx) => startSuggestionRun(tx, context));
    runner.wake();

    await vi.waitFor(() => expect(actions(f)).toContain(SUBMIT), { timeout: 2000 });
    controller.abort();
    await loop;
  } finally {
    await f.close();
  }
});

it("stops with the error when its sleep fails for a reason other than stopping", async () => {
  const f = await connected();
  try {
    const failure = new Error("timer broken");
    await expect(
      createContentSuggestionRunner(deps(f)).run(new AbortController().signal, {
        sleep: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  } finally {
    await f.close();
  }
});
```

Run: `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts`
Expected: FAIL — the suite does not load, because `./content-suggestion-runner.js` does not exist.

- [ ] **Step 2: Write the runner**

`apps/server/src/content-suggestion-runner.ts`:

```ts
import { setTimeout as delay } from "node:timers/promises";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { hasCode, isAppError, type ErrorCode } from "@waitron/shared";
import {
  readActiveSuggestionJob,
  recordSuggestionJobEnded,
  recordSuggestionJobProgress,
  recordSuggestionJobRefused,
  recordSuggestionJobReleased,
  recordSuggestionJobSubmitted,
  storeSuggestionResults,
  type SuggestionJobRow,
  type TranslationContext,
} from "@waitron/catalogue";
import type { SuggestionResults } from "@waitron/catalogue/src/content-suggestion-types.js";
import type { CloudConnection } from "./cloud-client.js";
import type { CloudReason } from "./cloud-translation.js";
import "@waitron/catalogue/src/errors.js";
import "./errors.js";

export type RunnerStep = "idle" | "wait" | "again";

export const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000;

const POLL_MS = 5000;
const IDLE_MS = 60000;
const FIRST_BACKOFF_MS = 5000;
const LAST_BACKOFF_MS = 60000;

const FAILURE: Record<CloudReason, "provider" | "consent" | "limit"> = {
  provider_unavailable: "provider",
  provider_failed: "provider",
  consent_required: "consent",
  limit_reached: "limit",
};

export interface ContentSuggestionRunnerDeps {
  db: Database;
  connection: Pick<CloudConnection, "translation" | "translationService">;
  context: TranslationContext;
  isPrimary: () => boolean;
  now?: () => Date;
}

function is(error: unknown, code: ErrorCode): boolean {
  return isAppError(error) && error.code === code;
}

function submitRefusal(
  error: unknown,
): { refusal: "consent" | "limit" | "job_running"; fits: number | null } | null {
  if (!isAppError(error)) return null;
  if (hasCode(error, "content.suggestion_limit_reached"))
    return { refusal: "limit", fits: error.params.fits };
  if (error.code === "content.suggestion_consent_required") return { refusal: "consent", fits: null };
  if (error.code === "content.suggestion_job_running") return { refusal: "job_running", fits: null };
  return null;
}

export function createContentSuggestionRunner(deps: ContentSuggestionRunnerDeps) {
  const now = deps.now ?? (() => new Date());
  const { translation } = deps.connection;
  const record = (fn: (tx: Transaction) => Promise<void>) => withTransaction(deps.db, fn);
  let woken = false;
  let interruptIdle: AbortController | undefined;

  /** Ends an open job; a finished one only needs its release recorded. */
  async function close(
    job: SuggestionJobRow,
    state: "failed" | "expired",
    failure: "not_connected" | "rejected" | null,
  ): Promise<RunnerStep> {
    const at = now();
    await record((tx) =>
      job.state === "submitting" || job.state === "running"
        ? recordSuggestionJobEnded(tx, job.id, state, failure, at)
        : recordSuggestionJobReleased(tx, job.id),
    );
    return "again";
  }

  async function submit(
    job: SuggestionJobRow,
    body: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      // The job's id is the operation ID, so a retry is the same job to Cloud.
      const reply = await translation.submit(job.id, body, signal);
      await record((tx) => recordSuggestionJobSubmitted(tx, job.id, reply));
      return "again";
    } catch (error) {
      const refused = submitRefusal(error);
      if (refused) {
        const at = now();
        await record((tx) =>
          recordSuggestionJobRefused(tx, job.id, refused.refusal, refused.fits, at),
        );
        return "again";
      }
      if (is(error, "cloud.request_invalid")) return close(job, "failed", "rejected");
      throw error;
    }
  }

  async function poll(
    job: SuggestionJobRow,
    cloudJobId: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      const status = await translation.status(cloudJobId, signal);
      if (status.state === "queued" || status.state === "running") {
        await record((tx) => recordSuggestionJobProgress(tx, job.id, status));
        return "wait";
      }
      if (status.state === "done" || status.state === "partly_done") {
        const collected = await translation.collect(cloudJobId, signal);
        // Collect's reply carries no reason; the status that finished the job does.
        const results: SuggestionResults =
          status.reason === "limit_reached" || status.reason === "provider_failed"
            ? { ...collected, reason: status.reason }
            : collected;
        const at = now();
        await record((tx) => storeSuggestionResults(tx, job.id, results, deps.context, at));
        return "again";
      }
      if (status.state === "failed") {
        const failure = FAILURE[status.reason ?? "provider_unavailable"];
        const at = now();
        await record((tx) => recordSuggestionJobEnded(tx, job.id, "failed", failure, at));
        return "again";
      }
      return await close(job, "expired", null);
    } catch (error) {
      if (is(error, "content.suggestion_expired")) return close(job, "expired", null);
      if (is(error, "cloud.request_invalid")) return close(job, "failed", "rejected");
      throw error;
    }
  }

  async function release(
    job: SuggestionJobRow,
    cloudJobId: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      await translation.release(cloudJobId, signal);
    } catch (error) {
      if (!is(error, "content.suggestion_expired")) throw error;
    }
    await record((tx) => recordSuggestionJobReleased(tx, job.id));
    return "again";
  }

  async function step(signal?: AbortSignal): Promise<RunnerStep> {
    if (!deps.isPrimary()) return "idle";
    const job = await withTransaction(deps.db, (tx) => readActiveSuggestionJob(tx));
    if (!job) return "idle";
    // A refusal that keeps coming back would otherwise hold the run open, refusing every new one.
    if (now().getTime() - Date.parse(job.createdAt) >= JOB_LIFETIME_MS)
      return close(job, "expired", null);
    // With the service off Cloud answers every call 403, which reaches here as cloud.unavailable.
    if ((await deps.connection.translationService()) !== "on")
      return close(job, "failed", "not_connected");
    if (job.state === "submitting")
      return job.body === null ? close(job, "failed", "rejected") : submit(job, job.body, signal);
    if (job.cloudJobId === null) return close(job, "failed", "rejected");
    return job.state === "running"
      ? poll(job, job.cloudJobId, signal)
      : release(job, job.cloudJobId, signal);
  }

  async function run(
    signal: AbortSignal,
    options: {
      sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
      onError?: (error: unknown) => void;
    } = {},
  ): Promise<void> {
    const sleep =
      options.sleep ?? ((ms: number, s: AbortSignal) => delay(ms, undefined, { signal: s }));
    let backoff = FIRST_BACKOFF_MS;
    const pause = async (ms: number, wakeable: boolean) => {
      const interrupt = new AbortController();
      if (wakeable) interruptIdle = interrupt;
      try {
        await sleep(ms, wakeable ? AbortSignal.any([signal, interrupt.signal]) : signal);
      } catch (error) {
        if (!signal.aborted && !interrupt.signal.aborted) throw error;
      } finally {
        if (wakeable) interruptIdle = undefined;
      }
    };
    while (!signal.aborted) {
      woken = false;
      let next: RunnerStep;
      try {
        next = await step(signal);
        backoff = FIRST_BACKOFF_MS;
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
        await pause(backoff, false);
        backoff = Math.min(backoff * 2, LAST_BACKOFF_MS);
        continue;
      }
      if (next === "wait") await pause(POLL_MS, false);
      else if (next === "idle" && !woken) await pause(IDLE_MS, true);
    }
  }

  return {
    step,
    run,
    wake(): void {
      woken = true;
      interruptIdle?.abort();
    },
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts`
Expected: PASS; read the `Tests` count (28 cases, counting each `it.each` row).

- [ ] **Step 4: Run the three controls, one at a time, restoring after each**

1. Delete the `translationService()` check in `step`. Expected: the two cases where the service is switched off fail, each with a step rejecting `cloud.unavailable` (the fake answering the status or release call `403 permission_denied`).
2. Delete the 24-hour check. Expected: the three cases about a job 24 hours old fail — `"wait"` where `"again"` was expected, a step rejecting `cloud.unavailable`, and an extra `translation-release` call.
3. Make `wake()` do nothing. Expected: "wakes at once when a run starts" fails in `vi.waitFor` after 2 seconds with no `translation-submit` call.

Re-run the file after restoring: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add apps/server/src/content-suggestion-runner.ts apps/server/src/content-suggestion-runner.test.ts
git commit -s -m "Run Translate all jobs on the primary: submit, poll every five seconds, collect, store and release, and give up on a job after a day or once Cloud switches the service off"
```

If `pnpm format:check` names either file, run `pnpm exec prettier --write <that file>`, re-run the check, then commit.

---

### Task 12: The routes, and starting the runner with the server

**Files:**
- Create: `apps/server/src/content-suggestions-api.ts`
- Modify: `apps/server/src/boot.ts` (imports beside `runCloudWorker` at line 14 and `mountCloudApi` at line 18; the runner and the routes after `mountCloudApi(...)`, lines 1909-1920; the loop after `cloudWorker`, lines 2231-2238; the unwind at lines 2270-2273; `stopWork`'s `closeAll` list at line 2285)
- Test: `apps/server/src/content-suggestions-api.test.ts` (new), `apps/server/src/boot.failed-start.test.ts` (one new case)

**Interfaces:**
- Consumes: `startSuggestionRun`, `markSuggestionRunOpened`, `contentSuggestionJobs`, `contentSuggestions` (Tasks 5 and 8); `listContentSuggestions`, `discardContentSuggestion`, `ContentSuggestionRead` (Task 10); `createContentSuggestionRunner` (Task 11); `translationCloudFixture` (Task 3); `authorizeManager` (`@waitron/identity`); `createErrorBoundary`, `readRawJsonBody`, `requireManagementSession` (`@waitron/server-kit`); `mountCatalogueApi` (`apps/server/src/catalogue-api.ts:777`, for the save case).
- Relies on Task 8's `markSuggestionRunOpened` writing `openedAt` only while it is null. The GET below calls it on every read, and the dialog re-reads whenever `content_suggestion_jobs` changes, so a version that rewrote the time on each call would answer each read with a change that starts the next. The "marks a finished run opened once" case pins this.
- Produces (new names):
  ```ts
  export interface ContentSuggestionsApiDeps {
    db: Database;
    connection?: Pick<CloudConnection, "translationService">;
    cloudOrigin?: string;
    context: TranslationContext;
    managementOrigin: string;
    isPrimary: () => boolean;
    wake: () => void;
  }
  export function mountContentSuggestionsApi(
    app: Hono,
    deps: ContentSuggestionsApiDeps,
    log: Logger,
  ): void;
  ```
  Routes, each gated by `catalogue.manage` through `authorizeManager` inside its one transaction:
  - `POST /management-api/content-suggestions/jobs`, body `{}` → `200 { run: SuggestionRunView | null }`. Refuses, in order: an `Origin` other than `managementOrigin` → `403 authorization.not_permitted` (as `cloud-api.ts:99-100` does); no session → `401 management_session.required`; a body that is not an empty JSON object, or over 1,024 bytes → `400 content.translation_invalid`; no permission → `403 authorization.not_permitted`; `translationService()` not `on` (or no connection) → `409 cloud.not_configured`; not the primary → `409 cloud.not_primary`; a run already active → `409 content.suggestion_job_running`. Calls `wake()` after the transaction commits, only when a run started.
  - `GET /management-api/content-suggestions?language=<code>&after=<id>` → `200 ContentSuggestionRead` (`{ ...ContentSuggestionPage, service, cloudOrigin }`, `cloudOrigin` null without one). On the primary it marks a finished run opened in the same transaction. A missing or repeated `language`, a repeated `after`, or any other key → `400 content.translation_invalid`, the translations route's code for the same mistake; a language not enabled → `400 content.languages_invalid` (from `listContentSuggestions`).
  - `DELETE /management-api/content-suggestions/:id` → `200 { deleted: id }`; gone → `404 content.suggestion_not_found { suggestionId }`.
  - Boot: the runner exists only with a Cloud connection; the route's `wake` calls it when there is one. The loop runs on `cloudController.signal`; its unwind entry is pushed before `undoOnFailure.push(async () => cloudController.abort())` (`boot.ts:2273`), because the unwind runs newest first (`boot.ts:722`) and the loop returns only once that signal aborts.

- [ ] **Step 1: Write the failing route tests**

`apps/server/src/content-suggestions-api.test.ts`:

```ts
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  CATALOGUE_MIGRATIONS,
  contentSuggestionJobs,
  contentSuggestions,
  createCatalogue,
  createProduct,
  readActiveSuggestionJob,
  startSuggestionRun,
  writeContentLanguages,
  type TranslationContext,
} from "@waitron/catalogue";
import type { ContentSuggestionRead } from "@waitron/catalogue/src/content-suggestion-types.js";
import type { TranslationPage } from "@waitron/catalogue/src/content-translation-types.js";
import { translationCloudFixture } from "../test/translation-cloud-fixture.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import {
  mountContentSuggestionsApi,
  type ContentSuggestionsApiDeps,
} from "./content-suggestions-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const context: TranslationContext = { fallbackLanguage: "es-ES", required: [] };
const ORIGIN = "https://dashboard.example";
const CLOUD = "https://cloud.example";
const JOBS = "/management-api/content-suggestions/jobs";
const LIST = "/management-api/content-suggestions";
let managerCookie: string;
let staffCookie: string;
const wake = vi.fn();

beforeEach(async () => {
  wake.mockReset();
  await seedTenant(suite.db);
  await inTx(async (tx) => {
    for (const role of ["manager", "staff"] as const) {
      const [person] = await tx.insert(persons).values({ displayName: role, role }).returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
      if (role === "manager") managerCookie = cookie;
      else staffCookie = cookie;
    }
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
  });
});

function mount(overrides: Partial<ContentSuggestionsApiDeps> = {}): Hono {
  const http = new Hono();
  mountContentSuggestionsApi(
    http,
    {
      db: suite.db,
      connection: { translationService: async () => "on" },
      cloudOrigin: CLOUD,
      context,
      managementOrigin: ORIGIN,
      isPrimary: () => true,
      wake,
      ...overrides,
    },
    () => {},
  );
  return http;
}

function send(
  http: Hono,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: { body?: string; cookie?: string | null; origin?: string } = {},
) {
  const cookie = options.cookie === undefined ? managerCookie : options.cookie;
  return http.request(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: options.origin ?? ORIGIN,
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

async function refused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function read(http: Hono, language: string): Promise<ContentSuggestionRead> {
  const response = await send(http, "GET", `${LIST}?language=${language}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<ContentSuggestionRead>;
}

/** One complete menu and one product missing English; returns the product's id. */
async function bread(): Promise<string> {
  return inTx(async (tx) => {
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT-es Almuerzo", en: "CLIENT-en Lunch" },
    });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      unitId: null,
      name: "STAFF Bread",
      kitchenName: "KITCHEN Bread",
      customerName: { es: "CLIENT-es Pan" },
      unitPrice: "3.00",
      vatClass: "reduced",
    });
    return product.id;
  });
}

async function connected() {
  const f = await translationCloudFixture();
  await f.client.refresh(); // renew: no lease yet
  await f.client.refresh(); // configuration, four services
  expect(await f.client.translationService()).toBe("on");
  return f;
}

async function runToIdle(runner: ReturnType<typeof createContentSuggestionRunner>) {
  for (let i = 0; i < 20; i++) if ((await runner.step()) === "idle") return;
  throw new Error("the runner did not finish");
}

const jobRows = () => suite.db.select().from(contentSuggestionJobs);

it("starts a run for a manager and wakes the runner", async () => {
  await bread();
  const response = await send(mount(), "POST", JOBS, { body: "{}" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    run: { state: "sending", total: 1, progress: 0, opened: false },
  });
  expect(wake).toHaveBeenCalledOnce();
  expect(await inTx((tx) => readActiveSuggestionJob(tx))).toMatchObject({ state: "submitting" });
});

it("answers no run and wakes nothing when nothing is missing", async () => {
  const response = await send(mount(), "POST", JOBS, { body: "{}" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ run: null });
  expect(wake).not.toHaveBeenCalled();
  expect(await jobRows()).toEqual([]);
});

it("refuses a start from another origin with authorization.not_permitted", async () => {
  await bread();
  await refused(
    await send(mount(), "POST", JOBS, { body: "{}", origin: "https://elsewhere.example" }),
    403,
    "authorization.not_permitted",
  );
  expect(await jobRows()).toEqual([]);
});

it.each([
  ["POST", JOBS, "{}"],
  ["GET", `${LIST}?language=en`, undefined],
  ["DELETE", `${LIST}/00000000-0000-4000-8000-000000000000`, undefined],
] as const)(
  "%s %s refuses no session with 401 and a person without catalogue.manage with 403",
  async (method, url, body) => {
    await bread();
    const http = mount();
    await refused(
      await send(http, method, url, { body, cookie: null }),
      401,
      "management_session.required",
    );
    await refused(
      await send(http, method, url, { body, cookie: staffCookie }),
      403,
      "authorization.not_permitted",
    );
    expect(await jobRows()).toEqual([]);
  },
);

it.each([
  ["an array", "[]"],
  ["a field", '{"language":"en"}'],
  ["text that is not JSON", "not json"],
  ["more than 1,024 bytes", `{"pad":"${"x".repeat(2000)}"}`],
])("refuses a start whose body is %s with content.translation_invalid", async (_name, body) => {
  await bread();
  await refused(await send(mount(), "POST", JOBS, { body }), 400, "content.translation_invalid");
  expect(await jobRows()).toEqual([]);
});

it.each([
  ["no Cloud connection", undefined],
  ["a connection without the service", "off"],
  ["a connection that is no longer registered", "not_connected"],
] as const)("refuses to start with %s as cloud.not_configured", async (_name, service) => {
  await bread();
  const http = mount({
    connection: service === undefined ? undefined : { translationService: async () => service },
  });
  await refused(await send(http, "POST", JOBS, { body: "{}" }), 409, "cloud.not_configured");
  expect(await jobRows()).toEqual([]);
  expect(wake).not.toHaveBeenCalled();
});

it("refuses to start off the primary with cloud.not_primary", async () => {
  await bread();
  await refused(
    await send(mount({ isPrimary: () => false }), "POST", JOBS, { body: "{}" }),
    409,
    "cloud.not_primary",
  );
  expect(await jobRows()).toEqual([]);
});

it("refuses a second run while one is active with content.suggestion_job_running", async () => {
  await bread();
  const http = mount();
  expect((await send(http, "POST", JOBS, { body: "{}" })).status).toBe(200);
  await refused(
    await send(http, "POST", JOBS, { body: "{}" }),
    409,
    "content.suggestion_job_running",
  );
  expect(wake).toHaveBeenCalledOnce();
  expect(await jobRows()).toHaveLength(1);
});

it("lists a language's suggestions with the run, the service and Cloud's origin, and marks a finished run opened once", async () => {
  const f = await connected();
  try {
    const id = await bread();
    const http = mount({ connection: f.client });
    expect((await send(http, "POST", JOBS, { body: "{}" })).status).toBe(200);
    expect(await read(http, "en")).toMatchObject({
      service: "on",
      cloudOrigin: CLOUD,
      run: { state: "sending", opened: false },
      suggestions: [],
    });

    await runToIdle(
      createContentSuggestionRunner({
        db: suite.db,
        connection: f.client,
        context,
        isPrimary: () => true,
      }),
    );
    expect(await read(http, "en")).toEqual({
      language: "en",
      service: "on",
      cloudOrigin: CLOUD,
      next: null,
      run: expect.objectContaining({ state: "done", waiting: 1, opened: true }),
      suggestions: [
        {
          id: expect.any(String),
          kind: "product",
          itemId: id,
          language: "en",
          text: "EN STAFF Bread",
          placeholder: false,
          fix: null,
          stale: false,
        },
      ],
    });
    const [opened] = await jobRows();
    expect(opened!.openedAt).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await read(http, "en");
    const [again] = await jobRows();
    expect(again!.openedAt).toBe(opened!.openedAt);
  } finally {
    await f.close();
  }
});

it("a read off the primary leaves a finished run unopened", async () => {
  const f = await connected();
  try {
    await bread();
    await inTx((tx) => startSuggestionRun(tx, context));
    await runToIdle(
      createContentSuggestionRunner({
        db: suite.db,
        connection: f.client,
        context,
        isPrimary: () => true,
      }),
    );
    const standby = mount({ connection: f.client, isPrimary: () => false });
    expect(await read(standby, "en")).toMatchObject({
      run: { state: "done", opened: false },
      suggestions: [{ text: "EN STAFF Bread" }],
    });
    const [job] = await jobRows();
    expect(job!.openedAt).toBeNull();
  } finally {
    await f.close();
  }
});

it("a read without Cloud says not_connected and has no Cloud origin", async () => {
  expect(await read(mount({ connection: undefined, cloudOrigin: undefined }), "en")).toEqual({
    language: "en",
    service: "not_connected",
    cloudOrigin: null,
    run: null,
    suggestions: [],
    next: null,
  });
});

it.each([
  ["no language", ""],
  ["two languages", "?language=en&language=es"],
  ["two cursors", "?language=en&after=a&after=b"],
  ["an unknown key", "?language=en&page=2"],
])("refuses a list with %s as content.translation_invalid", async (_name, query) => {
  await refused(await send(mount(), "GET", `${LIST}${query}`), 400, "content.translation_invalid");
});

it("refuses a list in a language the venue has not enabled with content.languages_invalid", async () => {
  await refused(
    await send(mount(), "GET", `${LIST}?language=fr`),
    400,
    "content.languages_invalid",
  );
});

it("discards a suggestion, and a second discard is content.suggestion_not_found with 404", async () => {
  const id = await bread();
  const [row] = await suite.db
    .insert(contentSuggestions)
    .values({ kind: "product", itemId: id, language: "en", text: "EN STAFF Bread", expected: "{}" })
    .returning();
  const http = mount();

  const first = await send(http, "DELETE", `${LIST}/${row!.id}`);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ deleted: row!.id });
  expect(await suite.db.select().from(contentSuggestions)).toEqual([]);

  const second = await send(http, "DELETE", `${LIST}/${row!.id}`);
  expect(second.status).toBe(404);
  expect(await second.json()).toEqual({
    error: { code: "content.suggestion_not_found", params: { suggestionId: row!.id } },
  });
});

it("saving the name through the translations route removes its suggestion", async () => {
  const id = await bread();
  await suite.db
    .insert(contentSuggestions)
    .values({ kind: "product", itemId: id, language: "en", text: "EN STAFF Bread", expected: "{}" });
  const http = mount();
  mountCatalogueApi(
    http,
    { db: suite.db, venueLocale: "es-ES", contentLanguageRules: { required: [], official: [] } },
    () => {},
  );
  const targets = await send(
    http,
    "GET",
    `/management-api/content-translations/en?target=product:${id}`,
  );
  const page = (await targets.json()) as TranslationPage;

  const save = await send(http, "PUT", "/management-api/content-translations/en", {
    body: JSON.stringify({
      edits: [{ kind: "product", id, expected: page.rows[0]!.expected, text: "CLIENT-en Bread" }],
    }),
  });
  expect(save.status).toBe(200);
  expect(await read(http, "en")).toMatchObject({ suggestions: [] });
});
```

Run: `pnpm --filter @waitron/server exec vitest run src/content-suggestions-api.test.ts`
Expected: FAIL — the suite does not load, because `./content-suggestions-api.js` does not exist.

- [ ] **Step 2: Write the routes**

`apps/server/src/content-suggestions-api.ts`:

```ts
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import {
  discardContentSuggestion,
  listContentSuggestions,
  markSuggestionRunOpened,
  startSuggestionRun,
  type TranslationContext,
} from "@waitron/catalogue";
import type { ContentSuggestionRead } from "@waitron/catalogue/src/content-suggestion-types.js";
import type { CloudConnection } from "./cloud-client.js";
import type { Logger } from "./logger.js";
import "@waitron/catalogue/src/errors.js";
import "./errors.js";

export interface ContentSuggestionsApiDeps {
  db: Database;
  connection?: Pick<CloudConnection, "translationService">;
  cloudOrigin?: string;
  context: TranslationContext;
  managementOrigin: string;
  isPrimary: () => boolean;
  wake: () => void;
}

const PATH = "/management-api/content-suggestions";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "cloud.not_configured": 409,
    "cloud.not_primary": 409,
    "content.suggestion_job_running": 409,
    "content.suggestion_not_found": 404,
  },
  "catalogue.failed",
);

function invalid(): never {
  throw new AppError("content.translation_invalid", {});
}

function pageQuery(c: Context): { language: string; after: string | undefined } {
  const params = new URL(c.req.url).searchParams;
  if ([...params.keys()].some((key) => key !== "language" && key !== "after")) invalid();
  const languages = params.getAll("language");
  const after = params.getAll("after");
  if (languages.length !== 1 || after.length > 1) invalid();
  return { language: languages[0], after: after[0] };
}

const authorize = (tx: Transaction, managementSessionId: string) =>
  authorizeManager(tx, { managementSessionId, permission: "catalogue.manage" });

export function mountContentSuggestionsApi(
  app: Hono,
  deps: ContentSuggestionsApiDeps,
  log: Logger,
): void {
  // Reads the saved connection file, never the network, so it may run before a transaction opens.
  const service = async () =>
    deps.connection ? deps.connection.translationService() : ("not_connected" as const);

  app.post(
    `${PATH}/jobs`,
    bodyLimit({
      maxSize: 1024,
      onError: (c) => c.json({ error: { code: "content.translation_invalid", params: {} } }, 400),
    }),
    (c) =>
      run(c, log, async () => {
        if (c.req.header("origin") !== deps.managementOrigin)
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        const sessionId = requireManagementSession(c);
        const body = await readRawJsonBody<unknown>(c);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
          invalid();
        const available = await service();
        const started = await withTransaction(deps.db, async (tx) => {
          await authorize(tx, sessionId);
          if (available !== "on") throw new AppError("cloud.not_configured", {});
          if (!deps.isPrimary()) throw new AppError("cloud.not_primary", {});
          return startSuggestionRun(tx, deps.context);
        });
        if (started) deps.wake();
        return c.json({ run: started });
      }),
  );

  app.get(PATH, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { language, after } = pageQuery(c);
      const available = await service();
      const page = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        // The runner writes the run's records on the primary; a standby leaves them alone.
        if (deps.isPrimary()) await markSuggestionRunOpened(tx);
        return listContentSuggestions(tx, language, { after }, deps.context);
      });
      const reply: ContentSuggestionRead = {
        ...page,
        service: available,
        cloudOrigin: deps.cloudOrigin ?? null,
      };
      return c.json(reply);
    }),
  );

  app.delete(`${PATH}/:id`, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        await discardContentSuggestion(tx, id);
      });
      return c.json({ deleted: id });
    }),
  );
}
```

- [ ] **Step 3: Run the route tests**

Run: `pnpm --filter @waitron/server exec vitest run src/content-suggestions-api.test.ts`
Expected: PASS; read the `Tests` count (25 cases, counting each `it.each` row). Control: delete the `if (deps.isPrimary())` guard in the GET handler (so it always marks); "a read off the primary leaves a finished run unopened" fails on `opened`. Restore.

- [ ] **Step 4: Write the failing boot case**

In `apps/server/src/boot.failed-start.test.ts`:

After `import { runCloudWorker } from "./cloud-worker.js";` (line 26) add:

```ts
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
```

After the `vi.mock("./cloud-worker.js", …)` block (lines 58-61) add:

```ts
vi.mock("./content-suggestion-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-suggestion-runner.js")>();
  return {
    ...actual,
    createContentSuggestionRunner: vi.fn(actual.createContentSuggestionRunner),
  };
});
```

In `afterEach`, after `vi.mocked(runCloudWorker).mockClear();` (line 111) add:

```ts
  vi.mocked(createContentSuggestionRunner).mockClear();
```

In the `describe("a start that fails after the venue folder is opened gives the folder back", …)` block, after the case "waits for the cloud snapshot loop when the cloud worker refuses to stop" (it ends at about line 572), add:

```ts
  it("stops the Translate all runner before waiting for it", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const { createContentSuggestionRunner: realCreate } = await vi.importActual<
      typeof import("./content-suggestion-runner.js")
    >("./content-suggestion-runner.js");
    let runSignal: AbortSignal | undefined;
    vi.mocked(createContentSuggestionRunner).mockImplementationOnce((deps) => ({
      ...realCreate(deps),
      // Like the real loop, this returns only once its signal aborts.
      run: (signal) => {
        runSignal = signal;
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    }));
    const deadline = new AbortController();
    const outcome = startServer(env).then(
      () => "started",
      (error: unknown) => error,
    );
    const stuck = delay(20_000, "the unwind waited on a runner nobody had stopped", {
      signal: deadline.signal,
    }).catch(() => "deadline cancelled");

    try {
      expect(await Promise.race([outcome, stuck])).toBe(failure);
    } finally {
      deadline.abort();
    }
    expect(createContentSuggestionRunner).toHaveBeenCalledOnce();
    expect(runSignal?.aborted).toBe(true);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);
```

`delay` is the file's existing `node:timers/promises` import (line 6). A failing case prints what went wrong: before the wiring, `expected "spy" to be called once, but got 0 times`; with the unwind entry pushed after the abort, `expected 'the unwind waited on a runner nobody had stopped' to be Error: interfaces unreadable`.

Run: `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts -t "Translate all runner"`
Expected: FAIL — `expected "spy" to be called once, but got 0 times`.

- [ ] **Step 5: Wire the runner and the routes into boot**

In `apps/server/src/boot.ts`:

After `import { runCloudWorker } from "./cloud-worker.js";` (line 14) add:

```ts
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
```

After `import { mountCloudApi } from "./cloud-api.js";` (line 18) add:

```ts
import { mountContentSuggestionsApi } from "./content-suggestions-api.js";
```

After the `mountCloudApi(…);` call (it ends at line 1920, just before `const backupTurns = createTurns();`) add:

```ts
  // The same context `mountCatalogueApi` gives the translations routes (`catalogue-api.ts:873-876`).
  const translationContext = {
    fallbackLanguage: venueLocale,
    required: contentLanguageRules.required,
  };
  const suggestionRunner = cloudConnection
    ? createContentSuggestionRunner({
        db,
        connection: cloudConnection,
        context: translationContext,
        isPrimary: cloudPrimary,
      })
    : undefined;
  mountContentSuggestionsApi(
    app,
    {
      db,
      connection: cloudConnection,
      cloudOrigin,
      context: translationContext,
      managementOrigin: config.managementOrigin,
      isPrimary: cloudPrimary,
      wake: () => suggestionRunner?.wake(),
    },
    log,
  );
```

(`venueLocale` is set at line 1425 and is never undefined, `readVenueLocale` returns a `SupportedLocale`; `contentLanguageRules` at line 1429; `cloudOrigin` at line 745.)

After the `cloudWorker` declaration (lines 2231-2238, ending `: undefined;`) and before `const cloudSnapshots = cloudConnection`, add:

```ts
  const suggestionLoop = suggestionRunner?.run(cloudController.signal, {
    onError: (error) =>
      log("error", "content.suggestion_runner_failed", { errorCode: codeOf(error) }),
  });
```

Replace lines 2270-2273:

```ts
  // The unwind runs newest first: abort before awaiting either duty, even if one rejects.
  undoOnFailure.push(async () => cloudSnapshots);
  undoOnFailure.push(async () => cloudWorker);
  undoOnFailure.push(async () => cloudController.abort());
```

with:

```ts
  // The unwind runs newest first: abort before awaiting any of the three duties, even if one rejects.
  undoOnFailure.push(async () => cloudSnapshots);
  undoOnFailure.push(async () => cloudWorker);
  undoOnFailure.push(async () => suggestionLoop);
  undoOnFailure.push(async () => cloudController.abort());
```

In `stopWork`'s `closeAll` list, after `() => cloudWorker,` (line 2285) add:

```ts
          () => suggestionLoop,
```

(`stopWork` calls `cloudController.abort()` before `closeAll`, so the loop is already stopping when it is awaited.)

- [ ] **Step 6: Run the boot case, then its control**

Run: `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts -t "Translate all runner"`
Expected: PASS.

Control: move `undoOnFailure.push(async () => suggestionLoop);` to after the `cloudController.abort()` line, re-run, and see it fail with `expected 'the unwind waited on a runner nobody had stopped' to be Error: interfaces unreadable` after about 20 seconds. Move it back and re-run: PASS.

- [ ] **Step 7: Run the neighbouring suites**

Run: `pnpm --filter @waitron/server exec vitest run src/content-suggestions-api.test.ts src/content-suggestion-runner.test.ts src/boot.failed-start.test.ts src/boot.test.ts src/cloud-api.test.ts src/content-translations-api.test.ts`
Expected: PASS; read the `Tests` count. Then `pnpm --filter @waitron/server typecheck`. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add apps/server/src/content-suggestions-api.ts apps/server/src/content-suggestions-api.test.ts apps/server/src/boot.ts apps/server/src/boot.failed-start.test.ts
git commit -s -m "Add the Translate all routes, and start the job runner with the server and stop it before a failed start waits for it"
```

If `pnpm format:check` names a file, run `pnpm exec prettier --write <that file>`, re-run the check, then commit.

---

### Task 13: Dashboard client calls and the drafts model

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (type re-exports beside `TranslationBatch` at about line 195; three calls after `saveContentTranslations` at about line 2381)
- Modify: `apps/dashboard/src/api/live-queries.ts` (`getContentSuggestions` beside `getContentTranslationTargets` at about line 97; `listAlerts` at about line 530)
- Modify: `apps/dashboard/src/widgets/content-translations-model.ts` (the whole file is given below)
- Test: `apps/dashboard/src/api/client-routes.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`, `apps/dashboard/src/widgets/content-translations-model.test.ts`

**Interfaces:**
- Consumes: `SuggestionRunView` (Task 8), `ContentSuggestionView`, `ContentSuggestionRead` (Task 10), all from the types-only file `packages/catalogue/src/content-suggestion-types.ts`. If Task 10 put its two view types anywhere else, move them there first: the dashboard imports catalogue types only from types-only files, as it does `content-translation-types.ts` (`client.ts:189-195`).
- Produces:
  - `DashboardApi.startContentSuggestions(): Promise<{ run: SuggestionRunView | null }>` (POST `{}` to `/management-api/content-suggestions/jobs`); `getContentSuggestions(language: string, after?: string): Promise<ContentSuggestionRead>`; `discardContentSuggestion(id: string): Promise<{ deleted: string }>`. `client.ts` re-exports `SuggestionRunView`, `ContentSuggestionView`, `ContentSuggestionRead`.
  - `QUERY_DEPENDENCIES.getContentSuggestions = ["content_suggestions", "content_suggestion_jobs"]`; `listAlerts: ["incidents", "content_suggestion_jobs", "content_suggestions"]`.
  - In `content-translations-model.ts`: `RowSuggestion`, `indexSuggestions(views, language, defaultLanguage)`, and on `TranslationDrafts`: `suggest(found)`, `isSuggested(ref)`, `get suggestedCount()`, `get unfilledCount()` (new name, not in the shared brief: the rows a suggestion could fill that the 100-edit limit left empty; Task 17's message reads it), `personalSubmission()`, `unsuggest(ref)`, `markStale(ref)`, `suggestionFor(ref)`.

How the model holds a suggestion. A person's typing lives in `#values` as today; a filled suggestion lives in a second map, `#filled`, and never in `#values`. So:

- `isEdited` reads `#values` only: a suggestion nobody touched is not a person's edit, and `personalSubmission()` (what the leave guard compares, Decision 5) leaves it out. `submission()` sends both.
- `count` counts both, because the save route's limit of 100 edits (`checkedBatch`, `packages/catalogue/src/content-translations.ts`) counts what is sent. Filling stops when `count` would pass 100; rows filled earlier keep their fill on every refresh, so the drafts never move to other rows.
- Typing into a suggested row makes it a person's edit; typing it back to exactly the suggested text makes it a suggestion again. Emptying it leaves it empty (not edited, not suggested). `reset()` (the leave guard's Discard) clears `#values` and fills the suggestions again.
- A row is filled only when it is eligible, has no text in the page language, nobody has typed in it, its suggestion has text and is not stale, and, when the row also needs the default-language name, a default-language suggestion came too.
- **`snapshot()` keeps a row only when it is a person's edit or is in `gaps` (`content-translations-model.ts:54`).** A suggested row is not a person's edit, so it is refreshed from the latest target like any unedited row, and dropped, fill and all, when the scan stops listing it. A row the page itself leaves out (Decision 1) survives only because the dialog's scan passes it in `gaps` (Task 16).
- `snapshot()` takes a new default language whenever the person has typed nothing (`personalSubmission()` is empty). Today it checks `count`, which would now count suggestions too and hold an old default while only suggestions are filled.
- `unsuggest` and `markStale` remember the suggestion ids, so an older read arriving after a Discard does not fill the row again, while a new suggestion (new ids, from a later run) does. `markStale` lasts while the dialog is open; the next opening reads the server's own stale flag.

- [ ] **Step 1: Write the failing client tests**

In `apps/dashboard/src/api/client-routes.test.ts`, inside `describe("DashboardApi routes", …)`, before `it("reads the missing-translations report from the management route", …)`:

```ts
  it("starts Translate all, reads suggestion pages and discards one suggestion by id", async () => {
    const run = {
      state: "sending",
      total: 3,
      progress: 0,
      done: 0,
      failed: 0,
      code: null,
      fits: null,
      waiting: 0,
      finishedAt: null,
      opened: false,
    };
    const read = {
      language: "ca-ES-valencia",
      run: null,
      suggestions: [],
      next: null,
      service: "on",
      cloudOrigin: "https://cloud.example.test",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ run }))
      .mockResolvedValueOnce(jsonResponse(read))
      .mockResolvedValueOnce(jsonResponse(read))
      .mockResolvedValueOnce(jsonResponse({ deleted: "a/b c" }));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.startContentSuggestions()).resolves.toEqual({ run });
    await expect(api.getContentSuggestions("ca-ES-valencia")).resolves.toEqual(read);
    await expect(api.getContentSuggestions("ca-ES-valencia", "s 1&x")).resolves.toEqual(read);
    await expect(api.discardContentSuggestion("a/b c")).resolves.toEqual({ deleted: "a/b c" });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/content-suggestions/jobs", "POST", {}],
      ["/management-api/content-suggestions?language=ca-ES-valencia", "GET", undefined],
      [
        "/management-api/content-suggestions?language=ca-ES-valencia&after=s+1%26x",
        "GET",
        undefined,
      ],
      ["/management-api/content-suggestions/a%2Fb%20c", "DELETE", undefined],
    ]);
  });
```

In `apps/dashboard/src/api/live-queries.test.ts`, add four rows to the `it.each` table right after `["listAlerts", [], "incidents"],` (about line 109):

```ts
  ["listAlerts", [], "content_suggestion_jobs"],
  ["listAlerts", [], "content_suggestions"],
  ["getContentSuggestions", ["es"], "content_suggestions"],
  ["getContentSuggestions", ["es"], "content_suggestion_jobs"],
```

and in `it("refreshes the open alerts passively and when incidents change", …)` (about line 165) replace `expect(query.dependencies).toEqual([{ type: "incidents" }]);` with:

```ts
  expect(query.dependencies).toEqual([
    { type: "incidents" },
    { type: "content_suggestion_jobs" },
    { type: "content_suggestions" },
  ]);
```

(The bell's alerts read gains the two tables because Task 19's notice is computed from the run; the assertion changes because the behaviour does.)

- [ ] **Step 2: Write the failing model tests**

In `apps/dashboard/src/widgets/content-translations-model.test.ts`, replace the two import lines for the client and the model with:

```ts
import type { ContentSuggestionView, TranslationTarget } from "../api/client.js";
import {
  TranslationDrafts,
  indexSuggestions,
  type RowSuggestion,
} from "./content-translations-model.js";
```

and append at the end of the file:

```ts
const found = (overrides: Partial<RowSuggestion> = {}): RowSuggestion => ({
  ids: ["s"],
  text: null,
  defaultText: null,
  stale: false,
  placeholder: false,
  fixes: [],
  ...overrides,
});

describe("suggested drafts", () => {
  it("fills untouched eligible rows that have no text, and leaves a person's edit alone", () => {
    const one = target("one", { defaultRequired: false });
    const two = target("two", { defaultRequired: false });
    const off = target("off", {
      defaultRequired: false,
      eligible: false,
      unavailableReason: "inactive",
    });
    const named = target("named", { defaultRequired: false, effectiveSelectedText: "Pan" });
    const drafts = new TranslationDrafts("es", "en", [one, two, off, named]);
    drafts.edit(two, "text", "Mine");
    drafts.suggest(
      new Map([
        ["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })],
        ["product:two", found({ ids: ["s2"], text: "CLIENT-es two" })],
        ["product:off", found({ ids: ["s3"], text: "CLIENT-es off" })],
        ["product:named", found({ ids: ["s4"], text: "CLIENT-es named" })],
      ]),
    );
    expect(drafts.value(one, "text")).toBe("CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.isEdited(one)).toBe(false);
    expect(drafts.value(two, "text")).toBe("Mine");
    expect(drafts.isSuggested(two)).toBe(false);
    expect(drafts.value(off, "text")).toBe("");
    expect(drafts.value(named, "text")).toBe("");
    expect(drafts.suggestedCount).toBe(1);
    expect(drafts.count).toBe(2);
    expect(drafts.submission()).toEqual({
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" },
        { kind: "product", id: "two", expected: "baseline-two", text: "Mine" },
      ],
    });
    expect(drafts.personalSubmission()).toEqual({
      edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Mine" }],
    });
  });
  it("skips a stale suggestion, a placeholder, and a missing default with no suggestion of its own", () => {
    const stale = target("stale", { defaultRequired: false });
    const placeholder = target("placeholder", { defaultRequired: false });
    const alone = target("alone");
    const both = target("both");
    const drafts = new TranslationDrafts("es", "en", [stale, placeholder, alone, both]);
    drafts.suggest(
      new Map([
        ["product:stale", found({ text: "CLIENT-es stale", stale: true })],
        ["product:placeholder", found({ placeholder: true })],
        ["product:alone", found({ text: "CLIENT-es alone" })],
        ["product:both", found({ text: "CLIENT-es both", defaultText: "CLIENT-en both" })],
      ]),
    );
    expect(drafts.suggestedCount).toBe(1);
    expect(drafts.value(alone, "text")).toBe("");
    expect(drafts.value(both, "defaultText")).toBe("CLIENT-en both");
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "both",
          expected: "baseline-both",
          text: "CLIENT-es both",
          defaultText: "CLIENT-en both",
        },
      ],
    });
  });
  it("stops at 100 drafts counting a person's edits, and a freed place goes to the next row", () => {
    const rows = Array.from({ length: 102 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const drafts = new TranslationDrafts("es", "en", rows);
    drafts.edit(rows[101]!, "text", "Mine");
    drafts.suggest(
      new Map(
        rows.map((row) => [
          `product:${row.id}`,
          found({ ids: [`s${row.id}`], text: `CLIENT-es ${row.id}` }),
        ]),
      ),
    );
    expect(drafts.count).toBe(100);
    expect(drafts.suggestedCount).toBe(99);
    expect(drafts.isSuggested(rows[98]!)).toBe(true);
    expect(drafts.isSuggested(rows[99]!)).toBe(false);
    expect(drafts.unfilledCount).toBe(2);
    drafts.edit(rows[99]!, "text", "Other");
    expect(drafts.value(rows[99]!, "text")).toBe("");
    drafts.edit(rows[0]!, "text", "Changed");
    expect(drafts.value(rows[0]!, "text")).toBe("Changed");
    expect(drafts.count).toBe(100);
    drafts.unsuggest(rows[1]!);
    expect(drafts.isSuggested(rows[99]!)).toBe(true);
    expect(drafts.isSuggested(rows[100]!)).toBe(false);
    expect(drafts.unfilledCount).toBe(1);
  });
  it("an edited suggestion is the person's edit until it matches the suggestion again, and reset restores it", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.suggest(new Map([["product:one", found({ text: "CLIENT-es one" })]]));
    drafts.edit(one, "text", "Croqueta casera");
    expect(drafts.isSuggested(one)).toBe(false);
    expect(drafts.personalSubmission()).toEqual({
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Croqueta casera" }],
    });
    drafts.edit(one, "text", "CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
    expect(drafts.personalSubmission()).toEqual({ edits: [] });
    drafts.edit(one, "text", "  ");
    expect(drafts.isSuggested(one)).toBe(false);
    expect(drafts.submission()).toEqual({ edits: [] });
    drafts.reset();
    expect(drafts.value(one, "text")).toBe("CLIENT-es one");
    expect(drafts.isSuggested(one)).toBe(true);
  });
  it("a person's companion beside a suggested name keeps the suggested name", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([["product:one", found({ text: "CLIENT-es one", defaultText: "CLIENT-en one" })]]),
    );
    drafts.edit(row, "defaultText", "Ham croquette");
    expect(drafts.personalSubmission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          expected: "baseline-one",
          text: "CLIENT-es one",
          defaultText: "Ham croquette",
        },
      ],
    });
  });
  it("unsuggest empties the row and ignores that suggestion when read again, but not a new one", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    const first = new Map([["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })]]);
    drafts.suggest(first);
    drafts.unsuggest(one);
    expect(drafts.value(one, "text")).toBe("");
    expect(drafts.suggestionFor(one)).toBeUndefined();
    drafts.suggest(first);
    expect(drafts.value(one, "text")).toBe("");
    drafts.suggest(new Map([["product:one", found({ ids: ["s9"], text: "CLIENT-es again" })]]));
    expect(drafts.value(one, "text")).toBe("CLIENT-es again");
  });
  it("markStale keeps the suggestion as out of date and fills nothing from it", () => {
    const one = target("one", { defaultRequired: false });
    const two = target("two", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one, two]);
    const index = new Map([
      ["product:one", found({ ids: ["s1"], text: "CLIENT-es one" })],
      ["product:two", found({ ids: ["s2"], text: "CLIENT-es two" })],
    ]);
    drafts.suggest(index);
    drafts.markStale(one);
    expect(drafts.value(one, "text")).toBe("");
    expect(drafts.suggestionFor(one)?.stale).toBe(true);
    expect(drafts.isSuggested(two)).toBe(true);
    drafts.suggest(index);
    expect(drafts.value(one, "text")).toBe("");
  });
  it("a suggested row in the scan is refreshed; one the scan stops listing goes, fill and all", () => {
    const listed = target("listed", { defaultRequired: false });
    const absent = target("absent", { defaultRequired: false });
    const drafts = new TranslationDrafts("ca", "ca", [listed, absent]);
    drafts.suggest(
      new Map([
        ["product:listed", found({ ids: ["s1"], text: "CLIENT-ca listed" })],
        ["product:absent", found({ ids: ["s2"], text: "CLIENT-ca absent" })],
      ]),
    );
    drafts.snapshot([listed, { ...absent, expected: "refreshed-absent" }], []);
    expect(drafts.rows.map((row) => row.id)).toEqual(["listed", "absent"]);
    expect(drafts.isSuggested(absent)).toBe(true);
    expect(drafts.submission().edits.map((edit) => edit.expected)).toEqual([
      "baseline-listed",
      "refreshed-absent",
    ]);
    drafts.snapshot([listed], []);
    expect(drafts.rows.map((row) => row.id)).toEqual(["listed"]);
    expect(drafts.count).toBe(1);
    drafts.snapshot([listed, absent], []);
    expect(drafts.arrivals).toBe(1);
    expect(drafts.isSuggested(absent)).toBe(false);
    drafts.review([listed, absent], new Map());
    expect(drafts.value(absent, "text")).toBe("CLIENT-ca absent");
  });
  it("a new default language is taken up while only suggestions are filled", () => {
    const row = target("one");
    const drafts = new TranslationDrafts("es", "en", [row]);
    drafts.suggest(
      new Map([["product:one", found({ text: "CLIENT-es one", defaultText: "CLIENT-en one" })]]),
    );
    drafts.snapshot([{ ...row, expected: "new-default" }], [], "fr");
    expect(drafts.defaultLanguage).toBe("fr");
  });
  it("checks a suggested name's UTF-8 bytes like a typed one", () => {
    const one = target("one", { defaultRequired: false });
    const drafts = new TranslationDrafts("es", "en", [one]);
    drafts.suggest(new Map([["product:one", found({ text: "é".repeat(2049) })]]));
    expect(drafts.validate()).toEqual([
      { target: { kind: "product", id: "one" }, field: "text", message: "name_bytes" },
    ]);
  });
});

it("indexes each item's suggestions for the page language, its default and its notes", () => {
  const view = (overrides: Partial<ContentSuggestionView>): ContentSuggestionView => ({
    id: "s",
    kind: "product",
    itemId: "one",
    language: null,
    text: null,
    placeholder: false,
    fix: null,
    stale: false,
    ...overrides,
  });
  const views = [
    view({ id: "s1", language: "es", text: "CLIENT-es one" }),
    view({ id: "s2", language: "en", text: "CLIENT-en one", stale: true }),
    view({ id: "s3", fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" } }),
    view({ id: "s4", kind: "variant", placeholder: true }),
    view({
      id: "s5",
      itemId: "two",
      language: "ca",
      fix: { field: "ca", wrong: "Crocretes", right: "Croquetes" },
    }),
  ];
  expect(indexSuggestions(views, "es", "en")).toEqual(
    new Map([
      [
        "product:one",
        {
          ids: ["s1", "s2", "s3"],
          text: "CLIENT-es one",
          defaultText: "CLIENT-en one",
          stale: true,
          placeholder: false,
          fixes: [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }],
        },
      ],
      [
        "variant:one",
        { ids: ["s4"], text: null, defaultText: null, stale: false, placeholder: true, fixes: [] },
      ],
      [
        "product:two",
        {
          ids: ["s5"],
          text: null,
          defaultText: null,
          stale: false,
          placeholder: false,
          fixes: [{ field: "ca", wrong: "Crocretes", right: "Croquetes" }],
        },
      ],
    ]),
  );
  expect(indexSuggestions([views[1]!], "en", "en").get("product:one")).toMatchObject({
    text: "CLIENT-en one",
    defaultText: null,
    stale: true,
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/api/live-queries.test.ts src/widgets/content-translations-model.test.ts
```

Expected: FAIL. `api.startContentSuggestions is not a function`; the four new `it.each` rows and the `listAlerts` dependency case fail (no `getContentSuggestions` entry, and `listAlerts` still names only `incidents`); the model file fails to load because `indexSuggestions` is not exported.

- [ ] **Step 4: Add the client calls**

In `apps/dashboard/src/api/client.ts`, right after `export type { TranslationBatch, TranslationPage, TranslationRef, TranslationTarget };` (about line 195):

```ts
import type {
  ContentSuggestionRead,
  ContentSuggestionView,
  SuggestionRunView,
} from "@waitron/catalogue/src/content-suggestion-types.js";
export type { ContentSuggestionRead, ContentSuggestionView, SuggestionRunView };
```

and right before `saveContentTranslations(` (about line 2381):

```ts
  startContentSuggestions(): Promise<{ run: SuggestionRunView | null }> {
    return this.#request("/management-api/content-suggestions/jobs", "POST", {});
  }

  getContentSuggestions(language: string, after?: string): Promise<ContentSuggestionRead> {
    const params = new URLSearchParams({ language });
    if (after !== undefined) params.append("after", after);
    return this.#request(`/management-api/content-suggestions?${params}`, "GET");
  }

  discardContentSuggestion(id: string): Promise<{ deleted: string }> {
    return this.#request(`/management-api/content-suggestions/${encodeURIComponent(id)}`, "DELETE");
  }

```

- [ ] **Step 5: Declare the dependencies**

In `apps/dashboard/src/api/live-queries.ts`, before `getContentTranslationTargets: [` add:

```ts
  getContentSuggestions: ["content_suggestions", "content_suggestion_jobs"],
```

and replace `listAlerts: ["incidents"],` with:

```ts
  listAlerts: ["incidents", "content_suggestion_jobs", "content_suggestions"],
```

- [ ] **Step 6: Replace the drafts model**

Replace the whole of `apps/dashboard/src/widgets/content-translations-model.ts` with:

```ts
import { sameValue } from "./product-editor-model.js";
import type {
  ContentSuggestionView,
  TranslationBatch,
  TranslationRef,
  TranslationTarget,
} from "../api/client.js";

export interface FieldFault {
  target: TranslationRef;
  field: "text" | "defaultText";
  message: string;
}

export type ReviewChoice = "keep" | "replace" | "discard";

export interface RowSuggestion {
  ids: string[];
  text: string | null;
  defaultText: string | null;
  stale: boolean;
  placeholder: boolean;
  fixes: { field: string; wrong: string; right: string }[];
}

interface DraftValues {
  text: string;
  defaultText: string;
}

export class TranslationDrafts {
  #latest = new Map<string, TranslationTarget>();
  #receivedSnapshot = false;
  #gaps: readonly TranslationTarget[] = [];
  #latestDefaultLanguage: string;
  readonly #targets: Map<string, TranslationTarget>;
  readonly #values = new Map<string, DraftValues>();
  #suggestions = new Map<string, RowSuggestion>();
  #filled = new Map<string, DraftValues>();
  readonly #dismissed = new Set<string>();
  readonly #staleIds = new Set<string>();
  constructor(
    readonly language: string,
    public defaultLanguage: string,
    public rows: readonly TranslationTarget[],
  ) {
    this.rows = structuredClone(rows);
    this.#targets = new Map(this.rows.map((row) => [translationKey(row), row]));
    this.#latestDefaultLanguage = defaultLanguage;
  }
  get arrivals(): number {
    return this.#gaps.filter((row) => !this.#targets.has(translationKey(row))).length;
  }
  current(ref: TranslationRef): TranslationTarget | undefined {
    return this.#latest.get(translationKey(ref));
  }
  changed(ref: TranslationRef): boolean {
    const baseline = this.#targets.get(translationKey(ref));
    const current = this.current(ref);
    return (
      this.isEdited(ref) &&
      this.#receivedSnapshot &&
      (!current || !current.eligible || current.expected !== baseline?.expected)
    );
  }
  snapshot(
    gaps: readonly TranslationTarget[],
    retained: readonly TranslationTarget[],
    defaultLanguage = this.defaultLanguage,
  ): void {
    this.#receivedSnapshot = true;
    this.#latestDefaultLanguage = defaultLanguage;
    if (!this.personalSubmission().edits.length) this.defaultLanguage = defaultLanguage;
    this.#gaps = gaps;
    this.#latest = new Map([...gaps, ...retained].map((row) => [translationKey(row), row]));
    const present = new Set(gaps.map(translationKey));
    this.rows = this.rows.filter((row) => this.isEdited(row) || present.has(translationKey(row)));
    const kept = new Set(this.rows.map(translationKey));
    for (const key of this.#targets.keys()) if (!kept.has(key)) this.#targets.delete(key);
    for (const row of this.rows) {
      if (!this.isEdited(row)) {
        const latest = this.current(row);
        if (latest) Object.assign(row, latest);
      }
    }
    this.#refill();
  }
  review(latest: readonly TranslationTarget[], choices: Map<string, ReviewChoice>): void {
    const current = new Map(latest.map((row) => [translationKey(row), row]));
    const unresolved: TranslationTarget[] = [];
    for (const row of this.rows) {
      if (!this.isEdited(row)) continue;
      const key = translationKey(row);
      const next = current.get(key);
      if (!next || (this.changed(row) && !choices.has(key))) {
        unresolved.push(row);
        continue;
      }
      const choice = choices.get(key);
      if (choice === "discard" || choice === "replace") this.#values.delete(key);
      if (choice === "keep" && (!next.eligible || !sameValue(next.owners, row.owners))) {
        unresolved.push(row);
        continue;
      }
      if (
        choice === "keep" &&
        (!next.defaultRequired || this.#latestDefaultLanguage !== this.defaultLanguage)
      ) {
        const values = this.#values.get(key);
        if (values) values.defaultText = "";
      }
      Object.assign(row, next);
      if (next.eligible || this.#gaps.some((gap) => translationKey(gap) === key))
        unresolved.push(row);
    }
    this.rows = [
      ...this.#gaps.map(
        (row) => unresolved.find((held) => translationKey(held) === translationKey(row)) ?? row,
      ),
      ...unresolved.filter(
        (row) => !this.#gaps.some((gap) => translationKey(gap) === translationKey(row)),
      ),
    ];
    this.#targets.clear();
    for (const row of this.rows) this.#targets.set(translationKey(row), row);
    if (!this.rows.some((row) => this.changed(row)))
      this.defaultLanguage = this.#latestDefaultLanguage;
    this.#refill();
  }
  get count(): number {
    return this.submission().edits.length;
  }
  edit(ref: TranslationRef, field: "text" | "defaultText", text: string): void {
    const key = translationKey(ref);
    const row = this.#targets.get(key);
    if (!row?.eligible || (field === "defaultText" && !this.needsDefault(row))) return;
    if (!this.isEdited(ref) && !this.isSuggested(ref) && this.count >= 100) return;
    const next = {
      text: this.value(row, "text"),
      defaultText: this.value(row, "defaultText"),
      [field]: text,
    };
    const filled = this.#filled.get(key);
    if (filled?.text === next.text && filled.defaultText === next.defaultText)
      this.#values.delete(key);
    else this.#values.set(key, next);
  }
  needsDefault(row: TranslationTarget): boolean {
    return this.language !== this.defaultLanguage && row.defaultRequired;
  }
  value(ref: TranslationRef, field: "text" | "defaultText"): string {
    const key = translationKey(ref);
    return (
      this.#values.get(key)?.[field] ??
      this.#filled.get(key)?.[field] ??
      (field === "text" ? (this.#targets.get(key)?.selectedText ?? "") : "")
    );
  }
  /** A person's own edit; a suggestion filled in and left untouched is not one. */
  isEdited(ref: TranslationRef): boolean {
    const key = translationKey(ref);
    const row = this.#targets.get(key);
    const values = this.#values.get(key);
    if (!row || !values) return false;
    const text = values.text.trim();
    const companion = values.defaultText.trim();
    if (!text && !companion) return false;
    return text !== (row.selectedText ?? "").trim() || companion !== "";
  }
  isSuggested(ref: TranslationRef): boolean {
    const key = translationKey(ref);
    return this.#filled.has(key) && !this.#values.has(key) && this.#targets.has(key);
  }
  get suggestedCount(): number {
    return this.rows.filter((row) => this.isSuggested(row)).length;
  }
  /** Rows a waiting suggestion could fill that the 100-edit limit left empty. */
  get unfilledCount(): number {
    return this.rows.filter(
      (row) =>
        !this.#filled.has(translationKey(row)) &&
        !this.#values.has(translationKey(row)) &&
        this.#fillable(row) !== undefined,
    ).length;
  }
  suggestionFor(ref: TranslationRef): RowSuggestion | undefined {
    const found = this.#suggestions.get(translationKey(ref));
    if (!found || found.ids.every((id) => this.#dismissed.has(id))) return undefined;
    return found.ids.some((id) => this.#staleIds.has(id)) ? { ...found, stale: true } : found;
  }
  suggest(found: ReadonlyMap<string, RowSuggestion>): void {
    this.#suggestions = new Map(found);
    this.#refill();
  }
  unsuggest(ref: TranslationRef): void {
    for (const id of this.#suggestions.get(translationKey(ref))?.ids ?? []) this.#dismissed.add(id);
    this.#refill();
  }
  markStale(ref: TranslationRef): void {
    for (const id of this.#suggestions.get(translationKey(ref))?.ids ?? []) this.#staleIds.add(id);
    this.#refill();
  }
  #fillable(row: TranslationTarget): DraftValues | undefined {
    const found = this.suggestionFor(row);
    if (
      !row.eligible ||
      (row.effectiveSelectedText ?? "").trim() ||
      !found ||
      found.stale ||
      found.text === null
    )
      return undefined;
    if (!this.needsDefault(row)) return { text: found.text, defaultText: "" };
    return found.defaultText === null
      ? undefined
      : { text: found.text, defaultText: found.defaultText };
  }
  // Rows filled before keep their fill, so a refresh never moves the 100 drafts to other rows.
  #refill(): void {
    const previous = this.#filled;
    this.#filled = new Map();
    let room = 100 - this.personalSubmission().edits.length;
    const fill = (row: TranslationTarget): void => {
      const key = translationKey(row);
      if (room <= 0 || this.#filled.has(key) || this.#values.has(key)) return;
      const values = this.#fillable(row);
      if (!values) return;
      this.#filled.set(key, values);
      room--;
    };
    for (const row of this.rows) if (previous.has(translationKey(row))) fill(row);
    for (const row of this.rows) fill(row);
  }
  submission(): TranslationBatch {
    return this.#batch((row) => this.isEdited(row) || this.isSuggested(row));
  }
  personalSubmission(): TranslationBatch {
    return this.#batch((row) => this.isEdited(row));
  }
  #batch(include: (row: TranslationTarget) => boolean): TranslationBatch {
    return {
      edits: this.rows.filter(include).map((row) => ({
        kind: row.kind,
        id: row.id,
        expected: row.expected,
        text: this.value(row, "text").trim(),
        ...(this.needsDefault(row) && this.value(row, "defaultText").trim()
          ? { defaultText: this.value(row, "defaultText").trim() }
          : {}),
      })),
    };
  }
  validate(): FieldFault[] {
    const faults: FieldFault[] = [];
    for (const row of this.rows) {
      if (!this.isEdited(row) && !this.isSuggested(row)) continue;
      const target = { kind: row.kind, id: row.id };
      if (this.changed(row)) faults.push({ target, field: "text", message: "review" });
      const fields = this.needsDefault(row)
        ? (["text", "defaultText"] as const)
        : (["text"] as const);
      for (const field of fields) {
        const value = this.value(row, field).trim();
        if (!value) faults.push({ target, field, message: "required" });
        else if (new TextEncoder().encode(value).length > 4096)
          faults.push({ target, field, message: "name_bytes" });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(this.submission())).length > 262144) {
      const first = this.submission().edits[0]!;
      faults.push({
        target: { kind: first.kind, id: first.id },
        field: "text",
        message: "batch_bytes",
      });
    }
    return faults;
  }
  reset(): void {
    this.#values.clear();
    this.#refill();
  }
}

export function indexSuggestions(
  views: readonly ContentSuggestionView[],
  language: string,
  defaultLanguage: string,
): Map<string, RowSuggestion> {
  const index = new Map<string, RowSuggestion>();
  for (const view of views) {
    const key = translationKey({ kind: view.kind, id: view.itemId });
    const entry = index.get(key) ?? {
      ids: [],
      text: null,
      defaultText: null,
      stale: false,
      placeholder: false,
      fixes: [],
    };
    entry.ids.push(view.id);
    if (view.placeholder) entry.placeholder = true;
    if (view.fix) entry.fixes.push(view.fix);
    if (view.text !== null && (view.language === language || view.language === defaultLanguage)) {
      if (view.language === language) entry.text = view.text;
      else entry.defaultText = view.text;
      entry.stale ||= view.stale;
    }
    index.set(key, entry);
  }
  return index;
}

export function translationKey(ref: TranslationRef): string {
  return `${ref.kind}:${ref.id}`;
}
```

- [ ] **Step 7: Run the tests to see them pass, and the dialog's suites unchanged**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/api/live-queries.test.ts src/widgets/content-translations-model.test.ts src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-translations-dialog.a11y.test.ts
pnpm exec vitest run scripts/live-subscriptions.test.ts
pnpm --filter @waitron/dashboard typecheck
```

Expected: PASS, no failures in the `Tests` line (the model file alone runs 29 tests: its 18 and these 11). The dialog does not call `suggest` yet, so nothing fills and its suites behave as before. The guard passes because Task 5 classified both tables, which makes them change sources (`CATALOGUE_CHANGE_SOURCES`, `packages/catalogue/src/classification.ts`). Control for the snapshot rule: change `snapshot`'s `if (!this.personalSubmission().edits.length)` back to `if (!this.count)` and see "a new default language is taken up while only suggestions are filled" fail; restore.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/live-queries.ts apps/dashboard/src/api/client-routes.test.ts apps/dashboard/src/api/live-queries.test.ts apps/dashboard/src/widgets/content-translations-model.ts apps/dashboard/src/widgets/content-translations-model.test.ts
git commit -s -m "The dashboard can start Translate all, read and discard suggestions, and hold them as drafts that are not a person's edits"
```

---

### Task 14: The Translate all bar in the translations dialog

**Files:**
- Create: `apps/dashboard/src/widgets/content-suggestions-bar.ts`
- Create: `apps/dashboard/src/widgets/content-suggestions-bar.test.ts`
- Create: `apps/dashboard/src/widgets/content-suggestions-bar.a11y.test.ts`
- Create: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts`
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.ts` (imports, state, `willUpdate`, `disconnectedCallback`, `#load`, `#save`, `render`; a second live query `suggestion-run`; `#translateAll`)
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts` (its fake API answers the suggestion read)
- Modify: `apps/dashboard/src/i18n/strings.ts` (the `suggestions.*` strings, both tables)

**Interfaces:**
- Consumes (Task 13): `DashboardApi.getContentSuggestions(language, after?) → Promise<ContentSuggestionRead>`, `DashboardApi.startContentSuggestions() → Promise<{ run: SuggestionRunView | null }>`, the types `SuggestionRunView` and `ContentSuggestionRead` re-exported from `apps/dashboard/src/api/client.ts`, and `QUERY_DEPENDENCIES.getContentSuggestions` (`["content_suggestions", "content_suggestion_jobs"]`, `apps/dashboard/src/api/live-queries.ts`). Error wording for the `content.suggestion_*` codes in `apps/dashboard/src/i18n/codes.ts` (Task 4).
- Produces:
  - `<dashboard-content-suggestions-bar>` (`ContentSuggestionsBar`), properties `service: SuggestionService | null` (null until the first suggestion read answers), `run: SuggestionRunView | null`, `busy: boolean`, `error: string`, `nothing: boolean` (the last POST answered `{ run: null }`), `cloudOrigin: string | null`; it dispatches `translate-all` (`bubbles: true, composed: true`, no `detail`; an app-owned component names its event plainly) and stops the click that caused it.
  - `export type SuggestionService = "on" | "off" | "not_connected"` and `export function runActive(run: SuggestionRunView | null): boolean` (true for `sending` and `running`) from the bar's file.
  - In the dialog: a second live query in slot `suggestion-run`, key `JSON.stringify(["suggestion-run", language, generation])`, dependencies `QUERY_DEPENDENCIES.getContentSuggestions`, read `client.getContentSuggestions(language)` (first page only; it uses `run`, `service` and `cloudOrigin`), released wherever `translations` is released. Private state `suggestionRun`, `service` (`SuggestionService | null`, initially `null`), `cloudOrigin`, `suggestionBusy`, `suggestionError`, `suggestionReadError`, `nothingMissing`; `#translateAll`.

**Why the read catches its own failure.** The dialog's `QueryController` error callback (`content-translations-dialog.ts:154-163`) turns ANY slot's failure into the dialog's load error. A failed suggestion read would then put "could not be loaded" over translations that loaded fine. So the suggestion read returns its failure as a value, and the bar tells it in its own message line; the translations stay usable without Translate all. It also means the dialog's existing suites, whose fake APIs have no `getContentSuggestions`, keep passing: their bar shows `codeMessage("server.internal")` and nothing else changes.

**Why a read that began before Translate all answered keeps its hands off the run.** The POST's reply carries the run it started (`sending`). A live read already under way when the POST was sent can answer after it with the previous run (for instance `done`), which would redraw the button as ready for a moment and invite a second press that the server refuses. Each read takes a sequence number; when the POST answers, the dialog records the highest number started so far, and a read at or below it updates `service` and `cloudOrigin` but not `run`. The POST's own write to `content_suggestion_jobs` causes the next read, which is newer and does apply.

States, each one sentence (concise product text). Checked top to bottom; the first that matches shows:

| Condition | Shows |
| --- | --- |
| `service` null (not read yet) | nothing but the button |
| `not_connected` | "Waitron Cloud can suggest every missing customer-facing name, in every language. Nothing reaches diners until you save it." and a link "Connect to Waitron Cloud" to `/manage/cloud` |
| `off` | "Translate all is not switched on for this venue in Waitron Cloud." |
| run `sending` | "Sending the names to Waitron Cloud…" (role status) |
| run `running` | "Translating… {progress} of {total}" (role status) |
| POST answered `{ run: null }` | "Every missing name already has a suggestion." (role status) |
| no run | the `not_connected` sentence, without the link |
| run `done` | "{count} suggestions are waiting for review." (`count` = `run.waiting`) |
| run `partly_done` | the same, then "{failed} couldn't be done this time. Translate all sends only those."; when the run's `code` is `content.suggestion_limit_reached` (the cap stopped it), that code's message replaces the second sentence, because pressing again this month would be refused |
| run `refused`, `failed`, `expired` | the run's `code` message (`codeMessage`); for `content.suggestion_limit_reached` also "{fits} more names would fit this month." when `fits` > 0; for `content.suggestion_consent_required` a link "Open Waitron Cloud" to `<cloudOrigin>/account` (contract, "Consent"), left out when `cloudOrigin` is null |

A refusal from the POST, or a failed read, goes in the bar's own message line (role alert) under the state line; it never disables the button by itself.

The button "Translate all" is always rendered (design-system.md → Forms, the not-a-save rule, owner 2026-10-08, A416 and A427): drawn `secondary` and disabled while it waits for the first read (`service` null), while the service is not `on`, and while a run is `sending` or `running` (the run rules it out); drawn `primary` once it can act, and kept `primary` with `loading` (which disables it) while its own POST is being sent.

`cloudOrigin` comes from the GET reply (Task 12 fills it from the saved connection). The dialog makes no `getCloudStatus` call, which needs `system.manage`.

- [ ] **Step 1: Add the strings.** In `apps/dashboard/src/i18n/strings.ts`, in the `en` table directly after `"translations.page": "Page {page} of {pages}",` (about line 518):

```ts
  "suggestions.translate_all": "Translate all",
  "suggestions.about":
    "Waitron Cloud can suggest every missing customer-facing name, in every language. Nothing reaches diners until you save it.",
  "suggestions.connect": "Connect to Waitron Cloud",
  "suggestions.off": "Translate all is not switched on for this venue in Waitron Cloud.",
  "suggestions.sending": "Sending the names to Waitron Cloud…",
  "suggestions.progress": "Translating… {progress} of {total}",
  "suggestions.waiting": "{count} suggestions are waiting for review.",
  "suggestions.partly": "{failed} couldn't be done this time. Translate all sends only those.",
  "suggestions.nothing": "Every missing name already has a suggestion.",
  "suggestions.fits": "{fits} more names would fit this month.",
  "suggestions.open_cloud": "Open Waitron Cloud",
```

In the `es` table directly after `"translations.page": "Página {page} de {pages}",` (about line 3385):

```ts
  "suggestions.translate_all": "Traducir todo",
  "suggestions.about":
    "Waitron Cloud puede sugerir todos los nombres para clientes que faltan, en todos los idiomas. Nada llega a los clientes hasta que lo guardas.",
  "suggestions.connect": "Conectar con Waitron Cloud",
  "suggestions.off": "Traducir todo no está activado para este local en Waitron Cloud.",
  "suggestions.sending": "Enviando los nombres a Waitron Cloud…",
  "suggestions.progress": "Traduciendo… {progress} de {total}",
  "suggestions.waiting": "{count} sugerencias pendientes de revisar.",
  "suggestions.partly": "{failed} no se han podido hacer esta vez. Traducir todo envía solo esas.",
  "suggestions.nothing": "Todos los nombres que faltan ya tienen una sugerencia.",
  "suggestions.fits": "Este mes cabrían {fits} nombres más.",
  "suggestions.open_cloud": "Abrir Waitron Cloud",
```

- [ ] **Step 2: Write the bar's failing tests.** Create `apps/dashboard/src/widgets/content-suggestions-bar.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { SuggestionRunView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-suggestions-bar.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const run = (overrides: Partial<SuggestionRunView> = {}): SuggestionRunView => ({
  state: "done",
  total: 358,
  progress: 358,
  done: 358,
  failed: 0,
  code: null,
  fits: null,
  waiting: 358,
  finishedAt: "2026-10-14T10:00:00.000Z",
  opened: false,
  ...overrides,
});
const SENDING = run({ state: "sending", progress: 0, done: 0, waiting: 0, finishedAt: null });
const RUNNING = run({ state: "running", progress: 180, done: 180, waiting: 0, finishedAt: null });
const PARTLY = run({ state: "partly_done", done: 270, failed: 88, waiting: 270 });
const LIMIT = "content.suggestion_limit_reached";
const CONSENT = "content.suggestion_consent_required";
const ABOUT_EN =
  "Waitron Cloud can suggest every missing customer-facing name, in every language. Nothing reaches diners until you save it.";
const ABOUT_ES =
  "Waitron Cloud puede sugerir todos los nombres para clientes que faltan, en todos los idiomas. Nada llega a los clientes hasta que lo guardas.";

function mount(props: Partial<ContentSuggestionsBar> = {}) {
  return mountWidget<ContentSuggestionsBar>("dashboard-content-suggestions-bar", {
    service: "on",
    run: null,
    busy: false,
    error: "",
    nothing: false,
    cloudOrigin: null,
    ...props,
  });
}
const q = (el: ContentSuggestionsBar, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const lines = (el: ContentSuggestionsBar) =>
  [...el.shadowRoot!.querySelectorAll(".lines > p")]
    .map((line) => line.textContent!.replace(/\s+/g, " ").trim())
    .join(" | ");
const button = (el: ContentSuggestionsBar) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=translate-all]")!;

const STATES: {
  name: string;
  props: Partial<ContentSuggestionsBar>;
  en: () => string;
  es: () => string;
}[] = [
  { name: "not read yet", props: { service: null }, en: () => "", es: () => "" },
  {
    name: "not connected",
    props: { service: "not_connected" },
    en: () => `${ABOUT_EN} Connect to Waitron Cloud`,
    es: () => `${ABOUT_ES} Conectar con Waitron Cloud`,
  },
  {
    name: "switched off in Cloud",
    props: { service: "off" },
    en: () => "Translate all is not switched on for this venue in Waitron Cloud.",
    es: () => "Traducir todo no está activado para este local en Waitron Cloud.",
  },
  { name: "ready with no run", props: {}, en: () => ABOUT_EN, es: () => ABOUT_ES },
  {
    name: "sending",
    props: { run: SENDING },
    en: () => "Sending the names to Waitron Cloud…",
    es: () => "Enviando los nombres a Waitron Cloud…",
  },
  {
    name: "running",
    props: { run: RUNNING },
    en: () => "Translating… 180 of 358",
    es: () => "Traduciendo… 180 de 358",
  },
  {
    name: "running after a press that found nothing",
    props: { run: RUNNING, nothing: true },
    en: () => "Translating… 180 of 358",
    es: () => "Traduciendo… 180 de 358",
  },
  {
    name: "done",
    props: { run: run() },
    en: () => "358 suggestions are waiting for review.",
    es: () => "358 sugerencias pendientes de revisar.",
  },
  {
    name: "partly done",
    props: { run: PARTLY },
    en: () =>
      "270 suggestions are waiting for review. | 88 couldn't be done this time. Translate all sends only those.",
    es: () =>
      "270 sugerencias pendientes de revisar. | 88 no se han podido hacer esta vez. Traducir todo envía solo esas.",
  },
  {
    name: "partly done at the spending cap",
    props: { run: { ...PARTLY, code: LIMIT, fits: 0 } },
    en: () => `270 suggestions are waiting for review. | ${codeMessage(LIMIT)}`,
    es: () => `270 sugerencias pendientes de revisar. | ${codeMessage(LIMIT)}`,
  },
  {
    name: "refused at the cap with room left",
    props: { run: run({ state: "refused", code: LIMIT, fits: 40, waiting: 0 }) },
    en: () => `${codeMessage(LIMIT)} 40 more names would fit this month.`,
    es: () => `${codeMessage(LIMIT)} Este mes cabrían 40 nombres más.`,
  },
  {
    name: "refused at the cap with no room",
    props: { run: run({ state: "refused", code: LIMIT, fits: 0, waiting: 0 }) },
    en: () => codeMessage(LIMIT),
    es: () => codeMessage(LIMIT),
  },
  {
    name: "refused for consent",
    props: {
      run: run({ state: "refused", code: CONSENT, waiting: 0 }),
      cloudOrigin: "https://cloud.example.test",
    },
    en: () => `${codeMessage(CONSENT)} Open Waitron Cloud`,
    es: () => `${codeMessage(CONSENT)} Abrir Waitron Cloud`,
  },
  {
    name: "refused for consent with no Cloud origin",
    props: { run: run({ state: "refused", code: CONSENT, waiting: 0 }) },
    en: () => codeMessage(CONSENT),
    es: () => codeMessage(CONSENT),
  },
  {
    name: "failed",
    props: { run: run({ state: "failed", code: "content.suggestion_service_unavailable" }) },
    en: () => codeMessage("content.suggestion_service_unavailable"),
    es: () => codeMessage("content.suggestion_service_unavailable"),
  },
  {
    name: "expired",
    props: { run: run({ state: "expired", code: "content.suggestion_expired" }) },
    en: () => codeMessage("content.suggestion_expired"),
    es: () => codeMessage("content.suggestion_expired"),
  },
  {
    name: "a press that found nothing",
    props: { run: run(), nothing: true },
    en: () => "Every missing name already has a suggestion.",
    es: () => "Todos los nombres que faltan ya tienen una sugerencia.",
  },
  {
    name: "a refusal",
    props: { error: "Refused." },
    en: () => `${ABOUT_EN} | Refused.`,
    es: () => `${ABOUT_ES} | Refused.`,
  },
];

describe.each([
  ["en-GB", "en"],
  ["es-ES", "es"],
] as const)("the Translate all bar in %s", (locale, column) => {
  it.each(STATES.map((state) => [state.name, state] as const))("shows %s", async (_name, state) => {
    setLocale(locale);
    const { el } = await mount(state.props);
    expect(lines(el)).toBe(state[column]());
    expect(button(el).textContent!.trim()).toBe(locale === "en-GB" ? "Translate all" : "Traducir todo");
  });
});

it.each([
  CONSENT,
  LIMIT,
  "content.suggestion_service_unavailable",
  "content.suggestion_expired",
  "content.suggestion_job_running",
])("has its own sentence for %s in both languages", (code) => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    expect(codeMessage(code)).not.toBe(codeMessage("no.such_code"));
  }
});

it.each([
  ["it has not read the service yet", { service: null }, true, "secondary", false],
  ["the box is not connected", { service: "not_connected" }, true, "secondary", false],
  ["the service is switched off", { service: "off" }, true, "secondary", false],
  ["it can act", {}, false, "primary", false],
  ["a run is being sent", { run: SENDING }, true, "secondary", false],
  ["a run is running", { run: RUNNING }, true, "secondary", false],
  ["a run is done", { run: run() }, false, "primary", false],
  ["a run is partly done", { run: PARTLY }, false, "primary", false],
  ["a run was refused", { run: run({ state: "refused", code: CONSENT }) }, false, "primary", false],
  ["its own request is being sent", { busy: true }, true, "primary", true],
  ["a refusal is shown", { error: "Refused." }, false, "primary", false],
] as const)("draws the button when %s", async (_name, props, disabled, variant, loading) => {
  const { el } = await mount(props as Partial<ContentSuggestionsBar>);
  expect(button(el).disabled).toBe(disabled);
  expect(button(el).getAttribute("variant")).toBe(variant);
  expect(button(el).loading).toBe(loading);
});

it("asks for Translate all once per press and lets no click escape", async () => {
  const { el, host } = await mount();
  const asked = vi.fn();
  const clicks = vi.fn();
  host.addEventListener("translate-all", asked);
  host.addEventListener("click", clicks);
  await userEvent.click(button(el));
  expect(asked).toHaveBeenCalledOnce();
  expect(clicks).not.toHaveBeenCalled();
  await userEvent.click(button(el));
  expect(asked).toHaveBeenCalledTimes(2);
});

it("asks nothing when its button is clicked while it cannot act", async () => {
  const { el } = await mount({ run: RUNNING });
  const asked = vi.fn();
  el.addEventListener("translate-all", asked);
  // A click on the host reaches the bar's listener even though the inner button is disabled.
  button(el).click();
  await el.updateComplete;
  expect(asked).not.toHaveBeenCalled();
});

it("announces progress and refusals", async () => {
  const { el } = await mount({ run: RUNNING, error: "Refused." });
  expect(q(el, ".lines > p[role=status]")!.textContent).toContain("180");
  expect(q(el, "[data-test=suggestions-error]")!.getAttribute("role")).toBe("alert");
  el.run = SENDING;
  await el.updateComplete;
  expect(q(el, ".lines > p[role=status]")).not.toBeNull();
  el.run = null;
  el.nothing = true;
  await el.updateComplete;
  expect(q(el, ".lines > p[role=status]")).not.toBeNull();
});

it("links a consent refusal to the Cloud account page in a new tab", async () => {
  const { el } = await mount({
    run: run({ state: "refused", code: CONSENT }),
    cloudOrigin: "https://cloud.example.test",
  });
  const link = q(el, "[data-test=suggestions-consent]")!;
  expect(link.getAttribute("href")).toBe("https://cloud.example.test/account");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

it("links a box that is not connected to the Cloud services screen", async () => {
  const { el } = await mount({ service: "not_connected" });
  expect(q(el, "[data-test=suggestions-connect]")!.getAttribute("href")).toBe("/manage/cloud");
  expect(q(el, "[data-test=suggestions-consent]")).toBeNull();
});

it("fits a phone screen without scrolling sideways", async () => {
  const { el, host } = await mount({ service: "not_connected", error: "Refused." });
  host.style.inlineSize = "343px";
  await el.updateComplete;
  const bar = q(el, ".bar")!;
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  expect(button(el).getBoundingClientRect().right).toBeLessThanOrEqual(
    host.getBoundingClientRect().right + 0.5,
  );
});
```

Create `apps/dashboard/src/widgets/content-suggestions-bar.a11y.test.ts`:

```ts
import { afterEach, describe, it } from "vitest";
import type { SuggestionRunView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./content-suggestions-bar.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const run = (overrides: Partial<SuggestionRunView>): SuggestionRunView => ({
  state: "done",
  total: 358,
  progress: 358,
  done: 358,
  failed: 0,
  code: null,
  fits: null,
  waiting: 358,
  finishedAt: "2026-10-14T10:00:00.000Z",
  opened: false,
  ...overrides,
});

const STATES: [string, Partial<ContentSuggestionsBar>][] = [
  ["not read yet", { service: null }],
  ["not connected", { service: "not_connected" }],
  ["switched off", { service: "off" }],
  ["ready", {}],
  ["sending", { run: run({ state: "sending", progress: 0, done: 0, waiting: 0 }) }],
  ["running", { run: run({ state: "running", progress: 180, done: 180, waiting: 0 }) }],
  ["done", { run: run({}) }],
  ["partly done", { run: run({ state: "partly_done", failed: 88, waiting: 270 }) }],
  [
    "refused for consent",
    {
      run: run({ state: "refused", code: "content.suggestion_consent_required" }),
      cloudOrigin: "https://cloud.example.test",
    },
  ],
  ["refused at the cap", { run: run({ state: "refused", code: "content.suggestion_limit_reached", fits: 40 }) }],
  ["expired", { run: run({ state: "expired", code: "content.suggestion_expired" }) }],
  ["nothing missing", { nothing: true }],
  ["sending its own request", { busy: true }],
  ["showing a refusal", { error: "Waitron could not reach Cloud or verify its reply. Try again." }],
];

describe.each(["light", "dark"] as const)("Translate all bar accessibility (%s)", (theme) => {
  it.each(STATES)("%s, in both languages", async (_name, props) => {
    for (const locale of ["en-GB", "es-ES"]) {
      cleanupWidgets();
      setLocale(locale);
      const { host } = await mountWidget<ContentSuggestionsBar>(
        "dashboard-content-suggestions-bar",
        { service: "on", run: null, busy: false, error: "", nothing: false, cloudOrigin: null, ...props },
        theme,
      );
      await expectNoA11yViolations(host);
    }
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-suggestions-bar.test.ts src/widgets/content-suggestions-bar.a11y.test.ts`
Expected: FAIL — both files fail to load `./content-suggestions-bar.js` (no such module), so no test runs.

- [ ] **Step 4: Write the bar.** Create `apps/dashboard/src/widgets/content-suggestions-bar.ts`:

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { SuggestionRunView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

export type SuggestionService = "on" | "off" | "not_connected";

export function runActive(run: SuggestionRunView | null): boolean {
  return run?.state === "sending" || run?.state === "running";
}

@customElement("dashboard-content-suggestions-bar")
export class ContentSuggestionsBar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .lines {
        display: grid;
        flex: 1;
        gap: var(--wt-space-1);
        min-width: min(100%, 24ch);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
    `,
  ];

  /** Null until the first suggestion read answers. */
  @property({ attribute: false }) service: SuggestionService | null = null;
  @property({ attribute: false }) run: SuggestionRunView | null = null;
  @property({ attribute: false }) busy = false;
  @property({ attribute: false }) error = "";
  /** The last press was answered with no run: nothing was left to send. */
  @property({ attribute: false }) nothing = false;
  @property({ attribute: false }) cloudOrigin: string | null = null;

  #ready(): boolean {
    return this.service === "on" && !this.busy && !runActive(this.run);
  }

  #press(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.#ready()) return;
    this.dispatchEvent(new CustomEvent("translate-all", { bubbles: true, composed: true }));
  }

  #waiting(run: SuggestionRunView): TemplateResult {
    return html`<p>${fill("suggestions.waiting", { count: String(run.waiting) })}</p>`;
  }

  #refusal(run: SuggestionRunView, code: string): TemplateResult {
    const fits =
      code === "content.suggestion_limit_reached" && run.fits !== null && run.fits > 0
        ? ` ${fill("suggestions.fits", { fits: String(run.fits) })}`
        : "";
    const consent =
      code === "content.suggestion_consent_required" && this.cloudOrigin !== null
        ? html` <a
              data-test="suggestions-consent"
              href=${new URL("/account", this.cloudOrigin).href}
              target="_blank"
              rel="noopener noreferrer"
              >${t("suggestions.open_cloud")}</a
            >`
        : nothing;
    return html`<p>${codeMessage(code)}${fits}${consent}</p>`;
  }

  #lines(): TemplateResult[] {
    const run = this.run;
    if (this.service === null) return [];
    if (this.service === "not_connected")
      return [
        html`<p>
          ${t("suggestions.about")}
          <a data-test="suggestions-connect" href="/manage/cloud">${t("suggestions.connect")}</a>
        </p>`,
      ];
    if (this.service === "off") return [html`<p>${t("suggestions.off")}</p>`];
    if (run?.state === "sending") return [html`<p role="status">${t("suggestions.sending")}</p>`];
    if (run?.state === "running")
      return [
        html`<p role="status">
          ${fill("suggestions.progress", { progress: String(run.progress), total: String(run.total) })}
        </p>`,
      ];
    if (this.nothing) return [html`<p role="status">${t("suggestions.nothing")}</p>`];
    if (run === null) return [html`<p>${t("suggestions.about")}</p>`];
    if (run.state === "done") return [this.#waiting(run)];
    if (run.state === "partly_done")
      return [
        this.#waiting(run),
        html`<p>
          ${run.code === "content.suggestion_limit_reached"
            ? codeMessage(run.code)
            : fill("suggestions.partly", { failed: String(run.failed) })}
        </p>`,
      ];
    return run.code === null ? [] : [this.#refusal(run, run.code)];
  }

  override render(): TemplateResult {
    const ready = this.#ready();
    return html`<div class="bar">
      <div class="lines">
        ${this.#lines()}
        ${this.error
          ? html`<p role="alert" data-test="suggestions-error">${this.error}</p>`
          : nothing}
      </div>
      <wt-button
        data-test="translate-all"
        variant=${ready || this.busy ? "primary" : "secondary"}
        ?disabled=${!ready}
        ?loading=${this.busy}
        @click=${this.#press}
        >${t("suggestions.translate_all")}</wt-button
      >
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-suggestions-bar": ContentSuggestionsBar;
  }
}
```

- [ ] **Step 5: Run the bar's tests**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-suggestions-bar.test.ts src/widgets/content-suggestions-bar.a11y.test.ts`
Expected: PASS. Read the `Tests` count: 36 state cases (18 states × 2 languages) plus 5 code cases, 11 button cases and 6 others in the first file; 28 cases (14 states × 2 themes) in the second. Then the control for the click guard: delete `if (!this.#ready()) return;` from `#press`, run the first file again, and see "asks nothing when its button is clicked while it cannot act" fail; put the line back.

- [ ] **Step 6: Write the dialog's failing tests.** Create `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  ContentSuggestionRead,
  DashboardApi,
  SuggestionRunView,
  TranslationPage,
  TranslationTarget,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const target = (id: string): TranslationTarget => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: true,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
});
const translations = (language: string): TranslationPage => ({
  language,
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  rows: [target("one")],
  next: null,
  total: 1,
});
const run = (overrides: Partial<SuggestionRunView> = {}): SuggestionRunView => ({
  state: "running",
  total: 358,
  progress: 180,
  done: 180,
  failed: 0,
  code: null,
  fits: null,
  waiting: 0,
  finishedAt: null,
  opened: false,
  ...overrides,
});
const SENDING = run({ state: "sending", progress: 0, done: 0 });
const read = (overrides: Partial<ContentSuggestionRead> = {}): ContentSuggestionRead => ({
  language: "es",
  run: null,
  suggestions: [],
  next: null,
  service: "on",
  cloudOrigin: "https://cloud.example.test",
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(overrides: Record<string, unknown> = {}, liveData?: LiveData) {
  const api = {
    getContentTranslationTargets: vi.fn(async (language: string) => translations(language)),
    saveContentTranslations: vi.fn(),
    getContentSuggestions: vi.fn(async (language: string) => read({ language })),
    startContentSuggestions: vi.fn(async () => ({ run: SENDING })),
    ...(liveData ? { liveData } : {}),
    ...overrides,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", api },
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
  return { el, api };
}
const bar = (el: ContentTranslationsDialog) =>
  el.shadowRoot!.querySelector<ContentSuggestionsBar>("dashboard-content-suggestions-bar")!;
const button = (el: ContentTranslationsDialog) =>
  bar(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=translate-all]",
  )!;
async function drawn(el: ContentTranslationsDialog): Promise<void> {
  await el.updateComplete;
  await bar(el).updateComplete;
  await button(el).updateComplete;
}
/** One task later: every microtask a read or a LiveData schedule queued has run. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Translate all in the translations dialog", () => {
  it("reads the run, the service and the Cloud origin into the bar, and follows the run live", async () => {
    const liveData = new LiveData();
    const answers = [
      read({ run: run() }),
      read({ run: run({ state: "done", progress: 358, done: 358, waiting: 358 }) }),
    ];
    const getContentSuggestions = vi.fn(async () => answers.shift() ?? read());
    const { el, api } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("running"));
    expect(getContentSuggestions).toHaveBeenCalledWith("es");
    expect(bar(el).service).toBe("on");
    expect(bar(el).cloudOrigin).toBe("https://cloud.example.test");
    const translationReads = vi.mocked(api.getContentTranslationTargets).mock.calls.length;
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("done"));
    expect(getContentSuggestions).toHaveBeenCalledTimes(2);
    expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(translationReads);
  });

  it("starts one run per press, is busy while it is sent, and shows the run it started", async () => {
    const sent = deferred<{ run: SuggestionRunView | null }>();
    const startContentSuggestions = vi.fn(() => sent.promise);
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await drawn(el);
    expect(startContentSuggestions).toHaveBeenCalledOnce();
    expect(startContentSuggestions).toHaveBeenCalledWith();
    expect(bar(el).busy).toBe(true);
    expect(button(el).loading).toBe(true);
    expect(button(el).getAttribute("variant")).toBe("primary");
    bar(el).dispatchEvent(new CustomEvent("translate-all", { bubbles: true, composed: true }));
    expect(startContentSuggestions).toHaveBeenCalledOnce();
    sent.resolve({ run: SENDING });
    await vi.waitFor(() => expect(bar(el).busy).toBe(false));
    await drawn(el);
    expect(bar(el).run?.state).toBe("sending");
    expect(button(el).disabled).toBe(true);
    expect(button(el).getAttribute("variant")).toBe("secondary");
  });

  it("tells a refusal in the bar and leaves the button and the dialog's own message alone", async () => {
    const startContentSuggestions = vi
      .fn()
      .mockRejectedValue({ code: "content.suggestion_job_running" });
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() =>
      expect(bar(el).error).toBe(codeMessage("content.suggestion_job_running")),
    );
    await drawn(el);
    expect(button(el).disabled).toBe(false);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("");
  });

  it("says nothing was missing until the next press", async () => {
    setLocale("en-GB");
    const startContentSuggestions = vi
      .fn()
      .mockResolvedValueOnce({ run: null })
      .mockResolvedValueOnce({ run: SENDING });
    const { el } = await mount({ startContentSuggestions });
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).nothing).toBe(true));
    await drawn(el);
    expect(bar(el).shadowRoot!.textContent).toContain(t("suggestions.nothing"));
    expect(button(el).disabled).toBe(false);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("sending"));
    expect(bar(el).nothing).toBe(false);
  });

  it("tells a failed suggestion read in the bar, keeps the translations usable, and clears it once a read answers", async () => {
    const liveData = new LiveData();
    const getContentSuggestions = vi
      .fn()
      .mockRejectedValueOnce({ code: "cloud.unavailable" })
      .mockResolvedValue(read());
    const { el } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).error).toBe(codeMessage("cloud.unavailable")));
    await drawn(el);
    expect(bar(el).service).toBeNull();
    expect(button(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    expect(bar(el).error).toBe("");
  });

  it("does not let a read that began before the press answered put back the run it replaced", async () => {
    const liveData = new LiveData();
    const late = deferred<ContentSuggestionRead>();
    const getContentSuggestions = vi
      .fn()
      .mockResolvedValueOnce(read())
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue(read({ run: run() }));
    const { el } = await mount({ getContentSuggestions }, liveData);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(getContentSuggestions).toHaveBeenCalledTimes(2));
    await drawn(el);
    await userEvent.click(button(el));
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("sending"));
    // Were the late answer's run applied, the bar would show "done" here.
    late.resolve(
      read({
        run: run({ state: "done", progress: 358, done: 358, waiting: 12 }),
        cloudOrigin: "https://later.example.test",
      }),
    );
    await vi.waitFor(() => expect(bar(el).cloudOrigin).toBe("https://later.example.test"));
    expect(bar(el).run?.state).toBe("sending");
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await vi.waitFor(() => expect(bar(el).run?.state).toBe("running"));
  });

  it("reads the new language when the dialog switches, and stops reading once it closes", async () => {
    const liveData = new LiveData();
    const { el, api } = await mount({}, liveData);
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    el.language = "en";
    await vi.waitFor(() => expect(api.getContentSuggestions).toHaveBeenLastCalledWith("en"));
    await vi.waitFor(() => expect(bar(el).service).toBe("on"));
    const reads = vi.mocked(api.getContentSuggestions).mock.calls.length;
    el.open = false;
    await el.updateComplete;
    // Were the read still watched, this would read the suggestions once more.
    liveData.invalidate([{ type: "content_suggestion_jobs" }]);
    await nextTask();
    expect(api.getContentSuggestions).toHaveBeenCalledTimes(reads);
  });
});
```

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.translate-all.test.ts`
Expected: FAIL — every case times out in `vi.waitFor` because the dialog renders no `dashboard-content-suggestions-bar` (`bar(el)` is null: "Cannot read properties of null").

- [ ] **Step 7: Wire the bar into the dialog.** In `apps/dashboard/src/widgets/content-translations-dialog.ts`:

Imports (`content-translations-dialog.ts:22-28`): the type import from `../api/client.js` gains `ContentSuggestionRead` and `SuggestionRunView`, and below the `./content-translations-model.js` import add:

```ts
import { runActive, type SuggestionService } from "./content-suggestions-bar.js";
```

Above `@customElement("dashboard-content-translations-dialog")` (`content-translations-dialog.ts:76`):

```ts
type SuggestionRunRead = { sequence: number } & (
  | { value: ContentSuggestionRead }
  | { failed: string }
);
```

After `@state() private reviewRows: TranslationTarget[] = [];` (`content-translations-dialog.ts:150`):

```ts
  @state() private suggestionRun: SuggestionRunView | null = null;
  @state() private service: SuggestionService | null = null;
  @state() private cloudOrigin: string | null = null;
  @state() private suggestionBusy = false;
  @state() private suggestionError = "";
  @state() private suggestionReadError = "";
  @state() private nothingMissing = false;
  #suggestionReads = 0;
  /** Reads numbered at or below this began before the last press was answered. */
  #runReplacedAt = 0;
```

In `disconnectedCallback`, after `this.busy = false;` (`content-translations-dialog.ts:179`):

```ts
    this.suggestionBusy = false;
```

In `willUpdate`, replace `this.#queries.release("translations");` (`content-translations-dialog.ts:190`) with:

```ts
      this.#queries.release("translations");
      this.#queries.release("suggestion-run");
      this.suggestionRun = null;
      this.service = null;
      this.cloudOrigin = null;
      this.suggestionBusy = false;
      this.suggestionError = "";
      this.suggestionReadError = "";
      this.nothingMissing = false;
```

Add, directly above `async #load(): Promise<void> {` (`content-translations-dialog.ts:283`):

```ts
  /** The first suggestion page only: the bar needs its run, service and Cloud origin. A failed read
   * is told in the bar, because the controller's error callback would put it over the translations. */
  #watchSuggestionRun(generation: number): Promise<void> {
    const language = this.language;
    const client = this.api.background ?? this.api;
    return this.#queries.watch(
      "suggestion-run",
      {
        key: JSON.stringify(["suggestion-run", language, generation]),
        dependencies: QUERY_DEPENDENCIES.getContentSuggestions.map((type) => ({ type })),
        refreshMs: 60_000,
        read: async (): Promise<SuggestionRunRead> => {
          const sequence = ++this.#suggestionReads;
          try {
            return { sequence, value: await client.getContentSuggestions(language) };
          } catch (error) {
            return { sequence, failed: codeOf(error) };
          }
        },
      },
      (answer) => {
        if (generation !== this.#generation || !this.open) return;
        if ("failed" in answer) {
          this.suggestionReadError = codeMessage(answer.failed);
          return;
        }
        this.suggestionReadError = "";
        this.service = answer.value.service;
        this.cloudOrigin = answer.value.cloudOrigin;
        if (answer.sequence > this.#runReplacedAt) this.suggestionRun = answer.value.run;
      },
    );
  }
```

In `#load`, after `this.loading = !this.model;` (`content-translations-dialog.ts:285`):

```ts
    void this.#watchSuggestionRun(generation);
```

(Its read never rejects, so the promise needs no handler; starting it before awaiting the translations keeps the two reads side by side.)

Add, directly above `#closed(event: Event): void {` (`content-translations-dialog.ts:488`):

```ts
  #translateAll(event: Event): void {
    event.stopPropagation();
    void this.#startRun();
  }
  async #startRun(): Promise<void> {
    if (this.suggestionBusy || this.service !== "on" || runActive(this.suggestionRun)) return;
    const generation = this.#generation;
    this.suggestionBusy = true;
    this.suggestionError = "";
    this.nothingMissing = false;
    try {
      const { run } = await this.api.startContentSuggestions();
      if (generation !== this.#generation || !this.open) return;
      this.#runReplacedAt = this.#suggestionReads;
      this.nothingMissing = run === null;
      if (run !== null) this.suggestionRun = run;
    } catch (error) {
      if (generation !== this.#generation || !this.open) return;
      this.suggestionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.suggestionBusy = false;
    }
  }
```

In `#save`, replace `this.#queries.release("translations");` (`content-translations-dialog.ts:458`) with:

```ts
      this.#queries.release("translations");
      this.#queries.release("suggestion-run");
```

In `render`, directly after `<p class="help">${t("translations.help")}</p>` (`content-translations-dialog.ts:620`):

```ts
      <dashboard-content-suggestions-bar
        .service=${this.service}
        .run=${this.suggestionRun}
        .busy=${this.suggestionBusy}
        .error=${this.suggestionError || this.suggestionReadError}
        .nothing=${this.nothingMissing}
        .cloudOrigin=${this.cloudOrigin}
        @translate-all=${this.#translateAll}
      ></dashboard-content-suggestions-bar>
```

In `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts`, inside the `api` object literal, after the `saveContentTranslations: vi.fn().mockRejectedValue(…),` entry (it ends at about line 91), add so the bar there is in its ready state rather than showing a failed read:

```ts
            getContentSuggestions: vi.fn(async () => ({
              language: "es",
              run: null,
              suggestions: [],
              next: null,
              service: "on" as const,
              cloudOrigin: null,
            })),
```

- [ ] **Step 8: Run the dialog's suites and the guards**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-suggestions-bar.test.ts src/widgets/content-suggestions-bar.a11y.test.ts src/widgets/content-translations-dialog.translate-all.test.ts src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-translations-dialog.a11y.test.ts src/screens/content-languages-screen.test.ts`
Expected: PASS, with a `Tests` count that includes the seven new dialog cases. The dialog's existing suites pass unchanged: their fake APIs have no `getContentSuggestions`, so their bar shows the failed read's message and nothing they assert changes.

Then the control for the late-read check: in `#watchSuggestionRun` change `if (answer.sequence > this.#runReplacedAt) this.suggestionRun = answer.value.run;` to `this.suggestionRun = answer.value.run;`, run `src/widgets/content-translations-dialog.translate-all.test.ts`, see "does not let a read that began before the press answered put back the run it replaced" fail with `expected 'done' to be 'sending'`; put it back.

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`
Expected: no type errors; both guards PASS.

- [ ] **Step 9: Look at it.** Start the dev stack from the worktree that executes this plan (`wa-wt demo <worktree-name>`), open Content languages → Edit translations, and look at the bar in the light and dark themes and at a 375 px wide window. The demo stack has no Cloud, so the `not_connected` state shows: the sentence, the "Connect to Waitron Cloud" link, and a quiet, disabled Translate all. Check the button wraps under the sentence at 375 px with nothing scrolling sideways, and that the link opens the Cloud services screen.

- [ ] **Step 10: Commit**

```bash
pnpm format:check
git add apps/dashboard/src/widgets/content-suggestions-bar.ts apps/dashboard/src/widgets/content-suggestions-bar.test.ts apps/dashboard/src/widgets/content-suggestions-bar.a11y.test.ts apps/dashboard/src/widgets/content-translations-dialog.ts apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "Show Translate all in the translations dialog, with its progress and why it cannot run"
```

---

### Task 15: Suggestions as drafts: fill, Discard, Save

**Files:**
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.ts` (imports, a `discarding` state, the draft scope, `#scan`, the `translations` watch, `#review`, `#visible`, three new private methods, `#save`, the name column's cell, `#input`, `render`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (three keys, both tables)
- Modify: `docs/developers/design-system.md` (one line in "These open already savable:", about line 2205)
- Create: `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts` (a new file, so it does not touch whatever Task 14 put in its own dialog test file)
- Test: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts`

**Interfaces:**
- Consumes: `TranslationDrafts.suggest`, `isSuggested`, `suggestedCount`, `personalSubmission`, `unsuggest`, `markStale`, `suggestionFor`, `indexSuggestions` (Task 13); `DashboardApi.getContentSuggestions`, `discardContentSuggestion` (Task 13); the dialog as Task 14 left it.
- Produces: no new exports. The `translations` watch now depends on `content_suggestions` too; the scan's value carries `suggestions: ContentSuggestionView[]`.

Behaviour:

1. The translation scan reads every suggestion page for the language after the translation pages (following `next` until null), through the same passive client. After every answer, and after Review latest, the dialog calls `model.suggest(indexSuggestions(value.suggestions, this.language, this.model.defaultLanguage))`. It indexes with the model's default language, not `value.config.defaultLanguage`, because the model keeps its old default while a person's edits are pending (`content-translations-model.ts`, `snapshot`) and `needsDefault` reads the model's.
2. The watch depends on `[...QUERY_DEPENDENCIES.getContentTranslationTargets, "content_suggestions"]`, not on `content_suggestion_jobs`: the runner rewrites the job row at every five-second poll, and each change would re-read every page. A finished job writes `content_suggestions`, so its results still arrive while the dialog is open, and fill only rows nobody has typed in.
3. Draft scope `current: () => this.model!.personalSubmission()` (Decision 5); Save uses `saveActionState(this.#scope, { savableAtOpen: suggestedCount > 0 })` both where it is drawn and in `#save`'s early return. A successful save commits the personal submission it sent, so nothing reads as unsaved when `translations-saved` arrives.
4. A suggested row shows "Suggested" (`data-test="suggested-<kind>-<id>"`) and a **Discard suggestion** button (`data-test="discard-<kind>-<id>"`, secondary). Discard deletes each of the row's suggestion ids in turn (one request after another), then `model.unsuggest(row)`. `content.suggestion_not_found` counts as done; any other refusal shows its code message in the bottom message and leaves the row filled.
5. A `content.translation_stale` refusal naming a suggested row: `model.markStale(row)`, and the existing code puts the refusal's message at the bottom. The person saves again.
6. "Show edited" and the hidden count include suggested rows (what Save will send), and a suggested row's field stays enabled at the 100 limit.

- [ ] **Step 1: Check that every test that opens the dialog can answer a suggestion read**

From this task on the scan calls `getContentSuggestions` on `this.api.background ?? this.api`, so a test api without it fails its read. Task 14's `suggestion-run` watch makes the same call, so Task 14 should already have given each of these api objects one; check:

```bash
/usr/bin/grep -c "getContentSuggestions" apps/dashboard/src/widgets/content-translations-dialog.test.ts apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts apps/dashboard/src/screens/content-languages-screen.test.ts apps/dashboard/src/screens/content-languages-screen.a11y.test.ts apps/dashboard/src/dashboard-app.test.ts
```

The objects that need one (line numbers as on `main` before Task 14): `content-translations-dialog.test.ts` — the `mount` helper (:37), the inline objects at :87, :108, :127 and :142, the passive `background` object at :167, and the object at :878; `content-translations-dialog.unsaved.test.ts:42`; `content-translations-dialog.a11y.test.ts:60`; `content-languages-screen.test.ts` :25, :930 and :1143; `content-languages-screen.a11y.test.ts:36`; `dashboard-app.test.ts:7490`. Where one is missing, add beside its `getContentTranslationTargets`:

```ts
getContentSuggestions: vi.fn(async (language: string) => ({
  language,
  run: null,
  suggestions: [],
  next: null,
  service: "not_connected" as const,
  cloudOrigin: null,
})),
```

Then run those six files; they must pass before you start (`pnpm --filter @waitron/dashboard exec vitest run <the six paths>`).

- [ ] **Step 2: Write the failing dialog tests**

Create `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type {
  ContentSuggestionRead,
  ContentSuggestionView,
  DashboardApi,
  TranslationBatch,
  TranslationPage,
  TranslationRef,
  TranslationTarget,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

const target = (id: string, overrides: Partial<TranslationTarget> = {}): TranslationTarget => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: false,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
  ...overrides,
});
const suggestion = (
  id: string,
  itemId: string,
  overrides: Partial<ContentSuggestionView> = {},
): ContentSuggestionView => ({
  id,
  kind: "product",
  itemId,
  language: "es",
  text: `CLIENT-es ${itemId}`,
  placeholder: false,
  fix: null,
  stale: false,
  ...overrides,
});

/** The venue behind the dialog's routes; a save or a discard changes what the next read returns. */
interface Venue {
  language: string;
  config: { defaultLanguage: string; languages: string[] };
  listed: TranslationTarget[];
  omitted: TranslationTarget[];
  suggestions: ContentSuggestionView[];
  suggestionPage: number;
}
const venue = (overrides: Partial<Venue> = {}): Venue => ({
  language: "es",
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  listed: [],
  omitted: [],
  suggestions: [],
  suggestionPage: 100,
  ...overrides,
});
function fakeApi(state: Venue, overrides: Record<string, unknown> = {}) {
  const page = (rows: TranslationTarget[], next: string | null): TranslationPage => ({
    language: state.language,
    config: state.config,
    required: [],
    rows,
    next,
    total: state.listed.length,
  });
  return {
    getContentTranslationTargets: vi.fn(
      async (_language: string, query: { after?: string; targets?: TranslationRef[] }) => {
        if (query.targets)
          return page(
            query.targets.map(
              (ref) =>
                [...state.listed, ...state.omitted].find(
                  (row) => row.kind === ref.kind && row.id === ref.id,
                ) ?? target(ref.id, { eligible: false, unavailableReason: "missing" }),
            ),
            null,
          );
        const start = query.after === undefined ? 0 : Number(query.after);
        return page(
          state.listed.slice(start, start + 50),
          start + 50 < state.listed.length ? String(start + 50) : null,
        );
      },
    ),
    getContentSuggestions: vi.fn(
      async (language: string, after?: string): Promise<ContentSuggestionRead> => {
        const start = after === undefined ? 0 : Number(after);
        const end = start + state.suggestionPage;
        return {
          language,
          run: null,
          service: "on",
          cloudOrigin: null,
          suggestions: state.suggestions.slice(start, end),
          next: end < state.suggestions.length ? String(end) : null,
        };
      },
    ),
    saveContentTranslations: vi.fn(async (_language: string, batch: TranslationBatch) => {
      const saved = new Set(batch.edits.map((edit) => `${edit.kind}:${edit.id}`));
      state.listed = state.listed.filter((row) => !saved.has(`${row.kind}:${row.id}`));
      state.omitted = state.omitted.filter((row) => !saved.has(`${row.kind}:${row.id}`));
      state.suggestions = state.suggestions.filter(
        (view) => !saved.has(`${view.kind}:${view.itemId}`),
      );
      return { saved: [] };
    }),
    discardContentSuggestion: vi.fn(async (id: string) => {
      if (!state.suggestions.some((view) => view.id === id))
        throw { code: "content.suggestion_not_found", params: { suggestionId: id } };
      state.suggestions = state.suggestions.filter((view) => view.id !== id);
      return { deleted: id };
    }),
    startContentSuggestions: vi.fn(async () => ({ run: null })),
    ...overrides,
  };
}
async function open(state: Venue, overrides: Record<string, unknown> = {}) {
  const api = fakeApi(state, overrides);
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: state.language, api: api as unknown as DashboardApi },
  );
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=loading]")).toBeNull());
  await settle(mounted.el);
  return { ...mounted, api };
}
const q = <T extends HTMLElement = HTMLElement>(
  el: ContentTranslationsDialog,
  selector: string,
): T | null =>
  el.shadowRoot!.querySelector<T>(selector) ??
  el.shadowRoot!.querySelector("wt-data-table")?.shadowRoot?.querySelector<T>(selector) ??
  null;
const field = (el: ContentTranslationsDialog, id: string, name = "text") =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `[name="translation-${name}-product-${id}"]`);
async function settle(el: ContentTranslationsDialog) {
  await el.updateComplete;
  await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")?.updateComplete;
}
async function edit(el: ContentTranslationsDialog, id: string, text: string, name = "text") {
  field(el, id, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function click(el: ContentTranslationsDialog, action: string) {
  q(el, `[data-test=${action}]`)!.click();
  await settle(el);
}
const save = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
const bottomMessage = (el: ContentTranslationsDialog) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("Translate all suggestions as drafts", () => {
  it("fills suggestions as drafts marked Suggested and opens with Save enabled", async () => {
    const { el } = await open(
      venue({ listed: [target("one"), target("two")], suggestions: [suggestion("s1", "one")] }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(q(el, "[data-test=suggested-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.suggested"),
    );
    expect(q(el, "[data-test=discard-product-one]")).not.toBeNull();
    expect(field(el, "two")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    expect(q(el, "[data-test=discard-product-two]")).toBeNull();
    expect(save(el).disabled).toBe(false);
    expect(save(el).variant).toBe("primary");
    await click(el, "show-edited");
    expect(field(el, "one")).not.toBeNull();
    expect(field(el, "two")).toBeNull();
  });
  it("fills a missing default only when its default-language suggestion came too", async () => {
    const { el } = await open(
      venue({
        listed: [
          target("one", { defaultRequired: true }),
          target("two", { defaultRequired: true }),
        ],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
          suggestion("s3", "two"),
        ],
      }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(field(el, "one", "defaultText")!.value).toBe("CLIENT-en one");
    expect(field(el, "two")!.value).toBe("");
    expect(field(el, "two", "defaultText")).toBeNull();
  });
  it("reads every suggestion page before filling", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two"), target("three")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two"), suggestion("s3", "three")],
        suggestionPage: 1,
      }),
    );
    expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "1");
    expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "2");
    expect(field(el, "three")!.value).toBe("CLIENT-es three");
  });
  it("saves suggested and typed names together, and an edited suggestion as typed", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two"), target("three")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    await edit(el, "two", "Croqueta casera");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    await edit(el, "three", "Pan");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" },
        { kind: "product", id: "two", expected: "baseline-two", text: "Croqueta casera" },
        { kind: "product", id: "three", expected: "baseline-three", text: "Pan" },
      ],
    });
  });
  it("Discard deletes each of the row's suggestions in turn and empties the row", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one", { defaultRequired: true })],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", { language: "en", text: "CLIENT-en one" }),
        ],
      }),
    );
    await click(el, "discard-product-one");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"], ["s2"]]);
    expect(field(el, "one", "defaultText")).toBeNull();
    expect(q(el, "[data-test=suggested-product-one]")).toBeNull();
    expect(q(el, "[data-test=discard-product-one]")).toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("a suggestion the server no longer holds counts as discarded; any other refusal is shown", async () => {
    const state = venue({
      listed: [target("one"), target("two")],
      suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
    });
    const { el, api } = await open(state);
    state.suggestions = state.suggestions.filter((view) => view.id !== "s1");
    await click(el, "discard-product-one");
    await vi.waitFor(() => expect(field(el, "one")!.value).toBe(""));
    api.discardContentSuggestion.mockRejectedValueOnce({ code: "server.internal" });
    await click(el, "discard-product-two");
    await vi.waitFor(() => expect(bottomMessage(el)).toBe(codeMessage("server.internal")));
    expect(field(el, "two")!.value).toBe("CLIENT-es two");
    expect(q(el, "[data-test=suggested-product-two]")).not.toBeNull();
  });
  it("a stale refusal on save empties that suggested row and keeps the others", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two" },
    });
    await click(el, "save");
    await vi.waitFor(() =>
      expect(bottomMessage(el)).toContain(codeMessage("content.translation_stale")),
    );
    expect(field(el, "two")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-two]")).toBeNull();
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenLastCalledWith("es", {
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" }],
    });
  });
  it("a suggestion arriving while the dialog is open fills an untouched row and leaves a typed one", async () => {
    const liveData = new LiveData();
    const state = venue({ listed: [target("one"), target("two")] });
    const { el, api } = await open(state, { liveData });
    await edit(el, "one", "Mine");
    state.suggestions = [suggestion("s1", "one"), suggestion("s2", "two")];
    const reads = api.getContentTranslationTargets.mock.calls.length;
    liveData.invalidate([{ type: "content_suggestions" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads),
    );
    await vi.waitFor(() => expect(field(el, "two")!.value).toBe("CLIENT-es two"));
    expect(field(el, "one")!.value).toBe("Mine");
  });
});
```

- [ ] **Step 3: Write the failing leave-guard tests**

In `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts`, change the client import to:

```ts
import type { ContentSuggestionView, DashboardApi, TranslationPage } from "../api/client.js";
```

and append:

```ts
const soup = (id: string, itemId: string, text: string): ContentSuggestionView => ({
  id,
  kind: "product",
  itemId,
  language: "es",
  text,
  placeholder: false,
  fix: null,
  stale: false,
});
function suggestionApi(page: TranslationPage, suggestions: ContentSuggestionView[]) {
  return {
    getContentTranslationTargets: vi.fn(async (_language: string, query: { after?: string }) => {
      const start = query.after === undefined ? 0 : Number(query.after);
      return {
        ...page,
        rows: page.rows.slice(start, start + 50),
        next: start + 50 < page.rows.length ? String(start + 50) : null,
        total: page.rows.length,
      };
    }),
    getContentSuggestions: vi.fn(async (language: string) => ({
      language,
      run: null,
      suggestions,
      next: null,
      service: "on" as const,
      cloudOrigin: null,
    })),
    saveContentTranslations: vi.fn().mockResolvedValue({ saved: [] }),
    discardContentSuggestion: vi.fn(),
    startContentSuggestions: vi.fn(async () => ({ run: null })),
  } as unknown as DashboardApi;
}
async function mountWith(api: DashboardApi) {
  const { el: app } = await mountWidget<TranslationLeaveApp>("translation-leave-test-app", { api });
  const form = app.shadowRoot!.querySelector("dashboard-content-translations-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  return { app, form };
}
async function closeUnasked(
  app: TranslationLeaveApp,
  form: HTMLElementTagNameMap["dashboard-content-translations-dialog"],
) {
  const closed = dialogClosed(form.shadowRoot!.querySelector("wt-modal")!);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  await closed;
  await vi.waitFor(() => expect(app.closed).toBe(1));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
}
it("closes with only untouched suggestions without asking or warning on unload", async () => {
  const { app, form } = await mountWith(
    suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]),
  );
  expect(field(form).value).toBe("CLIENT-es Sopa del día");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  await closeUnasked(app, form);
});
it("a person's edit of a suggested name still asks, and discarding the edit brings the suggestion back", async () => {
  const { app, form } = await mountWith(
    suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]),
  );
  await edit(form, "Sopa de la casa");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const proceed = vi.fn();
  const discarded = app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  const warning = await question(app);
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discarded).toBe("proceeded");
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  expect(field(form).value).toBe("CLIENT-es Sopa del día");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("saving untouched suggestions leaves nothing unsaved when the saved event arrives", async () => {
  const api = suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]);
  const { app, form } = await mountWith(api);
  const outcomes: boolean[] = [];
  form.addEventListener("translations-saved", () => outcomes.push(app.leave.coordinator.isDirty()));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(outcomes).toEqual([false]));
  expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "dish", expected: "baseline", text: "CLIENT-es Sopa del día" }],
  });
});
```

- [ ] **Step 4: Run them to see them fail**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.unsaved.test.ts
```

Expected: FAIL — the dialog never reads suggestions, so every filled-field assertion reads `''` (for example `expected '' to be 'CLIENT-es one'`), and the leave-guard cases read an empty field. The existing unsaved cases still pass.

- [ ] **Step 5: Add the strings**

In `apps/dashboard/src/i18n/strings.ts`, after `"translations.page": "Page {page} of {pages}",` in the English table:

```ts
  "suggestions.suggested": "Suggested",
  "suggestions.discard": "Discard suggestion",
  "suggestions.discard_named": "Discard the suggestion for {name}",
```

and after `"translations.page": "Página {page} de {pages}",` in the Spanish table:

```ts
  "suggestions.suggested": "Sugerido",
  "suggestions.discard": "Descartar sugerencia",
  "suggestions.discard_named": "Descartar la sugerencia de {name}",
```

- [ ] **Step 6: Change the dialog**

All in `apps/dashboard/src/widgets/content-translations-dialog.ts`.

(a) Imports. Add `ContentSuggestionRead` and `ContentSuggestionView` to the type import from `"../api/client.js"`, and `indexSuggestions` to the import from `"./content-translations-model.js"`:

```ts
import type {
  ContentSuggestionRead,
  ContentSuggestionView,
  DashboardApi,
  TranslationBatch,
  TranslationPage,
  TranslationTarget,
  TranslationGapKind,
} from "../api/client.js";
```

```ts
import {
  TranslationDrafts,
  indexSuggestions,
  translationKey,
  type FieldFault,
  type ReviewChoice,
} from "./content-translations-model.js";
```

(b) After `@state() private reviewRows: TranslationTarget[] = [];`:

```ts
  @state() private discarding: ReadonlySet<string> = new Set();
```

(c) In `willUpdate`'s `draftScopeFor` call, replace `current: () => this.model!.submission(),` with:

```ts
        current: () => this.model!.personalSubmission(),
```

(d) In `#scan`, replace the final `return { generation, revision, rows, retained, config: first!.config };` with:

```ts
    const suggestions: ContentSuggestionView[] = [];
    let after: string | null = null;
    const pages = new Set<string>();
    do {
      let value: ContentSuggestionRead;
      try {
        value = await client.getContentSuggestions(language, after ?? undefined);
      } catch (error) {
        if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
          return undefined;
        throw error;
      }
      if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
        return undefined;
      if (value.language !== language) throw new Error("suggestion scan changed");
      suggestions.push(...value.suggestions);
      after = value.next;
      if (after !== null && pages.has(after)) throw new Error("suggestion scan repeated");
      if (after !== null) pages.add(after);
    } while (after !== null);
    return { generation, revision, rows, retained, suggestions, config: first!.config };
```

(e) In `#load`'s `translations` watch, replace `dependencies: QUERY_DEPENDENCIES.getContentTranslationTargets.map((type) => ({ type })),` with:

```ts
          dependencies: [
            ...QUERY_DEPENDENCIES.getContentTranslationTargets,
            "content_suggestions",
          ].map((type) => ({ type })),
```

and in its callback, right after the `if (this.model) … else this.model = new TranslationDrafts(…);` statement and before `this.page = Math.min(…)`:

```ts
          this.model.suggest(
            indexSuggestions(value.suggestions, this.language, this.model.defaultLanguage),
          );
```

(f) In `#review`, right after `this.model.snapshot(value.rows, value.retained, value.config.defaultLanguage);`:

```ts
      this.model.suggest(
        indexSuggestions(value.suggestions, this.language, this.model.defaultLanguage),
      );
```

(g) In `#visible`, replace `if (this.editedOnly) return rows.filter((row) => this.model!.isEdited(row));` with:

```ts
    if (this.editedOnly) return rows.filter((row) => this.#staged(row));
```

and add these three methods right before `#showEdited(): void {`:

```ts
  #staged(row: TranslationTarget): boolean {
    return this.model!.isEdited(row) || this.model!.isSuggested(row);
  }
  #saveState() {
    return saveActionState(this.#scope, { savableAtOpen: (this.model?.suggestedCount ?? 0) > 0 });
  }
  async #discard(row: TranslationTarget): Promise<void> {
    const found = this.model?.suggestionFor(row);
    const key = translationKey(row);
    if (!found || this.busy || this.discarding.has(key)) return;
    const generation = this.#generation;
    this.discarding = new Set([...this.discarding, key]);
    this.actionError = "";
    try {
      for (const id of found.ids) {
        try {
          await this.api.discardContentSuggestion(id);
        } catch (error) {
          if (codeOf(error) !== "content.suggestion_not_found") throw error;
        }
      }
      if (generation !== this.#generation || !this.model) return;
      this.model.unsuggest(row);
    } catch (error) {
      if (generation === this.#generation && this.open)
        this.actionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation)
        this.discarding = new Set([...this.discarding].filter((held) => held !== key));
    }
  }
```

(h) In `#save`, replace the early return

```ts
    if (
      this.busy ||
      this.loading ||
      this.reviewing ||
      !this.model ||
      saveActionState(this.#scope).unchanged
    )
      return;
```

with

```ts
    if (this.busy || this.loading || this.reviewing || !this.model || this.#saveState().unchanged)
      return;
```

replace `const submitted = this.model.submission();` with

```ts
    const submitted = this.model.submission();
    const personal = this.model.personalSubmission();
```

replace `this.#scope?.commit(submitted);` with

```ts
      this.#scope?.commit(personal);
```

and in the `catch`, right after `const row = this.model.rows.find((row) => row.kind === params.kind && row.id === params.id);`:

```ts
      if (codeOf(error) === "content.translation_stale" && row && this.model.isSuggested(row))
        this.model.markStale(row);
```

(i) In `#columns`, the `name` column's cell: right before the line that renders `changed-${row.kind}-${row.id}`, add

```ts
              ${this.model!.isSuggested(row) ? html`<span part="translation-meta" data-test=${`suggested-${row.kind}-${row.id}`}>${t("suggestions.suggested")}</span>` : nothing}
```

and right after the line that renders the default-language field (`${this.model!.needsDefault(row) && (…) ? html`…${this.#input(row, "defaultText")}` : nothing}`), still inside `<div part="translation-fields">`, add

```ts
              ${this.model!.isSuggested(row) ? html`<wt-button data-test=${`discard-${row.kind}-${row.id}`} variant="secondary" aria-label=${fill("suggestions.discard_named", { name: label(row) })} ?disabled=${this.busy || this.discarding.has(translationKey(row))} @click=${() => void this.#discard(row)}>${t("suggestions.discard")}</wt-button>` : nothing}
```

(j) In `#input`, replace the `?disabled` binding with:

```ts
      ?disabled=${this.busy || !row.eligible || (this.model!.count >= 100 && !this.#staged(row))}
```

(k) In `render`, replace

```ts
    const hidden =
      this.model?.rows.filter((row) => this.model!.isEdited(row) && !shown.includes(row)).length ??
      0;
    const action = saveActionState(this.#scope);
```

with

```ts
    const hidden =
      this.model?.rows.filter((row) => this.#staged(row) && !shown.includes(row)).length ?? 0;
    const action = this.#saveState();
```

- [ ] **Step 7: Record the open-savable form in the design system**

In `docs/developers/design-system.md`, add to the list under "These open already savable:" (about line 2205), before the bullet that begins "a new canvas's editor":

```markdown
- the translations dialog while Translate all suggestions are filled in: they are drafts nobody
  typed, so Save opens ready, and closing asks nothing because the draft scope compares only a
  person's own edits (`personalSubmission`, `apps/dashboard/src/widgets/content-translations-dialog.ts`);
```

- [ ] **Step 8: Run the tests to see them pass**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.a11y.test.ts src/widgets/content-translations-model.test.ts src/screens/content-languages-screen.test.ts
pnpm --filter @waitron/dashboard typecheck
```

Expected: PASS, no failures in the `Tests` line. Controls, each restored after: put back `current: () => this.model!.submission()` and see the three new leave-guard cases fail; put back `this.#scope?.commit(submitted)` and see "saving untouched suggestions leaves nothing unsaved" fail; drop `"content_suggestions"` from the watch's dependencies and see "a suggestion arriving while the dialog is open" fail; remove the `markStale` line and see "a stale refusal on save" fail. (Measured 2026-10-14 in a copy of the tree at `5fc610986` holding these edits, Tasks 16 and 17's, and stand-in suggestion types: each control failed the cases named and no others, plus, for the first, Task 17's 150-row case and, for the last, Task 16's out-of-date note case, which come later.)

- [ ] **Step 9: Commit**

```bash
pnpm format:check
git add apps/dashboard/src/widgets/content-translations-dialog.ts apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts apps/dashboard/src/i18n/strings.ts docs/developers/design-system.md
git commit -s -m "Translate all suggestions fill the translations dialog as drafts to save or discard, and closing over them asks nothing"
```

Add to `git add` any of the six test files Step 1 had to change.

---

### Task 16: Notes, and the rows the page leaves out

**Files:**
- Test: `packages/catalogue/src/content-translations.test.ts` (one `it.each`, a check of today's save path)
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.ts` (`#scan` reads the left-out rows; a `#notes` method; Discard shown for any row with a suggestion)
- Modify: `apps/dashboard/src/i18n/strings.ts` (four keys, both tables)
- Test: `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`, `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts`

**Interfaces:**
- Consumes: Task 15's dialog; `getContentTranslationTargets(language, { targets })` (`apps/dashboard/src/api/client.ts:2367-2379`), which answers at most 50 refs a call (the `targets` branch of `listTranslationTargets`, `packages/catalogue/src/content-translation-targets.ts`); Task 10's `stale` flag, which marks a suggestion whose item is gone (`isLiveTarget`, Task 6), now holds text, or changed.
- Produces: no new exports.

**What the save path does with a name the default-language page leaves out (checked before this task was written).** `saveContentTranslations` (`packages/catalogue/src/content-translations.ts`) resolves each edit with `resolveTranslationTargets`, which has no absent-name filter: a product with `customer_name` null resolves `present`, and eligible when its role and ownership hold (`resolved`, `content-translation-targets.ts`). It merges `{ ...entry.names, [language]: text }` (`merged` in `saveContentTranslations`), and `validateTranslationNames` (`content-translation-writes.ts:13-52`) refuses only when `contentTranslationGap` (`content-languages.ts:34-47`) finds no default-language text in the merged map, which a default-language write supplies. Measured 2026-10-14 at `5fc610986`, Node v26.7.0, with the `content-translations.test.ts` fixture (default `es`): for a product, variant, options list and option with `customer_name` set to null, and a menu and section with `names` set to `{}`, `listTranslationTargets(tx, "es", …)` listed none of them, and `saveContentTranslations(tx, "es", …)` saved each one's text. So no product decision is needed; Step 1 keeps that as a test. The failing case is already covered by the existing "%s missing default carries its existing domain name refusal" cases, which save in `en` over an absent `es` name and are refused.

**The rows the page leaves out survive `snapshot()` because the scan passes them in as gaps.** After reading the suggestion pages, the scan collects each suggestion whose item the translation pages did not list and whose index entry is not stale, reads those items with the `targets` form 50 at a time, and appends to `rows` the ones that come back eligible with no text in the page language. `rows` is what the dialog hands to `new TranslationDrafts(…)` and to `snapshot(gaps, …)` (`content-translations-model.ts:54` keeps an unedited row only when it is in `gaps`), so the row is there at every refresh for as long as its suggestion is. On today's server only the default-language page leaves such items out (`blankIn`, `content-translation-targets.ts`); on any other page an absent name is listed. A stale suggestion for a left-out item is not read: the item is gone, named or changed, so there is no gap left for a row to fill.

Notes: a suggestion that is out of date shows "This name changed after the suggestion was made." (`data-test="stale-<kind>-<id>"`); a placeholder shows "This name doesn't say what it is, so there is no suggestion." (`data-test="placeholder-<kind>-<id>"`); a spelling fix shows "Possible spelling fix: {wrong} → {right}" for the internal name, or "Possible spelling fix in {language}: {wrong} → {right}" for a name entered in another language (`data-test="fix-<kind>-<id>-<field>"`). The fix links to the item's editor through the row's own Open link, which already points there (`editorHref`); there is no Use fix button (Decision 6). Discard now shows on any row with a suggestion — a filled one, a placeholder or a fix — and deletes all of that item's suggestion rows the page read, so a placeholder can be cleared after the staff name is improved, letting the next Translate all send the item again.

- [ ] **Step 1: Keep today's save path as a test**

In `packages/catalogue/src/content-translations.test.ts`, replace the two imports

```ts
import { resolveTranslationTargets } from "./content-translation-targets.js";
import type { TranslationBatch, TranslationRef } from "./content-translation-types.js";
```

with

```ts
import {
  listTranslationTargets,
  resolveTranslationTargets,
} from "./content-translation-targets.js";
import type {
  TranslationBatch,
  TranslationRef,
  TranslationTarget,
} from "./content-translation-types.js";
```

and add as the first case of `describe("atomic content translations", () => {`:

```ts
  it.each(["product", "variant", "option_list", "option_label", "menu", "section"] as const)(
    "%s with no customer-facing name takes a default-language save, though that page leaves it out",
    async (kind) => {
      const ids = await fixture();
      await app(async (tx) => {
        if (kind === "product" || kind === "variant")
          await tx.update(products).set({ customerName: null }).where(eq(products.id, ids[kind]));
        else if (kind === "option_list")
          await tx
            .update(optionLists)
            .set({ customerName: null })
            .where(eq(optionLists.id, ids[kind]));
        else if (kind === "option_label")
          await tx
            .update(optionLabels)
            .set({ customerName: null })
            .where(eq(optionLabels.id, ids[kind]));
        else await tx.update(sections).set({ names: {} }).where(eq(sections.id, ids[kind]));
      });
      const listed = await app(async (tx) => {
        const rows: TranslationTarget[] = [];
        let after: string | undefined;
        do {
          const page = await listTranslationTargets(
            tx,
            "es",
            after === undefined ? {} : { after },
            context,
          );
          rows.push(...page.rows);
          after = page.next ?? undefined;
        } while (after !== undefined);
        return rows;
      });
      expect(listed.some((row) => row.kind === kind && row.id === ids[kind])).toBe(false);
      const request = await batch(ids, [kind], "es");
      const result = await app((tx) => saveContentTranslations(tx, "es", request, context));
      expect(result.saved[0]).toMatchObject({
        kind,
        id: ids[kind],
        selectedText: `CLIENT English ${kind}`,
      });
      const stored = await app((tx) =>
        resolveTranslationTargets(tx, "es", [{ kind, id: ids[kind] }], context),
      );
      expect(stored.targets[0]!.target.selectedText).toBe(`CLIENT English ${kind}`);
    },
  );
```

Run `pnpm --filter @waitron/catalogue exec vitest run src/content-translations.test.ts`. Expected: PASS at once (it records today's behaviour; `Tests 73 passed` on `5fc610986`, the file's 67 and these 6). **If any of the six fails with `content.translation_refused` or `content.translation_unavailable`, stop and report it to the owner: the dialog would show a row it cannot save, and changing what the save accepts is a product decision.**

- [ ] **Step 2: Write the failing dialog tests**

In `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`, add the imports

```ts
import { languageDisplayName } from "@waitron/shared";
```

(after the `LiveData` import) and change the `../i18n/t.js` import to

```ts
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
```

then append:

```ts
describe("Translate all notes", () => {
  it("shows a placeholder's note, fills nothing and offers Discard", async () => {
    const { el } = await open(
      venue({
        listed: [target("one")],
        suggestions: [suggestion("s1", "one", { language: null, text: null, placeholder: true })],
      }),
    );
    expect(q(el, "[data-test=placeholder-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.placeholder"),
    );
    expect(field(el, "one")!.value).toBe("");
    expect(q(el, "[data-test=suggested-product-one]")).toBeNull();
    expect(q(el, "[data-test=discard-product-one]")).not.toBeNull();
    expect(save(el).disabled).toBe(true);
  });
  it("shows a spelling fix to the internal name beside the editor link, and still fills", async () => {
    const { el } = await open(
      venue({
        listed: [target("one")],
        suggestions: [
          suggestion("s1", "one"),
          suggestion("s2", "one", {
            language: null,
            text: null,
            fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
          }),
        ],
      }),
    );
    expect(q(el, "[data-test=fix-product-one-internal]")!.textContent!.trim()).toBe(
      fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }),
    );
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    const row = field(el, "one")!.closest("tr")!;
    expect(row.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/one");
  });
  it("shows a fix to a name entered in another language as a note naming that language", async () => {
    const { el } = await open(
      venue({
        listed: [target("one", { defaultText: "CLIENT-en Croquettes" })],
        suggestions: [
          suggestion("s1", "one", {
            language: "en",
            text: null,
            fix: { field: "en", wrong: "Croquetes", right: "Croquettes" },
          }),
        ],
      }),
    );
    expect(q(el, "[data-test=fix-product-one-en]")!.textContent!.trim()).toBe(
      fill("suggestions.fix_language", {
        language: languageDisplayName("en", currentLocale()),
        wrong: "Croquetes",
        right: "Croquettes",
      }),
    );
    expect(field(el, "one")!.value).toBe("");
  });
  it("shows an out-of-date suggestion's note and fills nothing, as after a stale refusal", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one", { stale: true }), suggestion("s2", "two")],
      }),
    );
    expect(q(el, "[data-test=stale-product-one]")!.textContent!.trim()).toBe(
      t("suggestions.stale"),
    );
    expect(field(el, "one")!.value).toBe("");
    api.saveContentTranslations.mockRejectedValueOnce({
      code: "content.translation_stale",
      params: { kind: "product", id: "two" },
    });
    await click(el, "save");
    await vi.waitFor(() => expect(q(el, "[data-test=stale-product-two]")).not.toBeNull());
  });
});

describe("rows the page leaves out", () => {
  const oneLanguage = (overrides: Partial<Venue> = {}) =>
    venue({
      language: "ca",
      config: { defaultLanguage: "ca", languages: ["ca"] },
      omitted: [target("empty", { defaultRequired: true })],
      suggestions: [suggestion("s1", "empty", { language: "ca", text: "CLIENT-ca Croquetes" })],
      ...overrides,
    });
  it("shows a one-language venue's suggestion for an empty name and saves it", async () => {
    const { el, api } = await open(oneLanguage());
    expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
      targets: [{ kind: "product", id: "empty" }],
    });
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull();
    expect(q(el, "[data-test=complete]")).toBeNull();
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("ca", {
      edits: [
        { kind: "product", id: "empty", expected: "baseline-empty", text: "CLIENT-ca Croquetes" },
      ],
    });
  });
  it("keeps a page-omitted suggested row through a live refresh", async () => {
    const liveData = new LiveData();
    const { el, api } = await open(oneLanguage(), { liveData });
    const reads = api.getContentTranslationTargets.mock.calls.length;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThanOrEqual(reads + 2),
    );
    await settle(el);
    expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes");
    expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull();
  });
  it("leaves out an omitted item that is gone, named since, or whose suggestion is out of date", async () => {
    const { el, api } = await open(
      oneLanguage({
        omitted: [
          target("gone", { eligible: false, unavailableReason: "missing" }),
          target("named", { selectedText: "Pa", effectiveSelectedText: "Pa" }),
          target("old"),
        ],
        suggestions: [
          suggestion("s1", "gone", { language: "ca" }),
          suggestion("s2", "named", { language: "ca" }),
          suggestion("s3", "old", { language: "ca", stale: true }),
        ],
      }),
    );
    expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
      targets: [
        { kind: "product", id: "gone" },
        { kind: "product", id: "named" },
      ],
    });
    expect(q(el, "[data-test=complete]")).not.toBeNull();
  });
  it("reads omitted items fifty at a time", async () => {
    const ids = Array.from({ length: 60 }, (_, n) => `e${String(n).padStart(2, "0")}`);
    const { el, api } = await open(
      oneLanguage({
        omitted: ids.map((id) => target(id)),
        suggestions: ids.map((id) =>
          suggestion(`s-${id}`, id, { language: "ca", text: `CLIENT-ca ${id}` }),
        ),
      }),
    );
    const sizes = api.getContentTranslationTargets.mock.calls
      .filter(([, query]) => query.targets)
      .map(([, query]) => query.targets!.length);
    expect(sizes).toEqual([50, 10]);
    expect(field(el, "e00")!.value).toBe("CLIENT-ca e00");
  });
});
```

In `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts`, change the client import to

```ts
import type {
  ContentSuggestionView,
  DashboardApi,
  TranslationPage,
  TranslationTarget,
} from "../api/client.js";
```

and append:

```ts
const note = (overrides: Partial<ContentSuggestionView>): ContentSuggestionView => ({
  id: "s",
  kind: "product",
  itemId: "suggested",
  language: null,
  text: null,
  placeholder: false,
  fix: null,
  stale: false,
  ...overrides,
});
describe.each(["light", "dark"] as const)(
  "translation dialog suggestion accessibility (%s)",
  (theme) => {
    it.each([390, 1280])(
      "renders suggested, fix, placeholder and out-of-date rows in both languages at %i px",
      async (width) => {
        await page.viewport(width, 700);
        for (const locale of ["en-GB", "es-ES"]) {
          setLocale(locale);
          cleanupWidgets();
          const rows = [
            { ...row, id: "suggested", name: "STAFF Croquetas de la casa" },
            {
              ...row,
              id: "fixed",
              name: "STAFF ZURRITO",
              defaultText: "CLIENT-en Croquetes",
              effectiveDefaultText: "CLIENT-en Croquetes",
              defaultRequired: false,
            },
            { ...row, id: "placeholder", name: "STAFF ?? nuevo" },
            { ...row, id: "stale", name: "STAFF Pan" },
          ];
          const api = {
            getContentTranslationTargets: vi.fn(async () => result(rows)),
            getContentSuggestions: vi.fn(async (language: string) => ({
              language,
              run: null,
              service: "on" as const,
              cloudOrigin: null,
              next: null,
              suggestions: [
                note({ id: "s1", language: "es", text: "CLIENT-es Croquetas caseras" }),
                note({ id: "s2", language: "en", text: "CLIENT-en Homemade croquettes" }),
                note({
                  id: "s3",
                  itemId: "fixed",
                  fix: { field: "internal", wrong: "ZURRITO", right: "ZURITO" },
                }),
                note({
                  id: "s4",
                  itemId: "fixed",
                  language: "en",
                  fix: { field: "en", wrong: "Croquetes", right: "Croquettes" },
                }),
                note({ id: "s5", itemId: "placeholder", placeholder: true }),
                note({
                  id: "s6",
                  itemId: "stale",
                  language: "es",
                  text: "CLIENT-es Pan",
                  stale: true,
                }),
              ],
            })),
            saveContentTranslations: vi.fn(),
            discardContentSuggestion: vi.fn(),
            startContentSuggestions: vi.fn(async () => ({ run: null })),
          } as unknown as DashboardApi;
          const { el, host } = await mountWidget<ContentTranslationsDialog>(
            "dashboard-content-translations-dialog",
            { api, language: "es", open: true },
            theme,
          );
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull(),
          );
          await el.updateComplete;
          const table = el.shadowRoot!.querySelector("wt-data-table")!;
          await table.updateComplete;
          for (const selector of [
            "[data-test=suggested-product-suggested]",
            "[data-test=fix-product-fixed-internal]",
            "[data-test=fix-product-fixed-en]",
            "[data-test=placeholder-product-placeholder]",
            "[data-test=stale-product-stale]",
          ])
            expect(table.shadowRoot!.querySelector(selector), selector).not.toBeNull();
          const modal = el.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          const native = modal.shadowRoot!.querySelector("dialog")!;
          expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
          expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
          await expectNoA11yViolations(host);
          await page.screenshot({
            element: native,
            path: `__screenshots__/look/translate-all-${locale}-${theme}-${width}.png`,
          });
        }
      },
    );
  },
);
```

(The screenshot follows the file's existing practice at `:193-196`; `__screenshots__/` is ignored by git, `.gitignore:20`.)

- [ ] **Step 3: Run them to see them fail**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.a11y.test.ts
```

Expected: FAIL — each note case reads `null` where it expects a note (`Cannot read properties of null (reading 'textContent')`); the one-language case finds no `targets` call and shows the "every name has a translation" sentence; the live-refresh case finds no field; "reads omitted items fifty at a time" gets `[]`; the new accessibility cases fail on their first selector. The Task 15 cases still pass.

- [ ] **Step 4: Add the strings**

English, after Task 15's `"suggestions.discard_named"` line:

```ts
  "suggestions.fix_internal": "Possible spelling fix: {wrong} → {right}",
  "suggestions.fix_language": "Possible spelling fix in {language}: {wrong} → {right}",
  "suggestions.placeholder": "This name doesn't say what it is, so there is no suggestion.",
  "suggestions.stale": "This name changed after the suggestion was made.",
```

Spanish, after its `"suggestions.discard_named"` line:

```ts
  "suggestions.fix_internal": "Posible corrección: {wrong} → {right}",
  "suggestions.fix_language": "Posible corrección en {language}: {wrong} → {right}",
  "suggestions.placeholder": "Este nombre no dice qué es, así que no hay sugerencia.",
  "suggestions.stale": "Este nombre cambió después de hacer la sugerencia.",
```

- [ ] **Step 5: Change the dialog**

(a) Add `TranslationRef` to the type import from `"../api/client.js"` (after `TranslationGapKind,`).

(b) In `#scan`, replace Task 15's `return { generation, revision, rows, retained, suggestions, config: first!.config };` with:

```ts
    // Under the default language the page leaves out a name stored as null or `{}`
    // (`listTranslationTargets`, packages/catalogue/src/content-translation-targets.ts), so a
    // suggestion for one is read by reference and becomes a row of its own.
    const listed = new Set(rows.map(translationKey));
    const index = indexSuggestions(suggestions, language, first!.config.defaultLanguage);
    const omitted = new Map<string, TranslationRef>();
    for (const view of suggestions) {
      const ref = { kind: view.kind, id: view.itemId };
      const key = translationKey(ref);
      if (!listed.has(key) && !index.get(key)!.stale) omitted.set(key, ref);
    }
    const omittedRefs = [...omitted.values()];
    for (let offset = 0; offset < omittedRefs.length; offset += 50) {
      const value = await read({ targets: omittedRefs.slice(offset, offset + 50) });
      if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
        return undefined;
      if (!value) return undefined;
      check(value);
      rows.push(
        ...value.rows.filter((row) => row.eligible && !(row.effectiveSelectedText ?? "").trim()),
      );
    }
    return { generation, revision, rows, retained, suggestions, config: first!.config };
```

(c) Add this method right before `#reviewCell(row: TranslationTarget) {`:

```ts
  #notes(row: TranslationTarget) {
    const found = this.model!.suggestionFor(row);
    if (!found) return nothing;
    const key = `${row.kind}-${row.id}`;
    return html`${found.stale ? html`<span part="translation-meta" data-test=${`stale-${key}`}>${t("suggestions.stale")}</span>` : nothing}${found.placeholder ? html`<span part="translation-meta" data-test=${`placeholder-${key}`}>${t("suggestions.placeholder")}</span>` : nothing}${found.fixes.map((fix) => html`<span part="translation-meta" data-test=${`fix-${key}-${fix.field}`}>${fix.field === "internal" ? fill("suggestions.fix_internal", { wrong: fix.wrong, right: fix.right }) : fill("suggestions.fix_language", { language: this.#name(fix.field), wrong: fix.wrong, right: fix.right })}</span>`)}`;
  }
```

(d) In the `name` column's cell, right after Task 15's `suggested-…` line, add:

```ts
              ${this.#notes(row)}
```

(e) In the same cell, change the Discard button's condition from `${this.model!.isSuggested(row) ? html`<wt-button data-test=${`discard-…` to `${this.model!.suggestionFor(row) ? html`<wt-button data-test=${`discard-…`, leaving the rest of that line as Task 15 wrote it.

- [ ] **Step 6: Run the tests to see them pass**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.a11y.test.ts src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.unsaved.test.ts
pnpm --filter @waitron/dashboard typecheck
```

Expected: PASS, no failures. Control for the left-out rows (the snapshot rule): change `const omittedRefs = [...omitted.values()];` to `const omittedRefs = this.model ? [] : [...omitted.values()];` (read them only at opening) and see "keeps a page-omitted suggested row through a live refresh" fail while "shows a one-language venue's suggestion" still passes; restore. (Measured 2026-10-14 in a copy of the tree at `5fc610986` with these edits: that control failed that one case.)

- [ ] **Step 7: Look at it**

Open the eight `apps/dashboard/src/widgets/__screenshots__/look/translate-all-*.png` images the accessibility case wrote (both locales, both themes, 390 and 1280 px). Check that each note sits under the row's kind line in the muted colour, Discard suggestion sits under the fields, and nothing runs past the dialog at 390 px. The demo stack has no Cloud, so these images are the look.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add packages/catalogue/src/content-translations.test.ts apps/dashboard/src/widgets/content-translations-dialog.ts apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "The translations dialog shows spelling fixes, placeholders and out-of-date suggestions, and rows the page leaves out, such as a one-language venue's empty names"
```

---

### Task 17: The 100-draft limit, closing without asking, and continuing later

**Files:**
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.ts` (the capacity line in `render`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (one key, both tables)
- Test: `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`, `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts`

**Interfaces:**
- Consumes: `TranslationDrafts.unfilledCount`, `suggestedCount` (Task 13); the dialog after Task 16.
- Produces: no new exports.

The model already stops filling at 100 (Task 13), Save sends at most 100 edits, and closing over untouched suggestions asks nothing (Task 15). This task tells the person why the other rows are empty — "{shown} suggestions are filled in. Save them to see the rest." (role status, `data-test="suggestion-capacity"`), shown while `unfilledCount > 0`, in place of today's "100 items are edited…" line — and adds the spec's "continuing later" tests: suggestions live on the box, so closing loses none, and a save (which closes the dialog) leaves the rest to fill the next opening. Both of those pass once Tasks 15 and 16 are in; they are here because the spec's testing list names them and no other test reopens the dialog over waiting suggestions.

- [ ] **Step 1: Write the tests**

In `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`, append:

```ts
describe("the 100-draft limit and continuing later", () => {
  const many = () => {
    const rows = Array.from({ length: 150 }, (_, n) => target(String(n).padStart(3, "0")));
    return venue({
      listed: rows,
      suggestions: rows.map((row) => suggestion(`s${row.id}`, row.id)),
    });
  };
  it("fills at most 100 drafts, says so, and saves those 100", async () => {
    const { el, api } = await open(many());
    expect(q(el, "[data-test=suggestion-capacity]")!.textContent!.trim()).toBe(
      fill("suggestions.capacity", { shown: "100" }),
    );
    await click(el, "next");
    await click(el, "next");
    expect(field(el, "100")!.value).toBe("");
    expect(field(el, "100")!.disabled).toBe(true);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    const edits = api.saveContentTranslations.mock.calls[0]![1].edits;
    expect(edits).toHaveLength(100);
    expect(edits.at(-1)).toEqual({
      kind: "product",
      id: "099",
      expected: "baseline-099",
      text: "CLIENT-es 099",
    });
  });
  it("closing keeps every suggestion for the next opening", async () => {
    const { el, api } = await open(
      venue({
        listed: [target("one"), target("two")],
        suggestions: [suggestion("s1", "one"), suggestion("s2", "two")],
      }),
    );
    await click(el, "close");
    await vi.waitFor(() => expect(el.open).toBe(false));
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el, "two")?.value).toBe("CLIENT-es two"));
    expect(field(el, "one")!.value).toBe("CLIENT-es one");
    expect(api.discardContentSuggestion).not.toHaveBeenCalled();
  });
  it("saving a page closes the dialog, and the next opening fills the rest", async () => {
    const { el } = await open(many());
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el, "100")?.value).toBe("CLIENT-es 100"));
    await settle(el);
    expect(field(el, "000")).toBeNull();
    expect(q(el, "[data-test=suggestion-capacity]")).toBeNull();
    expect(field(el, "149")!.value).toBe("CLIENT-es 149");
  });
});
```

In `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts`, change the `../i18n/t.js` import to `import { fill, t, setLocale } from "../i18n/t.js";` and append (Review Focus 5):

```ts
it("fills at most 100 of 150 suggestions and closes without asking", async () => {
  const rows = Array.from({ length: 150 }, (_, n) => ({
    ...result.rows[0]!,
    id: `dish-${n}`,
    name: `STAFF Soup ${n}`,
    expected: `baseline-${n}`,
  }));
  const { app, form } = await mountWith(
    suggestionApi(
      { ...result, rows },
      rows.map((row, n) => soup(`s${n}`, row.id, `CLIENT-es Sopa ${n}`)),
    ),
  );
  expect(
    form.shadowRoot!.querySelector("[data-test=suggestion-capacity]")!.textContent!.trim(),
  ).toBe(fill("suggestions.capacity", { shown: "100" }));
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await closeUnasked(app, form);
});
```

- [ ] **Step 2: Run them to see the capacity cases fail**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.unsaved.test.ts
```

Expected: "fills at most 100 drafts, says so, and saves those 100" and "fills at most 100 of 150 suggestions and closes without asking" FAIL (`Cannot read properties of null (reading 'textContent')`: there is no capacity line yet). The two continuing-later cases PASS already, as explained above; what would make them fail is a close that discards suggestions or a reopening that does not fill again.

- [ ] **Step 3: Add the string**

English, after `"suggestions.stale"`:

```ts
  "suggestions.capacity": "{shown} suggestions are filled in. Save them to see the rest.",
```

Spanish, after its `"suggestions.stale"`:

```ts
  "suggestions.capacity": "Hay {shown} sugerencias rellenadas. Guárdalas para ver el resto.",
```

- [ ] **Step 4: Show the capacity line**

In `apps/dashboard/src/widgets/content-translations-dialog.ts`'s `render`, replace

```ts
              ${count >= 100 ? html`<p role="status">${t("translations.capacity")}</p>` : nothing}
```

with

```ts
              ${
                this.model.unfilledCount > 0
                  ? html`<p role="status" data-test="suggestion-capacity">
                      ${fill("suggestions.capacity", { shown: String(this.model.suggestedCount) })}
                    </p>`
                  : count >= 100
                    ? html`<p role="status">${t("translations.capacity")}</p>`
                    : nothing
              }
```

(`unfilledCount` is above zero only once the drafts reach 100, because filling stops only there, so the general limit line is never needed beside it.)

- [ ] **Step 5: Run the tests to see them pass**

```bash
pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.a11y.test.ts src/widgets/content-translations-model.test.ts
pnpm --filter @waitron/dashboard typecheck
```

Expected: PASS, no failures. (Measured 2026-10-14 in a copy of the tree at `5fc610986` with Tasks 13, 15, 16 and 17's dialog and model edits and stand-in suggestion types: the drafts file ran 19 tests, the unsaved file 14, all passing.) CI runs the dashboard's coverage; if its branch bar drops, the new branches to look at are `#discard`'s refusal path and `#scan`'s abandoned-read returns.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/dashboard/src/widgets/content-translations-dialog.ts apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "The translations dialog says when more suggestions wait beyond the 100 a save can carry, and tests that closing or saving keeps the rest for next time"
```

---

### Task 18: A third alert level, notice

**Files:**
- Modify: `packages/module/src/alerts.ts` (`AlertSeverity`)
- Modify: `apps/server/src/alerts.ts` (`SEVERITY_RANK`)
- Modify: `packages/ui/src/components/wt-count-badge.ts` (tone `notice`)
- Modify: `apps/dashboard/src/api/client.ts` (`AlertView.severity`), `apps/dashboard/src/widgets/alert-format.ts` (`severityLabel`), `apps/dashboard/src/widgets/alerts-bell.ts` (badge tone, list item edge), `apps/dashboard/src/i18n/strings.ts` (`alerts.severity.notice`)
- Modify: `docs/developers/design-system.md` (the `wt-count-badge` row, the bell's paragraph, the badge's accessibility receipt)
- Test: `packages/ui/src/components/wt-count-badge.test.ts`, `packages/ui/src/components/wt-count-badge.a11y.test.ts`, `apps/server/src/alerts.test.ts`, `apps/dashboard/src/widgets/alerts-bell.test.ts`, `apps/dashboard/src/widgets/alerts-bell.a11y.test.ts`, `apps/dashboard/src/widgets/alert-format.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AlertSeverity = "warning" | "error" | "notice"` (`packages/module/src/alerts.ts:3`); `WtCountBadgeTone = "neutral" | "warning" | "error" | "notice"`; `SEVERITY_RANK = { error: 0, warning: 1, notice: 2 }`; `AlertView.severity: "warning" | "error" | "notice"`. `IncidentSeverity` (`packages/db/src/schema/incidents.ts:8`, `packages/core/src/incidents.ts:9`) is unchanged: a recorded incident is never a notice, and `eventAlert` (`apps/server/src/alerts.ts:63-76`) copies the incident's severity, so the types keep it so.

Drawing: the notice tone paints from `--wt-color-primary` with `--wt-color-on-primary` (existing tokens in both themes, `packages/ui-core/src/tokens/colors.css`), so it reads as news, not a fault. The bell's badge tone is `error` if any open alert is an error, else `warning` if any is a warning, else `notice`; a notice's list item has `border-inline-start-color: var(--wt-color-primary)`. Order: errors, then warnings, then notices. A notice that arrives while the page is open raises the shell's toast in its `info` tone (`apps/dashboard/src/dashboard-app.ts:1071` gives `error` only for an error), which needs no change.

The Spanish label is "Información", not "Aviso": the panel's own title is "Avisos" and its alert column "Aviso" (`alerts.title`, `alerts.col_alert`), and `alert-format.test.ts:98-102` already holds the warning's label apart from that column for the same reason.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/src/components/wt-count-badge.test.ts`, add a row to the token-painting `test.each` (`wt-count-badge.test.ts:41-52`), so the table reads:

```ts
test.each([
  ["error", "--wt-color-danger", "--wt-color-on-danger"],
  ["warning", "--wt-color-warning", "--wt-color-on-warning"],
  ["notice", "--wt-color-primary", "--wt-color-on-primary"],
  ["neutral", "--wt-color-surface-raised", "--wt-color-text"],
] as const)("a %s badge paints from its tokens", async (tone, background, text) => {
```

In `packages/ui/src/components/wt-count-badge.a11y.test.ts`, the tone list (`wt-count-badge.a11y.test.ts:12`) becomes `test.each(["neutral", "warning", "error", "notice"] as const)("a %s badge", …)`, and after the "detects unreadable badge text" case add:

```ts
  test("detects unreadable notice text", async () => {
    await mountThemed('<wt-count-badge count="12" tone="notice"></wt-count-badge>', theme);
    // `--wt-color-on-primary` against the page background is unreadable in both themes.
    host.style.setProperty("--wt-color-primary", "var(--wt-color-bg)");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("color-contrast");
  });
```

In `apps/server/src/alerts.test.ts`, inside `describe("readOpenAlerts", …)` after "puts alerts without a since last and breaks ties by key" (`alerts.test.ts:199-216`):

```ts
  it("puts notices after warnings and errors, however new", async () => {
    const source: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async () => [
        {
          key: "notice",
          code: "printing.x",
          params: {},
          severity: "notice",
          since: "2026-09-14T11:59:00.000Z",
        },
        {
          key: "warning",
          code: "printing.x",
          params: {},
          severity: "warning",
          since: "2026-09-14T10:00:00.000Z",
        },
        {
          key: "error",
          code: "printing.x",
          params: {},
          severity: "error",
          since: "2026-09-14T09:00:00.000Z",
        },
      ],
    };
    const r = createAlertRegistry({ claims: [], sources: [source] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["diagnostics.view"])),
    );
    expect(alerts.map((a) => a.key)).toEqual(["error", "warning", "notice"]);
  });
```

In `apps/dashboard/src/widgets/alerts-bell.test.ts`, after the `jobsWaiting` fixture (`alerts-bell.test.ts:38-47`):

```ts
const notice: AlertView = { ...ongoing, key: "notice:local", severity: "notice" };
```

and inside `describe("dashboard-alerts-bell", …)` after the first case:

```ts
  it("draws only notices in the notice tone, and lets a warning or an error outrank them", async () => {
    setLocale("en-GB");
    const { el, host } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [notice],
    });
    host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    el.open();
    const badge = q(el, "wt-count-badge")!;
    expect(badge.getAttribute("tone")).toBe("notice");
    const item = qa(el, "li")[0]!;
    expect(getComputedStyle(item).borderInlineStartColor).toBe("rgb(1, 2, 3)");
    expect(item.textContent!.replace(/\s+/g, " ")).toContain("Notice · Backups");
    el.alerts = [notice, event("1", "warning")];
    await el.updateComplete;
    expect(badge.getAttribute("tone")).toBe("warning");
    expect(getComputedStyle(qa(el, "li")[1]!).borderInlineStartColor).toBe("rgb(4, 5, 6)");
    el.alerts = [notice, event("2", "error")];
    await el.updateComplete;
    expect(badge.getAttribute("tone")).toBe("error");
  });
```

In `apps/dashboard/src/widgets/alerts-bell.a11y.test.ts`, add a third entry to `alerts` (`alerts-bell.a11y.test.ts:12-32`):

```ts
  {
    key: "notice:local",
    kind: "ongoing",
    code: "backup.disabled",
    params: {},
    severity: "notice",
    since: "2026-09-14T12:00:00.000Z",
    area: "backup",
    screen: "backup",
  },
```

In `apps/dashboard/src/widgets/alert-format.test.ts`, after "names a Spanish warning differently from the alert column it sits under" (`alert-format.test.ts:98-102`):

```ts
it("labels a notice in both languages, apart from the alert column it sits under", () => {
  setLocale("en-GB");
  expect(severityLabel("notice")).toBe("Notice");
  setLocale("es-ES");
  expect(severityLabel("notice")).toBe("Información");
  expect(severityLabel("notice")).not.toBe(t("alerts.col_alert"));
  expect(severityLabel("notice")).not.toBe(severityLabel("warning"));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-count-badge.test.ts src/components/wt-count-badge.a11y.test.ts`
Expected: FAIL — "a notice badge paints from its tokens" (the background is the neutral `--wt-color-surface-raised`, not `rgb(1, 2, 3)`) and, in both themes, "detects unreadable notice text" (no `color-contrast` violation, because a notice badge is still drawn neutral). The two new `a notice badge` cases pass already: a neutral badge is readable.

Run: `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts`
Expected: FAIL — "puts notices after warnings and errors, however new": `SEVERITY_RANK.notice` is undefined, the comparison is `NaN`, and the order comes out wrong.

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/alerts-bell.test.ts src/widgets/alerts-bell.a11y.test.ts src/widgets/alert-format.test.ts`
Expected: FAIL — the bell case (`tone` is `warning`, not `notice`) and the label case (`severityLabel("notice")` is "Warning").

- [ ] **Step 3: Implement**

`packages/module/src/alerts.ts:3`:

```ts
/** A notice is news, not a fault: only an ongoing source raises one, never a recorded incident. */
export type AlertSeverity = "warning" | "error" | "notice";
```

`apps/server/src/alerts.ts`: the `@waitron/module` type import (`alerts.ts:5`) gains `AlertSeverity`, and `SEVERITY_RANK` (`alerts.ts:78`) becomes:

```ts
const SEVERITY_RANK = { error: 0, warning: 1, notice: 2 } as const satisfies Record<
  AlertSeverity,
  number
>;
```

`packages/ui/src/components/wt-count-badge.ts`: the type (`wt-count-badge.ts:5`) becomes `export type WtCountBadgeTone = "neutral" | "warning" | "error" | "notice";`, and after the `:host([tone="error"]) span` rule add:

```css
      :host([tone="notice"]) span {
        border-color: transparent;
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
```

`apps/dashboard/src/api/client.ts:1664`: `severity: "warning" | "error" | "notice";`.

`apps/dashboard/src/widgets/alert-format.ts`: add `import type { StringKey } from "../i18n/strings.js";` and replace `severityLabel` (`alert-format.ts:52-54`) with:

```ts
const SEVERITY_LABELS = {
  error: "alerts.severity.error",
  warning: "alerts.severity.warning",
  notice: "alerts.severity.notice",
} as const satisfies Record<AlertView["severity"], StringKey>;

export function severityLabel(severity: AlertView["severity"]): string {
  return t(SEVERITY_LABELS[severity]);
}
```

`apps/dashboard/src/i18n/strings.ts`: after `"alerts.severity.warning": "Warning",` (about line 683) add `"alerts.severity.notice": "Notice",`; after `"alerts.severity.warning": "Advertencia",` (about line 3647) add `"alerts.severity.notice": "Información",`.

`apps/dashboard/src/widgets/alerts-bell.ts`: the `@waitron/ui` import (`alerts-bell.ts:3`) becomes `import { baseStyles, type WtCountBadgeTone, type WtRowActions } from "@waitron/ui";`; after `li[data-severity="warning"] { … }` (`alerts-bell.ts:72-74`) add:

```css
      li[data-severity="notice"] {
        border-inline-start-color: var(--wt-color-primary);
      }
```

above `@customElement("dashboard-alerts-bell")` add:

```ts
function badgeTone(alerts: readonly AlertView[]): WtCountBadgeTone {
  if (alerts.some((alert) => alert.severity === "error")) return "error";
  if (alerts.some((alert) => alert.severity === "warning")) return "warning";
  return "notice";
}
```

and the badge's `tone=${…}` (`alerts-bell.ts:178`) becomes `tone=${badgeTone(this.alerts)}`.

`docs/developers/design-system.md`:
- In the `wt-count-badge` row (line 641) replace `` `tone` (`neutral`\|`warning`\|`error`, reflected) `` with `` `tone` (`neutral`\|`warning`\|`error`\|`notice`, reflected; `notice` paints `--wt-color-primary` with `--wt-color-on-primary`, for news that is not a fault) ``.
- In the bell's paragraph (line 2797) replace "The badge is red when any open alert is an error and amber otherwise." with "The badge is red when any open alert is an error, amber when any is a warning, and blue (`--wt-color-primary`) when every open alert is a notice; each listed alert's leading edge takes its own level's colour."
- In the accessibility receipts (line 3362) after `` `packages/ui/src/components/wt-count-badge.a11y.test.ts` `` add `` — and its notice tone, verified <today's date as yyyy-mm-dd> by running the same file in both themes `` (write the date of the run you did in Step 4).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-count-badge.test.ts src/components/wt-count-badge.a11y.test.ts src/no-hardcoded-chrome.test.ts`
Expected: PASS; read the `Tests` count (the a11y file runs 10 cases: five per theme).

Run: `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts && pnpm --filter @waitron/dashboard exec vitest run src/widgets/alerts-bell.test.ts src/widgets/alerts-bell.a11y.test.ts src/widgets/alert-format.test.ts src/screens/alerts-screen.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run scripts/style-token-names.test.ts && pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/dashboard typecheck`
Expected: PASS and no type errors. The `satisfies` clauses are what make a fourth level a type error in both tables; delete `notice: 2` from `SEVERITY_RANK` and see `pnpm --filter @waitron/server typecheck` refuse it, then put it back.

Check free memory (`memory_pressure | grep free`). Well above 15%: run `pnpm --filter @waitron/ui mutation` scoped to `src/components/wt-count-badge.ts` as `docs/developers/ci-and-gates.md` describes and read its score against the floor of 90. Otherwise leave the mutation floor to CI and say so in the handover.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/module/src/alerts.ts apps/server/src/alerts.ts apps/server/src/alerts.test.ts packages/ui/src/components/wt-count-badge.ts packages/ui/src/components/wt-count-badge.test.ts packages/ui/src/components/wt-count-badge.a11y.test.ts apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/alert-format.ts apps/dashboard/src/widgets/alert-format.test.ts apps/dashboard/src/widgets/alerts-bell.ts apps/dashboard/src/widgets/alerts-bell.test.ts apps/dashboard/src/widgets/alerts-bell.a11y.test.ts apps/dashboard/src/i18n/strings.ts docs/developers/design-system.md
git commit -s -m "Add a notice alert level, which the bell draws as news rather than as a fault"
```

---

### Task 19: The "translations ready" notice

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (`contentSuggestionsAlertSource`)
- Modify: `apps/server/src/boot.ts` (import; `serverAlertSources`, `boot.ts:1821-1840`)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (two codes), `apps/dashboard/src/i18n/strings.ts` (`alerts.area.content`), `apps/dashboard/src/widgets/alert-format.ts` (`goToLabel`)
- Test: `apps/server/src/alert-sources.test.ts`, `apps/server/src/boot.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`, `apps/dashboard/src/widgets/alert-format.test.ts`, `apps/dashboard/src/widgets/alerts-bell.test.ts`

**Interfaces:**
- Consumes: `readSuggestionRun(tx): Promise<SuggestionRunView | null>` (Task 8, exported from `@waitron/catalogue`); the tables `contentSuggestionJobs` and `contentSuggestions` (Task 5, exported from `@waitron/catalogue`) in the tests; `AlertSource`, `OngoingAlert` (`packages/module/src/alerts.ts`); the `notice` level (Task 18); `QUERY_DEPENDENCIES.listAlerts` already names both suggestion tables (Task 13), so the bell asks again as soon as a run finishes or is opened.
- Produces: `contentSuggestionsAlertSource(): AlertSource` — `area: "content"`, `permission: "catalogue.manage"`. When `readSuggestionRun` shows a run that is `done` or `partly_done`, not opened, with `waiting > 0`, it returns one alert `{ key: "content.suggestions_ready", severity: "notice", since: run.finishedAt, screen: "content-languages", params: { count: run.waiting, failed: run.failed } }`, with `code: "content.suggestions_ready"` when `run.failed` is 0 and `code: "content.suggestions_ready_partly"` otherwise. Each code is spelled as its own `code: "…"` literal, because `scripts/ongoing-alert-codes.test.ts` finds codes that way (it reads text). `goToLabel(screen)` also tries `nav.<screen with hyphens as underscores>`.

What this changes beyond the notice:
- A session holding `catalogue.manage` and no other alert permission now sees the bell: `alertsVisible` (`apps/server/src/alerts.ts:49-51`) is true for any source's permission. Such a session sees only this area's alerts.
- `goToLabel("prep-stations")` now reads "Go to Prep stations" where the venue service module's strings are registered (`nav.prep_stations`, `packages/venue-service/src/dashboard/strings.ts:233`), instead of "Go to prep-stations"; `device-profiles` likewise finds `nav.device_profiles`. Both are the label the sidebar already shows.

Wording (`ALERT_MESSAGES`). The formatter writes a number as given ("1050"), without a thousands separator, in both languages (`formatParam`, `packages/dashboard-kit/src/alert-messages.ts`); a number slot is out of scope.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/alert-sources.test.ts`: add `contentSuggestionsAlertSource` to the `./alert-sources.js` import (`alert-sources.test.ts:35-49`), add `import { randomUUID } from "node:crypto";` at the top, and change the catalogue import (`alert-sources.test.ts:3`) to `import { CATALOGUE_MIGRATIONS, contentSuggestionJobs, contentSuggestions } from "@waitron/catalogue";`. At the end of the file (after every use of `suite`, which is declared at `alert-sources.test.ts:549`, so the venue database with the catalogue's tables is the one these cases use, reset after each test):

```ts
const FINISHED = "2026-09-15T11:30:00.000Z";

async function seedSuggestionJob(
  values: Partial<typeof contentSuggestionJobs.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await suite.db.insert(contentSuggestionJobs).values({
    id,
    runId: randomUUID(),
    position: 1,
    state: "done",
    sent: { "product:p0": ["en"], "product:p1": ["en"] },
    runTotal: 2,
    total: 2,
    done: 2,
    failed: 0,
    released: true,
    createdAt: "2026-09-15T11:00:00.000Z",
    finishedAt: FINISHED,
    ...values,
  });
  return id;
}

/** `count` suggestions with text, which are what the notice counts, and one placeholder, which is not. */
async function seedWaiting(jobId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++)
    await suite.db.insert(contentSuggestions).values({
      jobId,
      kind: "product",
      itemId: `p${i}`,
      language: "en",
      text: `CLIENT-en ${i}`,
      expected: `token-${i}`,
    });
  await suite.db.insert(contentSuggestions).values({
    jobId,
    kind: "product",
    itemId: "placeholder",
    language: null,
    text: null,
    expected: null,
    placeholder: true,
  });
}

function readNotice() {
  return withTransaction(suite.db, (tx) => contentSuggestionsAlertSource().read({ tx, now: NOW }));
}

describe("contentSuggestionsAlertSource", () => {
  it("belongs to the content area and needs catalogue.manage", () => {
    const source = contentSuggestionsAlertSource();
    expect(source.area).toBe("content");
    expect(source.permission).toBe("catalogue.manage");
    expect(source.readOutsideTransaction).toBeUndefined();
  });

  it("raises nothing before any run", async () => {
    expect(await readNotice()).toEqual([]);
  });

  it("raises a notice for a finished run nobody has opened, counting only suggestions with text", async () => {
    await seedWaiting(await seedSuggestionJob(), 2);
    expect(await readNotice()).toEqual([
      {
        key: "content.suggestions_ready",
        code: "content.suggestions_ready",
        params: { count: 2, failed: 0 },
        severity: "notice",
        since: FINISHED,
        screen: "content-languages",
      },
    ]);
  });

  it("raises the partly done notice, with what could not be done, for a run with failures", async () => {
    const jobId = await seedSuggestionJob({ state: "partly_done", done: 2, failed: 88, runTotal: 90 });
    await seedWaiting(jobId, 2);
    expect(await readNotice()).toEqual([
      {
        key: "content.suggestions_ready",
        code: "content.suggestions_ready_partly",
        params: { count: 2, failed: 88 },
        severity: "notice",
        since: FINISHED,
        screen: "content-languages",
      },
    ]);
  });

  it("raises nothing while a job runs", async () => {
    const jobId = await seedSuggestionJob({
      state: "running",
      cloudJobId: "cloud-job-1",
      released: false,
      finishedAt: null,
    });
    await seedWaiting(jobId, 1);
    expect(await readNotice()).toEqual([]);
  });

  it("raises nothing for a done job whose Cloud job is not yet released", async () => {
    const jobId = await seedSuggestionJob({ cloudJobId: "cloud-job-1", released: false });
    await seedWaiting(jobId, 1);
    expect(await readNotice()).toEqual([]);
  });

  it("raises nothing once someone has opened the run", async () => {
    const jobId = await seedSuggestionJob({ openedAt: "2026-09-15T11:45:00.000Z" });
    await seedWaiting(jobId, 2);
    expect(await readNotice()).toEqual([]);
  });

  it("raises nothing for a finished run with no suggestion waiting", async () => {
    await seedWaiting(await seedSuggestionJob(), 0);
    expect(await readNotice()).toEqual([]);
  });

  it.each([
    ["failed", { state: "failed" as const, failure: "provider" as const }],
    ["refused", { state: "refused" as const, refusal: "consent" as const }],
    ["expired", { state: "expired" as const }],
  ])("raises nothing for a %s run, even beside waiting suggestions", async (_name, values) => {
    await seedWaiting(await seedSuggestionJob(values), 1);
    expect(await readNotice()).toEqual([]);
  });
});
```

In `apps/server/src/boot.test.ts`: add `import { contentSuggestionJobs, contentSuggestions } from "@waitron/catalogue";` to the imports, and inside `describe("startServer — what a trading boot wires behind its management routes", …)`, directly after the case "raises the backup-disabled alert from the backup supervisor's live status" (`boot.test.ts:2988-2995`):

```ts
  it("raises the Translate all notice for a finished run nobody has opened", async () => {
    const jobId = randomUUID();
    await liveFixture(port, async (tx) => {
      await tx.insert(contentSuggestionJobs).values({
        id: jobId,
        runId: randomUUID(),
        position: 1,
        state: "done",
        sent: { "product:boot-notice": ["en"] },
        runTotal: 1,
        total: 1,
        done: 1,
        released: true,
        finishedAt: "2026-10-14T10:00:00.000Z",
      });
      await tx.insert(contentSuggestions).values({
        jobId,
        kind: "product",
        itemId: "boot-notice",
        language: "en",
        text: "CLIENT-en Pan",
        expected: "token",
      });
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/management-api/alerts`, {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { alerts: { area: string }[] };
      expect(body.alerts.filter((alert) => alert.area === "content")).toEqual([
        {
          key: "content.suggestions_ready",
          kind: "ongoing",
          area: "content",
          code: "content.suggestions_ready",
          params: { count: 1, failed: 0 },
          severity: "notice",
          since: "2026-10-14T10:00:00.000Z",
          screen: "content-languages",
        },
      ]);
    } finally {
      await liveFixture(port, async (tx) => {
        await tx.delete(contentSuggestions);
        await tx.delete(contentSuggestionJobs);
      });
    }
  }, 60_000);
```

(`liveFixture`, `boot.test.ts:144-160`, writes through the running server's own handle, so this is not a write beside a running server from another handle. The job is released and has no Cloud job, so the runner from Task 12 has nothing to do with it.)

In `apps/dashboard/src/i18n/alerts.test.ts`, at the end:

```ts
it("says how many Translate all suggestions wait, and how many could not be done", () => {
  expect(alertMessage("content.suggestions_ready", { count: 1050, failed: 0 }, "en")).toBe(
    "Translations ready: 1050 suggestions are waiting for review",
  );
  expect(alertMessage("content.suggestions_ready", { count: 1050, failed: 0 }, "es")).toBe(
    "Traducciones listas: 1050 sugerencias pendientes de revisar",
  );
  expect(alertMessage("content.suggestions_ready_partly", { count: 1050, failed: 88 }, "en")).toBe(
    "Translations ready: 1050 suggestions are waiting for review. 88 couldn't be done this time.",
  );
  expect(alertMessage("content.suggestions_ready_partly", { count: 1050, failed: 88 }, "es")).toBe(
    "Traducciones listas: 1050 sugerencias pendientes de revisar. 88 no se han podido hacer esta vez.",
  );
});
```

In `apps/dashboard/src/widgets/alert-format.test.ts`, after "names the destination screen by its navigation label" (`alert-format.test.ts:104-109`):

```ts
it("names a destination whose screen name is hyphenated by its navigation label", () => {
  setLocale("en-GB");
  expect(goToLabel("content-languages")).toBe("Go to Content languages");
  expect(goToLabel("device-profiles")).toBe("Go to Device profiles");
  setLocale("es-ES");
  expect(goToLabel("content-languages")).toBe("Ir a Idiomas del contenido");
});

it("labels the translations area in both languages", () => {
  setLocale("en-GB");
  expect(areaLabel("content")).toBe("Translations");
  setLocale("es-ES");
  expect(areaLabel("content")).toBe("Traducciones");
});
```

(The existing cases "names a destination with no navigation label by its screen name" and "…holding a replacement pattern as written" keep `no-such-screen` and `screen-$&`, which have no label under either spelling.)

In `apps/dashboard/src/widgets/alerts-bell.test.ts`, after the `notice` fixture Task 18 added:

```ts
const suggestionsReady: AlertView = {
  key: "content.suggestions_ready",
  kind: "ongoing",
  code: "content.suggestions_ready_partly",
  params: { count: 1050, failed: 88 },
  severity: "notice",
  since: "2026-09-14T12:00:00.000Z",
  area: "content",
  screen: "content-languages",
};
```

and inside `describe("dashboard-alerts-bell", …)`:

```ts
  it("words the Translate all notice from its counts and offers the Content languages screen", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [suggestionsReady],
      canOpen: (screen) => screen === "content-languages",
    });
    const item = qa(el, "li")[0]!.textContent!.replace(/\s+/g, " ");
    expect(item).toContain(
      "Translations ready: 1050 suggestions are waiting for review. 88 couldn't be done this time.",
    );
    expect(item).toContain("Notice · Translations");
    expect(item).not.toContain("content.suggestions_ready_partly");
    expect(q(el, "[data-test=alert-go-to]")!.textContent!.trim()).toBe("Go to Content languages");
    expect(q(el, "wt-count-badge")!.getAttribute("tone")).toBe("notice");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts`
Expected: FAIL — `contentSuggestionsAlertSource is not a function` in every new case (the old cases still pass).

Run: `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "Translate all notice"`
Expected: FAIL — the filtered list is `[]`, not the notice.

Run: `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alert-format.test.ts src/widgets/alerts-bell.test.ts`
Expected: FAIL — the wording falls back to the generic sentence, `goToLabel("content-languages")` is "Go to content-languages", and `areaLabel("content")` is "content".

Run: `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts`
Expected: PASS for now: the codes are not in `alert-sources.ts` yet, so the guard has nothing new to check. It is run again in Step 4, once they are.

- [ ] **Step 3: Implement**

`apps/server/src/alert-sources.ts`: add `import { readSuggestionRun } from "@waitron/catalogue";` beside the other package imports, and at the end of the file:

```ts
/** The Translate all notice: open while a finished run's suggestions wait and nobody has opened
 * them in the translations dialog. */
export function contentSuggestionsAlertSource(): AlertSource {
  return {
    area: "content",
    permission: "catalogue.manage",
    async read({ tx }): Promise<readonly OngoingAlert[]> {
      const run = await readSuggestionRun(tx);
      if (
        run === null ||
        run.opened ||
        run.waiting === 0 ||
        (run.state !== "done" && run.state !== "partly_done")
      )
        return [];
      const params = { count: run.waiting, failed: run.failed };
      const shared = {
        key: "content.suggestions_ready",
        params,
        severity: "notice",
        since: run.finishedAt,
        screen: "content-languages",
      } as const;
      return [
        run.failed === 0
          ? { ...shared, code: "content.suggestions_ready" }
          : { ...shared, code: "content.suggestions_ready_partly" },
      ];
    },
  };
}
```

`apps/server/src/boot.ts`: add `contentSuggestionsAlertSource,` to the `./alert-sources.js` import (`boot.ts:103-115`), and in `serverAlertSources` (`boot.ts:1821`) add `contentSuggestionsAlertSource(),` directly after `printingAlertSource(),` (`boot.ts:1828`).

`apps/dashboard/src/i18n/alert-messages.ts`, at the end of `ALERT_MESSAGES` (after `"reader.status_unavailable"`, `alert-messages.ts:298-301`):

```ts
  "content.suggestions_ready": {
    en: "Translations ready: {count} suggestions are waiting for review",
    es: "Traducciones listas: {count} sugerencias pendientes de revisar",
  },
  "content.suggestions_ready_partly": {
    en: "Translations ready: {count} suggestions are waiting for review. {failed} couldn't be done this time.",
    es: "Traducciones listas: {count} sugerencias pendientes de revisar. {failed} no se han podido hacer esta vez.",
  },
```

`apps/dashboard/src/i18n/strings.ts`: after `"alerts.area.invoice_delivery": "Invoice delivery",` (about line 691) add `"alerts.area.content": "Translations",`; after `"alerts.area.invoice_delivery": "Entrega de facturas",` (about line 3655) add `"alerts.area.content": "Traducciones",`.

`apps/dashboard/src/widgets/alert-format.ts`, replace `goToLabel` (`alert-format.ts:64-69`) with:

```ts
/** A screen's navigation label, under its own name or with its hyphens as underscores
 * (`content-languages` is labelled `nav.content_languages`). */
function navLabel(screen: string): string | null {
  for (const key of [`nav.${screen}`, `nav.${screen.replaceAll("-", "_")}`]) {
    const label = tKit(key);
    if (label !== key) return label;
  }
  return null;
}

/** A screen with no navigation label is named by its screen name, like an unknown area. */
export function goToLabel(screen: string): string {
  return fill("alerts.go_to", { screen: navLabel(screen) ?? screen });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/alerts.test.ts && pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "Translate all notice"`
Expected: PASS; read both `Tests` counts (the filtered boot run shows one passed and the rest skipped).

Run: `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alert-format.test.ts src/widgets/alerts-bell.test.ts src/screens/alerts-screen.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`
Expected: PASS. Then the control: delete the `"content.suggestions_ready_partly"` entry from `ALERT_MESSAGES`, run `scripts/ongoing-alert-codes.test.ts`, and see "every ongoing code has English and Spanish wording" fail naming `content.suggestions_ready_partly`; put it back. `scripts/alert-codes.test.ts` checks recorded incident codes only, so it says nothing about these two.

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/dashboard typecheck`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts apps/server/src/boot.ts apps/server/src/boot.test.ts apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/alerts.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/alert-format.ts apps/dashboard/src/widgets/alert-format.test.ts apps/dashboard/src/widgets/alerts-bell.test.ts
git commit -s -m "Tell the dashboard bell when Translate all suggestions are ready to review"
```

---

### Task 20: Documentation and the backlog

**Files:**
- Modify: `docs/developers/cloud-connection.md` (a "Translate all" section)
- Modify: `docs/developers/products.md` (under "Filling missing customer names together")
- Modify: `docs/backlog.md` (the "A 'Translate all' service from Waitron Cloud" entry, about line 1026, and the side-by-side dialog entry, about line 1089)

- [ ] **Step 1: `cloud-connection.md`** — add this section after the paragraph Task 1 rewrote (follow `~/.claude/docs-writing-style.md`; adjust only names the code you wrote spells differently, and say so in the handover):

```markdown
## Translate all

The box sends Waitron Cloud the customer-facing names a venue is missing, with each item's staff
name, its category, the names it already has and up to 300 saved names as examples of the
venue's style, plus the venue's languages and country. It sends no prices, no people and no sales.

A runner on the primary (`apps/server/src/content-suggestion-runner.ts`) makes every call: it
submits the job the dashboard recorded, asks for progress every five seconds while a job is open,
collects the results, stores them as suggestions and then releases the job so Cloud deletes it.
A lost reply or a restart resumes from the job's row in `content_suggestion_jobs`: a retried
submit signs the same fingerprint with the same operation ID, and Cloud answers with the same job.
A job ends on its own when it is 24 hours old, or when Cloud no longer offers the service to this
box.

Translation calls take the connection's lock only to renew the control lease, never for the HTTP
exchange, so a status or collect call never makes a refresh or a report answer `cloud.busy`.

The submit signature covers a fingerprint of the job (`jobSha256`, `jobBytes`), not the job
itself. The signing vectors are `apps/server/test/cloud-translation-vector.json` and the
contract's "Shared test vectors" section.
```

- [ ] **Step 2: `products.md`** — add after the paragraph that says "Under the default language an absent name is not listed":

```markdown
Translate all (the button at the top of the same dialog) asks Waitron Cloud for every enabled
language in which an item has no customer-facing text, the default language included. Its
results are suggestions: they fill empty fields as drafts and reach no diner until someone saves
them. A default-language suggestion for an item with no customer-facing name in any language is
shown as a row of its own, although the page's own list still leaves such a name out.
```

- [ ] **Step 3: Backlog** — delete the "A 'Translate all' service from Waitron Cloud" entry. In the same area add three short entries:
  - "Translate all: run the end-to-end check on the Santet venue against a local Waitron Cloud once Cloud's side exists (plan `docs/superpowers/plans/2026-10-14-translate-all.md`, Task 21)."
  - "Translate all: a **Use fix** button for a spelling fix to a name someone entered; it waits for the side-by-side translations dialog (plan Decision 6)."
  - "Alert wording writes numbers without a thousands separator (`formatParam`, `packages/dashboard-kit/src/alert-messages.ts`); the Translate all notice reads '1050 suggestions'."
  In the side-by-side dialog entry (about line 1089), replace "Translate all (above) fills the same dialog and needs neither change." with "Translate all fills the same dialog; its **Use fix** button waits for this change (entry above)."

- [ ] **Step 4: Check every claim these edits make** against the code you wrote (CLAUDE.md §1): for each function, file and table named, run `grep -rn "<name>" apps packages` and confirm it exists with that spelling. Read the edited paragraphs once more for a sentence that says more than the code does.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --file-info docs/backlog.md
git add docs/developers/cloud-connection.md docs/developers/products.md docs/backlog.md
git commit -s -m "Document Translate all and update the backlog for what it finishes and leaves open"
```

---

### Task 21: End-to-end check on the Santet venue against a local Waitron Cloud

**Needs Waitron Cloud's side to exist.** Do not start this task until the Cloud repository's Translate all work has landed on its `main` (its four routes, the worker, and the `servicesVersion: 2` reply) and its local runner starts. If it has not, stop here and leave the backlog entry from Task 20 in place.

**Files:** none changed unless the check finds a defect (then fix it test-first in the task that owns the code, and re-run this check).

- [ ] **Step 1: Reconcile the vectors.** Compare `apps/server/test/cloud-translation-vector.json` with the contract's "Shared test vectors" section on Cloud's `main`. They must be identical in every field except `source`. Copy the contract's block into a scratch file under `mktemp -d`, point `src/cloud-translation.test.ts`'s `read("cloud-translation-vector.json")` at it in a throwaway edit, run `pnpm --filter @waitron/server exec vitest run src/cloud-translation.test.ts`, and revert the edit. A difference is a protocol disagreement: report it to the owner; neither side edits its vector to pass.
- [ ] **Step 2: Prepare the Santet worktree.** In `~/workspace/worktrees/waitron-local-santet-data`: `git merge --ff-only main` (after this branch has landed, or merge this branch there for the check and reset afterwards — it has no commits of its own). Rebuild with `local/square/reset.sh` (never `wa-wt reset demo`; check what holds the venue first: `lsof +D <venue folder>` and `lsof -i :8180`).
- [ ] **Step 3: Start a local Cloud** with its local runner, following the Cloud repository's local-pairing guide, with `content_translation` switched on and a real provider key, or Cloud's own fake provider if the owner prefers not to spend.
- [ ] **Step 4: Point the Santet box at it.** Set `WAITRON_CLOUD_ORIGIN` to the local Cloud's origin (`WAITRON_ENV=dev` allows `http://127.0.0.1`), restart, and pair through Cloud services (`docs/developers/cloud-connection.md`). Check Cloud services lists "Translate all" as ready.
- [ ] **Step 5: Run it.** Content languages → Edit translations (a non-default language) → Translate all. Record: the progress line counting up and reaching its total; the number of Cloud jobs (Santet's 358 products plus variants, options and sections may exceed 1,000 items — if so, confirm the second job starts without pressing again); the notice in the bell when it finishes; the notice clearing once the dialog is opened; suggestions as drafts marked Suggested; saving a page of them; discarding one; closing and reopening (the rest are still there); a second device or browser showing the same suggestions; pressing Refresh on the Cloud services screen while a job runs (it must not answer that Cloud is busy).
- [ ] **Step 6: Check what Cloud kept.** In Cloud's database, the job's body and results are gone after release (the contract's release behaviour); only counts remain.
- [ ] **Step 7: Report** what was measured, in the form "pressed X, saw Y" (CLAUDE.md §1), including timings and the counts of suggestions, failures and drops. Delete the backlog entry from Task 20 Step 3 in a docs-only commit if everything passed; otherwise turn each failure into a backlog entry.

---

## Self-review

- **Spec coverage.** §1 service: Task 1 (the fourth entry by name, in any order, kept across renewals and reports). §2 starting a job (the route only records it; refusals; collecting every empty language including the default; deleted items left out; family; context heads; existing text; house style; languages and country; 1,000-item and 1 MiB chaining; `cloud.not_configured`): Tasks 6, 7, 8, 12. §3 runner (primary only, five-second poll, collect, store in one transaction, release, resume; a job always ends — service switched off, 24 hours): Task 11, with the lock rule in Task 4. §4 storage (two `state` tables, the `expected` token, spelling fix, placeholder, counts, opened time, dropping bad results): Tasks 5, 9. §5 routes (GET with the run, DELETE, save through the unchanged PUT deleting the suggestion in the same transaction, the stale check): Tasks 10, 12. §6 dialog (Translate all, not connected, progress, drafts marked Suggested, page-by-page save, spelling fixes, placeholder, rows the page leaves out, Discard, partly done, continuing later): Tasks 14–17 — a fix to an entered name is a note linking to the editor, and "Use fix" waits for the side-by-side dialog (Decision 6). §7 notice (third level, token painting and both-theme accessibility tests, area, English and Spanish, link to Content languages, wording): Tasks 18, 19. §8 error codes: Task 4, used in 8–17. Testing section: Tasks 2 (signing vectors), 3 (the fake, against the vectors), 6–7 (collecting), 9–10 (storing), 11 (runner against the fake), 14–18 (Chromium), 21 (end to end).
- **Placeholder scan.** Every code step carries its code and every test step its test code; no test body is a comment or empty. Searched the plan for "TBD", "TODO", "implement as above", "similar to Task", "fill in" and `async () => {}`: none in a step.
- **Type consistency.** `SuggestionResults` (Task 4) is what `collect` returns and `storeSuggestionResults` (Task 9) takes; `SuggestionRunView` (Task 8, with `progress`) is what the POST, the GET, the bar and the notice read; `ContentSuggestionRead` (Task 10) is the GET's reply in Tasks 12, 13 and 14; `translationService()` answers `"on" | "off" | "not_connected"` everywhere; `SuggestionJobDraft` (Task 7: `included` counts context heads, `heads`, `remaining`) feeds `startSuggestionRun` (Task 8) and the chain (Task 9); `isLiveTarget` and `readSuggestionGaps` (Task 6) are what Tasks 7, 9 and 10 use; `RowSuggestion` and `indexSuggestions` (Task 13) are what Tasks 15–17 use; `markSuggestionRunOpened` (Task 8) writes only while `opened_at` is empty, which Task 12's GET relies on.
- **Review Focus.** Each of the seven lines has its test in Tasks 6, 7, 9, 10, 11, 16 and 17.
- **Contract.** Every wire detail (fields and bounds, the nine kinds, context items, the five reasons, collect and release in each state, step 6's order with the service check first, the refusals table, the vectors' shape, services matched by name in any order, a non-JSON outer request answered 400 or 415) is implemented by the fake (Task 3), mapped by `refusalOf` (Task 4) and shown by the run view (Task 8). A sentence here that differs from the contract is the plan's mistake.
