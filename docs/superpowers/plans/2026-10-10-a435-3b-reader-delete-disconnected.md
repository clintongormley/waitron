# A435 step 3b: Delete a Paired Reader While Its Provider Is Not Connected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** When the venue's SumUp account is not connected, a manager can still delete a card reader
that is paired at SumUp. Waitron deletes it on its own side only, and the confirmation says so
before Delete is pressed. Today that delete is refused with "Connect SumUp first".

**Architecture:** The server's delete rules (`apps/server/src/card-reader-delete.ts`) learn a third
outcome for a reader that is still paired. Today there are two: "unpair it at the provider first"
and "refused, because the provider is not connected". The new third one is "delete it in Waitron
only, and say it stays registered at the provider". The delete impact, which is the answer the
confirmation dialog reads before the press, reports that outcome as a line under "What will end",
with its own key. The delete route carries it out only when the dashboard sends a query flag saying
the dialog showed that line. Without the flag the delete is refused exactly as it is today, and the
dialog reads the impact again, so the line appears before the next press. A delete that calls no
provider now checks and acts in ONE transaction, so a connection that changes during the request
cannot split its two halves.

**Tech Stack:** TypeScript, Drizzle over SQLite (`node:sqlite`), Hono, Lit, Vitest (real venue
databases, real headless Chromium for the dashboard).

**Spec:** [Delete and archive design](../specs/2026-10-08-delete-and-archive-design.md), "Card
readers" under "Each kind". Read it with the plan it amends,
[2026-10-10-a435-3-card-reader-delete.md](2026-10-10-a435-3-card-reader-delete.md) (decisions 1–5
and 18), and the code that plan landed (#1520, `08cc18a0a`).

**Execution base:** every `file:line` below was read at main `67ef06b0c` (2026-10-10). If main has
moved, re-read the cited ranges before Task 1.

## The owner's decision this plan builds (verbatim, 2026-10-10 ~23:12)

> "When there is NO SumUp connection, deleting a reader still paired at SumUp deletes it in Waitron,
> and the confirmation says so before the press: e.g. "SumUp isn't connected, so the reader stays
> registered at SumUp. Remove it there too." (concise; EN and ES). Not asked: a connected account
> whose key SumUp rejects — keep as built (reader left switched off, "try again") unless you find it
> should follow the same rule; say which in the FYI. … list the changed checks."

This overrides decision 18 of the A435 step 3 plan, which said a still-paired reader cannot be
deleted while its provider's account is disconnected.

## What the code does today (read at `67ef06b0c`)

- **Rules.** `cardReaderDeleteRules` (`apps/server/src/card-reader-delete.ts:49-160`) looks up the
  provider only for a reader that is still paired (`:73`). `unpairAtProvider` is true when that
  provider can unpair (`:74`). `connected` is true unless the provider can unpair and no credential
  is stored for it (`:75-83`). When not connected, the rules add the refusal
  `reader.provider_disconnected` (`:94-95`). The "What will end" list holds `provider_pairing` only
  when `unpairAtProvider` is true (`:136-138`). The impact read (`:174-180`), step (a)
  `prepareCardReaderDelete` (`:188-205`) and the final delete `deleteCardReader` (`:224-245`) all
  call these rules. The final delete refuses `reader.unpair_failed` if it still finds an unpair
  needed (`:231-232`).
- **Route.** `DELETE /management-api/payments/readers/:id` (`apps/server/src/payments-api.ts:523-554`)
  takes no body and no query. It always runs step (a) and the final delete as two separate
  transactions, with the provider call between them when there is one (comment `:527-530`).
- **A disconnected provider has only switched-off readers.** Disconnect is refused while an active
  reader uses the provider (`payments-api.ts:618-625`, `payment.provider_in_use`). So a still-paired
  reader of a disconnected provider is always already disabled.
- **Stripe shows nothing.** Stripe's seat cannot unpair (`packages/payments-stripe/src/card-provider.ts:191`),
  so its impact has no "What will end" line, and its registration silently stays at Stripe (A435-3
  decision 2).
- **Dialog.** `wt-delete-dialog` (`packages/ui/src/components/wt-delete-dialog.ts`) draws three
  groups from the impact: refusals, ends and removes (`:191-205`). Each line's words come from the
  screen's copy adapter. Delete is enabled only when there are no refusals (`:99-106`).
  `DeleteImpact` (`packages/shared/src/delete-impact.ts:5-17`) is shared by printers, devices and
  readers.
- **Copy.** `readerDeleteCopy` (`apps/dashboard/src/widgets/reader-delete-copy.ts`) words
  `provider_pairing` (`:34-37`) and the `reader.provider_disconnected` refusal, "Connect {provider}
  first" (`:54-57`, string `payments.delete_connect_first` at `apps/dashboard/src/i18n/strings.ts:2061`
  in English and `:4712` in Spanish). The provider's display name comes from the screen's
  `#providerName` (`apps/dashboard/src/screens/payments-screen.ts:572`), passed in at `:1036`.
- **Screen.** `#confirmDelete` (`payments-screen.ts:970-992`) calls `this.api.deleteReader(id)`
  (`apps/dashboard/src/api/client.ts:3835-3837`). On any refusal other than `reader.not_found` it
  shows the code's message and keeps the dialog open (`:981-984`). It does NOT read the impact
  again. The impact query re-reads by itself when the tables it depends on change
  (`apps/dashboard/src/api/live-queries.ts:98-106`), but `tenant_credentials` is not a live resource
  (`live-queries.ts:97`). So an open dialog never notices a provider being connected or
  disconnected.
- **How the sibling screens handle a stale dialog.** The printers and devices screens do the same
  thing: show the refusal's message and rely on the live re-read
  (`apps/dashboard/src/screens/printers-screen.ts:4002-4012`,
  `apps/dashboard/src/screens/devices-screen.ts:1690-1700`). Readers cannot rely on the live
  re-read for this refusal, for the reason above.
- **Query-flag precedent.** The course delete takes `?disable=true`. The server parses it with
  `queryFlag` (`apps/server/src/report-api.ts:85-89`, used at `management-api.ts:2253`), and the
  client builds it the same way (`client.ts:2931-2936`).

## Decisions this plan makes

Each line is what will be built. The owner may overrule any of them.

1. **The notice is a "What will end" line with its own key, `provider_registration_kept`.** It
   names the provider as its one target, `{ id: providerId, name: providerId }`, the same shape as
   `provider_pairing`, and it appears exactly where "Unpairs it from SumUp" would. The shared
   `DeleteImpact` type and `wt-delete-dialog` do not change. Why not a new section: a separate
   "notes" group would widen `DeleteImpact` (`packages/shared/src/delete-impact.ts:12-17`), which
   the printers and devices servers also return (`printer-delete.ts`, `device-delete.ts`). It would
   also change `DeleteDialogCopy` (`wt-delete-dialog.ts:15-27`) and the dialog's render, all for one
   line. The line's own words say nothing ends at SumUp, so the "What will end" heading does not
   mislead. Task 4's LOOK checks how it reads. **This is in the owner's FYI as a point he can
   overrule**: the notice sits under "What will end" / "Qué finalizará" over a line saying nothing
   ends; the alternative is a separate section, which touches the shared dialog and the printer and
   device copy.
2. **The words.** English: "{provider} isn't connected, so the reader stays registered at
   {provider}. Remove it there too." Spanish: "{provider} no está conectado, así que el lector
   sigue registrado en {provider}. Elimínalo también allí." This is the owner's own example with
   the provider's name filled in by `providerName`, never written as "SumUp" in the code. Each
   clause carries something the manager needs: why, what happens, and what to do. So it is not
   shortened further.
3. **The impact read reports what a press from the dialog will do.** For a still-paired reader
   whose provider can unpair but has no stored credential, the impact holds the notice and no
   `reader.provider_disconnected` refusal. The rules take one new input, whether the confirmation
   accepted the notice. The impact read always passes `true`, because the dialog that shows the
   impact is the one that sends the flag. So the read and a confirmed delete still agree, as the
   spec requires.
4. **The flag is `?acceptRegistrationKept=true` on the DELETE**, parsed with `queryFlag`. Any other
   value is refused `management.request_invalid` `{ field: "acceptRegistrationKept" }` (400). The
   dashboard sends it only when the impact it is showing at the moment of the press holds a
   `provider_registration_kept` line. Without it, a disconnected still-paired reader is refused
   `reader.provider_disconnected` (409), exactly as today, with nothing written.
5. **A dialog opened while the provider was connected re-reads its impact when the delete answers
   `reader.provider_disconnected`.** It shows no message of its own. The dialog shows "Checking
   what will change…" with Delete quiet and disabled while it reads; the old impact's lines stay
   drawn under the spinner, because `#retryImpact` (`payments-screen.ts:951-957`) does not clear
   `deleteImpact`, which is harmless since Delete cannot be pressed meanwhile. When the read
   answers, the notice line replaces "Unpairs it from …", and the next press sends the flag.
   The refusal's general message ("Connect this payment provider first") is not shown, because
   after the re-read connecting is no longer needed. The other refusals keep today's behaviour
   (message shown, live re-read), as printers and devices do.
6. **The reverse race unpairs as normal.** If the dialog showed the notice and the provider is
   connected before the press, the delete unpairs the reader at the provider and then deletes it:
   the flag is only an acceptance, never an instruction to skip the unpair. That outcome is better
   than what the dialog promised, and it is the one A435-3 built for a connected provider.
7. **A delete that calls no provider checks and acts in one transaction.** The route runs step (a)
   and, when (a) finds no provider call is needed, the final delete inside the same `gated`
   transaction. Only a reader to be unpaired at its provider keeps A435-3's three transactions. So
   a connect that lands mid-request can no longer make the final delete find an unpair that step
   (a) did not plan, which today would answer `reader.unpair_failed`. That answer would be
   misleading: its message says the reader is disabled and the provider failed, but nothing was
   called. After an unpair, the reader is marked unpaired before the final delete runs, so the
   final delete never looks at the provider. The final delete's existing `reader.unpair_failed`
   refusal stays (`card-reader-delete.ts:231-232`), so a caller can never skip an unpair.
8. **A connected account whose key SumUp rejects stays as built**: a SumUp unpair call that fails
   answers `reader.unpair_failed`, and the reader stays switched off and not deleted. The flag does
   not change this. (A seat's own coded refusal still passes through unchanged: for example a stored
   payload SumUp's seat cannot build a client from answers 422
   `payment.provider_credential_rejected`, `packages/payments-sumup/src/card-provider.ts:74`,
   pinned at `payments-api.test.ts:1902`.) Reasons:
   (a) a rejected key is only discovered when Delete is pressed, because the impact read calls no
   provider (it reads only whether a credential is stored, `card-reader-delete.ts:75-83`). The
   owner's rule is that the confirmation says so before the press, so following it here would need
   a provider call in the impact read or a second confirmation after the failed press;
   (b) re-entering the key on the Payments screen fixes it, and the delete then unpairs properly;
   (c) today's code does not distinguish a rejected key from an outage: SumUp's client puts the
   HTTP status only in a plain `Error`'s message (`packages/payments-sumup/src/sumup-client.ts:110`
   for 5xx, `:282-283` for 4xx), which the route records as reason `unknown` (backlog: "A failed
   SumUp unpair is logged with reason `unknown`"). Following the rule for a rejected key would
   first need that distinction, or it would also delete readers in Waitron only during an ordinary
   SumUp outage. A stored credential means "connected" here, as it does on the providers list
   (`payments-api.ts`, `GET …/providers`).
13. **A disconnect that lands after step (a) answers `reader.provider_disconnected`.** Step (a)
    switches the reader off, which lets a disconnect through (`payments-api.ts:618-625` refuses only
    while a reader is active). If the credential is gone when the seat reads it, SumUp's seat throws
    `credentials.missing` (`packages/payments-sumup/src/card-provider.ts:56-58`, thrown at
    `packages/credentials/src/store.ts:33`), which today passes through unwrapped and is not in the
    route's status map. The DELETE route alone maps that code, from the provider call only, to
    `reader.provider_disconnected` `{ providerId }` (409), so the dialog reads the impact again and
    shows the notice (decision 5). The reader is left switched off, not unpaired, not deleted. The
    pair-new route already answers `reader.provider_disconnected` rather than the opaque
    `credentials.missing` for the same cause, by checking first (`payments-api.ts:696-704`).
    (Coordinator's decision, 2026-10-10.)
9. **The provider id is freed exactly as for Stripe.** A deleted row no longer counts toward
   `card_readers_provider_ref_key`, which ignores deleted rows (A435-3 Task 1). Nothing extra is
   written: `unpaired_at` stays null, as on a deleted Stripe reader (A435-3 decision 2). Once the
   account is connected again, discovery offers the same SumUp reader as available, and Add creates
   a new record. Task 1 tests it.
10. **A Stripe reader's dialog is not changed.** The owner asked about SumUp with no connection.
    Stripe's registration also stays at Stripe after a delete, silently. A short backlog entry
    records that, so it is not lost (Task 3).
11. **The copy drops its `reader.provider_disconnected` line.** The impact read can no longer carry
    that refusal (decision 3), so `payments.delete_connect_first` goes in both languages. A refusal
    code the copy does not know still falls back to `codeMessage`, as today (`reader-delete-copy.ts:58-59`).
12. **The client takes an options object, as `removeCourse` does** (`client.ts:2931`):
    `deleteReader(id, { acceptRegistrationKept: true })`. The screen passes the options only when it
    sends the flag, so a plain delete is still `deleteReader(id)`.

## Global Constraints

- Spec: "The delete recomputes the same impact inside ONE `withTransaction` and acts on it."
  Never act on counts or ids the client sends. The flag is an acceptance, not data the server
  trusts: the server still decides from its own rows whether the reader is paired and whether the
  provider is connected.
- Spec: "An already-unpaired reader is deleted without contacting the provider." Unchanged.
- Spec: "Each delete route requires the same permission as editing that kind today":
  `payments.manage`, unchanged.
- A435-3 behaviour that does not change: a connected provider that can unpair is called first; a
  failed call answers `reader.unpair_failed` and leaves the reader switched off; a payment in
  progress refuses before any provider call; the in-memory hold refuses `reader.unpair_in_progress`;
  Stripe and already-unpaired readers are deleted without a provider call.
- No fiscal, sales or hash-chained table is touched. The golden huella tests and `inmutabilidad`
  pass **unedited**; a needed change to either is a STOP, not a fixture correction.
- No migration, no new error code, no new table, no change to `DeleteImpact` or `wt-delete-dialog`.
- UI text is as short as the meaning allows (owner, 2026-10-09), in English and Spanish, and names
  the provider through `providerName`.
- Test-first in every task: write the failing case, run it, see it fail for the stated reason, then
  implement. A missing-import or type error is not a behavioural RED. Rejected writes assert the
  domain error code. A test catches an expected refusal outside `withTransaction`. Statements on one
  transaction are awaited in turn, never `Promise.all`.
- A check that pins behaviour this plan changes is changed at least as strictly, and listed in
  "Intentional changes to existing checks" below, which the PR copies (owner rule, 2026-10-05).
  Every other existing assertion passes unedited.
- One implementer at a time in this worktree. Each task is sized well under 100 tool calls. An
  implementer past about 150 calls stops at a passing or cleanly red point, commits, and returns a
  handover (done, left, files, each check's state); a fresh implementer continues from it.
- Record the process id of anything you start, and stop only those (`pnpm reap` for orphans).
- Every commit is `git commit -s`; never `--no-verify`. Do not push; the driver runs `finish-branch`.
  Coverage and mutation bars are unchanged; no exclude or ignore comment over reachable code.

## Review Focus

1. **A dialog opened while SumUp was connected, then SumUp disconnected, then Delete pressed.** The
   delete must not happen without the notice having been shown: 409 `reader.provider_disconnected`,
   nothing written, no provider call. The dialog reads the impact again and shows the notice, and
   the next press deletes the reader in Waitron only (Task 1, route test; Task 2, screen test).
2. **The dialog showed the notice, then SumUp was connected, then Delete pressed with the flag.**
   The reader is unpaired at SumUp and then deleted; the flag does not skip the unpair (Task 1).
3. **SumUp is connected while a Waitron-only delete is running.** There is no misleading
   `reader.unpair_failed`; the reader is deleted in Waitron (Task 1, the one-transaction test, which
   must fail against today's two transactions).
4. **SumUp is connected but the call fails (rejected key or outage), and the flag is sent anyway.**
   502 `reader.unpair_failed`, reader switched off, not deleted (Task 1).
5. **After a Waitron-only delete, SumUp is connected again and the reader is found by discovery.**
   It is offered as available and Add makes a new record beside the deleted one, which stays as it
   was (Task 1).

## Tasks

### Task 1: Server — the third outcome, the flag, and one transaction for a delete with no provider call

**Deliverable:** the rules, the impact read, step (a), the final delete and the DELETE route
implement decisions 1, 3, 4, 6, 7, 8 and 9, with function-level and route-level tests.

**Files:**
- Modify: `apps/server/src/card-reader-delete.ts`
- Modify: `apps/server/src/payments-api.ts` (DELETE route `:523-554`; import `queryFlag` from
  `./report-api.js` as `management-api.ts:135` does)
- Test: `apps/server/src/card-reader-delete.db.test.ts`
- Test: `apps/server/src/payments-api.test.ts` (`describe("reader delete")` from `:1704`, and its
  nested `describe("a deleted reader")` from `:2194`)

**Interfaces:**
- Produces, in `card-reader-delete.ts`:

```ts
export type CardReaderDeleteOptions = {
  /** The confirmation showed that the reader stays registered at its unconnected provider. */
  acceptRegistrationKept?: boolean;
};
export function readCardReaderDeleteImpact(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string,
): Promise<DeleteImpact>; // unchanged signature; reads as if accepted
export function prepareCardReaderDelete(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string,
  now?: Date, options?: CardReaderDeleteOptions,
): Promise<CardReaderDeletePlan>; // CardReaderDeletePlan unchanged
export function deleteCardReader(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string,
  now?: Date, options?: CardReaderDeleteOptions,
): Promise<DeleteImpact>;
```

- Produces, on the wire: impact item key `provider_registration_kept` (under `ends`, one target
  `{ id: providerId, name: providerId }`); query flag `acceptRegistrationKept=true` on
  `DELETE /management-api/payments/readers/:id`. Task 2 relies on both names exactly.

- [ ] **Step 1: Write the failing function-level cases** in `card-reader-delete.db.test.ts`.
  First give the helpers an options argument (helper change only, no assertion change):

```ts
const remove = (
  list: readonly CardProviderContribution[],
  id: string,
  now = NOW,
  options: CardReaderDeleteOptions = {},
) => withTransaction(suite.db, (tx) => deleteCardReader(tx, list, id, now, options));
const prepare = (
  list: readonly CardProviderContribution[],
  id: string,
  now = NOW,
  options: CardReaderDeleteOptions = {},
) => withTransaction(suite.db, (tx) => prepareCardReaderDelete(tx, list, id, now, options));
const accepted = { acceptRegistrationKept: true };
const kept = { key: "provider_registration_kept", count: 1, targets: [{ id: "stripe", name: "stripe" }] };
```

  Then, in `describe("the card reader delete impact")`, **replace** the case at `:286-292`
  ("refuses a still-paired reader whose provider can unpair but is not connected") with:

```ts
it("says a still-paired reader stays registered at a provider that can unpair but is not connected, refusing nothing", async () => {
  const v = await seedVenue({ unpairedAt: null });
  const impact = await read([unpairing], v.r);
  expect(impact.refusals).toEqual([]);
  expect(impact.ends).toEqual([kept]);
});

it("shows a payment in progress beside the notice for a disconnected provider", async () => {
  const v = await seedVenue({ unpairedAt: null });
  await v.payment("attempting", v.caja2.id);
  const impact = await read([unpairing], v.r);
  expect(impact.refusals).toEqual([
    { code: "reader.payment_in_progress", params: { readerId: v.r }, targets: [v.caja2] },
  ]);
  expect(impact.ends).toEqual([kept]);
});
```

  In `describe("deleting a card reader")`, keep `:397-405` exactly as it is: without the flag the
  delete is still refused `reader.provider_disconnected` and writes nothing. Add beside it:

```ts
it("deletes a still-paired reader of a disconnected provider in Waitron only once the notice is accepted, as the impact said", async () => {
  const v = await seedVenue({ unpairedAt: null });
  const impact = await read([unpairing], v.r);
  const before = await snapshot();

  expect(await remove([unpairing], v.r, NOW, accepted)).toEqual(impact);

  expect(await snapshot()).toEqual(
    withoutReaderLinks(before, v.r, (row) => ({
      ...row,
      active: 0,
      deleted_at: NOW.toISOString(),
      disabled_at: NOW.toISOString(),
    })),
  );
  const [row] = await suite.db.select().from(cardReaders).where(eq(cardReaders.id, v.r));
  expect(row!.unpairedAt).toBeNull();
});

it("still refuses a payment in progress first when the notice is accepted", async () => {
  const v = await seedVenue({ unpairedAt: null });
  await v.payment("attempting", v.caja2.id);
  const before = await snapshot();
  await expect(remove([unpairing], v.r, NOW, accepted)).rejects.toMatchObject({
    code: "reader.payment_in_progress",
  });
  await expect(remove([unpairing], v.r)).rejects.toMatchObject({
    code: "reader.payment_in_progress",
  });
  expect(await snapshot()).toEqual(before);
});

it("never skips a needed unpair because the notice was accepted", async () => {
  const v = await seedVenue({ unpairedAt: null });
  await connectStripe(suite.db);
  const before = await snapshot();
  await expect(remove([unpairing], v.r, NOW, accepted)).rejects.toMatchObject({
    code: "reader.unpair_failed",
    params: { providerId: "stripe" },
  });
  expect(await snapshot()).toEqual(before);
});
```

  In `describe("preparing a card reader delete (step a)")` add:

```ts
it("plans no provider call and writes nothing for a disconnected provider once the notice is accepted", async () => {
  const v = await seedVenue({ unpairedAt: null });
  const impact = await read([unpairing], v.r);
  const before = await snapshot();
  expect(await prepare([unpairing], v.r, NOW, accepted)).toEqual({
    impact,
    provider: "stripe",
    providerRef: "tmr_R",
    unpairAtProvider: false,
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses reader.provider_disconnected without the acceptance, and writes nothing", async () => {
  const v = await seedVenue({ unpairedAt: null });
  const before = await snapshot();
  await expect(prepare([unpairing], v.r)).rejects.toMatchObject({
    code: "reader.provider_disconnected",
    params: { providerId: "stripe" },
  });
  expect(await snapshot()).toEqual(before);
});

it("plans the unpair for a connected provider whether or not the notice was accepted", async () => {
  const v = await seedVenue({ unpairedAt: null });
  await connectStripe(suite.db);
  expect(await prepare([unpairing], v.r, NOW, accepted)).toMatchObject({ unpairAtProvider: true });
});
```

  (`seedVenue` defaults to `active: true, disabledAt: null` (`card-reader-delete.db.test.ts:140-141`,
  read at `67ef06b0c`), which is why `disabled_at` becomes `NOW`.)

- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/card-reader-delete.db.test.ts`
  Expected: the new impact case fails with `refusals` holding `reader.provider_disconnected` and
  `ends` empty; the accepted delete and the accepted prepare fail with
  `reader.provider_disconnected` (the options argument is ignored today). Four new cases already
  pass before the change and are **pins**, to be reported as such: "still refuses a payment in
  progress first…", "never skips a needed unpair…", "refuses reader.provider_disconnected without
  the acceptance…" and "plans the unpair for a connected provider…". Read the `Tests` count.
  If a type error on `CardReaderDeleteOptions` stops the run, first add only the exported type,
  then re-run to see the behavioural failures.

- [ ] **Step 3: Implement the rules.** In `card-reader-delete.ts`:

```ts
export type CardReaderDeleteOptions = {
  /** The confirmation showed that the reader stays registered at its unconnected provider. */
  acceptRegistrationKept?: boolean;
};

async function cardReaderDeleteRules(
  tx: Transaction,
  seats: readonly CardProviderContribution[],
  id: string,
  acceptRegistrationKept: boolean,
): Promise<{ plan: CardReaderDeletePlan; refusals: Refused[] }> {
  // … reader and busy reads unchanged …
  const seat = reader.unpairedAt === null ? cardProviderById(seats, reader.provider) : undefined;
  const canUnpair = seat?.readers.canUnpair === true;
  const connected =
    canUnpair &&
    (
      await tx
        .select({ purpose: tenantCredentials.purpose })
        .from(tenantCredentials)
        .where(eq(tenantCredentials.purpose, seat!.credentialPurpose))
    ).length > 0;
  const unpairAtProvider = canUnpair && connected;
  const registrationKept = canUnpair && !connected;

  const refusals: Refused[] = [];
  // … payment refusal unchanged, still first …
  if (registrationKept && !acceptRegistrationKept)
    refusals.push(refused("reader.provider_disconnected", { providerId: reader.provider }, []));
  // … link reads unchanged …
  const provider = [{ id: reader.provider, name: reader.provider }];
  const ends: DeleteImpactItem[] = unpairAtProvider
    ? [named("provider_pairing", provider)]
    : registrationKept
      ? [named("provider_registration_kept", provider)]
      : [];
  // … return unchanged …
}
```

  `unrefusedRules` takes and passes `acceptRegistrationKept`. `readCardReaderDeleteImpact` passes
  `true`. `prepareCardReaderDelete(tx, seats, id, now = new Date(), options: CardReaderDeleteOptions = {})`
  and `deleteCardReader(…same…)` pass `options.acceptRegistrationKept === true`. Rewrite the doc
  comment on `readCardReaderDeleteImpact` (`:173`) to say it reads "what a delete confirmed from
  this impact would refuse, end and remove now". Keep the final delete's
  `reader.unpair_failed` throw (`:231-232`) unchanged.

- [ ] **Step 4: Green.** Re-run Step 2's command; every case passes, including the unchanged
  `:397-405`. Disposable-copy control: in a scratch edit, make `readCardReaderDeleteImpact` pass
  `false`; the "says a still-paired reader stays registered…" case must fail (it now shows the
  refusal). Restore.

- [ ] **Step 5: Write the failing route cases** in `payments-api.test.ts`. Give `mountApp`
  (`:210`) an optional third parameter `db: Database = suite.db`, used in place of `suite.db` in its
  deps (helper change only). In `describe("reader delete")` add a helper beside `deleteOf`:

```ts
const deleteAccepting = (app: Hono, venue: Venue, id: string) =>
  send(app, "DELETE", `${base}/readers/${id}?acceptRegistrationKept=true`, {
    cookie: venue.managerCookie,
  });
const kept = {
  key: "provider_registration_kept",
  count: 1,
  targets: [{ id: "stripe", name: "stripe" }],
};
/** Paired, then disabled and its provider disconnected: disconnect refuses while it is active. */
async function disconnectedReader(app: Hono, venue: Venue) {
  const paired = await pairedReader(app, venue);
  const opts = { cookie: venue.managerCookie };
  expect((await send(app, "POST", `${base}/readers/${paired.id}/disable`, opts)).status).toBe(204);
  expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);
  return paired;
}
```

  **Replace** the case at `:1919-1940` ("refuses reader.provider_disconnected for a still-paired
  reader once its provider is disconnected") with this one. It keeps every assertion about the
  refused DELETE and adds the accepted one (Review focus 1):

```ts
it("deletes a still-paired reader in Waitron only once its provider is disconnected, and only when the delete accepts the notice", async () => {
  const venue = await seedVenue();
  const { seat, removed } = unpairingSeat();
  const app = mountApp(venue, [seat]);
  const { id } = await disconnectedReader(app, venue);
  await linkReader(venue, id);
  const row = await readerRow(id);
  const links = await linksOf(id);

  const impact = (await (await impactOf(app, venue, id)).json()) as DeleteImpact;
  expect(impact.refusals).toEqual([]);
  expect(impact.ends).toEqual([kept]);

  const refused = await deleteOf(app, venue, id);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
  });
  expect(await readerRow(id)).toEqual(row);
  expect(await linksOf(id)).toEqual(links);

  const deleted = await deleteAccepting(app, venue, id);
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual(impact);
  expect(removed).toEqual([]);
  const after = await readerRow(id);
  expect(after).toEqual({ ...row, active: false, deletedAt: after.deletedAt });
  expect(after.deletedAt).not.toBeNull();
  expect(after.unpairedAt).toBeNull();
  expect(await linksOf(id)).toEqual({ chosen: [], listed: [], held: [] });
});
```

  (Import `DeleteImpact` from `@waitron/shared` and `Database` from `@waitron/db` if the file does
  not already.) Add, in the same `describe`:

```ts
it("unpairs at the provider as normal when it was connected again after the notice was shown", async () => {
  const venue = await seedVenue();
  const { seat, removed } = unpairingSeat();
  const app = mountApp(venue, [seat]);
  const { id, ref } = await disconnectedReader(app, venue);
  expect(((await (await impactOf(app, venue, id)).json()) as DeleteImpact).ends).toEqual([kept]);
  expect((await connectStripe(app, venue)).status).toBe(200);

  const res = await deleteAccepting(app, venue, id);

  expect(res.status).toBe(200);
  expect(removed).toEqual([ref]);
  const row = await readerRow(id);
  expect(row.deletedAt).not.toBeNull();
  expect(row.unpairedAt).not.toBeNull();
});

it("answers reader.unpair_failed when a connected provider's call fails, even with the notice accepted", async () => {
  const venue = await seedVenue();
  const { seat, removed } = unpairingSeat(async () => {
    throw new Error("sumup DELETE reader: HTTP 401");
  });
  const app = mountApp(venue, [seat]);
  const { id } = await pairedReader(app, venue);
  const before = await readerRow(id);

  const res = await deleteAccepting(app, venue, id);

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({
    error: { code: "reader.unpair_failed", params: { providerId: "stripe" } },
  });
  expect(removed).toHaveLength(1);
  const after = await readerRow(id);
  expect(after).toEqual({ ...before, active: false, disabledAt: after.disabledAt });
  expect(after.disabledAt).not.toBeNull();
  expect(after.deletedAt).toBeNull();
  expect(after.unpairedAt).toBeNull();
});

it("refuses a malformed acceptance flag, changing nothing", async () => {
  const venue = await seedVenue();
  const { seat, removed } = unpairingSeat();
  const app = mountApp(venue, [seat]);
  const { id } = await disconnectedReader(app, venue);
  const row = await readerRow(id);

  const res = await send(app, "DELETE", `${base}/readers/${id}?acceptRegistrationKept=yes`, {
    cookie: venue.managerCookie,
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: { code: "management.request_invalid", params: { field: "acceptRegistrationKept" } },
  });
  expect(removed).toEqual([]);
  expect(await readerRow(id)).toEqual(row);
});

it("checks and deletes in one transaction when no provider is called, so a connect during the delete cannot answer reader.unpair_failed", async () => {
  const venue = await seedVenue();
  const { seat, removed } = unpairingSeat();
  // Runs `afterLock` once, after the next write lock the app's requests release.
  let afterLock: (() => Promise<void>) | undefined;
  const db = new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock")
        return async <T>(fn: () => Promise<T>): Promise<T> => {
          const value = await target.withWriteLock(fn);
          const hook = afterLock;
          afterLock = undefined;
          await hook?.();
          return value;
        };
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const app = mountApp(venue, [seat], db);
  const { id } = await disconnectedReader(app, venue);
  afterLock = async () => {
    expect((await connectStripe(app, venue)).status).toBe(200);
  };

  const res = await deleteAccepting(app, venue, id);

  expect(afterLock).toBeUndefined();
  expect(res.status).toBe(200);
  expect(removed).toEqual([]);
  const row = await readerRow(id);
  expect(row.deletedAt).not.toBeNull();
  expect(row.unpairedAt).toBeNull();
});
```

  Add the disconnect-after-step-(a) case (decision 13). Its seat's `remove` models SumUp's, which
  reads the stored credential before calling SumUp (`packages/payments-sumup/src/card-provider.ts:56-58`):

```ts
it("answers reader.provider_disconnected when the provider is disconnected after the reader was switched off, then deletes in Waitron only once accepted", async () => {
  const venue = await seedVenue();
  let app!: Hono;
  let first = true;
  const { seat, removed } = unpairingSeat(async () => {
    if (!first) return;
    first = false;
    // Step (a) switched the reader off, so the disconnect is allowed now.
    expect(
      (await send(app, "POST", `${base}/providers/stripe/disconnect`, { cookie: venue.managerCookie }))
        .status,
    ).toBe(204);
    await withTransaction(suite.db, (tx) =>
      getCredential(tx, RING, { purpose: stripeSeat.credentialPurpose }),
    );
  });
  app = mountApp(venue, [seat]);
  const { id } = await pairedReader(app, venue);
  await linkReader(venue, id);
  const links = await linksOf(id);

  const res = await deleteOf(app, venue, id);

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: { code: "reader.provider_disconnected", params: { providerId: "stripe" } },
  });
  const row = await readerRow(id);
  expect(row.active).toBe(false);
  expect(row.unpairedAt).toBeNull();
  expect(row.deletedAt).toBeNull();
  expect(await linksOf(id)).toEqual(links);
  expect(((await (await impactOf(app, venue, id)).json()) as DeleteImpact).ends).toEqual([kept]);

  expect((await deleteAccepting(app, venue, id)).status).toBe(200);
  expect(removed).toHaveLength(1);
  expect((await readerRow(id)).deletedAt).not.toBeNull();
});
```

  In the nested `describe("a deleted reader")` (it has `spySeat` and `vendorOf`), add Review
  focus 5:

```ts
it("deleted in Waitron only while disconnected, is offered by discovery as new once connected again", async () => {
  const venue = await seedVenue();
  let listed: string[] = [];
  const spies = spySeat(() => listed);
  const app = mountApp(venue, [spies.seat]);
  const opts = { cookie: venue.managerCookie };
  const { id, ref } = await pairedReader(app, venue);
  expect((await send(app, "POST", `${base}/readers/${id}/disable`, opts)).status).toBe(204);
  expect((await send(app, "POST", `${base}/providers/stripe/disconnect`, opts)).status).toBe(204);
  expect(
    (await send(app, "DELETE", `${base}/readers/${id}?acceptRegistrationKept=true`, opts)).status,
  ).toBe(200);
  const row = await readerRow(id);
  expect((await connectStripe(app, venue)).status).toBe(200);
  listed = [ref];

  const available = await send(app, "GET", `${base}/providers/stripe/available-readers`, opts);
  expect(await available.json()).toEqual([{ ...vendorOf(ref), status: "available" }]);
  const adopted = await send(app, "POST", `${base}/readers/adopt`, {
    ...opts,
    body: { providerId: "stripe", providerRef: ref, name: "Counter" },
  });
  expect(adopted.status).toBe(201);
  expect(((await adopted.json()) as { id: string }).id).not.toBe(id);
  expect(await readerRow(id)).toEqual(row);
  expect(row.unpairedAt).toBeNull();
  expect(spies.removed).toEqual([]);
});
```

  (`deleteAccepting` and `disconnectedReader` are in the outer `describe`, so they are in scope;
  use them here if that reads better.)

- [ ] **Step 6: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "reader delete"`
  Expected, with Step 3 in and the route not yet changed: every case that sends the flag fails at
  its accepted DELETE, which answers 409 `reader.provider_disconnected`, because the route ignores
  the query. That covers the replaced case, the reverse-race case, the one-transaction case and the
  discovery case. The malformed-flag case fails with status 409, not 400. The
  disconnect-after-step-(a) case fails at its first DELETE with the passed-through
  `credentials.missing` (by A435-3 decision 9's reading of `packages/server-kit/src/error-boundary.ts:33`,
  status 400; record the status and body it prints). The rejected-key case may
  already pass, because a connected provider never needed the flag; say so in the report, since it
  pins decision 8.

- [ ] **Step 6b: Pass the flag through the route as it is, and watch the one-transaction case fail
  for its own reason.** In the existing DELETE route, parse
  `queryFlag(c.req.query("acceptRegistrationKept"), "acceptRegistrationKept")` and pass
  `{ acceptRegistrationKept }` as the options to both `prepareCardReaderDelete` and the final
  `deleteCardReader` (passing `new Date()` as `now`), keeping the two transactions. Re-run Step 6's
  command. Expected: everything passes except the disconnect-after-step-(a) case (unchanged
  failure) and the one-transaction case, which now fails with 502
  `reader.unpair_failed`. That is the misleading answer decision 7 removes: the hook connected the
  provider between step (a) and the final delete. **If the one-transaction case passes here, the
  hook is not running between the two transactions and the test proves nothing:** fix the proxy
  (check when `afterLock` is consumed) before going on.

- [ ] **Step 7: One transaction when no provider is called, and a late disconnect.** In
  `payments-api.ts`, import `queryFlag` from `./report-api.js`; `type CardReaderDeleteOptions` and
  `type CardReaderDeletePlan` from `./card-reader-delete.js`; and `type DeleteImpact` and `hasCode`
  from `@waitron/shared` (beside the existing `AppError` import, `:8`). The DELETE route body
  becomes:

```ts
app.delete("/management-api/payments/readers/:id", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const id = requireUuidParam(c.req.param("id"), "CardReaderId");
    const options: CardReaderDeleteOptions = {
      acceptRegistrationKept: queryFlag(
        c.req.query("acceptRegistrationKept"),
        "acceptRegistrationKept",
      ),
    };
    // A reader its provider must unpair takes three transactions, not one: a transaction holds the
    // database's only write lock (`packages/store/src/write-queue.ts:5`,
    // `packages/db/src/tenancy.ts:19`), so a provider call inside one would make every other write
    // wait on the network. A refusal after the unpair leaves the reader unpaired and switched off,
    // as Unpair would, and not deleted. Every other delete checks and acts in one transaction.
    return holdingReader(id, async (hold) => {
      const first: { plan: CardReaderDeletePlan; deleted?: DeleteImpact } = await gated(
        sessionId,
        async (tx) => {
          hold();
          const plan = await prepareCardReaderDelete(tx, deps.providers, id, new Date(), options);
          if (plan.unpairAtProvider) return { plan };
          return {
            plan,
            deleted: await deleteCardReader(tx, deps.providers, id, new Date(), options),
          };
        },
      );
      if (first.deleted !== undefined) return c.json(first.deleted);
      const { plan } = first;
      const seat = cardProviderById(deps.providers, plan.provider);
      try {
        await removeAtProvider(seat, plan.providerRef);
      } catch (error) {
        // Step (a) switched the reader off, which lets a disconnect through before this call.
        if (isAppError(error) && hasCode(error, "credentials.missing"))
          throw new AppError("reader.provider_disconnected", { providerId: plan.provider });
        if (isAppError(error)) throw error;
        throw new AppError(
          "reader.unpair_failed",
          { providerId: plan.provider },
          { reason: codeOf(error) },
        );
      }
      const unpairedAt = nowIso();
      await gated(sessionId, (tx) => markCardReaderUnpaired(tx, id, unpairedAt));
      return c.json(await gated(sessionId, (tx) => deleteCardReader(tx, deps.providers, id)));
    });
  }),
);
```

  Re-read the two cited lock lines before keeping them in the comment; if either has moved, cite
  where it is now. The comment must stay true for both paths (A435-3 decision 19).

- [ ] **Step 8: Green.** Re-run Step 6's command, then the whole files:
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts src/payments-api.stuck.test.ts src/card-reader-delete.db.test.ts`.
  Every A435-3 case passes unedited except the one replaced case. Disposable-copy control: put the
  route back to two transactions for the local path (return `{ plan }` always) and see the
  one-transaction case fail with 502; restore. Root guards (a refusal's use changed):
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`. Then format
  and lint: `pnpm exec prettier --write apps/server/src/card-reader-delete.ts apps/server/src/payments-api.ts apps/server/src/card-reader-delete.db.test.ts apps/server/src/payments-api.test.ts`,
  then `pnpm lint` and `pnpm format:check`. Check each command's exit status and `Tests` count.

- [ ] **Step 9: Commit.**

```bash
git add apps/server/src/card-reader-delete.ts apps/server/src/payments-api.ts \
  apps/server/src/card-reader-delete.db.test.ts apps/server/src/payments-api.test.ts
git commit -s -m "A reader still paired at a provider that is not connected can be deleted in \
Waitron only, once the delete accepts that it stays registered there"
```

### Task 2: Dashboard — the notice's words, the flag, and the re-read after a stale press

**Deliverable:** the dialog shows the notice in English and Spanish, Delete sends the flag only
when the shown impact carries the notice, and a delete refused `reader.provider_disconnected`
re-reads the impact.

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`deleteReader`, `:3835-3837`)
- Modify: `apps/dashboard/src/widgets/reader-delete-copy.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (English `:2061`, Spanish `:4712`)
- Modify: `apps/dashboard/src/screens/payments-screen.ts` (`#confirmDelete`, `:970-992`)
- Test: `apps/dashboard/src/api/live-queries.test.ts` (the reader case at `:64-84`)
- Test: `apps/dashboard/src/widgets/reader-delete-copy.test.ts`
- Test: `apps/dashboard/src/screens/payments-screen.delete.test.ts`
- Test: `apps/dashboard/src/screens/payments-screen.a11y.test.ts` (beside `:273-284`)

**Interfaces:**
- Consumes from Task 1: item key `provider_registration_kept` (one target, the provider id); query
  flag `acceptRegistrationKept=true`; DELETE answers 409 `reader.provider_disconnected` when the
  flag is missing and the notice applies.
- Produces: `deleteReader(id: string, options?: { acceptRegistrationKept: true }): Promise<DeleteImpact>`;
  string key `payments.delete_kept_at_provider`.

- [ ] **Step 1: Write the failing cases.**
  - `live-queries.test.ts`, in the reader case after the plain DELETE (`:79-82`), add:

```ts
expect(await api.deleteReader("r1", { acceptRegistrationKept: true })).toEqual(impact);
expect(fetchImpl.mock.calls[3]![0]).toBe(
  "/management-api/payments/readers/r1?acceptRegistrationKept=true",
);
expect(fetchImpl.mock.calls[3]![1].method).toBe("DELETE");
```

    and change its final `expect(active).toHaveBeenCalledTimes(2)` to `3` (one more activity
    report for the extra DELETE).
  - `reader-delete-copy.test.ts` (listed under "Intentional changes"): remove the `disconnected`
    field from `Language` (`:25`) and from both languages (`:46`, `:81`); remove the
    `reader.provider_disconnected` refusal assertion (`:141-147`) and that refusal from the
    "no line shows a key" list (`:176-180`). Add to each language's `lines`:
    - English: `[item("provider_registration_kept", [sumup]), "SumUp isn't connected, so the reader stays registered at SumUp. Remove it there too."]`
    - Spanish: `[item("provider_registration_kept", [sumup]), "SumUp no está conectado, así que el lector sigue registrado en SumUp. Elimínalo también allí."]`

    Add `"provider_registration_kept"` to the `keys` list at `:159-166`, and give it the `[sumup]`
    target where the list maps keys to items (`:170`:
    `key === "provider_pairing" || key === "provider_registration_kept" ? [sumup] : named`).
  - `payments-screen.delete.test.ts`, beside "names the provider the pairing ends…" (`:242`):

```ts
const keptImpact = impactOf("counter", "Counter", {
  ends: [{ key: "provider_registration_kept", count: 1, targets: [{ id: "acme", name: "acme" }] }],
});

it("says a reader stays registered at an unconnected provider, by its display name, and Delete accepts that", async () => {
  const api = client({ getReaderDeleteImpact: vi.fn().mockResolvedValue(keptImpact) });
  const el = await mount(api);
  await openDelete(el, "counter");
  expect(linesOf(el)).toEqual([
    "Acme Pay isn't connected, so the reader stays registered at Acme Pay. Remove it there too.",
  ]);
  expect(confirmOf(el).getAttribute("variant")).toBe("danger");
  confirmOf(el).click();
  await flush(el);
  expect(api.deleteReader).toHaveBeenCalledExactlyOnceWith("counter", {
    acceptRegistrationKept: true,
  });
});

it("a delete refused because the provider was disconnected after the dialog opened reads the impact again, then accepts the notice it shows", async () => {
  const getReaderDeleteImpact = vi.fn().mockResolvedValueOnce(counterImpact).mockResolvedValue(keptImpact);
  const deleteReader = vi
    .fn()
    .mockRejectedValueOnce(coded("reader.provider_disconnected"))
    .mockResolvedValue(keptImpact);
  const el = await mount(client({ getReaderDeleteImpact, deleteReader }));
  await openDelete(el, "counter");
  expect(linesOf(el)).toEqual(["Unpairs it from Acme Pay"]);

  confirmOf(el).click();
  await flush(el);

  expect(deleteReader).toHaveBeenNthCalledWith(1, "counter");
  await vi.waitFor(() => expect(getReaderDeleteImpact).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(dialogOf(el)!.open).toBe(true);
  expect(dialogOf(el)!.actionError).toBe("");
  expect(linesOf(el)).toEqual([
    "Acme Pay isn't connected, so the reader stays registered at Acme Pay. Remove it there too.",
  ]);
  expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

  confirmOf(el).click();
  await flush(el);
  expect(deleteReader).toHaveBeenNthCalledWith(2, "counter", { acceptRegistrationKept: true });
});
```

    In Spanish, add one case: `setLocale("es")` before mounting with `keptImpact`, and assert the
    line "Acme Pay no está conectado, así que el lector sigue registrado en Acme Pay. Elimínalo
    también allí." (The file's `afterEach` restores English.) The existing case "opens with one
    impact read…" (`:211-240`) already asserts that a dialog without the notice sends
    `deleteReader("counter")` with no second argument; it must pass unedited.
  - `payments-screen.a11y.test.ts`, beside "renders the delete dialog refused by its impact
    accessibly": a case for each of `en` and `es-ES` opening the dialog with an impact whose `ends`
    is `[{ key: "provider_registration_kept", count: 1, targets: [{ id: "acme", name: "acme" }] }]`,
    asserting the dialog shows one `li` and `expectNoA11yViolations(host)`. The surrounding
    `describe.each` runs it in both themes.

- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/widgets/reader-delete-copy.test.ts src/screens/payments-screen.delete.test.ts src/screens/payments-screen.a11y.test.ts`
  Expected: the client case fails because the path has no query; the copy cases fail with the
  unknown-key fallback `"sumup (1)"`; the screen cases fail with the line `"acme (1)"` and with
  `deleteReader` called as `("counter")` only; the stale-press case fails because the impact is
  read once and `actionError` is "Connect this payment provider first". The a11y case may pass at
  once (the fallback line is accessible too); say so — it is a pin.

- [ ] **Step 3: Implement.**
  - `client.ts`:

```ts
/** With `acceptRegistrationKept`, the confirmation showed that the reader stays registered at
 *  its provider, which is not connected. */
deleteReader(id: string, options?: { acceptRegistrationKept: true }): Promise<DeleteImpact> {
  return this.#request(
    `/management-api/payments/readers/${id}${options?.acceptRegistrationKept ? "?acceptRegistrationKept=true" : ""}`,
    "DELETE",
  );
}
```

  - `strings.ts`: delete `payments.delete_connect_first` in both blocks. Add beside
    `payments.delete_pairing`:
    - English: `"payments.delete_kept_at_provider": "{provider} isn't connected, so the reader stays registered at {provider}. Remove it there too.",`
    - Spanish: `"payments.delete_kept_at_provider": "{provider} no está conectado, así que el lector sigue registrado en {provider}. Elimínalo también allí.",`
  - `reader-delete-copy.ts`: in `itemLine`, beside `provider_pairing`:

```ts
if (key === "provider_registration_kept")
  return fill("payments.delete_kept_at_provider", {
    provider: item.targets.map(({ id }) => providerName(id)).join(", "),
  });
```

    and delete the `reader.provider_disconnected` branch in `refusalLine` (`:54-57`).
  - `payments-screen.ts`, `#confirmDelete`:

```ts
async #confirmDelete(id: string): Promise<void> {
  if (id !== this.deleteTarget || this.deleteSubmitting) return;
  const generation = this.#deleteGeneration;
  const kept = this.deleteImpact?.ends.some(({ key }) => key === "provider_registration_kept");
  this.deleteSubmitting = true;
  this.deleteActionError = "";
  try {
    await (kept
      ? this.api.deleteReader(id, { acceptRegistrationKept: true })
      : this.api.deleteReader(id));
  } catch (error) {
    if (generation !== this.#deleteGeneration) return;
    this.deleteSubmitting = false;
    const code = codeOf(error);
    // The provider was disconnected after this impact was read; the dialog does not see that
    // live (`live-queries.ts`), so it reads again and shows the notice before the next press.
    if (code === "reader.provider_disconnected") {
      this.#retryImpact();
      return;
    }
    if (code !== "reader.not_found") {
      this.deleteActionError = codeMessage(code);
      return;
    }
    this.#readerGone(id, true);
    await this.#load();
    return;
  }
  if (generation !== this.#deleteGeneration) return;
  this.#readerGone(id, false);
  await this.#load();
}
```

- [ ] **Step 4: Green.** Re-run Step 2's command, then the screen's other suites unedited:
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.test.ts src/screens/payments-screen.disable.test.ts src/screens/payments-screen.save-state.test.ts src/screens/payments-screen.tabs.test.ts src/screens/payments-screen.disconnect.test.ts src/i18n/codes.test.ts`.
  Root: `pnpm exec vitest run scripts/english-only.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.
  Disposable-copy control: remove the `reader.provider_disconnected` branch from `#confirmDelete`
  and see the stale-press case fail on the impact read count; restore. Then format and lint:
  `pnpm exec prettier --write apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/reader-delete-copy.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/payments-screen.ts apps/dashboard/src/api/live-queries.test.ts apps/dashboard/src/widgets/reader-delete-copy.test.ts apps/dashboard/src/screens/payments-screen.delete.test.ts apps/dashboard/src/screens/payments-screen.a11y.test.ts`,
  then `pnpm lint` and `pnpm format:check`. Check exit statuses and `Tests` counts.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/reader-delete-copy.ts \
  apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/payments-screen.ts \
  apps/dashboard/src/api/live-queries.test.ts apps/dashboard/src/widgets/reader-delete-copy.test.ts \
  apps/dashboard/src/screens/payments-screen.delete.test.ts \
  apps/dashboard/src/screens/payments-screen.a11y.test.ts
git commit -s -m "Dashboard: the reader delete confirmation says when a reader stays registered \
at an unconnected provider, and the delete accepts it"
```

### Task 3: Documentation, backlog and guards

**Deliverable:** every prose claim about the old behaviour updated, the owner question removed
from the backlog, the decision recorded, and the fiscal guards green unedited.

**Files:** `docs/superpowers/specs/2026-10-08-delete-and-archive-design.md` (Card readers),
`docs/superpowers/plans/2026-10-10-a435-3-card-reader-delete.md` (decisions 3, 5 and 18),
`docs/developers/design-system.md` (the paragraph starting "A card reader offers both", `:3560`),
`docs/backlog.md` (Modules, data and code health, `:4901-4904`), `docs/backlog/payments.md`
(`## Decisions and deliberate limits`, `:188`).

- [ ] **Step 1: Sweep for stale claims.** Run, from the worktree:
  `/usr/bin/grep -rn -i -e "provider_disconnected" -e "connect_first" -e "Connect SumUp" -e "Connect {provider}" -e "disconnected" -e "cannot be reached" -e "still paired" docs/developers docs/backlog.md docs/backlog README.md apps/*/README.md packages/*/README.md apps/server/src/card-reader-delete.ts apps/server/src/payments-api.ts apps/dashboard/src/widgets/reader-delete-copy.ts`
  and read the sentences around every hit about deleting a reader. At `67ef06b0c` the ones that
  describe the old behaviour are design-system.md `:3562-3563` and the backlog entry at
  `:4901-4904`; `conventions-ui.md:557-559` (re-adding a deleted reader) stays true and is not
  changed. Fix any other hit that describes the delete's old behaviour; leave hits about other
  routes (enable, discovery, pay) alone.
- [ ] **Step 2: Prose.**
  - design-system.md: replace "the delete is refused while that provider's account is
    disconnected, and an unpair that fails leaves the reader disabled but not deleted" with
    "while that provider's account is not connected, the delete removes it from Waitron only and
    the confirmation says it stays registered at the provider; an unpair that fails leaves the
    reader disabled but not deleted". Leave the rest of the paragraph.
  - Spec, under "Card readers", after the existing 2026-10-10 note:
    `_2026-10-10 (A435 step 3b, owner): while the provider's account is not connected, a
    still-paired reader is deleted in Waitron only, once the confirmation has said it stays
    registered there; while it is connected, a SumUp unpair call that fails still answers
    `reader.unpair_failed`. See [the step 3b plan](../plans/2026-10-10-a435-3b-reader-delete-disconnected.md)._`
  - A435-3 plan: under decision 18 add `_2026-10-10, owner: overridden by
    [2026-10-10-a435-3b-reader-delete-disconnected.md](2026-10-10-a435-3b-reader-delete-disconnected.md):
    a disconnected account no longer refuses the delete; the reader is deleted in Waitron only
    after the confirmation says it stays registered there. While the account is connected, a
    SumUp unpair call that fails (a rejected key included) still answers `reader.unpair_failed`._` At decisions 3 and 5, where they call `reader.provider_disconnected`
    an impact refusal, add `(_2026-10-10: no longer in the impact; see decision 18's note._)`.
- [ ] **Step 3: Backlog.** In `docs/backlog.md`, delete the entry "**Owner question: may a reader
  still paired at SumUp be deleted while SumUp cannot be reached?**" (`:4901-4904`). Add in the same
  area: "**A Stripe reader's delete confirmation does not say the reader stays registered at
  Stripe**, which a SumUp reader's does while SumUp is not connected. Left open by A435 step 3b."
  In `docs/backlog/payments.md` under `## Decisions and deliberate limits` add: "**A reader still
  paired at its provider is deleted in Waitron only while that provider's account is not
  connected** (owner, 2026-10-10), after the confirmation says it stays registered there. While
  the account is connected, a SumUp unpair call that fails, a rejected key included, still answers
  `reader.unpair_failed` and leaves the reader switched off: a rejected key is found only when
  Delete is pressed, because the impact read calls no provider, so the confirmation could not say
  so beforehand; re-entering the key fixes it and the delete then unpairs; and today's code does
  not tell a rejected key from an outage (backlog: "A failed SumUp unpair is logged with reason
  `unknown`"). Plan:
  `docs/superpowers/plans/2026-10-10-a435-3b-reader-delete-disconnected.md`." Keep the
  "reason `unknown`" entry; this branch does not change it.
- [ ] **Step 4: Guards still owed.** The fiscal tests must pass unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`, all files unedited
  (read the passed counts). Then
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/live-subscriptions.test.ts`.
  `git diff 67ef06b0c --stat -- packages/fiscal-verifactu packages/fiscal packages/shared packages/ui packages/db`
  must print nothing. Check each exit status and `Tests` count. No whole-workspace run; CI owns the
  package suites.
- [ ] **Step 5: Commit** the docs and backlog (`git commit -s -m "Docs: a reader still paired at
  an unconnected provider is deleted in Waitron only"`).
### Task 4: LOOK

**Deliverable:** screenshots of the changed dialog, looked at, with one line per state saying what
was seen. Runs after Tasks 1–3 are committed.

- [ ] **Step 1: Check headroom first** (`memory_pressure | grep free`;
  `ps -axo rss,command | sort -nr | head`) before starting Chromium.
- [ ] **Step 2: Capture, as A435-3 Task 8b did.** Write a throwaway, uncommitted browser test
  beside `payments-screen.delete.test.ts` (copy its `client`, `mount`, `openDelete` and `flush`
  helpers) that mounts the screen with the fake API, opens the dialog, sets the size with
  `page.viewport(w, h)` from `vitest/browser` (not `commands.setViewportSize`, which leaves the
  test's frame at its default width: testing-guide.md, "A width you set…"), reads
  `window.innerWidth` and records it, and saves with `page.screenshot` under
  `__screenshots__/look/` beside the test (Vite refuses paths outside the workspace:
  testing-guide.md, "A screenshot is saved only to a path…"). Mount through `mountWidget`'s theme
  argument for light and dark, as `payments-screen.a11y.test.ts:136` does. States:
  - `01-dialog-kept` — the notice plus two removes lines (`device_reader` with two long device
    names, `profile_reader`);
  - `02-dialog-kept-paying` — the notice beside a payment in progress (Delete quiet and disabled).

  Each in English and Spanish, light and dark, at 1280×900 and 390×844 — 16 files named
  `<state>-<en|es>-<light|dark>-<width>.png` — plus `01-dialog-kept-<en|es>-light-390x600.png`
  to check the footer is reachable on a short phone. Copy them to
  `/Users/clintongormley/waitron-campaign-b/a435-3b-shots/` (create it).
- [ ] **Step 3: Look** at every file: the notice wraps inside the dialog with nothing clipped, the
  "What will end" heading and the line read sensibly together in both languages, the provider
  appears by its display name, the footer is reachable, Cancel is focused on open. Write one line
  per state and language saying what was seen and the measured `window.innerWidth`. Delete the
  throwaway test and its `__screenshots__/look/` folder. Stop only the processes you started, by
  recorded id. Commit nothing unless a defect was found; a fix is test-first and committed with
  `git commit -s`.

### After the tasks: the finish (driver, not an implementer)

Announce that the branch is ready for `finish-branch`, then run it. Take the FULL path: the branch
changes a permission-gated route's contract and the order of transactions around a provider call
(concurrency). The run-it seat is Codex, as two reviews side by side with
`~/workspace/tools/codex-seat.sh review-run`. The first gets this plan, the spec and the Review
Focus as its checklist; the second is told to set that checklist aside and test what it does not
name. Read each report's findings, not the wrapper's exit status. CI must select
`@waitron/server` and `@waitron/dashboard` (read the `changes` job's outputs). The PR description
lists "Intentional changes to existing checks" below, and gives the owner the FYI: the rejected-key
case stays as built (decision 8, with its three reasons: a rejected key is found only on the press,
because the impact read calls no provider; re-entering the key fixes it; today's code does not tell
it from an outage); the notice sits under "What will end", which he can overrule in favour of a
separate section that would touch the shared dialog and the printer and device copy (decision 1);
a disconnect that lands during a delete now answers `reader.provider_disconnected` (decision 13);
and the Stripe dialog is unchanged (decision 10).

## Intentional changes to existing checks

Each line: the check, what it pinned, what replaces it.

1. `apps/server/src/card-reader-delete.db.test.ts:286-292`, "refuses a still-paired reader whose
   provider can unpair but is not connected": pinned that the impact read's `refusals` held
   `reader.provider_disconnected`. Replaced by "says a still-paired reader stays registered at a
   provider that can unpair but is not connected, refusing nothing", which pins `refusals` `[]` AND
   `ends` equal to the `provider_registration_kept` item, an exact `toEqual` on both lists. Its
   refusal half moves to the unchanged delete case at `:397-405` and the new prepare case, which
   still assert `reader.provider_disconnected` when the delete does not accept the notice.
2. `apps/server/src/payments-api.test.ts:1919-1940`, "refuses reader.provider_disconnected for a
   still-paired reader once its provider is disconnected": pinned the impact's refusal (`:1930-1932`)
   and the refused DELETE (409, the error body, no provider call, row unchanged). The refused-DELETE
   assertions are kept word for word and the case also pins the links unchanged. The impact
   assertion is replaced by `refusals` `[]` and `ends` `[kept]`, and the case gains the accepted
   DELETE: 200, the body equal to the impact, no provider call, the row equal to before except
   `active` and `deletedAt`, `unpairedAt` null, links gone.
3. `apps/dashboard/src/widgets/reader-delete-copy.test.ts:46,81,141-147,176-180`: pinned "Connect
   SumUp first" / "Conecta primero SumUp" for a `reader.provider_disconnected` refusal. That line no
   longer exists (decision 11). Replaced by exact-string cases for the
   `provider_registration_kept` line in both languages, and by adding that key to the "no line
   shows a key or a target's id" check.
4. `apps/dashboard/src/api/live-queries.test.ts:83`, `expect(active).toHaveBeenCalledTimes(2)`:
   becomes `3`, because the case now sends a second DELETE (with the flag). Each request is still
   counted once.
5. Test helpers that change shape without changing any assertion: `remove` and `prepare` in
   `card-reader-delete.db.test.ts:235-238` gain an options argument; `mountApp` in
   `payments-api.test.ts:210` gains an optional `db`.

No other existing assertion changes. In particular, the cases "opens with one impact read…"
(`payments-screen.delete.test.ts:211-240`), the unpair-failure cases (`payments-api.test.ts:1876-1917`,
`payments-screen.delete.test.ts:383-409`) and every case in `describe("a deleted reader")` pass
unedited.

## Plan self-review

- Owner decision coverage: Waitron-only delete when not connected (Task 1); the notice before the
  press, concise, in EN and ES, provider by name (Task 2); the rejected key kept as built, with its
  reason and a test (decision 8, Task 1); the list of changed checks (above).
- Brief's design points: 1 → decision 1; 2 → decisions 4–7 and Review focus 1–3; 3 → decision 8;
  4 → decision 9 and Review focus 5; 5 → decisions 2 and 11.
- Decision 13 (late disconnect) → Task 1's disconnect-after-step-(a) case.
- Review focus: 1 → Task 1 replaced route case and Task 2 stale-press case; 2 → Task 1 reverse
  race; 3 → Task 1 one-transaction case; 4 → Task 1 rejected-key case; 5 → Task 1 discovery case.
- Names used across tasks: `CardReaderDeleteOptions`, `acceptRegistrationKept` (option, query flag
  and client option), `provider_registration_kept`, `payments.delete_kept_at_provider`,
  `deleteReader(id, { acceptRegistrationKept: true })`.
- Not established while planning (no code was run for this plan): whether the `Proxy` around
  `suite.db` works with drizzle's internals unchanged (Task 1 Step 6b says what to do if the hook
  does not run); whether the a11y case passes before the change.
