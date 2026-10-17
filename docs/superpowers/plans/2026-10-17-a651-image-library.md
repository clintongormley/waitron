# A651 Image Library Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans`; implement inline, task by task. The owner approved unattended execution and campaign finish/land. Do not request another design or workflow confirmation.

**Goal:** Upload photos by dropping or choosing files, simplify library tiles, and select a photo from the picker's full-size view.

**Architecture:** Add `wt-file-input` in `packages/ui`, consuming the existing shared field styles without moving account controls. Keep editor drafts, page batches and tile/viewer actions in the existing media dashboard. Reuse `ImageApi.uploadImage(file, { names })` and the existing picker event path.

**Tech stack:** TypeScript, Lit, existing UI tokens, Vitest browser mode with real Chromium, axe.

**Spec:** [catalogue.md A651](../../backlog/catalogue.md#a651--drop-photos-to-upload-them-and-tidy-the-image-library-and-its-picker). Inspect all six [PNG boards](../../backlog/mockups/a651-image-library/): `1-library-page.png`, `2-dragging-photos.png`, `3-after-the-drop.png`, `4-picker.png`, `5-picker-full-photo.png`, `6-upload-window.png`. Text wins over boards.

## Constraints and settled choices

- Read `CLAUDE.md` and developer `conventions-ui.md`, `design-system.md` (Forms, primitives, events), `testing-guide.md`, `writing-claims.md`, `workflow-guide.md` and `ci-and-gates.md` before execution. Read the TDD skill before writing any implementation or test.
- This plan changes browser UI only. No fiscal, database, migration, server, framing/replacement (A652), or A740 work; no new dependencies or transport API.
- Source inspection, not runtime verification: `packages/media/src/dashboard/client.ts:71` exposes one multipart upload returning `{ image, created }`, with no progress callback; `image-picker.ts` embeds `dashboard-image-library`; `apps/dashboard/src/widgets/image-upload.ts:351` receives write-busy events and selection. These support sequential uploads and completed-file counts, not byte percentages.
- Batch upload is on the standalone library page. The picker retains Upload photos opening its single-photo editor. Page-level drops never write through a picker or an open editor, viewer or delete dialog. Prevent browser file-drag navigation even when a drop cannot act; a drop on the editor's field belongs only to that field.
- Run one batch at a time, in chosen order; disable another batch/editor launch while it runs. Continue after failures. Snapshot the default content language at batch start. Count successful responses, including reused duplicates, in “2 of 3 photos uploaded.” Track processed failures separately so completion never implies every file succeeded.
- Show queued/uploading rows or tiles with filenames and an indeterminate active indicator; do not invent byte progress. Give each failure its filename and localized `codeMessage(codeOf(error))`. Keep errors and duplicate notices through refresh until the next batch; no automatic retries.
- New badges belong only to IDs returned with `created: true` in this mounted library session. Reuse duplicates without renaming or PATCHing them, with the existing duplicate wording and retained-name explanation. Merge/deduplicate by image ID when refreshed rows arrive. A successful edit updates the retained copy; a confirmed delete evicts it and its New badge.
- Preserve current search, relevance/date/name sorting, direction and pagination; do not switch to newest-first because a board shows it. Refresh through the existing query controller, retaining action errors separately from load errors. Keep newly created results visible in a temporary batch-results area if filters/page exclude them.
- Filename naming: remove the final extension, replace runs of dashes/underscores with spaces, trim and capitalize the first letter using `capitaliseFirst` with the content default language. Preserve remaining case/accents and internal dots. If the result is empty, use the original trimmed filename, then the localized Photo label as a last fallback. Do not truncate; server metadata limits remain authoritative.
- In the editor, fill only the default-language name when blank or still equal to the previous generated suggestion. Preserve manual names and other translations on replacement. Clearing removes only an unchanged generated suggestion, preserving the existing clean-baseline behavior. Configuration changes never move a suggestion to another language.
- `accept="image/jpeg,image/png,image/webp"` and “JPEG, PNG or WebP, up to 20 MB” are chooser guidance. Send chosen/dropped bytes to the existing server validation; do not reject files by MIME, extension or size in this UI. Keep a keyboard-accessible chooser.
- All copy has EN/ES entries in media `strings.ts`; pass localized field copy into the primitive. All chrome uses declared `--wt-*` tokens. Keep save-state, field-refusal, draft and passive-read contracts.

## Review focus

1. Native file events and nested drops cause exactly one change/upload; disabled fields cannot act (Tasks 1–3).
2. File replacement, clear, disconnect and late responses release URLs and cannot overwrite another draft/session (Tasks 1–3).
3. Mixed success/duplicate/failure batches finish, retain named outcomes and never relabel reused metadata (Task 3).
4. Refresh/live snapshots, filtering and language changes preserve drafts, error ownership and unique visible results (Tasks 2–3).
5. Real pointer/keyboard menu actions and nested viewer closes preserve picker selection and focus (Task 4).

## Task 1: Reusable file field

**Files:** Create `packages/ui/src/components/wt-file-input.ts`, `wt-file-input.test.ts`, `wt-file-input.a11y.test.ts`; export in `packages/ui/src/index.ts`; add examples in `packages/ui/demo/main.ts` and the primitive contract in `docs/developers/design-system.md`.

**Interface:** `WtFileInput`: `name`, `label`, `hint`, `accept`, `error`, `locale` strings; `required`, `invalid`, `disabled`, `multiple`, `compact` booleans; `.files: File[]`; `.copy: { drop: string; choose: string; replace: string; previewAlt: string }`. Emit `wt-change` with `detail: { files: File[] }`, bubbling and composed, using `dispatchWtChange` to stop the native trigger. Callers supply `currentLocale()` for size formatting. No upload API inside the field.

- [ ] RED: Write behavioral cases for single/multiple chooser and drop, first file only in single mode, empty/cancelled chooser, same-file reselection, controlled clear/replacement, disabled chooser/drop, non-file drags and nested drag transitions. Assert one custom event with exact File identities, flags and no escaped native input/change/drop; cancel emits nothing.
- [ ] RED: Add token-painting assertions for empty/selected/required/error/disabled/drag/focus states, danger-colored asterisk, field max-width and minimum tap targets. Add axe checks for these distinct states, single/multiple, in both themes.
- [ ] Run `pnpm --filter @waitron/ui test -- src/components/wt-file-input.test.ts src/components/wt-file-input.a11y.test.ts`; observe intended failures before implementation, not an unrelated import/harness failure.
- [ ] GREEN: Build from `baseStyles`, `fieldStyles`/`fieldLabel`, delegated focus and real native file chooser. Render a token-painted dashed drop area, selected preview(s), filename, localized size and Choose another; compact mode serves the page's single-line chooser. Associate label/hint/error within the shadow root; forward required/invalid/disabled/name and make `focusFirstInvalid` reach the chooser. Keep Enter/Space usable without submitting the enclosing editor.
- [ ] Own preview URLs in this component: create only for selected files, revoke on replacement/clear/disconnect, recreate on reconnect; programmatic assignment emits no change. Do not clear selection on chooser cancellation; reset the native chooser after reading it to permit reselection.
- [ ] Remove a label association temporarily and watch the accessibility check fail, then restore.
- [ ] Run the same focused command to PASS with nonzero test counts, plus `pnpm --filter @waitron/ui test -- src/no-hardcoded-chrome.test.ts`; document the new field/drop styling and add workbench states.

## Task 2: Stage one photo and suggest its name

**Files:** Modify `packages/media/src/dashboard/image-library.ts`, `strings.ts`, `image-library.test.ts`, `image-library.save-state.test.ts`, `image-library.unsaved.test.ts`, `image-library.a11y.test.ts`, `image-library.narrow.test.ts`; create `image-filename-name.ts` and `image-filename-name.test.ts` alongside them.

**Interface:** `imageNameFromFilename(filename: string, locale: string, fallbackName: string): string`; pass the content default language and `t("image.file")`. The editor consumes `wt-change.detail.files[0] ?? null` and binds `.files` back from its draft. The field owns local previews; the editor keeps the stored-image preview when editing existing metadata.

- [ ] RED: Pin `patatas-bravas.jpg` → `Patatas bravas`, underscores, uppercase extension, multiple dots, accents, empty stem/name fallback. Pin filename suggestion in the content default language even when UI language differs; replacement changes an untouched suggestion but preserves a manual name; clear restores the original blank draft only when no manual changes remain.
- [ ] RED: Choosing/dropping fills the field with no upload until Save. Assert exact Save multipart metadata, optional translations retained, red Photo required mark, invalid-field focus, refused-file retry still enabled, URL cleanup, Keep/discard and late-write protection. Keep successful-save/failed-refresh assertions unchanged.
- [ ] Run `pnpm --filter @waitron/media test -- --project browser src/dashboard/image-filename-name.test.ts src/dashboard/image-library.test.ts src/dashboard/image-library.save-state.test.ts src/dashboard/image-library.unsaved.test.ts src/dashboard/image-library.a11y.test.ts src/dashboard/image-library.narrow.test.ts`; record intended RED cases.
- [ ] GREEN: Replace the native file label/input with required `wt-file-input name="image-file"`; remove the editor's duplicate local preview URL owner. Wire file changes into existing draft/refusal handling, apply the naming rule and preserve generations, `saveActionState`, attempted validation and close-before-refresh.
- [ ] Add EN/ES drop/choose/replace/format guidance, preserving the singular upload-dialog title. Rerun the focused command to PASS; adapt test access through the new field's shadow root without weakening assertions.

## Task 3: Direct page batches and refresh

**Files:** Modify `packages/media/src/dashboard/image-library.ts`, `strings.ts`; create `image-library.batch.test.ts`; extend `image-library.a11y.test.ts`. Keep `client.ts` and its wire assertions unchanged.

**Interface:** Private `#uploadBatch(files: File[]): Promise<void>` calls the existing API sequentially. Store a per-file stable queue identity, File, status (`queued|uploading|uploaded|reused|failed`), returned image/error, plus session-created IDs; duplicate filenames remain separate outcomes.

- [ ] RED: Use deferred API responses for three files: created, failure, reused. Assert only one active upload, exact default-language names, no editor, continued third upload, 2/3 successful count, completed state despite failure, filename-specific localized error, reused metadata unchanged and New only on the created ID. Test all-fail, repeated filenames and two files returning the same image ID. Pin one-photo progress in EN/ES, rename outside the query, delete after a positive refresh control, disabled Edit/Delete while uploading, and an old finally leaving a newer batch busy.
- [ ] RED: Exercise whole-page file drag/drop and multiple chooser, “Drop 3 photos to upload them” when the count is available (generic wording otherwise), singular/plural copy, nested enter/leave without flicker, non-file drags, prevented navigation, disabled second batch, and drops inside/outside an open editor or picker. Assert the editor field stages one file and page handling performs zero immediate writes there. Cover uploading/mixed-result axe states in both themes before implementation.
- [ ] RED: Pin refreshed results appearing during the batch, unique IDs, filtered/paginated successes still visible, failed refresh reported as load failure without resubmission, live recovery retaining action errors, unchanged drafts, and disconnect/reconnect ignoring old completions and sending no remaining queued uploads.
- [ ] Run `pnpm --filter @waitron/media test -- --project browser src/dashboard/image-library.batch.test.ts src/dashboard/image-library.a11y.test.ts`; observe the intended RED cases.
- [ ] GREEN: Render “Drop photos anywhere on this page to upload them, or choose files” with compact multiple `wt-file-input`, counted drag overlay and accessible live progress/outcomes. Bind page file-drag listeners only while mounted; remove them/reset drag depth on disconnect. Prevent navigation before action gating; let the field stop its own drop. Guard batches by connection/session generation and modal/picker state.
- [ ] Snapshot files then reset the page field for reselection. Await each upload, record each outcome, refresh successful results through `#load(true)` and reconcile returned images with query snapshots. Clear only load errors on read recovery. Revoke any queue-owned preview URLs on settlement/reset/disconnect; no fake percentage bar.
- [ ] Run the same focused command to PASS; extend both-theme axe coverage for empty queue, uploading, mixed results and named errors.

## Task 4: Tile menus and picker full-size selection

**Files:** Modify `packages/media/src/dashboard/image-library.ts`, `strings.ts`, `image-library.test.ts`, `image-library.narrow.test.ts`, `image-library.a11y.test.ts`, `image-picker.test.ts`; extend `apps/dashboard/src/widgets/image-upload.test.ts` for the real nested selection path. Keep the picker wrapper/API injection and dashboard upload widget behavior unless the new regression requires wiring changes.

**Interface:** One private `#select(image: LibraryImage): void` emits the existing `select-image` event with the image itself; tile and viewer call it. Viewer selection invalidates its pending usage read before dispatch.

- [ ] RED: Assert standalone primary Upload photos still opens the single editor; picker hides only the inner heading, retains Upload photos, and has full-width secondary Use image per tile. Assert no visible Preview chip, unchanged named keyboard thumbnail button, name-adjacent localized row menu, Edit/Delete behavior and closed popover after a real `userEvent.click`.
- [ ] RED: Assert picker viewer has primary Use image beside secondary Back, dispatches once with exact metadata, closes through the outer widget and changes no stored image. Back/Escape return to the grid with thumbnail focus; closing nested viewer does not close picker; late usage reads do not reopen it. Standalone viewer keeps Close and has no selection action.
- [ ] Run `pnpm --filter @waitron/media test -- --project browser src/dashboard/image-library.test.ts src/dashboard/image-library.narrow.test.ts src/dashboard/image-library.a11y.test.ts src/dashboard/image-picker.test.ts` and `pnpm --filter @waitron/dashboard test -- src/widgets/image-upload.test.ts`; observe intended RED cases.
- [ ] GREEN: Use `wt-row-actions align="end"` with image-specific accessible label and Edit/Delete buttons `align="start"`; do not stop action clicks. Preserve the existing delete confirmation/usage safeguards. Keep grid Use image secondary (theme surface, white in light mode), full-size Use image primary; add EN/ES Back and plural upload/action labels.
- [ ] Run both focused commands to PASS. Preserve existing viewer proportions, responsive wrap thresholds, use links, preview keyboard behavior and deletion semantics.

## Assertion changes allowed by A651

- Replace only old inline Edit/Delete placement/one-line spacing expectations with name/menu alignment, reachable actions and menu containment at the same widths/themes/locales. Keep overflow, tap-target and full-width Use image assertions.
- Replace visible Preview-chip text assertions with chip absence; retain the thumbnail's accessible Preview name and Enter/Space behavior. Remove only the picker's redundant inner-heading expectation; retain the outer title.
- Page/picker launch text becomes Upload photos; upload editor title stays Upload photo. Add viewer selection/Back expectations only in picker mode; standalone Close assertions remain.
- File selection now supplies a default name; update only exact empty/generated-name expectations. Explicitly clear that suggestion where an existing case tests a missing name. Preserve manual-name, exact metadata, opaque File identity, clean-on-clear, draft protection, retry, duplicate and late-response assertions. Move native-control selectors into the field shadow root rather than deleting their assertions.

## Task 5: Visual verification and approved campaign finish

- [ ] Run the focused commands above after integration, including `client.test.ts` and dashboard `image-upload.unsaved.test.ts`/`image-upload.a11y.test.ts`. Read nonzero Tests counts. Use measured memory headroom for Chromium concurrency; keep coverage thresholds `98/98/98/95`, no exclusions or blanket workspace suite merely to finish.
- [ ] Inspect real rendered library, drag overlay, partial batch, picker grid/full-size viewer and upload empty/selected/error/disabled states against all six boards in EN/ES × light/dark × 390/1280. Use `page.viewport`, record `window.innerWidth`, load real image fixtures/icons, save ignored `__screenshots__/look/` PNGs and open them. Check keyboard chooser, focus, menu clipping, names/sizes, tap targets and horizontal overflow; wait for actual `wt-close` events.
- [ ] Update `docs/developers/design-system.md` for the field contract and remove only finished A651 detail from `docs/backlog/catalogue.md`; narrow the combined index in `docs/backlog.md` to A652, preserving its independent scope. Retain owner decisions in the catalogue area's Decisions and deliberate limits; audit changed prose for retired behavior, including `docs/content-and-images.md`.
- [ ] Review the diff and assertion-change inventory, sign off implementation commits with `git commit -s`, announce readiness for `finish-branch`, then continue under the existing campaign authorization. After the initial rebase, obtain one Claude whole-branch run-it review via `~/workspace/tools/claude-seat.sh review-run <candidate-checkout> <brief-file> <report-file>` in a disposable complete candidate checkout with frozen dependencies. Require completed findings/experiments, retain the report and fix justified findings inline with focused RED/GREEN checks.
- [ ] Use the normal pre-push hook, never bypass it. Verify actual selected affected/dependent packages and required coverage/merge jobs on the current head SHA; a skipped or unselected job is no receipt. Reinspect/retest affected behavior after rebases without repeating the approved whole-branch review solely for a rebase.
- [ ] Continue the campaign-approved `land-branch` workflow with its shared-main locking/cleanup rules and resolved conversations; no extra confirmation. Verify merge, main install, local/remote feature cleanup and the merge's own CI run/result. Record any genuinely blocked step instead of declaring completion.
