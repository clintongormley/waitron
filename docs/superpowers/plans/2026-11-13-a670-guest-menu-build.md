# A670: read-only guest menu, then A4 presets

**Plan for Claude's read, then PLAN FOR APPROVAL to the watcher. Not cleared to build.**
Execute inline after clearance. Source inspection only; no tests run.
**Finish line:** you choose one published menu, share one public HTTPS link, and guests read it on mobile data without signing in. Cloud forwards to the box while reachable and serves the hosted published read-only copy otherwise. Then you choose an A4 preset and print or save it as PDF.

## Authority and limits

- Lane D `/Users/clintongormley/waitron-campaign-d/queue.md`, A1517-4 records the ask: "smallest read-only online go-live scope and one-page printed-template options with quick restaurant-style studies. Docs and mock-ups only; no product build before the owner sees them."
- `questions.md`, WATCHER 2026-11-13 22:31, records the owner's words: "Online ordering requires forwarding cloud requests to the server. If the internet is down we can show a cloud hosted copy of the menu but without online ordering"; "Presets first (Recommended)"; "it should fall back to the name in the default language, and failing that, to the internal name. never to the kitchen name".
- Latest next action, verbatim: "Next: write the build plan for the go-live guest menu (read-only online menu with both delivery routes as above, then the presets), smallest usable result first, Cloud's part named as a separate Cloud item. Plan → Claude read → PLAN FOR APPROVAL as usual. Ordering itself is not in this item."
- Read the [online study](../specs/2026-11-13-a670-online-go-live-study.md) and [printed study](../specs/2026-11-13-a670-printed-template-study.md); the [12 November proposal](../specs/2026-11-12-a670-guest-menu-design.md) remains historical. These decisions are not owner approval of this plan.
- Omit ordering, payments, table/tab QR credentials, stock promises, filters, blocks, uploads, arbitrary CSS, a PDF service and all parked renderer work.
  Proposed first cut: text masthead, readable background/text/accent colours and supplied font stacks; no logo, cover or dish photos, media routes or external asset requests. These reductions are proposals, not owner decisions.

## Shared boundary and reuse

- New `packages/shared/src/menu-document/guest-menu.ts`: `PublicGuestMenu` (format 1) and `projectGuestMenu(document, publication, languages, identity)`.
  Allow only publication identity/date, enabled/default languages, public titles, ordered sections/items, descriptions, prices/units, variants, options, extras and separate declarations. Exclude home layouts, hashes, kitchen names, VAT/reporting/ordering data and unrelated products; never spread a `MenuDocument`.
- Resolve display text for each enabled language with `customer-menu-presentation.ts#resolveMenuText`: customer guest language, customer venue default, staff/internal fallback. Return display maps, not raw staff fields; resolve product/variant halves separately. Descriptions may be empty. Keep null/unreviewed declarations distinct from reviewed-empty; neither asserts allergen absence.
- Reuse `packages/catalogue/src/menu-publication.ts#readLiveMenu` for the live published version, never working catalogue rows; preserve direct inclusions and published order. Reuse `menuPriceRange`, product presentation and existing nutrition symbols. Keep `/management-api/catalogues/:id/live` protected (`apps/server/src/catalogue-api.ts`).
- New `apps/server/src/guest-menu-page.ts` renders standalone HTML with section/language links and labelled, keyboard-operable icon explanations. Embed tokens/styles and used SVG symbols with their existing notices.
  Cloud stores this public payload and box-rendered language pages. Agree delivery using existing Cloud facilities; add no protocol/framework or asset pipeline.
- New `packages/shared/src/i18n/guest-menu.ts` shares controls, keys and explanations between online/paper. Start EN/ES and the CA/GL vocabulary in the historical proposal; whole-bundle fallback is venue default then English, visibly named. Content text still follows its own fallback. Proposed dietary display uses the most-specific declared mark; retain independent halal/kosher and written cereal/nut kinds.

## Build slices, each useful and independently reviewable

Estimates below separate production/test lines; allow up to three hours to PR per slice. Re-slice with the watcher beyond roughly 500–1,000 lines or that window.
For each slice: write the named test, observe its expected failure, implement minimally, rerun green, then inspect rendered output. Keep existing assertions. Use `useVenueDb` and real Chromium.

### 1. Authenticated guest preview (production 350–450; tests 200–250; about 2½ hours)

- New files: shared payload/wording and sibling `*.test.ts`; server page, `apps/server/src/guest-menu-api.ts` and `guest-menu-api.test.ts`. Modify `packages/shared/src/index.ts` for exports.
- Modify `apps/server/src/boot.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/screens/menus-screen.ts`, `apps/dashboard/src/i18n/strings.ts`; add a protected guest-preview action for a menu's live publication. New `apps/dashboard/src/widgets/guest-menu-preview.ts` and `guest-menu-preview.test.ts` show that page, without enabling public access or changing publication behavior.
- Tests: `projects only published guest fields`, `falls back to default then internal never kitchen`, `keeps variant extra prices and declarations separate`, `preview requires catalogue management`.
  Assert complete shapes; fixtures give customer/staff/kitchen names different text and a draft price different from the publication.
- Browser test `reads a translated preview and opens declarations by keyboard`: guest choice survives section navigation, focus alone opens nothing, Enter/Space open and dismissal works; malicious content renders as text. Inspect 390/1280 widths and both surrounding themes. Proposed browser matching uses enabled content languages, otherwise default; an explicit language link wins.
- Commands: `pnpm --filter @waitron/shared exec vitest run src/menu-document/guest-menu.test.ts src/i18n/guest-menu.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/guest-menu-api.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/guest-menu-preview.test.ts`.

### 2. Explicit public selection and appearance (production 220–300; tests 200–260; about 2½ hours, generated baseline extra)

- Modify `packages/db/src/schema/catalogue.ts`: default-false `isGuestMenu` and a partial unique index, following `isDefault`; R4 keeps the selection out of settings JSON.
  Run `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Expected generated files: `packages/db/drizzle/0000_baseline.sql`, its `meta/0000_snapshot.json`, `meta/_journal.json` and tool-reported epoch changes. Disclose the reset in the PR; measure generated churn before continuing and take growth to the watcher.
- New `packages/catalogue/src/guest-menu.ts`, `guest-menu.test.ts`, `guest-menu-settings.ts`, `guest-menu-settings.test.ts`; modify its `index.ts`, `configuration-transfer.ts` and `packages/composition/src/modules.ts`.
  Appearance alone uses `defineSettingsDocument`/`saveSettings`. Import leaves sharing off. Selection clears the previous flag atomically; public reads require an active selected menu and live publication, never a caller-supplied menu id.
- Extend the new server API with authenticated read/save/disable under `catalogue.manage` and public GET/HEAD page/content reads. Modify new preview widget into the selection/appearance editor reached from existing Menus navigation; reuse `draftScopeFor`, `saveActionState`, passive reads and the existing API request wrapper. New `apps/dashboard/src/widgets/guest-menu-preview.unsaved.test.ts` covers leaving a changed draft. No new top-level navigation section.
- Tests: `public reads only the selected live publication`, `selection is unique and opt in`, `import does not enable sharing`, `disabled inactive or unpublished menu exposes no content`, `appearance save refuses a stale revision`; public POST and an arbitrary menu id must not expose/write content. Keep this privacy suite here rather than repeating it in every layer.
- Commands: `pnpm --filter @waitron/catalogue exec vitest run src/guest-menu.test.ts src/guest-menu-settings.test.ts src/configuration-transfer.test.ts`; extend/run `pnpm --filter @waitron/db exec vitest run src/schema/catalogue.test.ts`; rerun server/widget tests, including the unsaved test.
  Required schema checks: root `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.

### 3. Box entrance for both Cloud routes (production 100–180; tests 150–220; about 2 hours once Cloud contract is checked)

- Modify `apps/server/src/cloud-remote.ts`, `boot.ts` and the new guest API; extend `cloud-remote.test.ts`, add `apps/server/src/boot.guest-menu.test.ts`. Provide an explicit guest-only GET/HEAD allowlist for the selected public page/content; do not broaden `createStaffApp` into anonymous management/media access. Use the existing serving-role check, so a non-serving box cannot supply a fresh menu.
- Tests: `guest entrance cannot reach staff routes or unrelated assets`, `boot exposes only selected content while serving`; preserve legitimate staff behavior.
  Publication/patch/selection/disable changes must reach Cloud's delivery/status integration, after watcher routing confirms it. No Cloud call inside the sale or publication transaction.
- Show the manager the stable public link and whether the current publication/selection has reached the hosted copy; pending or failed delivery must not look current. Reuse the existing QR library only once the stable URL is qualified; a venue QR carries no table/tab identity. Test `pending hosted update does not claim delivered` at the API/widget boundary using the agreed Cloud response. No new delivery ledger or retry runner here.
- Commands: `pnpm --filter @waitron/server exec vitest run src/cloud-remote.test.ts src/boot.guest-menu.test.ts src/guest-menu-api.test.ts`; rerun the preview widget test for status/link changes. Local box preview remains useful while this integration waits; do not call it online go-live.

**Separate watcher-routed Cloud item (no new queue entry/id):** permanent venue HTTPS URL, guest-only forwarding to the serving box, hosted published-copy storage/update/status and fallback when unreachable.
Cloud readiness is **UNVERIFIED**; no Cloud repo was inspected. Its owner supplies exact files, estimates and tests before integration; this plan promises no cross-repository implementation.

**Joint acceptance:** on mobile data without staff session/certificate, the same URL reads the forwarded selected publication, survives box disconnection with the last delivered publication/date, and updates after reconnect/publication. Manager status moves from pending to delivered.
An explicit disabled/not-published response must not revive cached content; an offline change stays pending until Cloud confirms it. Qualify replacement/disable, takeover and refusal of staff/media/write paths. Both routes precede online go-live and public QR printing.

### 4. Fixed A4 presets (production 300–400; tests 180–250; about 2½ hours; after online delivery)

- New `apps/dashboard/src/widgets/guest-menu-print.ts`, `guest-menu-print.test.ts`; extend preview/settings/wording with preset and paper-language choices.
  Proposed Bistro uses balanced columns; Lunch and wine places the final published section in a narrow panel. Preserve section order; capture one payload/publication/language. Add no prices or set-lunch behavior.
- Reuse isolated print-frame and `afterprint` cleanup from `widgets/equipment-label.ts` and token/text-safe document construction from `screens/node-recovery-print.ts`. Proposed first-cut delivery is browser **Print / Save as PDF**, explicitly labelled; no one-click PDF promise. Watcher clearance must explicitly settle whether browser printing meets the paper first cut; the template answer alone does not settle PDF delivery.
- Tests: `prints only the captured publication`, `keeps prices variants extras and declarations together`, `long translated menu continues without clipping`, `cleans up the print frame`.
  Written key at the end, with inline words as the alternative; keep headings with first items and continue long content. Proposed omissions: per-page keys, manual breaks and free-text regions.
- Command: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/guest-menu-print.test.ts src/widgets/guest-menu-preview.test.ts`. Inspect actual saved A4 PDFs for both presets, EN/ES and a long CA example with separate extras and cereal/nut kinds. Check page boundaries, key placement and readable prices; viewport screenshots alone are not print evidence. Keep PDFs/screenshots outside git.

## Documentation and completion

Update `apps/server/src/guide/en/products.md` and `es/products.md` in the owning slices with shared heading ids: selecting/publishing, the public link and pending hosted copy, names fallback, then preset printing. Update `docs/developers/products.md` for the new guest consumer and `design-system.md` for the separate guest theme/print contract. Run existing guide guards when building, not for this plan.
Record the settled owner choices and pending plan in the existing A670 backlog entry now; narrow delivered scope in each later slice, retaining ordering and other unfinished work. Each built slice goes through `finish-branch`, normal hook and current-head scoped CI; the driver arranges Claude's reviews. This author runs none. Final completion needs the joint Cloud acceptance and inspected printed output, not merely passing box tests.
