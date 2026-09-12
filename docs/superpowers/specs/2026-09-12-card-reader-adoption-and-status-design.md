# Adding a reader the provider already knows, and showing what it reports — Design

**Date:** 2026-09-12. **Status:** approved in brainstorm, spec under review.

Follow-up to `2026-09-11-payments-provider-and-reader-ui-design.md` (slice 1, landed #323). It does
not reopen that design; it fixes one hole the first live run found and takes two things the vendor
APIs already give us.

## The problem the owner hit

The owner unplugged the Solo from its screen and ran the new Add-reader flow. The reader never
offered a pairing code — it simply reconnected to the SumUp cloud, because it was already paired to
the merchant account from the 2026-09-11 experiments. Waitron's dialog has exactly one way in (type
a code, poll until the device confirms), so there was nothing to type. The only escape was to sign
in to SumUp's website, delete the reader there, and pair again.

So: **a reader already connected to the provider's cloud cannot be added to Waitron at all.** That is
not a rare state — it is the state of every reader that has been set up once before, including every
reader a venue already runs before installing Waitron.

Two smaller things came up in the same session:

- **The row button says "Retire"**, a word used nowhere else in Waitron. Printers use
  Disable/Disabled/Add again (`printers.status_inactive`, `printers.add_again`).
- **The vendors report more than we keep.** SumUp gives battery, connection type, what the screen is
  doing, firmware and last-seen; we keep online/offline and one unrendered text field.

## What the owner decided (brainstorm, 2026-09-12)

- **Readers already at the provider are offered inside the Add dialog**, ahead of the pairing form —
  not auto-imported at connect time, and not held back until a pairing attempt has failed.
- **The table keeps a short status word and gains a battery column**; the rest opens from the row.
- **Both providers** get the pick-from-a-list treatment, not SumUp alone.
- **Status is read when the screen opens, plus a refresh control.** Nothing polls in the background.
- **The row's single button becomes a `wt-row-actions` menu** carrying Edit, Details, Disable/Enable
  and Unpair as separate items.
- **Reader location is not added.** An editable name plus the model and serial in the details dialog
  identifies a reader; a location would mean a new column, a cross-set FK and a picker filter for
  something the name already does. The slice-1 spec recorded reader→location as skippable for the
  same reason.

## Receipts

Measured against the owner's live merchant account on 2026-09-12, not read from documentation.

`GET /v0.1/merchants/{mc}/readers` — the call `packages/payments-sumup/src/sumup-client.ts`'s
`listReaders` already makes, and which no caller anywhere invokes today:

```json
{ "items": [ {
  "id": "rdr_053SG4NG3J80AV0YHBK79MB7A7", "name": "My Reader", "status": "paired",
  "device": { "identifier": "200101525543", "model": "solo" },
  "service_account_id": "051e604a-…", "created_at": "2026-09-12T11:03:45.683302Z",
  "updated_at": "2026-09-12T11:03:45.683302Z" } ] }
```

`GET /v0.1/merchants/{mc}/readers/{id}/status` — of which our client keeps `status` and collapses
`connection_type` + `state` into one string:

```json
{ "data": { "battery_level": 100.0, "battery_temperature": 35, "connection_type": "Wi-Fi",
  "firmware_version": "3.3.42.2", "last_activity": "2026-09-12T11:03:48.930006Z",
  "state": "IDLE", "status": "ONLINE" } }
```

**Stripe reports no battery.** Read from the installed SDK typings (`stripe@22.3.2`,
`esm/resources/Terminal/Readers.d.ts`, the `Reader` interface): `device_sw_version`, `device_type`,
`ip_address`, `label`, `last_seen_at`, `serial_number`, `status`, `location`, `metadata`, `action`.
No battery field of any name. So battery is **absent** for a Stripe reader, never zero.

**Stripe's `last_seen_at` is in milliseconds.** Its own doc comment says so explicitly: *"Unlike most
other Stripe timestamp fields which use seconds, this field uses milliseconds."* Multiplying it as if
it were seconds lands the date in the far future; dividing a seconds field by 1000 lands it in 1970.
Pinned by a test asserting a known epoch renders as a 2026 date.

**What "Retire" does today, read from the code:** `POST /management-api/payments/readers/:id/retire`
calls `seat.readers.remove` before setting `active=false` (`apps/server/src/payments-api.ts:392`).
For SumUp that is `DELETE …/readers/{id}` — it unpairs the physical device and returns it to
standalone use. So today's one button does two different things at once, and the vendor half of it is
exactly what makes a reader un-re-addable.

## Section 1 — listing what the provider already has

### The seat gains one operation

`CardProviderContribution.readers` (`packages/payments/src/card-provider.ts`) gains:

```ts
/** The readers this account already holds at the provider. Generic code compares them against the
 * tenant's `card_readers` rows to offer the ones Waitron has not got. A provider that cannot
 * enumerate returns `[]` — honestly empty, never an excuse to omit the method. */
list(deps: CardProviderRuntimeDeps): Promise<VendorReader[]>;

interface VendorReader {
  providerRef: string;
  /** The provider's own label for it, offered as the default Waitron name. */
  name: string;
  model?: string;   // "solo", "bbpos_wisepos_e"
  serial?: string;  // the physical device's identifier
  registeredAt?: string; // ISO 8601
}
```

Required, not optional: both shipped providers can fill it, and an optional method invites a seat
that quietly does nothing.

- **SumUp** fills it from `listReaders`, widened to carry `device.identifier`, `device.model` and
  `created_at`. It **returns only readers whose vendor `status` is `paired`** — one mid-pairing or
  expired is not adoptable, and filtering here keeps SumUp's vocabulary inside the SumUp package.
- **Stripe** fills it from `terminal.readers.list()`, mapping `label` → `name`, `device_type` →
  `model`, `serial_number` → `serial`. Every field on `ReaderListParams` is optional — `location`,
  `device_type`, `serial_number`, `status` and the pagination pair (read from the same SDK typings) —
  so a call with no params returns the account's readers rather than requiring a location. It returns
  **one page**; the seat takes the default page and does not paginate, which is honest for a venue
  with a handful of readers and is stated in the seat's own comment so nobody later assumes
  exhaustiveness.

### The route

`GET /management-api/payments/providers/:id/available-readers`, gated on `payments.manage`, refusing
with `reader.provider_disconnected` when the provider has no sealed credential (the same pre-check
the add route already does).

It calls the seat's `list`, reads this tenant's `card_readers` rows for that provider — **every read
carrying `eq(cardReaders.tenantId, cfg.tenantId)`**, since one-tenant-per-database is not the query's
isolation boundary (CLAUDE.md §3, the till-reroute leak) — and returns each vendor reader labelled:

| label | meaning | what the dialog offers |
| --- | --- | --- |
| `available` | no Waitron row for this reference | **Add** |
| `disabled` | a Waitron row exists with `active = false` | **Add again** |
| `added` | an active Waitron row exists | listed, greyed, no action |

`added` entries are returned deliberately: an operator who cannot find their reader in the list needs
to be told it is already here, not left guessing.

### Adopting

`POST /management-api/payments/readers/adopt`, body `{ providerId, providerRef, name }`:

1. `payments.manage`; provider-connected pre-check.
2. **Verify the reference against the seat's own `list`** — adopt refuses a `providerRef` the
   provider does not report, with `reader.not_listed`. Without this the route would write any string
   an operator or a crafted request supplied. Proven by deletion: with the check removed, a forged
   reference inserts a row.
3. In one transaction, re-reading the credential exactly as the add route does (a disconnect can
   commit during the provider round-trip):
   - a row already exists for `(tenant_id, provider, provider_ref)` → set `active = true`,
     `disabled_at = null`, and the supplied `name`;
   - otherwise insert a new active row.

   The uniqueness constraint `card_readers_provider_ref_key` forces this branch anyway; doing it
   deliberately is what preserves the reader's payment history and any device that defaults to it.
4. Returns `{ id, status: "paired" }`.

**No vendor rollback path.** Unlike pairing, adoption creates nothing at the provider, so a failed
insert leaves nothing stranded and needs no best-effort `remove`.

### The dialog

The panels keep their pairing and reference forms unchanged. The generic screen puts a step in front.

```text
Add a card reader
─────────────────────────────────────────
Already connected to your SumUp account:

  [ My Reader              ]  [ Add ]
  Solo · serial 200101525543

  [ Terrace                ]  [ Add again ]
  Solo · serial 200101499881 · disabled in Waitron

  Front counter — already added
─────────────────────────────────────────
A reader that isn't listed above needs pairing:
                     [ Pair a new reader ]
```

- Each actionable row carries an **editable name prefilled from the provider**. SumUp's own default
  is "My Reader", which identifies nothing; the operator renames it here rather than being stuck with
  it. The field follows the shared forms contract (`docs/developers/design-system.md` → Forms): a
  semantic `name`, a visible required marker, and explanatory text beside the field on an empty
  submission.
- **Pair a new reader** closes this dialog and opens the panel's own — today's `renderAddReader`,
  untouched. Cancelling there returns to this dialog. Two dialogs in sequence rather than one,
  because both panel elements render their own `wt-dialog` inside a shadow root
  (`packages/payments-sumup/src/dashboard/sumup-add-reader.ts`), so nesting one inside a generic
  dialog would nest two dialogs; reshaping both panels to render body-plus-slotted-footer is churn
  this change does not need.
- **The listing never blocks pairing.** If `list` throws (a provider outage), the dialog says it could
  not check what is already connected and still offers the pairing button. Regression: the failing
  call with the pairing button still reachable.
- **Empty list** says so plainly and leaves pairing as the obvious next step.

## Section 2 — Disable, Unpair, Edit, Details

The single Retire button becomes a `wt-row-actions` menu, following
`packages/venue-service/src/dashboard/venue-operations-screen.ts:267` — the existing precedent for a
row menu, including how it restores focus to the opener.

| item | what it does | provider call |
| --- | --- | --- |
| **Edit** | rename the reader | none |
| **Details** | the status dialog of Section 3 | none |
| **Disable** / **Enable** | stop / resume routing sales to it | **none** |
| **Unpair from SumUp** | release the device at the provider | `readers.remove` |

**Disable is Waitron-only.** It stops sales routing and nothing else; the reader stays paired at the
provider, so it keeps appearing in the Add dialog as _Add again_ and returns with one press. This is
the printers rule applied to readers (CLAUDE.md §3: *a retained hardware registration must remain
re-addable after deactivation*), and it is what makes the `disabled` label of Section 1 reachable.

**Unpair is the separate, rarer action** — returning the device, or wanting it standalone again. It
confirms in a dialog that names the consequence in plain words (*this reader returns to standalone
use; adding it back will need a pairing code*), then calls `readers.remove` and disables the row. It
is shown only where the seat supports it: the contribution declares `readers.canUnpair`, true for
SumUp, **false for Stripe**, whose `remove` is already a documented no-op because a Stripe Terminal
reader stays registered at Stripe. A menu item that does nothing is worse than an absent one.

**Wording** matches the printers screen exactly: **Disable** / **Disabled** / **Add again**. The
`payments.retire*` strings are replaced — these are UI strings, not error codes, so renaming is free
(the never-rename rule covers error codes only).

**The readers table gains an Active / Disabled / All filter**, defaulting to Active, the same control
the printers table uses (`apps/dashboard/src/screens/printers-screen.ts:1101`).

**Column rename.** `card_readers.retired_at` becomes `disabled_at`, and the schema comment follows,
so the code stops saying "retired" while every surface says "Disabled". Nothing is in production, so
the payments migration set drops and recreates (CLAUDE.md §3: no backwards-compatibility or
data-migration code). The `active`/`disabled_at` pair and the withheld DELETE grant are unchanged —
rows are still never deleted, so a historical payment always resolves a reader name.

**Routes**, replacing `POST …/readers/:id/retire`:

- `PATCH /management-api/payments/readers/:id` — `{ name }`
- `POST /management-api/payments/readers/:id/disable` and `/enable`
- `POST /management-api/payments/readers/:id/unpair`

Every one reads its reader by id **with the tenant predicate**, and every one is covered by the
two-tenant probe in Section 4.

## Section 3 — what the reader reports

### The contract

`ReaderStatus` (`packages/payments/src/card-provider.ts`) keeps `online` and `pairingStatus`, **drops
`detail`**, and gains:

```ts
batteryPercent?: number;   // 0–100, whole percent. Absent when the provider does not report one.
connection?: string;       // how it reaches the network, in the provider's words: "Wi-Fi", "mobile"
activity?: string;         // what the screen is doing now: idle, waiting for a card
firmwareVersion?: string;
lastSeenAt?: string;       // ISO 8601
model?: string;
serial?: string;
unreachable?: boolean;     // the status read itself failed — render "Unknown", never "Offline"
```

Every new field is optional, because what a provider reports differs and an absent battery must read
as absent rather than as a flat one.

**The shape is declared three times and all three move together** — the server contract above, plus
two browser mirrors of the route's response body: `ReaderStatusView`
(`apps/dashboard/src/api/client.ts`) for the generic screen and `ReaderStatus`
(`packages/payments-sumup/src/dashboard/client.ts`) for the pairing dialog. Nothing enforces that they
agree, so the plan carries each one explicitly rather than trusting a typecheck to find the two that
were missed.

**`unreachable` fixes a real defect.** Today a SumUp outage or an unknown reader is caught and turned
into `{ online: false, detail: "unreachable" }`, and `#statusText` renders that as **Offline** — which
sends an operator to check a reader that is fine. The flag separates *we could not ask* from *we asked
and it is off*. Proven by deletion: with the flag dropped the regression reads "Offline".

- **SumUp** fills all of them. `battery_level` rounds to a whole percent; `connection_type` and
  `state` become `connection` and `activity` instead of being concatenated; `last_activity` and
  `firmware_version` map across. `model` and `serial` come from `getReader`'s `device` block — a call
  the seat **already makes** for `pairingStatus`, so no extra request. `battery_temperature` is not
  surfaced: a figure with no operator action attached.
- **Stripe** fills `online`, `model` (`device_type`), `serial` (`serial_number`), `firmwareVersion`
  (`device_sw_version`), `connection` (`ip_address`) and `lastSeenAt` — **dividing `last_seen_at` by
  1000**, per the receipt above. No `batteryPercent`.

### The screen

- The readers table gains a **Battery** column, blank for a provider that reports none.
- The status word gains **Unknown** for `unreachable` and **Disabled** for an inactive row.
- **Details** in the row menu opens a `wt-dialog` listing connection, what it is doing now, firmware,
  last seen, model and serial, each omitted when absent.
- A **Refresh** control re-reads every active reader's status. Statuses still load once when the
  screen opens and are fetched per reader, a failure marking only that row — the existing shape in
  `payments-screen.ts:178`.
- **Nothing polls.** This keeps the screen clear of the passive-session question entirely
  (CLAUDE.md §3: automatic dashboard reads are passive session activity) — there is no automatic
  read to make passive.

## Section 4 — errors, security, testing

**New error codes**, each naming the domain concept and carrying no secret in its params
(`apps/server/src/errors.ts` discipline; the recovery page renders params):

- `reader.not_listed` — adopt was given a reference the provider does not report. Params:
  `{ providerId }`.

`reader.not_found` and `reader.provider_disconnected` are reused as they are. Both get `en`+`es` text
in `apps/dashboard/src/i18n/codes.ts`.

**Security.** Nothing here touches the credential vault; the provider reference is a public
identifier, as the existing schema comment states. The one new trust boundary is adopt's input, closed
by verifying the reference against the provider's own list before any write.

**Testing** (CLAUDE.md §4):

- **Two-tenant isolation probe on real Postgres as `app_user` (`rolsuper = f`)** for every new by-id
  read — adopt, rename, disable, enable, unpair, and the available-readers comparison. This is the
  class that reading missed and only running caught in till-reroute; PGlite cannot prove it, because
  every PGlite connection is a superuser and grants are not enforced.
- **Adopt refuses an unlisted reference** — proven by deletion (remove the check, a forged reference
  inserts).
- **Adopt of a disabled reader re-enables the existing row**, asserted by row count as well as state,
  so a second insert would fail the test rather than the uniqueness constraint.
- **`unreachable` renders Unknown, not Offline** — proven by deletion.
- **Stripe's millisecond `last_seen_at`** — a known epoch value renders as its 2026 date; the
  negative control (treating it as seconds) fails.
- **The listing failing still offers pairing**, and the empty-list message.
- **Both seats' `list`** against the existing `FakeSumUpClient` and the injected `makeStripe`,
  including SumUp's filter to `paired` (a `processing` reader is not offered).
- **Response bodies asserted with `toEqual`, not `toMatchObject`** — a key never listed is never
  checked (CLAUDE.md §4), and these routes are where a stray field would leak.
- **Whole-workspace run** after touching `CardProviderContribution`: more than one package asserts its
  shape.
- **Live confirmation on the owner's Solo** before the PR: the reader adopted from the list without
  deleting anything at SumUp, and its battery figure on the screen matching the API.

## Scope

**In:** the `list` seat operation and both providers filling it; the available-readers route and the
adopt route; the Add dialog's pick-from-a-list step with its editable name; the `wt-row-actions` menu
with Edit / Details / Disable / Enable / Unpair; `canUnpair`; the Active/Disabled/All filter; the
Disable wording sweep and the `retired_at` → `disabled_at` rename; the richer `ReaderStatus` with both
seats filling it; the Battery column, the Details dialog, the Unknown state and the Refresh control.

**Out, each with a reason:**

- **Reader location** — an editable name plus model and serial identifies a reader; a location costs a
  column, a cross-set FK and a picker filter. Raised and set aside 2026-09-12; the slice-1 spec had
  already recorded it as skippable.
- **Background refresh of status** — the owner chose open-plus-refresh. Adding polling later means
  routing it through the passive-session controller (`docs/developers/dashboard-live-updates.md`),
  not a bare timer.
- **Battery temperature** — reported by SumUp, but no operator action attaches to it.
- **Stripe location objects** — Stripe's reader list is passed no location, so an account whose
  readers are all location-scoped still lists them. Stripe's device-code registration, which needs a
  `Location`, stays deferred from slice 1.
- **Alerting on a low battery** — a notification surface, not a config screen; worth raising separately
  once the dashboard has somewhere to put it.
