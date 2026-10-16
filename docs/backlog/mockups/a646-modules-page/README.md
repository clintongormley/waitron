# A646: one Modules catalogue, row menus and modal configuration

These static boards revise the [proposed design](../../../superpowers/specs/2026-10-16-a646-modules-page-design.md)
after the owner's 16 October answer at about 22:40. The prior design is **not approved**. The spec
quotes the owner's exact words and records the one remaining scope question. Build still waits
for owner agreement and A739/A764; the first independent build PR must repair retained protection.

Each board contains **five separately labelled page snapshots**, stacked vertically for review.
They are different moments, not a page with a permanent dialog beside or below its list:

1. **Enabled on opening.** One catalogue shows name, applied state, configuration/readiness and
   a row kebab. The examples include specific red reasons and recovery actions for missing
   alternative login, dependencies, unprepared runtime support and Stripe's unknown €28 charge.
   These reasons stay in the row when its menu closes. Required/setup-only entries are readable
   separately. The long drawing exposes every row; the real page can scroll.
2. **Add a module selects Disabled.** The same catalogue now shows Workforce Spain, Bookings and
   SumUp. Its open SumUp menu offers Configure and Enable. This shortcut changes the state filter,
   preserves the visible category and creates no second list. You can clear Category to browse
   everything. State also offers All; search is explicitly deferred.
3. **An enabled row's menu is open.** Google offers Configure and a grey, disabled Disable. The
   specific reason and Account security recovery action remain visible outside the popover.
   This example concerns the applying administrator and applies under either proposed scope.
4. **Configure opens a centred modal.** A bounded `wt-dialog` overlays the dimmed page, with a
   title, client ID/secret replacement controls, derived callback address, Cancel and quiet,
   disabled unchanged Save. “Saved securely” is configuration status, never a credential value
   or submitted mask. Save changes settings only; a disabled entry stays disabled. Enable is a
   separate row action with explicit confirmation and fresh server checks. No snapshot has an
   on/off toggle. Modules without settings instead get a truthful no-settings dialog with Close.
5. **Card payments' direct link selects All states.** Category = Card providers and State = All
   show configured Stripe and configured-but-disabled SumUp together. The link overrides a
   remembered Enabled state; configuration/readiness does not hide providers that need setup.

The examples are a fictional venue's proposed states. “Configured”, “vault readable”, no-settings
labels, readiness and refusal reasons are not observations of a running installation. All eight
boards show the same design in EN/ES, light/dark and phone/desktop widths. Open the tall PNGs at
native width to read the phone text; their height preserves wrapping rather than shrinking type.

| Language | Theme | Desktop, 1280 px         | Phone, 390 px           |
| -------- | ----- | ------------------------ | ----------------------- |
| English  | Light | [PNG](en-light-1280.png) | [PNG](en-light-390.png) |
| English  | Dark  | [PNG](en-dark-1280.png)  | [PNG](en-dark-390.png)  |
| Spanish  | Light | [PNG](es-light-1280.png) | [PNG](es-light-390.png) |
| Spanish  | Dark  | [PNG](es-dark-1280.png)  | [PNG](es-dark-390.png)  |

Each PNG has a same-named SVG source. Those SVGs are the editable visual artifacts; there is no
committed generator or product prototype. Text wraps at phone width, and page/modal snapshots
have separate labels. Palette literals are copied from the explicit light/dark blocks in
`packages/ui-core/src/tokens/colors.css`, including the danger, quiet field and scrim colours.
This is static documentation artwork, not an alternative theme or implementation contract.

## Full inventory and reading receipts

At source snapshot `2e33ca8907863d3f8125eb15378a57cd4aaf1eb5`, reading the complete
`ALL_MODULES` assembly gives the following optional catalogue. These are **read-only source
observations, unverified at runtime**; “toggleable” does not establish safe runtime switching.
The product must derive its entries from composition, not copy these names into a host list.

| Current optional module          | Composition receipt                           | Board location |
| -------------------------------- | --------------------------------------------- | -------------- |
| Identity (`identity`)            | `packages/composition/src/modules.ts:153–155` | Enabled        |
| Workforce (`workforce`)          | Same file `:167–169`                          | Enabled        |
| Workforce Spain (`workforce-es`) | Same file `:182–184`                          | Disabled       |
| Payments (`payments`)            | Same file `:198–200`                          | Enabled        |
| Scheduler (`scheduler`)          | Same file `:213–215`                          | Enabled        |
| Credentials (`credentials`)      | Same file `:226–228`                          | Enabled        |
| Bookings (`bookings`)            | Same file `:275–277`                          | Disabled       |
| Staffing (`staffing`)            | Same file `:310–312`                          | Enabled        |

Google login (`identity-google`) is **proposed**, not a current optional descriptor. Stripe and
SumUp are current **provider contributions within Payments**, assembled at
`packages/composition/src/card-providers.ts:12`; their owning descriptors are
`packages/payments-stripe/src/card-provider.ts:133` and
`packages/payments-sumup/src/card-provider.ts:123`. Their browser panels are assembled at
`packages/dashboard-modules/src/card-providers.ts:10`. They share the catalogue without claiming
to be separate migration modules.

**Media is mandatory.** Composition imports `MEDIA_MODULE` at
`packages/composition/src/modules.ts:1`, inserts it at `:151`, and its owning descriptor sets
`tier: "mandatory"` at `packages/media/src/module.ts:29`. Core, catalogue, venue-service and
adjustments are also mandatory. Fiscal-verifactu and fiscal-none are provision-only alternatives;
read them separately and identify the selected regime without offering a regime switch.

The spec retains its original source observations pinned to
`2aa3e92506aa483c97a77ad8516f96068a5ede46`. The inventory files above were also compared between
that snapshot and this revision's source snapshot with `git diff`; they had no differences.
That comparison establishes file equality for those paths, not behavior.

## One proposed owner decision

Should disabling Google protect **Only the administrator making the change**, or **Every active
administrator**? I recommend every active administrator, explicitly as a proposal awaiting approval.
Both require the applying admin's fresh, short-lived, purpose-bound non-Google proof.

Elena has a password and completes fresh proof; Pablo has only Google. **Only me** permits Disable
once other safety checks clear, warning that Pablo will lose new login access. **Every active
administrator** refuses, names Pablo only to the authorized admin and waits for supported recorded
non-Google enrollment. Pablo does not need fresh possession proof for Elena's operation. Neither
option proves that other people still know their passwords or possess their passkeys. Concurrency
and factor-removal checks must follow the scope the owner selects; the design must not promise
all-admin protection if Only me is selected.

## Render again and understand the limits

To regenerate PNGs from the checked-in SVGs, run this from the repository root with dependencies
already installed. It uses the existing server dependency on sharp; it adds no repository script:

```sh
node --input-type=module - <<'JS'
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
const sharp = createRequire(process.cwd() + '/apps/server/package.json')('sharp');
const dir = 'docs/backlog/mockups/a646-modules-page';
for (const name of (await readdir(dir)).filter(name => name.endsWith('.svg'))) {
  await sharp(`${dir}/${name}`).png().toFile(`${dir}/${name.replace('.svg', '.png')}`);
}
JS
```

Rendering and looking at these files establish only that the static artwork can be rasterized
and visually inspected. They do **not** establish runtime behavior, real `wt-*` layout, keyboard or
focus behavior, screen-reader output, accessibility/axe results, permissions, server rechecks,
lockout prevention, credential sealing, payment continuation, migration safety or retained-record
protection. No product page, server route, test suite or provider was run for this revision. Those
claims remain proposed requirements for a later authorized build; A646 and its protection defect
remain open.
