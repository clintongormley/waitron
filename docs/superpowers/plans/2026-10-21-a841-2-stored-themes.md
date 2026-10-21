# A841 slice 2 — the stored themes and the server: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** Every task below touches a risk trigger (CLAUDE.md, global rules): a
migration (Tasks 3 and 10), a permission-gated route or its retirement (Tasks 4, 5, 8), or a
contract between packages — the theme document, `/api/theme`'s answer, the till's start read, the
configuration bundle (Tasks 1, 2, 6, 7, 9, 10). Implementers are dispatched as
`subagent_type: "implementer"`. An implementer that passes about 150 tool calls with its task
unfinished stops at a passing or cleanly failing point, commits, and hands over: done, left, files,
each check's state.

**Goal:** a venue can store several named custom themes, one of them in use; the server checks and
stores their choices, answers their worked-out colours and readability warnings, serves the theme
in use as a stylesheet at `GET /api/theme`, tells a signed-in till when it changes, and carries
the themes in a configuration copy. `tenant_themes` and everything that reads it are retired. No
screen changes.

**Architecture:** three pure pieces join `@waitron/ui-core/theme` beside slice 1's derivation — the
document check, the name rules and the three-block stylesheet — so slices 5 and 13 reuse them in
the browser. `@waitron/layouts` stores the rows (`custom_themes`, a new core table) and checks a
bundle's rows. `apps/server` reads Waitron's own token files from disk, derives, builds and caches
the answer, and mounts the routes. `@waitron/composition` adds the theme check to the core module's
import check.

**Tech stack:** TypeScript, drizzle-kit 0.31.11 on `node:sqlite`, Hono, Vitest 4.1.11 (node for
the server packages, real Chromium for `ui-core`), esbuild through `scripts/bundle-node.mjs`, Stryker
for `ui-core`.

**Spec:** `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` — section 16 item 2 (the
scope, lines 2500-2519), and what it rests on: section 7's sheet (lines 1345-1366), section 8b
(names, switching, deleting; lines 1761-1797), section 9's validity paragraph (lines 1951-1970),
section 10's warning shape (lines 2001-2018), section 11 (lines 2026-2156), section 12 (lines
2166-2185, 2224-2234), section 13 (lines 2246-2284), section 14 (lines 2320-2330) and section 15's
"Server" and "Custom themes" server cases (lines 2369-2382, 2444-2453).

**Slice 1:** `docs/superpowers/plans/2026-10-20-a841-1-theme-derivation.md`, "Left for slice 2"
(lines 967-993), and the code it landed in `packages/ui-core/src/theme/`.

Every `file:line` outside the design was read on 2026-10-21 in this worktree at `f2e97aef4`, unless
it names a command that was run. Probes ran in `~/waitron-campaign/a841-plan2/probes/` (a
throwaway worktree there, since removed); their outputs are the `output-*.txt` files in that folder.

**Ledger:** `docs/handoffs/2026-10-21-a841-2-stored-themes.md` (gitignored), updated at the end of
every task.

---

## Decisions this plan makes (the design left them open)

**D1. How the server reads Waitron's token files: from disk, through `@waitron/ui-core`'s own
exports, at module load.** `apps/server/src/theme-defaults.ts` reads
`import.meta.resolve("@waitron/ui-core/tokens/colors.css")` (and `structure.css`) with
`readFileSync` and passes the text to `readDefaults` (`packages/ui-core/src/theme/defaults.ts:36`).
The two `exports` entries exist today (`packages/ui-core/package.json:45-46`). The server build
copies `packages/ui-core/package.json` and the two files into
`apps/server/dist/node_modules/@waitron/ui-core/`, where Node's resolution from `dist/server.js`
finds them, and the box image copies that folder to `/app/node_modules/@waitron/`, beside sharp
(`deploy/Dockerfile:218`). Reading at module load means every boot — the setup box image-smoke
starts, bundle-smoke's in-place run and its copied-out run (`.github/workflows/ci.yml:570,622`) —
fails at start if the files are missing, rather than at the first `/api/theme`.

Measured 2026-10-21 (Node v26.11.1, tsx in `apps/server/node_modules/.bin`, Vitest 4.1.11,
esbuild 0.28.2), with `probe-theme.ts` and `probe-vitest.test.ts` in the probes folder:

- tsx: `PROBE_HOW=meta tsx src/zz-probe-theme.ts` printed `resolved meta …/packages/ui-core/src/tokens/colors.css`,
  `primary #1f6feb dark bg #101216 radius 8px`, and for the lemon brand
  `warnings [["brandColor","light","#9d8a15"]]`, exit 0 (`output-tsx.txt`; `createRequire(…).resolve`
  printed the same).
- Vitest in `apps/server`: both resolutions, `Tests 2 passed (2)` (`output-vitest.txt`).
- esbuild with `scripts/bundle-node.mjs`'s flags (`:13-24`), the bundle copied to a folder of its
  own: with nothing beside it, `ERR_MODULE_NOT_FOUND` (`output-bundle-alone.txt`); with
  `node_modules/@waitron/ui-core/{package.json,src/tokens/colors.css,src/tokens/structure.css}`
  beside it, it resolved to that copy and printed the same values, exit 0
  (`output-bundle-with-files.txt`).
- The way not taken, importing slice 1's `@waitron/ui-core/theme/waitron` (`?raw`) from the server:
  `tsc --noEmit -p apps/server` refused it, `TS2307: Cannot find module '../tokens/colors.css?raw'`,
  and tsx refused it, `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".css"`
  (`output-typecheck-raw.txt`). A loader would need `--loader:.css=text` in the bundle and a hook on
  every tsx entry (`apps/server/package.json:19-36`, `apps/server/scripts/dev-server.mjs:67`), and still a type
  declaration; an esbuild `--define` of the text (the `__WAITRON_HOUR_RELEASE__` pattern,
  `scripts/bundle-node.mjs:44`) would give the bundle and the source two different code paths.
- Deriving costs about a millisecond: `waitron first ms 0.8`, `lemon first ms 1.3`, `green tinted
  first ms 0.7`, then `0.1` or less on a repeat (slice 1's memo, `derive.ts:58-80`).

**D2. The dependency edges, and `validateCoreConfiguration` stays free of the theme.**
`apps/server` and `packages/layouts` gain `@waitron/ui-core`; `packages/composition` gains
`@waitron/layouts`. `packages/db` does **not** gain `@waitron/ui-core`: CI tests every dependent of
a changed package (`--filter "...$pkg"`, `ci.yml:322,2315,2411`), and `pnpm --filter "...@waitron/ui-core" ls`
counted 17 packages on `main`, 18 with this plan's edges, and 35 with `db` depending on `ui-core`
too — every `db` dependent would rerun on every token or component change (`output-ci-scope.txt`).
So the theme rows' import check is `validateThemeConfiguration` in `@waitron/layouts`, and the core
module's transfer in `packages/composition/src/modules.ts:117` runs `validateCoreConfiguration` and
then it. The design's words "adds to `validateCoreConfiguration`" (line 2152) become "adds to the
core module's import check"; what is checked is unchanged. `scripts/workspace-cycles.test.ts` and
`scripts/module-seams.test.ts` passed with these edges (`Tests 3395 passed`, `output-guards.txt`).
The `lit` peer of `ui-core` (`package.json:49-51`): the install printed no peer line, but a control
(the peer raised to `^99.0.0`) printed none either, so that silence is no evidence; what settles it
is that a server bundle importing `@waitron/ui-core/theme` holds no `lit` code (`grep -cE
'LitElement|lit-html|@lit/'` printed 0; the control, a bundle of `wt-button`, printed 21;
`install-peer-control.txt`).

**D3. Which document keys slice 2 accepts: exactly the five slice 1 derives from** — `brandColor`,
`brandFix`, `background`, `corners`, `handSet` (`ThemeChoices`,
`packages/ui-core/src/theme/theme.ts:9-16`) — **all five required**. A document carrying `logo`
(slice 7), `textScale` (slice 10), `text` (slice 11), `printedLogo` (slice 7) or any other key is
refused `theme.invalid { field: "<key>", reason: "unknown_key" }`. Nothing on `main` writes a theme
(design line 2491), so nothing breaks; each later slice adds its key to the accepted list as
**optional with a stated default** (`logo` null, `textScale` 100, `text` `{}`), so every row slice 2
stored stays valid without a migration.

**D4. The import "recomputes `name_key`" by refusing a row whose sent key is not the one its name
gives, or two rows whose names give one key.** The catalogue's way — omit the column and set it in
`afterImport` (`packages/db/src/configuration-transfer.ts:36-37`,
`packages/catalogue/src/product-names.ts:15-34`) — cannot work here: `name_key` is `NOT NULL` with
a unique index, so the insert would fail before `afterImport` runs. The stored key is therefore
always the recomputed one.

**D5. Two migrations, not one.** drizzle-kit 0.31.11, asked to create `custom_themes` and drop
`tenant_themes` in one generation, stopped to ask whether the table was renamed and failed
`Interactive prompts require a TTY terminal`. Generating the create first (Task 3) and the drop later
(Task 10) needs no answer (`output-migration-sql.txt` holds both files' SQL).

**D6. `POST /management-api/themes` takes an optional `inUse: true`**, so "Save as new theme" with
"Use it on every screen now" switched on (design lines 1752-1757) is one transaction.

**D7. A stored document this release refuses** (written by hand, or by a later release before a
downgrade) is served as Waitron's look — `/api/theme` answers the empty sheet and the till's
`themeHash` its hash — and is listed with `choices`, `light` and `dark` `null` and no warnings, so a
manager can still save over it (and, from slice 13, rename or delete it). The till's start read
never fails because of a theme row.

**D8. `/api/theme` answers `Cache-Control: no-store`**, so the browser's HTTP cache never stands in
for the stored copy slice 3 keeps.

**D9. The list answers custom themes only**, ordered by `name_key`, with the id in use (or `null`)
beside them. Waitron's built-in theme is the dashboard's to draw from `WAITRON_CHOICES`
(`theme.ts:18-24`).

**D10. The answer cache** is one module-level entry in `apps/server/src/venue-theme.ts`, keyed by
`themeCacheKey(row)` = `JSON.stringify([id, document])` of the row in use. Slice 7 extends that one
function with each logo image's source and framing (design lines 2176-2184); `logo` is `null` in
slice 2's answer and already inside the hash's input.

**D11. The bundle format moves 5 → 6 once, in Task 10**, which both drops `tenant_themes` from the
transfer and is the last change to the declared table set (Task 9 adds `custom_themes`). The branch
lands as one pull request, so no format-5 bundle ever carries `custom_themes`.

**D12. Where the routes live:** a new `apps/server/src/themes-api.ts`, mounted in the trading boot
beside `mountLocationSettingsApi` (`apps/server/src/boot.ts:1852`), holds `/api/theme` and the four
management routes, with its own error table, as `location-settings-api.ts:29-49` does.

**D13. Rename and delete wait for slice 13, as the design's slices say.** Section 16 gives slice 2
"the list, create, save and switch routes" (line 2501) and slice 13 "the rename, copy and delete
routes" (line 2594); the brief's summary listed `PATCH` and `DELETE` here, and the brief says the
design wins. "Copy" needs no route of its own: it is a `POST` of another theme's choices. So this
slice has `GET` and `POST /management-api/themes`, `PUT /management-api/themes/{id}` and
`PUT /management-api/theme-in-use`; section 15's rename and delete server cases are slice 13's
("Left for later slices"). If the controller wants them here, they are one more task after Task 8:
two store functions and two routes on the same patterns.

---

## Global Constraints

- **Names** (design lines 1761-1766): "1 to 60 characters after trimming, unique ignoring case, and
  never "Waitron" in any case"; the key is "the name normalised to NFC, trimmed, then
  `toLowerCase()`"; "SQLite's own `lower()` is never used for it". This plan counts the 60 in code
  points of the NFC form (so an emoji counts once) and stores the trimmed name as typed.
- **`custom_themes`** (lines 2043-2049): `id`, `name`, `name_key` with `custom_themes_name_key_uq`,
  `in_use` "declared with the vocabulary's `count` builder, nullable — not `flag`", CHECK
  `custom_themes_in_use_ck` allowing only `1`, unique index `custom_themes_in_use_uq`; "`1` on the
  theme in use and NULL on every other"; `theme` (JSON) and `updated_at`. Classified `state`. No
  foreign key in or out.
- **Switching** "clears the old row's `in_use` and then sets the new one's, in one transaction, in
  that order" (lines 2060-2062).
- **One `withTransaction` per request**; write functions take `tx` and never open their own
  (CLAUDE.md §3).
- **Errors:** `theme.invalid` with `field` and `reason`, for choices that are not valid and nothing
  else; `theme.name_taken` with `field: "name"`; `theme.not_found` (lines 2124-2139). Readability is
  never a refusal: it goes in `warnings`.
- **Warnings carry keys only:** `{ field, mode, against, fix, blockedBy }` (lines 2005-2010), exactly
  slice 1's `ThemeWarning` (`theme.ts:28-36`).
- **Gates:** reading the list needs `venue.view`; every write needs `layout.configure`;
  `/api/theme` needs no session (lines 2253-2283).
- **`/api/theme`** answers `{ hash, css, logo }`; `css` is section 7's three blocks from the theme in
  use, `""` with none; `logo` is `null` until slice 7; `hash` is SHA-256 of `css` and `logo` together
  (lines 2166-2175). The stylesheet is built only from derived values (lines 1967-1970).
- **No data migration, no backwards compatibility:** an old `tenant_themes` row is not carried
  forward (line 2115; CLAUDE.md §3).
- **English only** in code, tests and identifiers (CLAUDE.md §3). Test titles use colours, not the
  design's venue names: "the lemon brand (#f2d300)", "the dark-green brand (#1e5b3a)".
- **Comments:** only an invariant or a non-obvious why; no history.
- **Coverage 98/98/98/95** in every package touched; `ui-core`'s mutation floor is 90 on its merged
  score (`.github/workflows/mutation.yml`), so the new `ui-core` files are mutation-tested in their
  task.
- **Each task ends green on** its focused test files, the changed packages' `typecheck` and `lint`,
  and `pnpm exec prettier --check <changed files that are not under docs/>`; commit with
  `git commit -s`, message in plain English. Read every run's `Tests` count, never its exit status
  alone; prefix `env -u AI_AGENT -u CLAUDECODE` when a passing test's console output is needed.
- **Browser runs** (`ui-core`): check `memory_pressure | grep free` first; run beside another
  session's browser run only when free memory is well above 15%.
- **Processes:** a server you start for a check is stopped by the process id you recorded, never by
  name.

## Review Focus

The inputs most likely to bite that no design example exercises, each with its test in the owning
task:

1. **A stored document this release refuses** (a row written by hand, or by a later release before a
   downgrade): `/api/theme` answers Waitron's empty sheet, `GET /api/till` still answers 200 with
   Waitron's `themeHash`, and the list shows the row with `choices: null` (D7). Tests: Task 5
   (store), Task 7 (`/api/theme`, the till), Task 8 (the list).
2. **Uppercase hex** (`#F2D300`) sent by a script: stored lowercase, and the same `css` and `hash` as
   the lowercase document. Tests: Task 1 (the check lowercases), Task 8 (round trip and hash).
3. **A new theme whose name differs from another's only by case or accent form** ("ZOË STUDIO",
   or "Zoë" typed with a decomposed accent, `zoe\u0308`) is `theme.name_taken`, while a name
   that holds another inside it ("Zoë Studio 2") is not. Test: Task 5.
4. **Switching to the theme already in use**, and switching to Waitron's while Waitron's is in use:
   both answer 200, leave exactly the rows in use they found, and leave `/api/theme`'s hash unchanged.
   Tests: Task 5 (store), Task 8 (hash).
5. **A 60-character name made of code points outside the Basic Multilingual Plane** ("🍋" × 60 is
   120 UTF-16 units) is accepted and 61 are refused. Test: Task 1.

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `packages/ui-core/src/theme/document.ts` (new) | 1 | `readThemeDocument`: a stored or sent document → `ThemeChoices`, or the first refusal |
| `packages/ui-core/src/theme/names.ts` (new) | 1 | `themeNameKey`, `checkThemeName` |
| `packages/ui-core/src/theme/sheet.ts` (new) | 2 | `themeSheet`: section 7's three blocks from a `DerivedTheme` |
| `packages/ui-core/src/theme/index.ts` | 1, 2 | re-exports the three |
| `packages/db/src/schema/custom-themes.ts` (new) | 3 | the table |
| `packages/db/drizzle/0182_*.sql`, `0183_*.sql` + meta | 3, 10 | generated create, generated drop |
| `packages/db/src/schema/tenant-themes.ts` | 10 | deleted |
| `packages/layouts/src/theme-store.ts` | 4 (delete), 5 (new content) | the store |
| `packages/layouts/src/theme-input.ts` (new) | 5 | `parseThemeChoices`, `parseThemeName` → `AppError` |
| `packages/layouts/src/theme-configuration.ts` (new) | 9 | `validateThemeConfiguration` |
| `packages/layouts/src/theme.ts`, `theme.test.ts`, `theme-registry.test.ts` | 4 | deleted |
| `packages/composition/src/modules.ts` | 9 | the core module runs the theme check |
| `apps/server/src/theme-defaults.ts` (new) | 6 | Waitron's values read from the token files |
| `apps/server/scripts/copy-migrations.mjs`, `deploy/Dockerfile` | 6 | ship the two files beside the bundle and in the image |
| `apps/server/src/venue-theme.ts` (new) | 7 | the answer, its hash and its cache |
| `apps/server/src/themes-api.ts` (new) | 7, 8 | `/api/theme`, then the management routes |
| `apps/server/src/till-setup.ts` | 7 | `themeHash` |
| `apps/server/src/management-api.ts` | 4 | the two old routes go |
| `packages/provisioning/src/configuration-transfer.ts` | 10 | format 6 |
| `apps/till/src/layout.ts` | 4 | `ThemeOverride` goes |

---

### Task 1: The theme document check and the name rules (`@waitron/ui-core/theme`)

Risk trigger: a cross-package contract (the document every later slice and the import read).

**Files:** Create `packages/ui-core/src/theme/document.ts`, `document.test.ts`, `names.ts`,
`names.test.ts`. Modify `packages/ui-core/src/theme/index.ts` (add two `export *` lines).

**Interfaces — Consumes:** `ThemeChoices`, `Background`, `normaliseChoices` (`theme.ts:7-16,65-75`),
`THEME_COLOURS`, `ThemeColour`, `Corners` (`tokens.ts:3-28,61`), `MODES`, `Mode`
(`defaults.ts:1-3`). **Produces:**

```ts
// document.ts
export const THEME_DOCUMENT_KEYS = ["brandColor", "brandFix", "background", "corners", "handSet"] as const;
export const BACKGROUNDS: readonly Background[]; // ["neutral", "tinted"]
export const CORNER_CHOICES: readonly Corners[]; // ["square", "standard", "round"]
export type ThemeRefusalReason =
  | "not_object" | "unknown_key" | "missing" | "bad_value" | "unknown_colour"
  | "fix_without_brand" | "fix_with_hand_set";
export type ThemeDocumentResult =
  | { readonly ok: true; readonly choices: ThemeChoices }
  | { readonly ok: false; readonly field: string; readonly reason: ThemeRefusalReason };
export function readThemeDocument(input: unknown): ThemeDocumentResult;

// names.ts
export const THEME_NAME_MAX_LENGTH = 60;
export const BUILT_IN_THEME_NAME = "Waitron";
export function themeNameKey(name: string): string; // name.normalize("NFC").trim().toLowerCase()
export type ThemeNameRefusal = "empty" | "too_long" | "reserved";
export type ThemeNameResult =
  | { readonly ok: true; readonly name: string; readonly key: string } // name: trimmed, as typed
  | { readonly ok: false; readonly reason: ThemeNameRefusal };
export function checkThemeName(name: string): ThemeNameResult;
```

The document check returns a result rather than throwing an `AppError`: theme sources may import
only their siblings (`packages/ui-core/src/theme/sources.test.ts:24-33`). It checks in this fixed
order and answers the first refusal:

1. not a plain object → `{ field: "theme", reason: "not_object" }`;
2. each own key, in `Object.keys` order, not in `THEME_DOCUMENT_KEYS` → `{ field: <key>, reason: "unknown_key" }`;
3. `brandColor`: absent → `missing`; not `null` and not a string matching `/^#[0-9a-f]{6}$/i` → `bad_value`;
4. `brandFix`: absent → `missing`; not a plain object → `bad_value`; a key other than `light`/`dark` → `{ field: "brandFix.<key>", reason: "unknown_key" }`; a value other than `true` → `{ field: "brandFix.<mode>", reason: "bad_value" }`;
5. `background`: absent → `missing`; not in `BACKGROUNDS` → `bad_value`;
6. `corners`: absent → `missing`; not in `CORNER_CHOICES` → `bad_value`;
7. `handSet`: absent → `missing`; not a plain object → `bad_value`; a key other than `light`/`dark` → `handSet.<key>` `unknown_key`; `light` or `dark` absent → `handSet.<mode>` `missing`; not a plain object → `handSet.<mode>` `bad_value`; a colour key outside `THEME_COLOURS` → `handSet.<mode>.<key>` `unknown_colour`; a value not `#rrggbb` → `handSet.<mode>.<key>` `bad_value`;
8. for `light` then `dark`: `brandFix[mode]` with `brandColor` `null` → `{ field: "brandFix.<mode>", reason: "fix_without_brand" }`; `brandFix[mode]` with `handSet[mode].primary` set → `fix_with_hand_set`;
9. otherwise `{ ok: true, choices: normaliseChoices(document) }` (hex lower-cased).

- [ ] **Step 1: Write the failing tests.** `document.test.ts`:
  - "accepts Waitron's own choices": `readThemeDocument(WAITRON_CHOICES)` is `{ ok: true, choices: WAITRON_CHOICES }`.
  - "lower-cases hex on the way in": `{ ...WAITRON_CHOICES, brandColor: "#F2D300", handSet: { light: { bg: "#F8F1E1" }, dark: {} } }` gives `choices.brandColor` `"#f2d300"` and `choices.handSet.light.bg` `"#f8f1e1"` (Review Focus 2).
  - "refuses each malformed part, naming its field", an `it.each` table of `[document, field, reason]`, each document `WAITRON_CHOICES` with one change: `null` → `theme`/`not_object`; `[]` → `theme`/`not_object`; `logo: { light: "a.webp" }` added → `logo`/`unknown_key`; `textScale: 110` → `textScale`/`unknown_key`; `text: {}` → `text`/`unknown_key`; `printedLogo: null` → `printedLogo`/`unknown_key`; `brandColor` removed → `brandColor`/`missing`; `brandColor: "#abc"`, `"1e5b3a"`, `"red"`, `7` → `brandColor`/`bad_value`; `brandFix: []` → `brandFix`/`bad_value`; `brandFix: { sepia: true }` → `brandFix.sepia`/`unknown_key`; `brandFix: { light: false }` → `brandFix.light`/`bad_value`; `background: "grey"` → `background`/`bad_value`; `corners: "pill"` → `corners`/`bad_value`; `handSet: { light: {} }` → `handSet.dark`/`missing`; `handSet: { light: {}, dark: {}, sepia: {} }` → `handSet.sepia`/`unknown_key`; `handSet: { light: [], dark: {} }` → `handSet.light`/`bad_value`; `handSet: { light: { scrim: "#000000" }, dark: {} }` → `handSet.light.scrim`/`unknown_colour`; `handSet: { light: { "danger": "#ff0000" }, dark: {} }` → `handSet.light.danger`/`unknown_colour`; `handSet: { light: { bg: "#fff" }, dark: {} }` → `handSet.light.bg`/`bad_value`; `brandColor: null, brandFix: { light: true }` → `brandFix.light`/`fix_without_brand`; `brandColor: "#1e5b3a", brandFix: { dark: true }, handSet: { light: {}, dark: { primary: "#5fa77a" } }` → `brandFix.dark`/`fix_with_hand_set`.
  - "answers the first refusal in its fixed order": a document with both an unknown key `logo` and `brandColor: "red"` → `logo`/`unknown_key`; one with `brandColor: "red"` and `corners: "pill"` → `brandColor`.
  - "accepts a fix beside a hand-set colour other than Main buttons": `brandColor: "#1e5b3a", brandFix: { dark: true }, handSet: { light: {}, dark: { bg: "#000000" } }` is ok.
  - "never mutates its input": a deep-frozen document gives `ok: true`.

  `names.test.ts`:
  - `themeNameKey("  Zoë Studio ")` equals `themeNameKey("zoe\u0308 studio")` and is `"zoë studio"` (composed `ë`, U+00EB). (Test names and values stay English: no venue names from the design.)
  - `checkThemeName("  Bar  ")` is `{ ok: true, name: "Bar", key: "bar" }`.
  - `checkThemeName("")` and `checkThemeName("   ")` → `empty`; `"a".repeat(60)` ok, `"a".repeat(61)` → `too_long`; `"🍋".repeat(60)` ok and `"🍋".repeat(61)` → `too_long` (Review Focus 5); `"a".repeat(59) + "e\u0301"` (61 code points as typed, 60 once composed) is ok.
  - `"Waitron"`, `"WAITRON"`, `" waitron "` → `reserved`; `"Waitron 2"` ok.

- [ ] **Step 2: Run, expect failure.** `memory_pressure | grep free`, then
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/document.test.ts src/theme/names.test.ts`
  — FAIL: `./document.js` and `./names.js` do not resolve.

- [ ] **Step 3: Implement** `document.ts` and `names.ts` to the interfaces and the order above; add
  `export * from "./document.js";` and `export * from "./names.js";` to `index.ts`.

- [ ] **Step 4: Run, expect pass** (same command; read the `Tests` count), then
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/sources.test.ts` (the sibling-import and
  no-DOM guard covers the new files).

- [ ] **Step 5: Mutation.** `pnpm --filter @waitron/ui-core exec stryker run --mutate
  "src/theme/document.ts,src/theme/names.ts"`; read the clear-text table's `All files` row. Kill
  survivors with assertions until the score is 90 or more; record score and any equivalent
  survivor (file, line, why) in the ledger.

- [ ] **Step 6: Commit** — `git commit -s -m "Check a theme document and a theme name in one shared place"`.

---

### Task 2: The three-block stylesheet (`@waitron/ui-core/theme`)

Risk trigger: a cross-package contract (`/api/theme`'s `css`, which slice 3 applies).

**Files:** Create `packages/ui-core/src/theme/sheet.ts`, `sheet.test.ts`. Modify `index.ts`.

**Interfaces — Consumes:** `DerivedTheme` (`theme.ts:38-45`), `THEME_TOKENS` (`tokens.ts:46`).
**Produces:** `export function themeSheet(theme: Pick<DerivedTheme, "light" | "dark">): string`.

The text is the design's section 7 block (lines 1348-1356), each block declaring every
`THEME_TOKENS` name in that order with that version's value, one declaration per line:

```
@media screen {
  [data-wt-theme-root] { …light… }
  @media (prefers-color-scheme: dark) {
    [data-wt-theme-root]:not([data-theme="light"]) { …dark… }
  }
  [data-wt-theme-root][data-theme="dark"] { …dark… }
}
```

It throws `RangeError` when a version's keys are not exactly `THEME_TOKENS`, or a value is not
`/^#[0-9a-f]{6}$/` for a `--wt-color-` name or `/^\d+px$/` for a radius — so nothing that is not a
derived value can reach the sheet (design lines 1967-1970).

- [ ] **Step 1: Write the failing tests** in `sheet.test.ts` (real Chromium, as every `ui-core`
  test):
  - "parses as one screen rule holding the three blocks": `new CSSStyleSheet()` `.replaceSync(themeSheet(deriveTheme(LEMON)))`; one `CSSMediaRule` whose `media.mediaText` is `"screen"`, holding in order a `CSSStyleRule` with `selectorText` `"[data-wt-theme-root]"`, a `CSSMediaRule` `"(prefers-color-scheme: dark)"` holding `[data-wt-theme-root]:not([data-theme="light"])`, and a `CSSStyleRule` `[data-wt-theme-root][data-theme="dark"]`; each style rule's `style.length` equals `THEME_TOKENS.length`. (`LEMON` = `{ ...WAITRON_CHOICES, brandColor: "#f2d300" }`; `deriveTheme` from `./waitron.js`, as the slice 1 tests import it.)
  - "a forced light root paints the light version and a forced dark root the dark": with `GREEN = { ...WAITRON_CHOICES, brandColor: "#1e5b3a", brandFix: { dark: true }, background: "tinted", corners: "round" }` (its light and dark buttons differ, `#1e5b3a` and its dark fix), adopt `themeSheet(deriveTheme(GREEN))` into `document.adoptedStyleSheets` after the token layer; on `mountTokenRoot("light")` and `mountTokenRoot("dark")` (`src/tokens/token-test-helpers.ts`), `token(el, "--wt-color-primary")` equals `deriveTheme(GREEN).light` / `.dark` `["--wt-color-primary"]`, which differ from each other and from Waitron's, and `--wt-radius-md` is `"14px"`. Control in the same test: with the sheet taken out of `adoptedStyleSheets`, the two roots read Waitron's `#1f6feb` and `#4c8dff` and `8px`. Remove the sheet and the roots afterwards.
  - "refuses what is not a derived value": a light map with `--wt-color-bg` set to `"red; } body { display: none"`, one with `--wt-radius-md` `"1em"`, one missing `--wt-color-bg`, and one with an extra `--wt-color-danger` each throw `RangeError`.

- [ ] **Step 2: Run, expect failure.** `pnpm --filter @waitron/ui-core exec vitest run src/theme/sheet.test.ts` — FAIL: `./sheet.js` does not resolve.

- [ ] **Step 3: Implement** `themeSheet`; add `export * from "./sheet.js";` to `index.ts`.

- [ ] **Step 4: Run, expect pass**, then the package's coverage:
  `pnpm --filter @waitron/ui-core test:coverage` — read the per-file table for the three new files
  and the `All files` thresholds (98/98/98/95).

- [ ] **Step 5: Mutation.** As Task 1 step 5, with `--mutate "src/theme/sheet.ts"`; 90 or more.

- [ ] **Step 6: Commit** — `git commit -s -m "Build the theme stylesheet's light and dark blocks from worked-out values"`.

---

### Task 3: The `custom_themes` table (migration 1 of 2)

Risk trigger: a migration.

**Files:** Create `packages/db/src/schema/custom-themes.ts`,
`packages/db/src/schema/custom-themes.test.ts`, the generated `packages/db/drizzle/0182_*.sql` and
`drizzle/meta/0182_snapshot.json`, the journal entry. Modify `packages/db/src/schema/index.ts`
(add `export * from "./custom-themes.js";` after `:43`), `packages/db/src/index.ts` (add
`export { customThemes } from "./schema/custom-themes.js";` beside `:174`),
`packages/db/src/classification.ts` (add `classify("custom_themes", "state", STATE),` beside `:141`),
`scripts/schema-constraints.test.ts` (add `"custom_themes_in_use_uq"` and
`"custom_themes_name_key_uq"` to `EXPECTED_UNIQUE_INDEXES` (`:370`) after
`"convenio_config_location_uq"`, and `"custom_themes_in_use_ck"` to `EXPECTED_CHECK_CONSTRAINTS`
(`:507`) in its sorted place). `tenant_themes` stays until Task 10.

**Interfaces — Produces:** `customThemes` with columns `id` (`id("id").primaryKey().$defaultFn(newId)`),
`name` (`label`, not null), `nameKey` (`label("name_key")`, not null), `inUse` (`count("in_use")`,
nullable), `theme` (`json("theme")`, not null), `updatedAt` (`tsString`, not null,
`$defaultFn(nowIso)`); `uniqueIndex("custom_themes_name_key_uq").on(nameKey)`,
`uniqueIndex("custom_themes_in_use_uq").on(inUse)`, `check("custom_themes_in_use_ck", sql\`${inUse} = 1\`)`.
Builders from `./columns.js` only (`scripts/column-vocabulary.test.ts`). One comment at `in_use`:
why `count` and not `flag` (a `false` would be written `0`, which the CHECK refuses), and that NULL
means "not in use".

- [ ] **Step 1: Write the failing test** `custom-themes.test.ts` (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`;
  each insert in its own `withTransaction`, and each refusal caught around the whole
  `withTransaction` with `captureError`, CLAUDE.md §3):
  - "lets any number of themes be out of use and at most one be in use": two rows with `inUse: null` insert; a third with `inUse: 1` inserts; a fourth with `inUse: 1` is refused with a message containing `UNIQUE constraint failed: custom_themes.in_use`.
  - "refuses an in-use value other than 1": `inUse: 2` and `inUse: 0` are each refused with a message containing `custom_themes_in_use_ck`.
  - "refuses a second row with the same name key": a message containing `UNIQUE constraint failed: custom_themes.name_key`.
  - "has nothing pointing at it and points at nothing": `pragma_foreign_key_list('custom_themes')` is empty, and no table's `pragma_foreign_key_list` names `custom_themes`.

- [ ] **Step 2: Run, expect failure.** `pnpm --filter @waitron/db exec vitest run src/schema/custom-themes.test.ts` — FAIL: `./custom-themes.js` / `customThemes` does not exist.

- [ ] **Step 3: Write the schema file and the exports, then generate.**
  `pnpm --filter @waitron/db exec drizzle-kit generate --name create_custom_themes`. drizzle-kit picks the number.
  Never edit the journal or a snapshot by hand. **Read the SQL it wrote.** Expected (the probe's
  generation, `output-migration-sql.txt`): `CREATE TABLE \`custom_themes\`` with the six columns and
  `CONSTRAINT "custom_themes_in_use_ck" CHECK("custom_themes"."in_use" = 1)`, then two
  `CREATE UNIQUE INDEX` statements, nothing else — no table rebuild, no `DROP`. Anything more is a
  stop-and-report.

- [ ] **Step 4: Run, expect pass** (same command), then the migration guards:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts scripts/migration-upgrade.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. The
  probe's run of the root list with both migrations printed `Tests 599 passed (599)`, the upgrade
  walk about 62 s (`output-guards-migration.txt`). Then `pnpm --filter @waitron/db exec vitest run
  src/classification.test.ts src/configuration-transfer.test.ts`.

- [ ] **Step 5: Commit** — `git commit -s` with a message that says why a new table enters the core
  set (CLAUDE.md §3): "Add the custom_themes table to the core set. It replaces tenant_themes, which
  is core, and it is read by /api/theme for every app, so a module of its own would split one
  contract. The generated SQL creates the table, its in-use check and its two unique indexes, and
  nothing else."

---

### Task 4: Retire the old theme surface

Risk trigger: permission-gated routes removed; a cross-package export removed.

Nothing on `main` reads these but the code retired with them (design lines 2488-2490; this plan's
grep is under "What was checked"). The six HTTP cases go here and come back rewritten in Task 8.

**Files:** Delete `packages/layouts/src/theme.ts`, `theme.test.ts`, `theme-store.ts`,
`theme-store.test.ts`, `theme-registry.test.ts`. Modify `packages/layouts/src/index.ts` (drop
`:28-29` and `:79`), `packages/layouts/src/index.test.ts` (`:5-8`), `packages/layouts/src/errors.ts`
(`:45-49`), `packages/layouts/src/errors.test.ts` (`:16-28`), `apps/server/src/management-api.ts`
(drop `getTenantTheme` and `putTenantTheme` from the import at `:80,82`, the `"theme.invalid": 400`
entry at `:260`, and both routes at `:1260-1289`),
`apps/server/src/management-api.canvas-retirement.test.ts` (drop `import type { ThemeOverride }` at
`:14` and the `describe` at `:138-235`; the file header at `:22-25` names the canvas routes only),
`apps/till/src/layout.ts` (drop `ThemeOverride`, `:58-60`), `docs/developers/design-system.md`
(three sentences, step 4).

**Interfaces — Produces** (in `packages/layouts/src/errors.ts`, replacing `:45-49`):

```ts
"theme.invalid": { field: string; reason: ThemeRefusalReason | ThemeNameRefusal };
"theme.name_taken": { field: "name" };
"theme.not_found": Record<string, never>;
```

with the two reason types imported from `@waitron/ui-core/theme` — so `packages/layouts/package.json`
gains `"@waitron/ui-core": "workspace:*"` here (run `pnpm install`; commit the lockfile).

- [ ] **Step 1: Change the tests first.** `index.test.ts`: the barrel case asserts
  `api.FORM_FACTORS` defined and `"validateThemeOverride" in api` is `false`. `errors.test.ts`: the
  theme case constructs `new AppError("theme.invalid", { field: "handSet.light.bg", reason: "bad_value" })`
  and `new AppError("theme.name_taken", { field: "name" })` and checks code and params.

- [ ] **Step 2: Run, expect failure.** `pnpm --filter @waitron/layouts exec vitest run src/index.test.ts src/errors.test.ts`
  — the barrel case FAILS (`validateThemeOverride` is still exported); `pnpm --filter @waitron/layouts typecheck`
  FAILS on the new params.

- [ ] **Step 3: Retire.** Make every deletion and edit in **Files**. Then the docs: in
  `docs/developers/design-system.md` replace the sentence at `:199-201` ("A tenant theme cannot set
  it: … no screen applies a stored tenant theme yet.") with "A venue's custom theme writes it, worked
  out from the theme's own button colour (`THEME_COLOURS`, `packages/ui-core/src/theme/tokens.ts`),
  but no screen applies a venue's theme yet (A841)."; at `:209-210` replace "and `THEMEABLE_TOKENS`
  does not list them either, so a tenant theme cannot set them." with "and a venue's custom theme
  writes `--wt-color-primary-hover` but never `--wt-color-danger-hover`: danger is a colour with a
  meaning, outside `THEME_COLOURS`."; at `:217-218` replace "and `THEMEABLE_TOKENS` does not list
  them, so a tenant theme cannot set them." with "and a venue's custom theme writes the two primary
  ones but neither danger one." (Check each claim against `THEME_COLOURS`, `tokens.ts:3-26`, before
  writing it.)

- [ ] **Step 4: Run, expect pass.** `pnpm --filter @waitron/layouts exec vitest run` (whole package
  — read the `Tests` count), `pnpm --filter @waitron/layouts typecheck`,
  `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
  `pnpm --filter @waitron/server exec vitest run src/management-api.canvas-retirement.test.ts`, and
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts scripts/module-seams.test.ts`.
  Then `git grep -n "THEMEABLE_TOKENS\|MAX_THEME_VALUE_LENGTH\|validateThemeOverride\|ThemeOverride\|getTenantTheme\|putTenantTheme\|management-api/theme\b" -- ':!docs/superpowers' ':!docs/backlog*'`
  prints nothing.

- [ ] **Step 5: Commit** — `git commit -s -m "Retire the single-document tenant theme and its two routes"`,
  the body naming the six HTTP cases removed here and rewritten for the new routes in the themes API
  task.

---

### Task 5: The custom themes store (`@waitron/layouts`)

Risk trigger: permission-gated writes; the in-use switch.

**Files:** Create `packages/layouts/src/theme-input.ts`, `theme-input.test.ts`,
`packages/layouts/src/theme-store.ts`, `theme-store.test.ts`. Modify `packages/layouts/src/index.ts`
(export the store and the two parsers).

**Interfaces — Consumes:** `customThemes` (Task 3), `readThemeDocument`, `checkThemeName`,
`ThemeChoices` (Task 1), `authorizeManager` (`@waitron/identity`), `isUniqueViolation`,
`constraintTarget`, `sameTarget` (`@waitron/db`, as `device-profile-store.ts:94-106` uses them),
`isUuid` (`@waitron/shared`). **Produces:**

```ts
// theme-input.ts — throws AppError
export function parseThemeChoices(input: unknown): ThemeChoices; // theme.invalid { field, reason }
export function parseThemeName(input: string): { name: string; key: string }; // theme.invalid { field: "name", reason }

// theme-store.ts
export interface StoredTheme {
  readonly id: string;
  readonly name: string;
  readonly choices: ThemeChoices | null; // null: a stored document this release refuses (D7)
  readonly updatedAt: string;
}
export interface ThemeList { readonly themes: readonly StoredTheme[]; readonly inUse: string | null }
export function listCustomThemes(tx: Transaction): Promise<ThemeList>; // ordered by name_key; no gate (the route gates)
export function readThemeInUse(tx: Transaction): Promise<{ readonly id: string; readonly choices: ThemeChoices | null } | null>;
export function createCustomTheme(tx: Transaction, input: { managementSessionId: string; name: string; theme: unknown; inUse?: boolean }): Promise<StoredTheme>;
export function saveCustomTheme(tx: Transaction, input: { managementSessionId: string; id: string; theme: unknown }): Promise<StoredTheme>;
export function setThemeInUse(tx: Transaction, input: { managementSessionId: string; customThemeId: string | null }): Promise<string | null>;
```

Every write function authorizes `layout.configure` first, then checks its input, then writes;
an id that is not a UUID, or names no row, is `theme.not_found`. A unique violation whose target is
`custom_themes(name_key)` becomes `theme.name_taken { field: "name" }`. `setThemeInUse` checks the
target exists, then runs `update custom_themes set in_use = null where in_use = 1` and then
`update … set in_use = 1 where id = ?`. `createCustomTheme` with `inUse: true` inserts with
`in_use` null, then switches the same way. `saveCustomTheme` never touches `in_use` or the name.
The stored `theme` is the normalised document (`choices` from `parseThemeChoices`), and `updated_at`
is set by every write to its row.

- [ ] **Step 1: Write the failing tests.** `theme-input.test.ts`: `parseThemeChoices` turns one
  refusal from Task 1's table into `AppError("theme.invalid", { field: "brandFix.light", reason: "fix_without_brand" })`
  and returns lowercase choices for an uppercase document; `parseThemeName(" waitron ")` throws
  `theme.invalid { field: "name", reason: "reserved" }`, `""` → `empty`, 61 characters → `too_long`.

  `theme-store.test.ts` (`useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] })`,
  `seedTenant`, sessions made as the old `theme-store.test.ts:22-31` made them):
  - "creates a theme out of use, and lists it": `listCustomThemes` → `{ themes: [{ id, name: "Bar", choices: LEMON, updatedAt }], inUse: null }`.
  - "refuses every write from a supervisor and from staff before writing" — the three writes each `authorization.not_permitted`; `select count(*) from custom_themes` unchanged (the old file's gate-before-write case, `:73-85`).
  - "refuses an invalid document before writing" — `theme.invalid`, row count unchanged (the old `:87-101`).
  - "refuses a name another theme holds, ignoring case and accent form" (Review Focus 3): "Zoë Studio" exists; creating "ZOË STUDIO" and "zoe\u0308 studio" (the accent decomposed) are each `theme.name_taken { field: "name" }`; creating "Zoë Studio 2" succeeds (the control).
  - "switches by clearing the old theme before setting the new one": A in use, `setThemeInUse(B)` → `select id from custom_themes where in_use = 1` is `[B]`; `setThemeInUse(null)` → none; `setThemeInUse(B)` twice → still `[B]` (Review Focus 4); `setThemeInUse(null)` with none in use → none, no error.
  - "creates a theme in use in one call": A in use, `createCustomTheme({ …, inUse: true })` → only the new row in use.
  - "create and save change only their own row": two rows; after saving A, and after creating C from A's choices (a copy), B's full row (`select * … where id = B`) equals its value before, and A's is unchanged by the copy.
  - "answers theme.not_found for an unknown or malformed id" — save and switch, with a random UUID and with `"not-a-uuid"`.
  - "reads back a stored document this release refuses as null choices" (Review Focus 1): a row inserted with raw SQL holding `'{"tokens":{}}'` and `in_use = 1` → `listCustomThemes` lists it with `choices: null`, and `readThemeInUse` → `{ id, choices: null }`; saving a valid document over it then reads back that document.

- [ ] **Step 2: Run, expect failure.** `pnpm --filter @waitron/layouts exec vitest run src/theme-input.test.ts src/theme-store.test.ts` — FAIL: the modules do not resolve.

- [ ] **Step 3: Implement** to the interfaces; export them from `index.ts`.

- [ ] **Step 4: Run, expect pass**, then `pnpm --filter @waitron/layouts test:coverage` (read the
  `All files` row: 98/98/98/95), `pnpm --filter @waitron/layouts typecheck`, `lint`, and
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts`.

- [ ] **Step 5: Commit** — `git commit -s -m "Store custom themes: create, save, and switch the one in use"`.

---

### Task 6: The server reads Waitron's token files, in the workspace and beside the bundle

Risk trigger: a new cross-package dependency, the bundle and the box image.

**Files:** Create `apps/server/src/theme-defaults.ts`, `theme-defaults.test.ts`. Modify
`apps/server/package.json` (`"@waitron/ui-core": "workspace:*"`; `pnpm install`; commit the
lockfile), `apps/server/scripts/copy-migrations.mjs` (after `:25`), `deploy/Dockerfile` (after
`:218`), `scripts/deploy-image-env.test.ts` (a case beside `:221-224`).

**Interfaces — Produces:**

```ts
export function readTokenFile(name: "colors.css" | "structure.css"): string;
export const SERVER_THEME_DEFAULTS: WaitronDefaults; // readDefaults(readTokenFile("colors.css"), readTokenFile("structure.css"))
```

`readTokenFile` reads `fileURLToPath(import.meta.resolve(\`@waitron/ui-core/tokens/${name}\`))`.
One comment says where that resolves in the workspace and beside the bundle. `copy-migrations.mjs`
copies `packages/ui-core/package.json` (by its path from the repository root, `resolve(packageRoot,
"../../packages/ui-core")`: `ui-core`'s `exports` has no `./package.json` entry, so it cannot be
resolved by name) to `dist/node_modules/@waitron/ui-core/package.json` and the two token files to
`dist/node_modules/@waitron/ui-core/src/tokens/`. The Dockerfile adds
`COPY --from=build --chown=waitron:waitron /src/apps/server/dist/node_modules/@waitron/ /app/node_modules/@waitron/`.

- [ ] **Step 1: Write the failing tests.** `theme-defaults.test.ts`:
  - "reads Waitron's values from ui-core's token files": `SERVER_THEME_DEFAULTS.light["--wt-color-primary"]` is `"#1f6feb"`, `.dark["--wt-color-bg"]` is `"#101216"`, `.structure["--wt-radius-md"]` is `"8px"`.
  - "reads the package's own files": `SERVER_THEME_DEFAULTS` deep-equals `readDefaults` of the two files read with `readFileSync(new URL("../../../packages/ui-core/src/tokens/<name>", import.meta.url))` — a second route to the same files. (Not `@waitron/ui-core/theme/waitron`: the server's typecheck refuses its `?raw` imports, D1.)

  `deploy-image-env.test.ts`, "ships ui-core's token files where the server resolves them":
  `DOCKERFILE` contains `/src/apps/server/dist/node_modules/@waitron/ /app/node_modules/@waitron/`.
  Weaker than its name, as its neighbours say: it reads text; the boots in step 4 and image-smoke's
  setup box are what load the files.

- [ ] **Step 2: Run, expect failure.** `pnpm --filter @waitron/server exec vitest run src/theme-defaults.test.ts`
  — FAIL: `./theme-defaults.js` does not resolve. `pnpm exec vitest run scripts/deploy-image-env.test.ts -t "token files"`
  — FAIL: the line is absent.

- [ ] **Step 3: Implement** the module, the copy and the Dockerfile line.

- [ ] **Step 4: Run, expect pass**, then `pnpm --filter @waitron/server build` and check
  `ls apps/server/dist/node_modules/@waitron/ui-core/src/tokens` prints `colors.css structure.css`.
  (Nothing imports `theme-defaults.ts` at boot until Task 7, whose step 5 runs the bundle.)
  Then `pnpm --filter @waitron/server typecheck`, `lint`, and
  `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts`.

- [ ] **Step 5: Commit** — `git commit -s -m "Read Waitron's own colours on the server from ui-core's token files, and ship them beside the bundle"`,
  the body recording D1's probes.

---

### Task 7: `/api/theme`, its cache, and the till's `themeHash`

Risk trigger: an unauthenticated route; the till's start-read contract.

**Files:** Create `apps/server/src/venue-theme.ts`, `venue-theme.test.ts`,
`apps/server/src/themes-api.ts`, `themes-api.public.test.ts`. Modify `apps/server/src/till-setup.ts`
(`:78-110`, one field), `apps/server/src/boot.ts` (mount beside `:1852`),
`apps/server/src/till-api.test.ts` (`:1220-1258`), `apps/server/src/till-api.setup-revision.test.ts`,
`apps/server/src/boot.test.ts` (the trading-boot case at `:1729`).

**Interfaces — Consumes:** `readThemeInUse` (Task 5), `deriveThemeFrom`, `themeSheet` (Task 2),
`SERVER_THEME_DEFAULTS` (Task 6). **Produces:**

```ts
// venue-theme.ts
export interface VenueThemeAnswer { readonly hash: string; readonly css: string; readonly logo: null }
export function themeHashOf(css: string, logo: null): string; // sha256 hex of JSON.stringify({ css, logo })
export const WAITRON_THEME_ANSWER: VenueThemeAnswer; // { hash: themeHashOf("", null), css: "", logo: null }
export function themeCacheKey(row: { id: string; choices: ThemeChoices }): string; // JSON.stringify([id, choices])
export function readVenueTheme(tx: Transaction): Promise<VenueThemeAnswer>;
export function forgetVenueTheme(): void; // tests only: empties the cache

// themes-api.ts
export function mountThemesApi(app: Hono, deps: { db: Database }, log: Logger): void;
```

`readVenueTheme` reads the row in use; none, or `choices: null` (D7), answers
`WAITRON_THEME_ANSWER`; otherwise it answers the cached entry when `themeCacheKey` matches, and
derives, builds and replaces the one entry when not. `GET /api/theme` opens one transaction, answers
`readVenueTheme`'s value as JSON with `Cache-Control: no-store`, and needs no session.
`readTillSetup` adds `themeHash: (await readVenueTheme(tx)).hash` as its last field, so
`setupRevisionOf` (`till-setup.ts:116-118`) moves with it.

- [ ] **Step 1: Write the failing tests.**
  `venue-theme.test.ts` (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`; rows written with
  `suite.db.insert(customThemes)` and updated directly — the store's own cases are Task 5's;
  `forgetVenueTheme()` in `beforeEach`):
  - "answers Waitron's empty sheet with no theme in use": `{ hash: "e5b913bdac6111b271019fdd50363b9b68977f24809cb00fb7a0cb54c2e72146", css: "", logo: null }` (the sha256 of `{"css":"","logo":null}`, `output-empty-hash.txt`), also with a theme stored but none in use.
  - "serves the theme in use as picked, warnings and all": the lemon brand in use → `css` equals `themeSheet(deriveThemeFrom(SERVER_THEME_DEFAULTS, LEMON))`, contains `--wt-color-primary: #f2d300;` and not `#9d8a15`; `hash` equals `themeHashOf(css, null)`.
  - "derives once while nothing changes": with `vi.mock("@waitron/ui-core/theme", …)` wrapping `deriveThemeFrom` in `vi.fn`, two reads give equal answers and one call; updating the row's document gives a new hash and a second call (the control).
  - "returns to Waitron's hash when the theme stops being in use, and to its own when used again".
  - "serves Waitron's look for a stored document this release refuses" (Review Focus 1): raw SQL row `'{"tokens":{}}'`, `in_use = 1` → `WAITRON_THEME_ANSWER`.

  `themes-api.public.test.ts` (same suite shape, `mountThemesApi` on a bare `Hono`): `GET /api/theme`
  with no cookie → 200, `cache-control` `no-store`, body `WAITRON_THEME_ANSWER`; with the lemon
  in use → the same body `readVenueTheme` gives.

  `till-api.test.ts:1220-1258`: the `toEqual` gains `themeHash: "e5b913bd…2146"` (the full value).

  `till-api.setup-revision.test.ts`, three cases with `setupTill()` and direct row writes:
  "switching the theme in use moves the revision, and themeHash is /api/theme's hash" (compare with
  `readVenueTheme` in a transaction); "saving a theme that is not in use leaves the revision"; "a
  stored document this release refuses still answers the start read" (200, Waitron's `themeHash`).

  `boot.test.ts`, in "boots in trading mode when a venue is bound…" (`:1729`): `fetch(.../api/theme)`
  is 200 with `css: ""` and `logo: null`.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/server exec vitest run src/venue-theme.test.ts src/themes-api.public.test.ts src/till-api.test.ts src/till-api.setup-revision.test.ts`
  — FAIL: the modules do not resolve; the `/api/till` `toEqual` lacks `themeHash`.

- [ ] **Step 3: Implement** `venue-theme.ts`, `themes-api.ts` with `/api/theme` only, the
  `readTillSetup` field and the boot mount.

- [ ] **Step 4: Run, expect pass** (same command, then `src/boot.test.ts -t "boots in trading mode"`).

- [ ] **Step 5: The bundle starts, beside and away from the workspace, and fails without the files.**
  `pnpm --filter @waitron/server build`, then run CI's two smoke steps by hand (`ci.yml:570-605` and
  `:622-645`), each with `gtimeout 60s`, a port of its own (`WAITRON_HTTP_PORT`), a fresh
  `WAITRON_VENUE_DIR` from `mktemp -d`, its process id recorded and stopped by that id: in place, and
  with `apps/server/dist/.` copied to a `mktemp -d` folder. Each must log
  `"event":"server.listening"`. **Control:** delete `node_modules/@waitron` from the copied folder
  and run it again: it must not reach `server.listening`, and its log must name `@waitron/ui-core`
  (`ERR_MODULE_NOT_FOUND`). Record the three outcomes in the commit body.

- [ ] **Step 6: Commit** — `git commit -s -m "Serve the theme in use at /api/theme and tell a signed-in till when it changes"`.

---

### Task 8: The management routes, and the six cases rewritten

Risk trigger: permissions (a read under `venue.view`, every write under `layout.configure`).

**Files:** Modify `apps/server/src/themes-api.ts`. Create `apps/server/src/themes-api.test.ts`.
Modify `apps/server/src/management-api.canvas-retirement.test.ts` (the rewritten six, where Task 4
removed them; `mountApp` mounts `mountThemesApi` beside `mountManagementApi`).

**Interfaces — Consumes:** Task 5's store and parsers, `SERVER_THEME_DEFAULTS`, `deriveThemeFrom`.
**Produces** (answers; every route opens one `withTransaction`):

```ts
interface ThemeAnswer {
  id: string; name: string; updatedAt: string;
  choices: ThemeChoices | null;
  light: Record<string, string> | null; // deriveThemeFrom(…).light, or null with choices null
  dark: Record<string, string> | null;
  warnings: readonly ThemeWarning[];      // [] with choices null
}
// GET    /management-api/themes              venue.view        200 { themes: ThemeAnswer[], inUse: string | null }
// POST   /management-api/themes              layout.configure  201 ThemeAnswer   body { name, theme, inUse? }
// PUT    /management-api/themes/:id          layout.configure  200 ThemeAnswer   body { theme }
// PUT    /management-api/theme-in-use        layout.configure  200 { inUse: string | null }   body { customThemeId: string | null }
```

A body that is not an object, or lacks or mistypes `name`, `theme`, `inUse` or `customThemeId`,
is `management.request_invalid { field }` (`readJsonBody` turns `null` into `{}`,
`packages/server-kit/src/read-json-body.ts:9-15`). Error table: `management_session.required` 401,
`management_session.expired` 401, `person.suspended` 403, `authorization.not_permitted` 403,
`management.request_invalid` 400, `theme.invalid` 400, `theme.name_taken` 409, `theme.not_found` 404.

- [ ] **Step 1: Write the failing tests.**
  The six, rewritten in `management-api.canvas-retirement.test.ts` (same order — the suite does not
  reset between tests; `RED` = `{ brandColor: "#ff0000", brandFix: {}, background: "neutral", corners: "standard", handSet: { light: {}, dark: {} } }`):
  1. "GET lists no custom themes and none in use for a venue that has saved none" → 200 `{ themes: [], inUse: null }`.
  2. "POST → 201, then GET lists it (round trip)" → POST `{ name: "Red", theme: RED }` answers 201 with `name` and `choices: RED`; GET's `themes` holds one answer with the same `id`, `name` and `choices`.
  3. "PUT with an unknown colour → 400 theme.invalid naming the field" → PUT the theme `{ theme: { ...RED, handSet: { light: { evil: "#ff0000" }, dark: {} } } }` → `{ code: "theme.invalid", params: { field: "handSet.light.evil", reason: "unknown_colour" } }`.
  4. "PUT with a body omitting theme → 400 management.request_invalid naming the field" → `{}` and `null` bodies → `params: { field: "theme" }`.
  5. "refuses the theme routes for a STAFF-role session with 403" → the GET and the PUT each `authorization.not_permitted`.
  6. "refuses the theme routes unauthenticated with 401" → GET `/management-api/themes` → `management_session.required`.

  `themes-api.test.ts` (manager, supervisor and staff sessions as `venue-defaults-permission.test.ts:40-62`
  makes them; `CORE_MIGRATIONS`, `IDENTITY_MIGRATIONS`; `forgetVenueTheme()` in `beforeEach`):
  - "refuses invalid choices naming the field" — PUT with `handSet.light.bg: "#fff"` → `handSet.light.bg`/`bad_value`; `brandColor: null, brandFix: { light: true }` → `brandFix.light`/`fix_without_brand`; `brandFix: { light: true }, handSet: { light: { primary: "#1e5b3a" }, dark: {} }` → `brandFix.light`/`fix_with_hand_set`; `logo` and `textScale` added → `unknown_key`; the stored document unchanged after each.
  - "stores the lemon brand (#f2d300) as sent and answers its warning in keys": PUT → 200, `choices.brandColor` `"#f2d300"`, `brandFix` `{}`, `warnings` toEqual `[{ field: "brandColor", mode: "light", against: ["field-fill", "bg", "surface", "surface-raised", "stepper-button"], fix: "#9d8a15", blockedBy: [] }]` (slice 1's pin, `brand-warnings.test.ts:22-30`); the code is never `theme.invalid`.
  - "answers the same warning from GET, to a supervisor too".
  - "serves the lemon from /api/theme as picked once it is in use": PUT `theme-in-use` → `css` contains `--wt-color-primary: #f2d300;`.
  - "an uppercase document is stored, served and hashed as the lowercase one" (Review Focus 2): POST `#F2D300` as theme A and switch to it; note the hash; switch to a theme B saved with `#f2d300`; the hash is the same and both answers' `choices.brandColor` are `"#f2d300"`.
  - "a supervisor reads the list and is refused every write": GET 200; POST, PUT and PUT `theme-in-use` each 403 `authorization.not_permitted`, and `custom_themes` unchanged.
  - "staff are refused the read" — GET 403.
  - "a name another theme holds is name_taken, and Waitron's name is refused": POST "red" with "Red" stored → 409 `{ code: "theme.name_taken", params: { field: "name" } }`; POST "WaItRoN" → 400 `{ field: "name", reason: "reserved" }`.
  - "switching moves /api/theme's hash, and back to Waitron's returns it": hashes h0 (none in use) → A in use h1 ≠ h0 → B h2 ≠ h1 → `customThemeId: null` h0 → A again h1.
  - "switching to the theme already in use changes nothing" (Review Focus 4): 200, same hash, one row in use.
  - "saving or copying a theme not in use leaves the hash, and saving the one in use moves it": copy = POST of A's `choices` under a new name; the last part is the control.
  - "POST with inUse switches in the same request": A in use; POST B with `inUse: true` → GET's `inUse` is B's id.
  - "the list answers each theme's warnings, and null for a document this release refuses" (Review Focus 1): A lemon, B the dark-green brand (#1e5b3a) — B's dark warning present; a raw SQL row listed with `choices: null`, `light: null`, `dark: null`, `warnings: []`; PUT a valid theme over it → 200.
  - "an unknown or malformed id is theme.not_found" — PUT with a random UUID and with `"x"`; PUT `theme-in-use` with a random UUID.
  - "malformed bodies name their field" — POST without `name` → `name`; POST `name: 7` → `name`; POST `inUse: "yes"` → `inUse`; PUT `theme-in-use` `{}` → `customThemeId`.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/server exec vitest run src/themes-api.test.ts src/management-api.canvas-retirement.test.ts`
  — FAIL: every route answers 404.

- [ ] **Step 3: Implement** the four routes in `themes-api.ts`.

- [ ] **Step 4: Run, expect pass** (same command), then `pnpm --filter @waitron/server typecheck`,
  `lint`, and `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/english-only.test.ts`.

- [ ] **Step 5: Commit** — `git commit -s -m "Add the custom theme routes: list for supervisors and up, every change for managers and up"`.

---

### Task 9: A configuration copy carries the custom themes

Risk trigger: the configuration import (a cross-package contract).

**Files:** Create `packages/layouts/src/theme-configuration.ts`, `theme-configuration.test.ts`.
Modify `packages/layouts/src/errors.ts` (add `"setup.request_invalid": { field: string };`, the type
`packages/db/src/errors.ts:53` declares), `packages/layouts/src/index.ts`,
`packages/db/src/configuration-transfer.ts` (add `{ name: "custom_themes" },` after `:72`;
`tenant_themes` stays until Task 10), `packages/composition/package.json`
(`"@waitron/layouts": "workspace:*"`; `pnpm install`; commit the lockfile),
`packages/composition/src/modules.ts` (`:117`), `packages/composition/src/composition.test.ts`,
`apps/server/src/configuration-transfer.test.ts`.

**Interfaces — Produces:**
`export function validateThemeConfiguration(tables: Readonly<Record<string, readonly Record<string, unknown>[]>>): void`,
throwing `AppError("setup.request_invalid", { field })` with these fields, checked row by row in
this order, then across rows:

| Field | Refused when |
| --- | --- |
| `custom_themes.name` | not a string, `checkThemeName` refuses it, or it differs from its trimmed form |
| `custom_themes.name_key` | not `themeNameKey(name)` (D4) |
| `custom_themes.in_use` | neither `null` nor `1` |
| `custom_themes.theme` | not a string, not JSON, or `readThemeDocument` refuses it |
| `custom_themes.in_use` | (across rows) more than one row holds `1` |
| `custom_themes.name_key` | (across rows) two rows share a key |

A bundle row's `theme` is the column's text: the export reads `select *`
(`packages/provisioning/src/configuration-transfer.ts:289-292`). Every module's `validate` receives
the whole `bundle.tables` (`:611-614`, the call at `:613`), so the order modules run in does not limit what this check
can read; slice 7's logo check reads `tables.media_images` from the same argument.

In `modules.ts` the core entry's `configurationTransfer` becomes `CORE_TRANSFER`:
`{ ...CORE_CONFIGURATION_TRANSFER, validate: (tables) => { CORE_CONFIGURATION_TRANSFER.validate(tables); validateThemeConfiguration(tables); } }` (D2).

- [ ] **Step 1: Write the failing tests.** `theme-configuration.test.ts`: a valid two-row bundle
  (one `in_use: 1`, one `null`) passes; a hard-to-read one (the lemon, unfixed) passes; one `it.each`
  per row of the table above refuses with its field; an absent `custom_themes` passes.

  `composition.test.ts`, in "ALL_MODULES configuration transfer contribution" (`:135`): "the core
  module refuses an invalid theme row and still runs its own checks" — the core module's `validate`
  with `{ custom_themes: [{ …, theme: '{"tokens":{}}' }] }` throws `custom_themes.theme`, and with
  `{ kitchen_stations: [{ colour: "invalid-colour" }] }` throws `kitchen_stations.colour` (the control
  that `validateCoreConfiguration` still runs).

  `apps/server/src/configuration-transfer.test.ts`, three cases in the shape of the station-colour
  case (`:2383-2415`: source venue, `buildConfigurationBundle`, `applyVenue(…, beforeCommit:
  importConfigurationTables…)` into `targetSuite`):
  - "carries the custom themes and which one is in use": two themes stored on the source, one in use →
    the target holds both names, `choices` and `name_key`, exactly one row in use, its name the
    source's, and new ids.
  - "refuses a copy with two themes in use without keeping venue rows": both rows' `in_use` set to
    `1` in the bundle → `setup.request_invalid { field: "custom_themes.in_use" }`, `tenants` count 0.
  - "refuses a copy whose name key is not its name's": `name_key` edited → `custom_themes.name_key`.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/layouts exec vitest run src/theme-configuration.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t "custom themes|two themes in use|name key"`
  — FAIL: the module does not resolve; the composition case does not throw; the bundle has no
  `custom_themes`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run, expect pass**, then `pnpm --filter @waitron/layouts test:coverage`,
  `pnpm --filter @waitron/composition test:coverage`,
  `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts`, the whole
  `apps/server/src/configuration-transfer.test.ts` and `configuration-import.test.ts`, and
  `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts`.

- [ ] **Step 5: Commit** — `git commit -s -m "Carry custom themes in a configuration copy and check them on import"`.

---

### Task 10: Drop `tenant_themes` (migration 2 of 2) and move the bundle to format 6

Risk trigger: a migration; the configuration bundle's format.

**Files:** Delete `packages/db/src/schema/tenant-themes.ts`. Generated `packages/db/drizzle/0183_*.sql`
and meta. Modify `packages/db/src/schema/index.ts` (drop `:43`), `packages/db/src/index.ts`
(drop `:174`), `packages/db/src/classification.ts` (drop `:141`),
`packages/db/src/configuration-transfer.ts` (drop `{ name: "tenant_themes" }`, `:72`),
`scripts/schema-constraints.test.ts` (drop `"tenant_themes_singleton_ck"`, `:795`),
`packages/provisioning/src/configuration-transfer.ts` (`:138` `version: 6`, `:172` `version: 6;`,
`:483` `> 6`, `:486` `!== 6`), `packages/provisioning/test/configuration-bundle.ts:5`,
`packages/provisioning/src/configuration-transfer.boundaries.test.ts:51`,
`apps/server/src/configuration-import.test.ts` (`:49`, `:141`, two new rows after `:139`),
`apps/server/src/configuration-transfer.test.ts` (`:400`, `:4384`),
`docs/developers/conventions-data.md` (`:1625-1627`), `docs/developers/design-system.md`
(`:5063-5065`).

`apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:247` keeps its
`"tenant_themes": []`: it is a format-1 export, refused as outdated, as it must be.

- [ ] **Step 1: Change the tests first.** `configuration-import.test.ts`: `bundle.version` 6 (`:49`);
  "future version" `{ version: 7 }` (`:141`); add "A841 pre-theme-retirement export with a theme"
  `{ version: 5, tables: { ...bundle.tables, tenant_themes: [{ id: 1, theme: '{"tokens":{}}', updated_at: "2026-10-01T00:00:00.000Z" }] } }`
  and "A841 pre-theme-retirement export without themes" `{ version: 5 }`, both expecting
  `setup.configuration_outdated` through the existing `it.each` (`:96-215`).
  `configuration-transfer.test.ts:400` and `:4384` → 6; `configuration-bundle.ts:5` → 6;
  `boundaries.test.ts:51` → `{ version: 7 }`.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts` — FAIL: the two
  new format-5 rows are accepted past the version check, and the format-6 bundle is refused.

- [ ] **Step 3: Retire the table and generate.** Delete the schema file and make the edits in
  **Files**, then `pnpm --filter @waitron/db exec drizzle-kit generate --name retire_tenant_themes`. Read the SQL:
  expected exactly `DROP TABLE \`tenant_themes\`;` (`output-migration-sql.txt`). Nothing references
  `tenant_themes` (`git grep -i 'references.*tenant_themes' apps packages` printed nothing, design
  line 2109), so the drop deletes no other rows. Then the format-5 → 6 edits and the docs:
  `conventions-data.md:1625-1627` gains "and A841 slice 2 (format 6, 2026-10-21, when it replaced
  `tenant_themes` with `custom_themes`)" and pins format 6; `design-system.md:5063-5065` reads
  "custom themes" for "tenant themes" and "format 6" for "format 5".

- [ ] **Step 4: Run, expect pass.** The step 2 command; then every migration guard of Task 3 step 4
  again (the list and `inmutabilidad.test.ts`); `pnpm --filter @waitron/provisioning exec vitest run`;
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts`;
  `pnpm --filter @waitron/db typecheck`, `@waitron/provisioning typecheck`, `@waitron/server typecheck`.
  Then `git grep -n -i "tenant_themes\|tenantThemes\|tenant-themes" -- ':!packages/db/drizzle' ':!docs/superpowers' ':!docs/backlog*' ':!docs/developers/grants-retirement-audit.md' ':!apps/server/src/testing/fixtures'`
  prints only the new format-5 test rows.

- [ ] **Step 5: Commit** — `git commit -s -m "Drop tenant_themes and move configuration copies to format 6"`, the
  body saying a format-5 copy is now refused as outdated and why (a format-5 copy carries
  `tenant_themes`, which the import would otherwise refuse with the generic `tables` refusal,
  `packages/provisioning/src/configuration-transfer.ts:565-569`).

---

## Driver steps (not implementer tasks)

- **`/finish-branch`** with this worktree's path and this plan's path. The run-it seat runs as two
  reviews (a risk-trigger branch). Do not merge; landing waits for the owner's `/land-branch`.
- **The backlog and backlog-adjacent docs, at land time** (the last commit, right before
  `/land-branch`; docs only):
  - `docs/backlog.md`, the A841 entry (find it by "Next: slice 2 (the stored themes and the
    server)"): replace from "Next: slice 2" to the end of that sentence group with "Slice 2 landed
    (#<PR>): custom themes stored in `custom_themes` (`tenant_themes` retired), their routes, the
    theme in use served at `/api/theme`, the till's `themeHash`, and configuration copies at format
    6. Next: slice 3 (delivery)."
  - `docs/backlog.md` "`tenant_themes`: decide the remaining DELETE restriction (A805 follow-up)"
    (by its title): delete it — the table is gone, and deleting a custom theme is an intended path
    (design line 2149).
  - `docs/backlog.md` and `docs/backlog/dashboard.md`, the `--wt-color-primary-text` entry: rewrite
    to what is left, not delete it. A venue's custom theme now writes `--wt-color-primary-text`,
    `--wt-color-primary-hover` and the two primary disabled colours from its own button colour
    (`THEME_COLOURS`), so "a tenant theme cannot set it" is gone; what stays is a deployment that
    overrides `--wt-color-primary` or `--wt-color-danger` by hand (design-system.md "Retheming a
    deployment") and the danger hover and disabled colours, which no theme writes. The design (line
    2146) says this entry "closes"; it does not, for those two reasons — say so in the commit.
  - `docs/backlog/architecture.md:409`: drop "`tenant_themes*`, " from the parenthesis.
  - `docs/backlog/kitchen.md:291`: append "**2026-10-21:** A841 slice 2 moved it to version 6."
  - `docs/developers/grants-retirement-audit.md`: below the table holding the `tenant_themes` row
    (`:131`), one dated line: "2026-10-21: `tenant_themes` was dropped by A841 slice 2
    (`custom_themes` replaced it)." — a pointer, not a rewrite (CLAUDE.md §6).
  Commit with `git commit -s`.

---

## What was checked (every reader of what this slice retires)

`git grep -n -i 'tenant_themes\|tenantThemes\|tenant-themes\|THEMEABLE_TOKENS\|MAX_THEME_VALUE_LENGTH\|validateThemeOverride\|ThemeOverride\|management-api/theme\b\|getTenantTheme\|putTenantTheme\|theme-registry\|theme-store\|tenant theme\|tenant_theme'`
over the whole tree less `docs/superpowers`, `docs/handoffs` and `packages/db/drizzle` found, and
this plan handles:

- `apps/server/src/management-api.ts:80,82,1260-1289` and `:260` (`theme.invalid`) — Task 4.
- `apps/server/src/management-api.canvas-retirement.test.ts:14,138-235` — Tasks 4 and 8.
- `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:247` — kept (Task 10).
- `apps/till/src/layout.ts:58` — Task 4.
- `packages/layouts/src/{index.ts:28-29,79, index.test.ts:7, theme.ts, theme.test.ts, theme-store.ts, theme-store.test.ts, theme-registry.test.ts, errors.ts:45-49, errors.test.ts:16-28}` — Task 4.
- `packages/db/src/{schema/tenant-themes.ts, schema/index.ts:43, index.ts:174, classification.ts:141, configuration-transfer.ts:72}` and `scripts/schema-constraints.test.ts:795` — Task 10.
- `docs/developers/design-system.md:199-200,210,218` — Task 4; `:5063-5065` — Task 10.
- `docs/developers/grants-retirement-audit.md:131`, `docs/backlog.md:3178-3179,4605,6454`,
  `docs/backlog/architecture.md:409`, `docs/backlog/dashboard.md:1230-1234` — driver step.
- `packages/db/drizzle/0000_baseline.sql` and every snapshot to `0181` — shipped migrations, never
  edited (CLAUDE.md §3).

Also searched, nothing found: `theme.invalid`, `custom_themes`, `/api/theme` and `themeHash` outside
the files above and `docs/backlog.md:3200`; "stored theme", "tenant theme" and "themeable" in
`docs/developers`, `CLAUDE.md`, `README.md` and the user guides (`apps/server/src/guide`); `theme`
in `packages/layouts`' and `packages/db`'s READMEs (layouts has none). The bundle format: `git grep
"version: 5\|version !== 5\|> 5\b"` and `version).toBe(5)` over `apps`, `packages` and `scripts` —
every hit is listed in Task 10 except the menu-version and bill-editor fixtures in
`apps/dashboard` and `apps/till`, which are not bundle formats.

## Changed test checks

Every existing assertion this plan changes, and the design line that changes it:

| Assertion | Change | Design |
| --- | --- | --- |
| `management-api.canvas-retirement.test.ts:146-235`, the six theme cases | rewritten for `/management-api/themes` and the new document; each refusal kept (unknown token → unknown colour, missing body field, staff 403, no session 401) | §15, lines 2381-2382; §11, "Today's `/management-api/theme` routes go" (line 2124) |
| `packages/layouts/src/theme-store.test.ts`, five cases | replaced by Task 5's store suite; the gate-before-write and validate-before-write cases kept in the new form | §16 item 2, lines 2514-2518 |
| `packages/layouts/src/theme.test.ts` | deleted with `validateThemeOverride`; Task 1's document cases replace it | §11 "Retired", lines 2141-2145 |
| `packages/layouts/src/theme-registry.test.ts` | deleted | §14, lines 2292-2295 |
| `packages/layouts/src/index.test.ts:7` | `validateThemeOverride` is no longer exported | §11, line 2143 |
| `packages/layouts/src/errors.test.ts:16-28` | `theme.invalid` carries `field` and `reason`, not `token` and `maxLength` | §11 "Error code", lines 2126-2133 |
| `apps/server/src/till-api.test.ts:1220-1258` | gains `themeHash` | §12, lines 2224-2228 |
| `scripts/schema-constraints.test.ts:795` and the two lists | `tenant_themes_singleton_ck` leaves; three `custom_themes_*` names join | §14, lines 2324-2326 |
| `apps/server/src/configuration-import.test.ts:49,141` | format 6; "future" is 7 | §16 item 2, lines 2507-2513 |
| `apps/server/src/configuration-transfer.test.ts:400,4384` | format 6 | same |
| `packages/provisioning/test/configuration-bundle.ts:5`, `configuration-transfer.boundaries.test.ts:51` | format 6; "future" is 7 | same |

## Left for later slices

- **Slice 3** applies `/api/theme` in the apps, adds the dashboard's live theme read, and the till's
  `#applyVenueSetup` swap; the forced Light/Dark computed-value case of Task 2 is not the Follow
  device probe, which is slice 3's.
- **Slice 7** adds `logo` and `printedLogo` to `THEME_DOCUMENT_KEYS` (optional, default `null`, D3),
  the logo's facts to `themeCacheKey` (D10) and to `/api/theme`'s `logo`, and the logo's import check
  to `validateThemeConfiguration`.
- **Slices 10 and 11** add `textScale` and `text` the same way, and the type tokens to the sheet
  through `THEME_TOKENS`.
- **Slice 5** rewrites `design-system.md:189-218` wholesale (design line 2528); Task 4's three
  sentences only stop it naming retired code.
- **Slice 13** adds `PATCH` and `DELETE /management-api/themes/{id}` with `renameCustomTheme` and
  `deleteCustomTheme` in `packages/layouts/src/theme-store.ts` (D13), and their section 15 cases:
  rename and delete change only their row; a rename to another form of the theme's own name
  succeeds; deleting the theme in use leaves no row in use and `/api/theme` empty, with the control
  that deleting a theme not in use leaves the hash; `theme.not_found` for both. It also words
  `theme.name_taken`, `theme.invalid` with `field: "name"` and `theme.not_found` in the dashboard's
  strings.
