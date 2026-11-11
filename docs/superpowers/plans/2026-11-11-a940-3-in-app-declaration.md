# A940 slice 3 — the declaration on every terminal: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** the box serves the running version's declaración responsable (the producer's legal
statement that this version meets Spain's invoicing-software rules) at `/legal/declaration`, as a
page, a PDF and plain text, on every listener and in every mode, and every terminal opens it in
two taps: About Waitron on the dashboard, in the till's More menu, an ⓘ button in the till's
corners and in the setup wizard's header.

**Architecture:** one server module reads a fixed folder of files that slice 4 will build into
the image (`/app/declaration/`), checks the set is whole, and answers four addresses. It is
mounted beside the guide pages in the main app, and on the waiting start, the plain-HTTP landing
listener and the recovery listener. The front ends never render the declaration: they frame the
box's page, and read one small JSON answer (`/legal/about`) for the version shown in titles.

**Tech stack:** Hono routes in `apps/server`; Lit components in `apps/dashboard`, `apps/till` and
`apps/setup` built from existing `wt-*` primitives (no new primitive); Markdown guides served by
the box.

**Spec:** [A940 design](../specs/2026-10-21-a940-declaracion-responsable-design.md) — §6 (every
terminal), §7.2 (before setup and while stopped), §8, §10 slice 3, §12.

**Depends on:** slice 2 landed — #2820 (text and renderer), #2827 (PDF and the package command),
#2836 (release commands and runbook). Slice 3 uses slice 2's renderer only in tests: the box
serves files, it never renders.

**Pull requests:** four, each one implementer's work, landed in order.

| PR  | What                                                   | Production lines (estimate) |
| --- | ------------------------------------------------------ | --------------------------- |
| 1   | Server: the four addresses on every listener; runbook  | about 150                   |
| 2   | Dashboard: About Waitron, the sign-in foot line        | about 140                   |
| 3   | Till: More menus, the corner ⓘ, lock and pairing ⓘ     | about 120                   |
| 4   | Setup wizard ⓘ, the guide page in two languages, backlog | about 70, plus guide text |

**Review path: LIGHT** (design §10). No pull request touches a risk trigger: nothing fiscal,
no migration, no sign-in or permission check, no write route (all four addresses are reads that
need no sign-in, as `/help/…` does). PR 1 does widen one allowlist, the Waitron Cloud staff
entrance's (`apps/server/src/cloud-remote.ts:132-143`); LIGHT still holds because the addition
is GET and HEAD only, under `/legal/`, where the box answers four fixed file names and its own
404 — no sign-in, no data, no write. Task 2 gets a per-task review anyway, because of that list.
Per CLAUDE.md, the plan is read once against the spec by a fresh-context reviewer before any
implementer starts, and every branch still goes through `/finish-branch` (its run-it seat runs on
every branch). Every commit `git commit -s`; never `--no-verify`.

## Departures from the approved design and decisions needing the watcher's approval

1. Handheld More: About Waitron sits just above Log out, not "very last" (§6.3); today More always ends with Log out, followed only by "Powered by" while a venue logo is in use (`till-shell.ts:1241-1245`).
2. A fourth address, `/legal/about` (JSON: the release's version and date, and the build), which the titles and the sign-in foot line need; the design names three.
3. A fourth file, `release.json`, in `/app/declaration/`, holding the version and the declaration's own date, which slice 4 writes in the same run from the same `v<version>.md`.
4. The download links («Descargar PDF», «Descargar texto») sit inside the Spanish declaration page, in Spanish only, and download rather than open, so no terminal repeats them; the design put them on the dashboard's About page.
5. Kiosk tills get the corner ⓘ as well as kitchen screens, because the shell draws that corner for both (`till-shell.ts:993-999`).
6. The dashboard's About is a window over the current screen, not a page with its own address, so the signed-out sign-in screen opens the same thing.
7. The setup wizard's ⓘ opens a full-screen sheet, not a new tab.
8. Three states, never a partial one: no folder → "this build has none" (404); a folder with any file missing or inconsistent → "cannot be shown" (500); otherwise the declaration.

## What a person can do once each pull request lands

- **After PR 1:** anyone can open `https://waitron.local/legal/declaration` (or `.pdf`, `.txt`),
  or `http://waitron.local/legal/declaration` on the plain-HTTP page, on a box in any state —
  before setup, trading, a spare, a box waiting for its peer, a box restricted after a handover, a
  box repairing its time zone, a box stopped on its recovery page — and the plain-HTTP page (both
  its forms) and the recovery page link to it at their foot. **Today every box answers "this build has no declaración responsable"**, because no image
  carries the folder until slice 4; a box given slice 4's folder shows the declaration with no
  further change. The release runbook says the release pull request goes through `/finish-branch`.
- **After PR 2:** on the dashboard, the account menu (person icon) has **About Waitron** between
  Language and Log out; the sign-in screen's foot has one quiet line that opens the same window.
  The window shows the version, its date, the licence, the English note, and the declaration.
- **After PR 3:** on a counter till and a handheld, **About Waitron** sits in More, just above Log
  out; a kitchen screen's corner, and the PIN and pairing screens' corners, have an ⓘ. Each opens
  the declaration in the till's full-screen sheet, titled "About Waitron · 1.0.0".
- **After PR 4:** the setup wizard's header has the same ⓘ; the guide has an "About Waitron" page
  in English and Spanish saying where to find the declaration and what to hand over; the backlog
  says slice 3 is done and what slice 4 must now build.

## Where a box finds its declaration, today and after slice 4

Established on main at `1d078d438b`, 2026-11-11:

- **Nothing serves or writes it today.** `git grep -n -E "app/declaration|/legal|declaration\.(pdf|txt|html)" -- ':!docs'`
  finds no route, no Dockerfile line and no script (its only hits are the unrelated
  `/management-api/venue-details/legal-name`). Slice 2's plan names the seam: slice 4 "adds a
  `render` subcommand to the package's `declaration` command, writing
  `/app/declaration/declaration.{html,pdf,txt}`" (its "The seams slices 3 and 4 take").
- **How the box finds a folder of its own files.** The guides are found by
  `guideRoot()` = `new URL("./guide/", import.meta.url)` (`apps/server/src/guide-catalogue.ts:27-29`),
  and the image puts them beside the bundles: `deploy/Dockerfile:230` copies `dist/guide/` to
  `/app/guide/`, and `:231-240` puts `server.js` and `node-entry.js` in `/app/`. So
  `new URL("./declaration/", import.meta.url)` is `/app/declaration/` in both bundles, with no
  setting and no `loadConfig` — which matters, because the recovery entry never runs `loadConfig`
  (`apps/server/src/recovery-listener.ts:182-183`).
- **On a development box, in tests, and on every image until slice 4,** that resolves to a folder
  that does not exist (`apps/server/src/declaration/` under `tsx`; `/app/declaration/` in today's
  image).

**What slice 3 does when the folder is absent: says so, and shows nothing else.** It never renders
a declaration on the fly from the template. Reasons, from the code: the template carries two
release-blocker lines (`packages/fiscal-verifactu/declarations/template.md:1-2`), the producer's
three facts are slots filled only from settings (`src/declaration/source.ts`, `PRODUCER_SLOTS`), and
typing `yes` at `pnpm release prepare` *is* the producer signing (`docs/operations/release.md`,
step 4). A page rendered by the box would be an unsigned draft shown as the version's declaration.
And `apps/server` may not import `@waitron/fiscal-verifactu` (`packages/composition/src/modules.ts:133-139`,
guarded by `scripts/module-seams.test.ts`).

## Decisions made in this plan

§12 of the design leaves nothing named for slice 3; these are the points §6 and §7.2 leave open.

1. **The folder's contract, which slice 4 must fill.** `/app/declaration/` holds four files:
   `declaration.html` (exactly `renderDeclaration(...).html`), `declaration.pdf`, `declaration.txt`,
   and `release.json` = `{ "version": "1.0.0", "releasedOn": "2026-12-03" }`. Reason: the About
   window shows "the date it was released" (§6.1), and nothing on a box knows a release's date or
   number today; one folder holding every release fact means a build either has all of it or none.
   **`release.json` is not a second source.** Slice 4 writes it in the same render run, from the
   same `v<version>.md`, as the three other files: `version` is the version rendered, and
   `releasedOn` is the declaration's own date — the `YYYY-MM-DD` Madrid day of signing that fills
   ‹fecha› (`packages/fiscal-verifactu/src/declaration/source.ts:11-12`, `:40`; `docs/operations/release.md:92`).
   Slice 4 owes a test that pins both. So "released" on the About window means the day the
   producer signed that version's declaration.
2. **Three states, never a partial one.** The folder absent (`stat` answers `ENOENT`) → "no
   declaration" (404). Anything else wrong → "damaged" (500, logged
   `declaration.folder_damaged { file }`, worded differently, because saying "this build is not a
   release" there would be false): the folder cannot be read or is not a directory (`file: "."`);
   any of the four files missing or unreadable; `release.json` not matching
   `{ version: /^\d+\.\d+\.\d+$/, releasedOn: a real YYYY-MM-DD date }`; `declaration.html` not in
   the renderer's shape; or `declaration.txt` not containing `release.version` (item 1.c) holds it),
   which catches a `release.json` from another render. Otherwise → the release. Files are read on
   each request, as the guides are; nothing is cached. The none and damaged pages follow the
   browser's `Accept-Language`, not the language chosen in the till or the dashboard: the server
   cannot see that choice, as the recovery page cannot.
3. **The server shows the declaration inside the box's own page look.** The renderer's HTML has no
   style at all (`render.ts:139-149`: a bare `<html lang="es">` document). Framed in a dark-theme
   till it would be a white panel in the browser's serif font. So the route takes the text between
   the renderer's `<body>` and `</body>` lines and serves it in the guide pages' frame (same
   tokens, theme script, policy and `frame-ancestors 'self'`). The file itself stays as rendered, for
   slice 4's GitHub Release copy. A test pins this against slice 2's real renderer.
4. **A fourth address, `/legal/about`** (the design names three). JSON
   `{ release: { version, releasedOn } | null, build }`, with `build` the same value the server
   already sends on every answer as `x-waitron-build` (`boot.ts:1281`, `:1309`). The titles
   "About Waitron · 1.0.0" (§6.2) and "Waitron 1.0.0 · Declaración responsable" (§6.1) need the
   version as data.
5. **The page's own links download rather than navigate.** Under the declaration the page offers
   "Descargar PDF" and "Descargar texto", each with `download="waitron-<version>-declaration.<ext>"`
   (§7.1's file names). A link that navigated would strand a till's sheet or a kiosk with no back
   button. So the dashboard's window does not repeat the links: they are in the framed page, on
   every terminal.
6. **The dashboard's About is a window (`wt-modal`), not a routed screen.** The signed-out
   sign-in foot must open "the same page" (§6.1), and a dashboard screen needs a session.
7. **On the handheld menu, About Waitron sits just above Log out, not "very last".** The design
   (§6.3) was written when Log out lived in the operator menu on wider handhelds; today More always
   ends with Log out and then "Powered by" (`till-shell.ts:1241-1245`). Just above Log out is the same
   place at every width, and the counter till's placement (§6.2).
8. **The kitchen corner uses the shell's sheet; the PIN and pairing screens get a small widget
   with a sheet of its own** (§6.4: "they get their own copy of the sheet"). Reason for the first:
   the shell's two-minute help idle (`till-shell.ts:96-101`) then closes it too. **Kiosks get the
   ⓘ as well:** the shell draws that corner whenever it has no bar — a kiosk or a kitchen screen
   (`till-shell.ts:993-999`) — and a kiosk can invoice, so it is a terminal the design's duty
   covers.
9. **The setup wizard's ⓘ opens a sheet, not a new tab.** A setup wizard on a box's own screen has
   no tab bar to come back by — the reason the till uses a sheet (conventions-ui.md, "How the till
   links a guide").
10. **One new guide page, `about`, with one section `{#declaration}`,** in English and Spanish. No
    existing page fits (the list is `apps/server/src/guide-catalogue.ts:5-24`). It says where the
    declaration is on each terminal and to download the PDF when an inspector or the gestor asks —
    the only thing it changes in what staff do.
11. **The cloud staff entrance lists `/legal/` reads** beside `/help/` (`cloud-remote.ts:136-143`):
    it is a separate front with its own allowlist, so without the line a remote dashboard's About
    window would frame a 404. **The time-zone repair gate is left alone:** the routes are registered
    at `boot.ts:1345`, before the gate at `:2191`, so the gate never sees them, and a line there
    would be one no request reaches. A real-boot case in repair mode (Task 2) proves they answer.
12. **No image-smoke step in slice 3.** The image has no folder until slice 4; slice 4 adds a
    smoke step that fetches `/legal/declaration` from the image.
13. **No shared "framed page" component.** The till's sheet, the dashboard's window and the setup
    sheet each wrap `wt-modal size="full"` round a frame, but what they add differs: the till's
    relays touches for idle sign-out and registers with the till's dialog tracking
    (`guide-sheet.ts:62-82`, `trackDialog` at `:91`), the dashboard's carries the version, licence and note
    lines, the setup one is bare. The common part is about 25 lines of layout. Moving it into
    `packages/ui` would make it a `wt-*` primitive, with its token-painting and axe tests and
    `ui`'s mutation floor, and would rewrite a tested till widget — more code and risk than the
    duplication it removes.
14. **About from More or a corner opens at once,** headed "About Waitron", and the heading gains
    the version when `readLegalAbout()` answers; a failed read leaves it as is.
15. **A development copy of the folder** is written by
    `pnpm --filter @waitron/server exec tsx -e 'await (await import("./src/testing/declaration-folder.ts")).writeDeclarationFolder("src/declaration")'`
    (Task 1 runs it once to confirm it works, and fixes the command here if it does not), and
    `apps/server/src/declaration/` goes in `.gitignore` so a copy is never committed.

## Questions for the owner

None.

## Design citations checked on main `1d078d438b`

Moved, or no longer holding:

- §3 `/help/…` "mounted ahead of every mode's gates (`apps/server/src/boot.ts:984-1003`)" — now
  `mountGuidePages(app, {}, log)` at `boot.ts:1345`, its comment at `:1325`.
- §3 `.github/workflows/ci.yml:37` (`v*` trigger) and `:2772` (version tag) — now `:29` and the
  `refs/tags/v*)` branch at `:4405`. Slice 4's concern.
- §5.3 the composition rule at `packages/composition/src/modules.ts:121-127` — now `:133-139`.
- §5.5 `deploy/waitron.sh:324-353` (install pulls only for `main`) — now `:401-410`. Slice 4's.
- §6.2 `apps/till/src/widgets/guide-sheet.ts:89` (fixed title) — **holds**.
- §6.3 `till-app.ts:17244-17253` (`find-bill` always added) — now `#affordances()` at
  `till-app.ts:20681-20689`. `till-shell.ts:501`, `:495`, `:868` — now the handheld More
  `#menu` at `:1193-1246`, `#nameInMore()` at `:608`, the session group at `:1454`. **No longer
  holds:** "On a tablet or wide handheld Log out sits in the operator menu" — the handheld More
  always draws Log out (`:1241-1243`). Decision 7.
- §6.4 `till-shell.ts:990-993` (kitchen corner) — now `:1434-1438`, drawn only when the shell is
  barless, a kiosk or a kitchen screen (`:993-999`). `till-app.ts:18226-18232` (chooser and
  pairing) — now `:21868-21874`; `:18377` (lock screen) — now `:22046`. The chooser is the
  development-only device picker and gets no ⓘ.
- §6.5 `apps/setup/src/setup-app.ts:2064-2074` (header) — now `:2273-2287`.
- §7.2 `apps/server/src/landing-app.ts` — holds, with one addition the design does not mention:
  `buildLandingApp` has a second shape, the connection-repair page, which returns early
  (`landing-app.ts:27-30`) and is drawn by `renderConnectionPage`
  (`apps/server/src/connection-bootstrap-page.ts:62`, reached from `trust-page.ts:77`). PR 1 mounts
  before that branch and puts the foot link on both pages.
- Outside the design: `docs/developers/conventions-ui.md`, "Which boots serve it", cites
  `boot.ts:948` for `mountGuidePages`; it is now `:1345`. PR 1 corrects it while it adds the
  declaration's section beside it.

## Global constraints

- `apps/server` imports nothing from `@waitron/fiscal-verifactu` outside `*.test.ts` and
  `src/testing/` (`scripts/module-seams.test.ts`).
- Spanish words only in translation homes: `apps/server/src/i18n/`, each app's `strings.ts` or
  `i18n/` files, `apps/server/src/guide/es/` (`isHome`, `packages/db/src/english-only.ts:22-33`).
  The legal name «Declaración responsable» is Spanish in every language (§6.6); it lives in those
  files too. **Every other new or changed file holds no accented letter at all** —
  `scripts/english-only.test.ts:739-760` runs `findAccented` (`packages/db/src/english-only.ts:228`)
  over every scanned file, tests included. So a test never types an expected Spanish string: it
  takes it from the renderer's output, the files `writeDeclarationFolder` wrote, or the words
  module it tests. A producer value with markup is ASCII (`Smith & Sons <Ltd>`). The English guide
  writes the legal name in guillemets, «declaración responsable». Measured 2026-11-11 by calling
  `findAccented` through `tsx` on single lines: `## Show the «declaración responsable» {#declaration}`
  gave 0 findings, the same line without guillemets 1, `const h = "<h1>DECLARACIÓN</h1>";` 1, and
  `name: "Smith & Sons <Ltd>"` 0. Task 10 still runs the whole guard over the real file.
- The declaration is Spanish only, in every interface language (§6.6). Its page is
  `<html lang="es">`.
- Every colour, spacing, radius and font reads a `--wt-*` token. Server pages read the copies in
  `GUIDE_PAGE_TOKENS` (`guide-pages.ts`), which `scripts/guide-page-tokens.test.ts` checks.
- No new `wt-*` primitive. Front ends use `wt-modal`, `wt-button` and `till-guide-sheet`.
- Product text as short as the meaning allows. The fixed English words, used verbatim:
  - menu entry: "About Waitron" / «Acerca de Waitron»;
  - the English note (§6.6): "Waitron's statement of compliance with Spain's invoicing-software
    rules, in Spanish as the law requires." Shown only when the interface language is not Spanish.
- Server words (in `apps/server/src/i18n/declaration-page.ts`, English then Spanish):
  - none: "This build has no declaración responsable" / «Esta compilación no tiene declaración
    responsable»; "Only a released version of Waitron carries one, and this build is not a
    release." / «Solo las versiones publicadas de Waitron llevan una, y esta compilación no lo es.»
  - damaged: "This box's declaración responsable cannot be shown" / «La declaración responsable de
    este equipo no se puede mostrar»; "One of its files is missing or damaged." / «Falta uno de sus
    archivos o está dañado.»
  - not found: "Page not found" / «Página no encontrada».
  - link labels, Spanish only, under the declaration: «Descargar PDF», «Descargar texto»; at the
    foot of the plain-HTTP and recovery pages: «Declaración responsable».
- Coverage `98/98/98/95` in every package; real reading code is covered by a test that runs it.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1).
- Mock-ups and screenshots are never committed; show them to the owner directly.

## Review focus

1. **A folder that is half there** — `release.json` present but the PDF missing, or `release.json`
   naming `1.2` — must answer the damaged page, never the declaration and never "not a release";
   `/legal/about` says `release: null`. Task 1.
2. **Addresses near the real ones** — `/legal`, `/legal/`, `/legal/declaration/`,
   `/legal/declaration.PDF`, `/legal/declaration.html` — answer the box's own 404 page, not
   whatever a front end's catch-all would give (in Task 1 a stand-in catch-all answering 200; on a
   real trading box the till's catch-all answers an empty 404, `boot.test.ts:2266-2267`, so Task 2
   tells them apart by the page's words). Task 1, and Task 2.
3. **A dashboard reached through Waitron Cloud's staff entrance** frames `/legal/declaration`; the
   entrance must pass it, and still refuse a POST to it. Task 2.
4. **A producer value holding markup** (`Smith & Sons <Ltd>`) stays escaped after the server lifts
   the body out of the renderer's page. Task 1.
5. **The till's sheet opened from More on a till left idle** still counts touches inside the
   framed page as activity, so idle sign-out works (§6.2), and Close returns focus to More's
   button. Task 8a.

## Root guards and sweeps: which apply

Read for this plan; each PR runs the ones that touch it.

- **Apply:** `scripts/dev-proxy-config.test.ts` (PR 1: pins each app's proxied prefixes);
  `scripts/guide-page-tokens.test.ts` (PR 1, if the shared page look changes); `scripts/english-only.test.ts`
  (every PR); `scripts/module-seams.test.ts` (PR 1); `apps/server/src/guide-content.test.ts` and
  `scripts/guide-links.test.ts` (PR 4); `scripts/native-form-fields.test.ts` and
  `packages/ui/src/no-hardcoded-chrome.test.ts` / `scripts/style-token-names.test.ts` (PRs 2-4);
  `scripts/primary-coloured-text.test.ts` (any `color:` declaration a PR adds); the recovery page's
  own `apps/server/src/recovery-surface.test.ts` and `apps/server/src/i18n/recovery-page.test.ts`
  (PR 1, the foot link).
- **Do not apply, and why:** the management-origin sweep
  (`apps/server/src/boot.management-origin.test.ts:265-305`) walks write routes only — all four
  addresses are GETs; the till's person-header walk (`apps/server/src/till-api.session-person.test.ts`)
  covers the till, device and schedule mounts only; `scripts/help-tooltip-mode.test.ts` — no
  `wt-help-tooltip` is added (if an implementer adds one outside setup, it needs `mode="help-mode"`);
  `scripts/live-subscriptions.test.ts` — no live subscription.

---

## Pull request 1 — the four addresses on every listener

First line of its description: "Serves the declaración responsable at /legal/declaration on every
listener (A940 slice 3, part 1 of 4); every box says it has none until slice 4."

### Task 1: The folder reader and the four routes

**Files:**
- Create: `apps/server/src/declaration-pages.ts`, `apps/server/src/declaration-pages.test.ts`
- Create: `apps/server/src/i18n/declaration-page.ts`
- Create: `apps/server/src/testing/declaration-folder.ts` (test helper; outside coverage,
  `apps/server/vitest.config.ts:49`)
- Create: `packages/shared/src/legal-about.ts`; modify `packages/shared/src/index.ts` (export)
- Modify: `apps/server/src/guide-pages.ts` (export the page frame)
- Modify: `.gitignore` — add `apps/server/src/declaration/` (decision 15)

**Interfaces:**
- Produces, in `packages/shared/src/legal-about.ts`:
  `export interface LegalAbout { release: { version: string; releasedOn: string } | null; build: string }`
- Produces, in `apps/server/src/guide-pages.ts`: `renderBoxPage(lang: "en" | "es", title: string, body: string): string`
  and `boxPageAnswer(c: Context, html: string, status: 200 | 404 | 500): Response` — today's
  private `page()` (`:104-120`) and `answer()` (`:122-124`) renamed and exported; the guide routes
  call them unchanged.
- Produces, in `apps/server/src/declaration-pages.ts`:
  - `declarationRoot(): string` — `fileURLToPath(new URL("./declaration/", import.meta.url))`.
  - `type DeclarationFolder = { kind: "release"; version: string; releasedOn: string; body: string } | { kind: "none" } | { kind: "damaged"; file: string }`
  - `readDeclarationFolder(root: string): Promise<DeclarationFolder>` — `none` only when `stat(root)`
    fails with `ENOENT`; `damaged` with `file: "."` when `stat(root)` fails otherwise or `root` is
    not a directory; otherwise `damaged` names the first bad file in the order `release.json`,
    `declaration.html`, `declaration.pdf`, `declaration.txt` (the last also when it lacks
    `release.version`).
  - `mountDeclarationPages(app: Hono, deps: { root?: string; build?: string }, log: Logger): void`
    — `build` defaults to `applicationVersion(process.env)` (`@waitron/db`).
- Produces, in `apps/server/src/testing/declaration-folder.ts`:
  `writeDeclarationFolder(dir: string, release?: { version: string; releasedOn: string }): Promise<void>`
  — renders with slice 2's real code: `declarationSource` and `testProducer` from
  `@waitron/fiscal-verifactu/test/declaration.js` (version `1.2.3`), `renderDeclaration` from
  `@waitron/fiscal-verifactu/src/declaration/render.js`, `renderDeclarationPdf` from
  `…/src/declaration/pdf.js`. Default release `{ version: "1.2.3", releasedOn: "2026-10-22" }`.
  Also accepts an optional producer override for Review focus 4.

- [ ] **Step 1: Write the failing tests** in `declaration-pages.test.ts`, each mounting on a bare
  `new Hono()` with `root` a `mkdtemp` folder and `build: "test-build"`. No expected Spanish is
  typed into the test (Global constraints): it is read from the files the helper wrote, or imported
  from `i18n/declaration-page.ts`.
  - `serves a release's declaration in the box page look, in Spanish`: 200,
    `content-type` contains `text/html`; body contains `<html lang="es">`, `PRODUCER PERSON`,
    `href="/legal/declaration.pdf" download="waitron-1.2.3-declaration.pdf"` and the `.txt` twin;
    the `content-security-policy` header equals the guide pages' (compare with a `/help/en/products`
    answer from `mountGuidePages` on the same app) and so contains `frame-ancestors 'self'`.
  - `the page holds the legal text whole`: read `declaration.html` from the folder, take the text
    between `"<body>\n"` and `"\n</body>"` (`render.ts:139-149`), and expect the page to contain it
    verbatim; then, for every non-empty line of `declaration.txt` (a leading `- ` stripped), expect
    the page with its HTML entities decoded and tags removed to contain that line. **Deletion
    proof:** make the extraction drop the body's last line — this case must fail.
  - `serves the PDF and the text exactly as written`: bytes equal the files;
    `content-type` `application/pdf` and `text/plain; charset=utf-8`;
    `content-disposition` `inline; filename="waitron-1.2.3-declaration.pdf"` (and `.txt`).
  - `/legal/about names the release and the build`: `toEqual({ release: { version: "1.2.3", releasedOn: "2026-10-22" }, build: "test-build" })`.
  - `with no folder, the three addresses say this build has none, and nothing is logged`: each
    404, body holds the English none title from `i18n/declaration-page.ts`, and with
    `Accept-Language: es` the Spanish one; `/legal/about` 200 with `release: null`; the log spy
    was never called.
  - `it.each(["release.json", "declaration.html", "declaration.pdf", "declaration.txt"])("a folder without %s is damaged")`:
    500 with the damaged title, `/legal/about` `release: null`, log called once with
    `("warn", "declaration.folder_damaged", { file })`.
  - `it.each(['{}', '{"version":"1.2","releasedOn":"2026-10-22"}', '{"version":"1.2.3","releasedOn":"2026-02-30"}', 'not json'])("release.json %s is damaged")`.
  - `a release.json naming another version is damaged`: `{ "version": "9.9.9", … }` beside a
    1.2.3 declaration → damaged, `file: "declaration.txt"`.
  - `a declaration.html not in the renderer's shape is damaged`: write `<p>x</p>` → damaged,
    `file: "declaration.html"`.
  - `a folder that is a file, or cannot be read, is damaged`: `root` a plain file → damaged,
    `file: "."`; and (skipped when the test runs as root) a folder with mode `000` → damaged,
    `file: "."` or the first file, whichever the reader meets — the case asserts 500 and one log.
  - `it.each(["/legal", "/legal/", "/legal/declaration/", "/legal/declaration.PDF", "/legal/declaration.html", "/legal/x/y"])("answers its own 404 at %s")`:
    with `app.get("*", (c) => c.text("spa", 200))` mounted after, the answer is 404 and not `spa`.
  - `a producer value with markup stays escaped`: folder rendered with producer name
    `Smith & Sons <Ltd>` → page contains `Smith &amp; Sons &lt;Ltd&gt;` and not `<Ltd>`.
  - `finds its folder beside the module`: `declarationRoot()` equals
    `fileURLToPath(new URL("./declaration/", import.meta.url))`.

- [ ] **Step 2: Run them and watch them fail**

  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts src/guide-pages.test.ts`
  — expected: FAIL, `declaration-pages.js` does not exist. Read the `Tests` count, not the exit status.

- [ ] **Step 3: Implement.** Body extraction: exactly one `"<body>\n"` and one `"\n</body>"`, in
  that order (the renderer joins its lines with `\n`, `render.ts:139-149`); anything else is
  damaged. The page body is the extracted text followed by
  `<p><a href=… download=…>Descargar PDF</a> · <a …>Descargar texto</a></p>`. The none, damaged and
  not-found pages choose English or Spanish with `resolveLoginLocale(Accept-Language, "en-GB")`, as
  the recovery page does (`recovery-surface.ts`, `app.get("/")`), and send `Vary: Accept-Language`.
  The PDF and text answers carry `Cache-Control: no-cache`.

- [ ] **Step 4: Run them, then prove three by deletion.** Same command — PASS. Delete the shape
  check: the "not in the renderer's shape" case fails because it is served. Make `none` cover every
  `ENOENT` (any missing file): the "without declaration.pdf" case fails. Delete the version check:
  the "another version" case fails. Restore all three. Then run decision 15's command once, check
  it writes four files into `apps/server/src/declaration/`, that `git status` does not list them,
  and delete them; fix the command in this plan if it fails.

- [ ] **Step 5: Commit** — `git commit -s -m "Read the declaration's folder and answer its four addresses (A940 slice 3)"`.

### Task 2: Mount them in the main app and on a waiting start; let the gates pass them

**Files:**
- Modify: `apps/server/src/boot.ts:1345` (call `mountDeclarationPages(app, { build }, log)` right
  after `mountGuidePages`; `build` is `:1281`'s)
- Modify: `apps/server/src/waiting-start.ts:105` (mount on the waiting app right after
  `app.use("*", deps.pageCheck)`, as the main app mounts it after its own handover gate,
  `boot.ts:1287` before `:1345`)
- Modify: `apps/server/src/cloud-remote.ts:136-143` (`path.startsWith("/legal/")` among the reads,
  beside `/help/`). **Not** `zone-repair-serving.ts` (decision 11).
- Modify: `apps/dashboard/vite.config.ts:16-21`, `apps/till/vite.config.ts:37-43`,
  `apps/setup/vite.config.ts:17-20` (`"/legal": devServerProxy()`)
- Test: `apps/server/src/boot.test.ts`, `apps/server/src/boot.mirror.test.ts`,
  `apps/server/src/boot.restricted.test.ts`, `apps/server/src/boot.zone-admission.test.ts`,
  `apps/server/src/waiting-start.test.ts`, `apps/server/src/cloud-remote.test.ts`,
  `scripts/dev-proxy-config.test.ts`

**Interfaces:** consumes `mountDeclarationPages` (Task 1).

**Review:** this task gets a per-task reviewer although the path is LIGHT, because it widens the
Cloud staff entrance's allowlist.

- [ ] **Step 1: Write the failing tests.** Every "none page" below is recognised by the English
  none title imported from `i18n/declaration-page.ts`.
  - `boot.test.ts`, the setup-mode case beside `:2210`: `/legal/declaration` is 404 with the none
    page; `/legal/about` answers `release: null`.
  - `boot.test.ts`, the built-apps case beside `:2268`: `/legal/declaration` with
    `Accept: text/html` answers the none page. The till's catch-all also answers 404 there, with an
    empty body (`:2266-2267`), so the case asserts the page's words, not the status.
  - `boot.mirror.test.ts` beside `:763`: a spare answers the none page.
  - `boot.restricted.test.ts`, beside its `/api/node` read (`:223`): a box restricted after a
    handover (`startRestricted` is handed the main `app`, `boot.ts:1812`) answers the none page.
  - `boot.zone-admission.test.ts`, in the case that reads the explanation in repair mode (`:378`):
    `/legal/declaration` answers the none page. This, not a gate entry, is what proves repair mode
    serves it.
  - `waiting-start.test.ts`: `serves the declaration while it waits` — the waiting app's
    `/legal/declaration` is the none page.
  - `cloud-remote.test.ts`: add `/legal/declaration` and `/legal/about` to the GET-200 list
    (`:151-161`); a POST to `/legal/declaration` is 404.
  - `scripts/dev-proxy-config.test.ts:21-25`: `"/legal"` in all three apps' expected routes.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.mirror.test.ts src/boot.restricted.test.ts src/boot.zone-admission.test.ts src/waiting-start.test.ts src/cloud-remote.test.ts`
  and `pnpm exec vitest run scripts/dev-proxy-config.test.ts` — FAIL on the new cases only.
- [ ] **Step 3: Implement** the lines listed under Files.
- [ ] **Step 4: Run both commands** — PASS. Then move the `boot.ts` call below the setup branch, which
  returns at `:1685` and closes at `:1697`: the setup-mode case must fail; put it back.
- [ ] **Step 5: Commit** — `git commit -s -m "Serve the declaration in every mode of the main app and through the staff entrance"`.

### Task 3: The plain-HTTP listener and the recovery listener, and their foot links

**Files:**
- Modify: `apps/server/src/landing-app.ts:25-31` (mount before the `deps.connection` branch, so both
  shapes serve it)
- Modify: `apps/server/src/recovery-listener.ts:126-127` (mount on `surface` before
  `if (bootstrap)`, so the connection-repair surface and the recovery app both serve it — every
  `serveRecovery` caller: `node-entry.ts:448`, `:472`, `:518`, `:546`, `:615`, `:829`, and
  `first-setup-launch.ts:66`)
- Modify: `apps/server/src/trust-page.ts:76-137` (a foot line after the last section:
  `<p class="note"><a href="/legal/declaration" lang="es">…</a></p>`, the label imported from
  `i18n/declaration-page.ts`, never typed here — this file is scanned for accented letters)
- Modify: `apps/server/src/connection-bootstrap-page.ts:62-185` (`renderConnectionPage`, the
  connection-repair form of the same page: the same foot line before `</main>` at `:185`)
- Modify: `apps/server/src/recovery-surface.ts:242-260` (the same line after the log tail)
- Test: `apps/server/src/landing-app.test.ts`, `apps/server/src/connection-bootstrap.entry.test.ts`,
  `apps/server/src/trust-page.test.ts`, `apps/server/src/connection-bootstrap-page.test.ts`,
  `apps/server/src/recovery-surface.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `landing-app.test.ts`: `it.each(["trust page", "connection repair"])` — `buildLandingApp` with
    and without `connection` answers `/legal/declaration` with the none page over plain HTTP.
  - `trust-page.test.ts` and `connection-bootstrap-page.test.ts`: each rendered page contains
    `href="/legal/declaration"`.
  - `connection-bootstrap.entry.test.ts`: in the bootstrap-only case (`:134`) and the recovery-app
    case (`:325`), `GET /legal/declaration` on the HTTPS port answers the none page; the recovery
    page `/` contains `href="/legal/declaration"`.
  - `recovery-surface.test.ts`: the page links the declaration in English and Spanish.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/landing-app.test.ts src/trust-page.test.ts src/connection-bootstrap-page.test.ts src/connection-bootstrap.entry.test.ts src/recovery-surface.test.ts src/i18n/recovery-page.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Move the `recovery-listener.ts` mount into the `else` branch: the
  bootstrap case must fail; put it back.
- [ ] **Step 5: Look at it.** Write the trust page, the connection-repair page and the recovery page to files from a test run
  and open them with the workspace's Playwright Chromium, light and dark, 1280 px and 375 px wide
  (CLAUDE.md §4, string-rendered pages); the foot line must not crowd the "Continue" button or the
  log. Open the declaration page from `writeDeclarationFolder` the same way. Keep the screenshots
  out of the repository.
- [ ] **Step 6: Commit** — `git commit -s -m "Serve and link the declaration on the plain-HTTP and recovery listeners"`.

### Task 4: The runbook, the UI conventions, the design's pointer

**Files:**
- Modify: `docs/operations/release.md` § "5. Land the pull request" (`:112-114`)
- Modify: `docs/developers/conventions-ui.md` — a new `## The declaration pages` after "The user
  guides" (ends `:406`); correct `boot.ts:948` to `:1345` in "Which boots serve it" (`:348`)
- Modify: `docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md` — one dated
  pointer under the slice 2 pointer (`:14`)

- [ ] **Step 1: Replace §5's one sentence** with: the release pull request that `pnpm release
  prepare` opens goes through `/finish-branch` like any branch — on the light path when it touches
  no risk trigger — and lands only after that, not on green CI alone. Say why in one sentence: the
  run-it review seat runs on every branch (the owner's standing rule), a generated declaration file
  is no exception, and the declaration is the legal artefact. Name the watcher's decision of
  2026-11-11 15:53 as the source.
- [ ] **Step 2: Write the conventions section**, short: the four addresses; the folder and its four
  files (decision 1); the three states (decision 2); the body lifted into the guide page frame and
  the test that pins it (decision 3); every surface that serves it (Tasks 2-3), and that
  `/help/…` is still not served on the landing and recovery listeners.
- [ ] **Step 3: Add the design pointer,** dated the day PR 1 lands (written as `<date>` here):
  "**<date>, A940 slice 3:** the [slice 3 plan](../plans/2026-11-11-a940-3-in-app-declaration.md)'s
  departures replace parts of §6 and §7: a fourth address, `/legal/about`, and a fourth file,
  `release.json`; three states for the box's folder; the download links inside the Spanish page,
  in Spanish, rather than on the dashboard's About page; the dashboard's About as a window; About
  Waitron just above Log out on the handheld (§6.3); the corner ⓘ on kiosks as well as kitchen
  screens, and a small widget with its own sheet on the PIN and pairing screens (§6.4); and a sheet
  for the setup wizard's ⓘ (§6.5)."
- [ ] **Step 4:** `pnpm exec prettier --file-info docs/operations/release.md` prints
  `"ignored": true` (docs is ignored); read the three changes once more for claims without receipts.
- [ ] **Step 5: Commit** — `git commit -s -m "Release runbook: the release pull request goes through finish-branch; document the declaration pages"`.

---

## Pull request 2 — the dashboard

First line: "Adds About Waitron to the dashboard's account menu and sign-in screen (A940 slice 3,
part 2 of 4)."

### Task 5: The client read and the About window

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`getLegalAbout()`, beside `getLocales()` at `:2542`)
- Modify: `apps/dashboard/src/api/client-routes.test.ts`
- Modify: `packages/diagnostics/src/path-patterns.ts` (add `"/legal/about"`)
- Create: `apps/dashboard/src/screens/about-dialog.ts`, `about-dialog.test.ts`, `about-dialog.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (English block and Spanish block)

**Interfaces:**
- Consumes: `LegalAbout` from `@waitron/shared`.
- Produces: `DashboardApi.getLegalAbout(): Promise<LegalAbout>` — a passive GET of `/legal/about`
  (`{ passive: true }`, as `getVenueZoneRepair` does at `:3394-3401`).
- Produces: `<dashboard-about-dialog>` with `@property({ type: Boolean }) open`,
  `@property({ attribute: false }) about: LegalAbout | null`; dispatches `about-close` (bubbling,
  composed) when its `wt-modal` closes.
- Strings: `about.title` "About Waitron" / «Acerca de Waitron»; `about.version`
  "Version {version}, released {date}" / «Versión {version}, publicada el {date}»; `about.build`
  "Test build {build}" / «Compilación de prueba {build}»; `about.licence`
  "Licence: Elastic License 2.0, with additional permissions" / «Licencia: Elastic License 2.0, con
  permisos adicionales» (`LICENSE:1`, `LICENSE-GRANTS.md:3`); `about.declaration_note` (English
  only, the fixed note above); `about.close` "Close" / «Cerrar»; `about.foot` "Waitron {version} ·
  Declaración responsable" (both languages).

- [ ] **Step 1: Write the failing tests.** Expected words come from the strings table (`t(...)`,
  filled), never typed Spanish (Global constraints).
  - `client-routes.test.ts`: `reads /legal/about passively` — one call to `/legal/about`, `GET`,
    header `x-waitron-live: 1`.
  - `about-dialog.test.ts`:
    - `shows the version and its date, the licence, and frames the box's declaration`: with
      `about = { release: { version: "1.2.3", releasedOn: "2026-10-22" }, build: "b" }`, in `en-GB`
      the text holds "Version 1.2.3, released 22 October 2026" (Node 26.13.0's
      `Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" })` printed
      `22 October 2026`; in `es`, `22 de octubre de 2026`); one `iframe` whose `src` is
      `/legal/declaration`.
    - `says it is a test build when the box has no release`: `release: null`, build `abc123` →
      "Test build abc123", still one frame.
    - `adds the English note only when the language is not Spanish`: present in `en-GB`, absent in
      `es`.
    - `close dispatches about-close`.
  - `about-dialog.a11y.test.ts`: axe over the open window in light and dark, release and no release.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/screens/about-dialog.test.ts src/screens/about-dialog.a11y.test.ts`
  — FAIL. Browser tests run real Chromium: check `memory_pressure | grep free` first and run only
  above 15% free.
- [ ] **Step 3: Implement** `wt-modal size="full"` laid out as `till-guide-sheet` is
  (`apps/till/src/widgets/guide-sheet.ts:21-41`: heading and lines, then a frame that takes the
  rest), named with `aria-label`, a footer Close `wt-button`. Dates with
  `Intl.DateTimeFormat(currentLocale(), { dateStyle: "long", timeZone: "UTC" })`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Dashboard: the About Waitron window"`.

### Task 6: The account menu entry and the sign-in foot line

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` — the account menu (`:2210-2247`): a ghost,
  start-aligned `wt-button` `data-test="about"` between the language chooser (`:2234-2240`) and Log
  out (`:2241-2247`); the sign-in page (`:1859-1876`): after `this.#poweredBy()`, a ghost
  `wt-button` `data-test="about-foot"` reading `about.foot` when a release is known and
  `about.title` otherwise; one `<dashboard-about-dialog>` rendered from `render()`.
- Modify: `docs/developers/design-system.md:3869-3870` ("Dashboard banner": the account menu's
  list "Account settings, Theme, Language and Log out" gains About Waitron before Log out, and one
  sentence on the sign-in screen's foot line)
- Test: `apps/dashboard/src/dashboard-app.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `the account menu offers About Waitron between Language and Log out`: the menu's children, in
    order, end `[…, "language-chooser", "about", "logout"]`.
  - `About Waitron opens the window with what /legal/about answered`: click → the dialog is open and
    its `about` equals the stubbed answer.
  - `the sign-in screen's foot names the release and opens the same window`: stub
    `{ release: { version: "1.2.3", … } }` → the foot's text equals `about.foot` filled with
    `1.2.3`; click opens the dialog. With `release: null` the foot reads `t("about.title")`.
  - `a failed /legal/about read still offers the foot`: the stub rejects → the foot reads "About
    Waitron" and opens the window with `about: null`.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "About"` — FAIL.
- [ ] **Step 3: Implement.** The sign-in page reads `/legal/about` once per mount of the login
  page; the menu reads it on open when it has no answer yet.
- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/screens/about-dialog.test.ts`
  — PASS.
- [ ] **Step 5: Look at it.** `wa-wt demo <worktree-name>`; open the account menu and the window,
  and the sign-in screen, in light and dark, at desktop width and 375 px. Also open the window over
  a real declaration: copy the folder `writeDeclarationFolder` writes into
  `apps/server/src/declaration/` of the worktree with decision 15's command (it is ignored by git;
  delete it afterwards).
- [ ] **Step 6: Update `design-system.md`** as listed under Files, from the code as built.
- [ ] **Step 7: Commit** — `git commit -s -m "Dashboard: About Waitron in the account menu and on the sign-in screen"`.

---

## Pull request 3 — the till

First line: "Adds About Waitron to the till's More menu and an ⓘ to its corners (A940 slice 3,
part 3 of 4)."

### Task 7: A heading for the sheet, and the version read

**Files:**
- Modify: `apps/till/src/widgets/guide-sheet.ts:89` (title from a property)
- Create: `apps/till/src/legal-about.ts`, `apps/till/src/legal-about.test.ts`
- Modify: `apps/till/src/i18n/strings.ts` (`about.title` "About Waitron" / «Acerca de Waitron»)
- Test: `apps/till/src/widgets/guide-sheet.test.ts`

**Interfaces:**
- Produces: `TillGuideSheet.heading: string` — `@property() heading = ""`; empty means the guide
  title, so every existing caller is unchanged.
- Produces: `readLegalAbout(fetchImpl: typeof fetch = fetch): Promise<LegalAbout | null>` — `null`
  on any failure; `aboutHeading(about: LegalAbout | null): string` — `"About Waitron · 1.2.3"` with
  a release, `"About Waitron"` without (in the till's current language).

- [ ] **Step 1: Write the failing tests.**
  - `guide-sheet.test.ts`: `a heading replaces the guide title in the heading, the frame's title and
    the modal's name` (the three places `:89` feeds); the existing cases stay as they are.
  - `legal-about.test.ts`: `reads /legal/about`; `answers null for a refused or unreadable answer`
    (status 500, invalid JSON, a network error); `aboutHeading` for both shapes, English and Spanish.
- [ ] **Step 2:** `pnpm --filter @waitron/till exec vitest run src/widgets/guide-sheet.test.ts src/legal-about.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Till: the guide sheet takes a heading; read the running release"`.

### Task 8a: The shell's menus and its corner

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts` — `#tillMenu()` (`:1255-1290`) and `#menu()`
  (`:1193-1246`): an `about` ghost `wt-button` just above Log out (`:1278`, `:1241`); the corner
  (`:1434-1438`): `<wt-button variant="ghost" aria-label=…><span aria-hidden="true">ⓘ</span></wt-button>`
  as `basket.ts:948-955` draws an ⓘ. All three open the shell's sheet at once with
  `href="/legal/declaration"` and `heading` `aboutHeading(null)`, then set the heading to
  `aboutHeading(about)` when `readLegalAbout()` answers (decision 14), unless the sheet has closed
  meanwhile. A `@state() guideHeading` is cleared with `guideHref` on close and on the help idle
  (`:96-101`, `:122-126`). Close returns focus to the button that opened it (More's trigger or the ⓘ).
- Modify: `docs/developers/design-system.md:5812-5815` (the counter till's More list) and
  `:5856-5860` (the handheld's More order), adding About Waitron before Log out, and the corner's ⓘ
  where that section describes the corner.
- Modify: `apps/server/src/guide/en/table-service.md:270-273` and its twin
  `apps/server/src/guide/es/table-service.md:284-289` (the list of what More holds: About Waitron
  before Log out). The English line writes nothing accented.
- Test: create `apps/till/src/widgets/till-shell.about.test.ts`

**Interfaces:** consumes Task 7's `heading`, `readLegalAbout`, `aboutHeading`.

- [ ] **Step 1: Write the failing tests** (`till-shell.about.test.ts`, with `fetch` stubbed to
  answer a release `1.2.3`; expected words from `aboutHeading` and `t(...)`, never typed Spanish):
  - `a counter till's More offers About Waitron just above Log out`: the menu's buttons end
    `["about", "logout"]`.
  - `a handheld's More offers it just above Log out, at phone and tablet width`.
  - `About Waitron opens the sheet at once, then heads it with the version`: before the stubbed
    read answers, sheet `href` is `/legal/declaration` and its heading `aboutHeading(null)`; after,
    `aboutHeading(release 1.2.3)`.
  - `a touch inside the framed page still counts as activity` (Review focus 5): as
    `guide-sheet.test.ts`'s relay case, with the sheet opened from More.
  - `closing returns focus to More's button`.
  - `a kiosk's and a kitchen screen's corner have the ⓘ, and two idle minutes close what it opened`.
- [ ] **Step 2:** `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.about.test.ts`
  — FAIL (check free memory first, as Task 5).
- [ ] **Step 3: Implement**, then update the two documents listed under Files from the code as built.
- [ ] **Step 4: Run** it, then the shell's neighbours that pin the menus and corners:
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/widgets/till-shell.handheld-bar.test.ts src/widgets/till-shell.kitchen-help.test.ts src/widgets/till-shell.menu-help.test.ts src/widgets/till-shell.powered-by.test.ts src/widgets/till-shell.a11y.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` — PASS.
- [ ] **Step 5: Look at it.** `wa-wt demo <worktree-name>`: a counter till, a handheld at 360×640
  and at tablet width, a kiosk and a kitchen screen — light and dark — with More open and the sheet
  open. At 360×640, Log out must still be reachable in More (by scrolling, as More does when it is
  taller than the room below), and the corner's ⓘ must not crowd the theme and language choosers.
- [ ] **Step 6: Commit** — `git commit -s -m "Till: About Waitron in More, and an ⓘ in the kiosk and kitchen corner"`.

### Task 8b: The PIN and pairing screens

**Files:**
- Create: `apps/till/src/widgets/about-button.ts` (`till-about-button`: the ⓘ plus its own
  `till-guide-sheet`, opening at once and heading it as Task 8a does), `about-button.test.ts`,
  `about-button.a11y.test.ts`
- Modify: `apps/till/src/screens/till-lock-screen.ts:338-344`,
  `apps/till/src/screens/till-enrol-screen.ts:190-196` (a `till-about-button` first in the corner)
- Test: add to `apps/till/src/screens/till-lock-screen.test.ts` and `till-enrol-screen.test.ts`

**Interfaces:** consumes Task 7's `heading`, `readLegalAbout`, `aboutHeading`. Produces
`<till-about-button>`, no properties.

- [ ] **Step 1: Write the failing tests.**
  - `about-button.test.ts`: `opens its own sheet on /legal/declaration, headed with the version`;
    `stays headed aboutHeading(null) when the read fails`; `Close and Escape return focus to the ⓘ`.
  - lock and enrol screens: `the corner has the ⓘ, first`.
  - `about-button.a11y.test.ts`: axe over the closed button and the open sheet, light and dark.
- [ ] **Step 2:** `pnpm --filter @waitron/till exec vitest run src/widgets/about-button.test.ts src/widgets/about-button.a11y.test.ts src/screens/till-lock-screen.test.ts src/screens/till-enrol-screen.test.ts`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-lock-screen.a11y.test.ts src/screens/till-enrol-screen.a11y.test.ts`
  — PASS.
- [ ] **Step 5: Look at it:** the PIN and pairing screens at 360×640 and tablet width, light and
  dark, closed and open.
- [ ] **Step 6: Commit** — `git commit -s -m "Till: an ⓘ on the PIN and pairing screens"`.

---

## Pull request 4 — the setup wizard, the guide, the backlog

First line: "Adds the setup wizard's ⓘ and the About Waitron guide page (A940 slice 3, part 4 of 4)."

### Task 9: The setup wizard's ⓘ

**Files:**
- Create: `apps/setup/src/about-sheet.ts` (`setup-about-sheet`: `wt-modal size="full"`, heading
  "About Waitron", a frame on `/legal/declaration`, Close; `open` property, `about-close` event),
  `about-sheet.test.ts`, `about-sheet.a11y.test.ts`
- Modify: `apps/setup/src/setup-app.ts:2276-2286` (an ⓘ `wt-button` first in `.header-controls`,
  drawn as Task 8a's)
- Modify: the setup app's strings (`apps/setup/src/i18n/strings/`, English and Spanish:
  `about.title`, `about.close`)
- Test: `apps/setup/src/setup-app.test.ts`, `apps/setup/src/setup-app.chooser-clearance.test.ts`

- [ ] **Step 1: Write the failing tests:** `the header's ⓘ opens the declaration in a sheet`
  (frame `src` `/legal/declaration`, the ⓘ's accessible name "About Waitron"); `Close and Escape
  close it and return focus to the ⓘ`; axe over the open sheet, light and dark.
- [ ] **Step 2:** `pnpm --filter @waitron/setup exec vitest run src/about-sheet.test.ts src/about-sheet.a11y.test.ts src/setup-app.test.ts src/setup-app.chooser-clearance.test.ts`
  — FAIL on the new cases.
- [ ] **Step 3: Implement.** No version in the setup sheet's heading: the setup wizard reads no
  release facts, and §6.5 asks only for the ⓘ.
- [ ] **Step 4: Run** — PASS, `chooser-clearance` included (the header's controls must still
  clear each other).
- [ ] **Step 5: Look at it** in `wa-wt onboarding <worktree-name>`, light and dark, desktop and
  375 px.
- [ ] **Step 6: Commit** — `git commit -s -m "Setup wizard: an ⓘ that opens the declaration"`.

### Task 10: The guide page

**Files:**
- Create: `apps/server/src/guide/en/about.md`, `apps/server/src/guide/es/about.md`
- Modify: `apps/server/src/guide-catalogue.ts:5-24` (`"about"` last), `apps/server/src/i18n/guide-pages.ts`
  (`names.about`: "About Waitron" / «Acerca de Waitron»)
- Test: `apps/server/src/guide-content.test.ts`

- [ ] **Step 1: Write the failing test:** `it.each(GUIDE_LANGUAGES)("the About Waitron guide in %s registers its section")`
  → sections `["declaration"]`, as the Box status case at `:74` is written.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` — FAIL.
- [ ] **Step 3: Write the page,** from the code PRs 2-4 built, not from this plan: `# About Waitron`,
  then `## Show the «declaración responsable» {#declaration}` (the legal name in guillemets
  wherever the English page uses it, Global constraints) — what it is in one sentence; where it
  is: the person menu's About Waitron on the dashboard (and the sign-in screen's foot), More on a
  till, the ⓘ on a kitchen screen, the PIN screen and the setup wizard; `/legal/declaration` on
  the box's address before setup or while it is stopped; download the PDF when an inspector or
  your gestor asks for it. Spanish twin with the same `{#declaration}` id. A sentence that changes
  nothing staff do is cut (CLAUDE.md §3).
- [ ] **Step 4: Run** the same and `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts` — PASS.
- [ ] **Step 5: Look at it:** `/help/en/about` and `/help/es/about` in light and dark, at 375 px.
- [ ] **Step 6: Commit** — `git commit -s -m "Guide: About Waitron, where to find the declaración responsable"`.

### Task 11: The backlog

**Files:** `docs/backlog.md:224-227`, `docs/backlog/fiscal.md:1304-1346` (A940's line and section).

- [ ] **Step 1:** In both, replace "Slices 3 to 6 remain" with: slice 3 landed (the four pull
  requests' numbers; this plan's link): every listener serves `/legal/declaration`, `.pdf`, `.txt`
  and `/legal/about`, and every terminal opens it; every box says it has none until slice 4. Slice
  4 must now also put the four files of decision 1 in `/app/declaration/`, all from one render run
  of the same `v<version>.md`, with `release.json`'s `version` the version rendered and its
  `releasedOn` the declaration's own date (the day of signing that fills ‹fecha›), pinned by a
  test of slice 4's; and add an image-smoke step that fetches `/legal/declaration`.
  Slices 4 to 6 remain. Delete nothing else; the entry stays open.
- [ ] **Step 2:** read the changed lines against what landed (CLAUDE.md §1: a claim needs a receipt).
- [ ] **Step 3: Commit** — `git commit -s -m "Backlog: A940 slice 3 landed; what slice 4 now owes"`.

---

## Size, per task (estimates)

| Task | Production lines | Test lines |
| ---- | ---------------- | ---------- |
| 1    | 105              | 200        |
| 2    | 15               | 70         |
| 3    | 25               | 70         |
| 4    | docs only        | —          |
| 5    | 100              | 120        |
| 6    | 40               | 90         |
| 7    | 35               | 70         |
| 8a   | 50               | 120        |
| 8b   | 40               | 80         |
| 9    | 55               | 70         |
| 10   | 5, plus two guide pages | 15  |
| 11   | docs only        | —          |
