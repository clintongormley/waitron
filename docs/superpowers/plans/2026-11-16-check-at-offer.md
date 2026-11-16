# CHECK-AT-OFFER implementation plan

**Authority:** queued ask “Check everything at the offer, while the old box still sells”
(`docs/backlog/replication-cloud.md:565–570,592–602`; runner dispatch). No owner plan approval.
**Reviewed by Claude (initial and corrections reads); cleared by the watcher, 2026-11-16 09:50.**
Watcher correction, 10:33: `copyBytes` estimates logical size; repacking and later sales can change
the final size. Keep the WAL proof and actual-size acceptance check; no archive upper-bound claim.
One PR; no table, migration, fiscal-invariant, rotation, or recovery-workflow changes.
Paths: `S` = `apps/server/src`, `H` = `packages/handover/src`, `D` = `apps/dashboard/src`.
**Deployment limit:** use the same build on both boxes. Old offer shapes refuse before recording;
an old stored final indicator cannot resume after this format change. Finish handovers before
updating, or reset the preproduction test installation. No upgrade gate or compatibility layer:
`CLAUDE.md` forbids that work before go-live. `S/upgrade-checks.ts` has no handover-state check
(source read only); deployment between stepdown and placement is not prevented by this change.
Repeat this deployment limit in the PR description.

**Result:** refuse an undersized destination or different encryption keys before stepdown;
the source keeps selling and the destination records no operation/event. Matching keys and room
pass. Keep the later room check for growth and the existing stored-offer replay semantics.

**Read findings:** final comparison also constructs `OfferSettings` (`S/handover-compare.ts:340–365`).
Capture uses `archiveTo`'s `VACUUM INTO` (`S/handover-capture.ts:107–109`). Received becomes
accepted by rename (`S/handover-acceptance.ts:64`), then placement writes another file
(`S/handover-place-copy.ts:203–213`). Budget **two additional copies at offer**; the existing
database already occupies space. Acceptance needs **one additional copy plus floor**
(`S/handover-destination-duty.ts:516–527`), since the accepted copy already exists.

1. **Compare keys throughout the existing path.** In `H/manifest.ts`, replace `ringVersions`
   with `ringKeys: readonly { version: number; sha256: string }[]` on `NodeLocalItem`; use that
   shape in `OfferSettings`, `readOfferSettings`, `parseOfferSettings`, and
   `offerSettingsDifference` in `S/handover-manifest.ts`. Hash each current/previous key's **raw
   Buffer** with existing `sha256Hex`, sort by version, and require each offered version/hash
   on the destination; extra destination keys and different current/previous positions may pass.
   Update `H/{indicator,indicator-parse}.ts` and `S/handover-compare.ts` together, requiring a
   nonempty list, unique positive safe-integer versions and lowercase SHA256 digests, using the
   existing validation helpers. No version-only fallback. Update touched manifest wording.
   Never serialize/log keys or include hashes in refusals.
   **Tests:** `S/handover-manifest.test.ts`: “fingerprints raw current and previous keys
   without exposing them” (assert offers/indicators exclude raw/hex/base64 keys);
   `S/handover-destination-api.test.ts`: “same version with different key bytes refuses without
   recording”; retain “a ring version this box holds beyond the offer's is no difference”.
   `S/handover-compare.test.ts`: “same-version key replacement
   after the offer refuses the final copy”. Extend `H/{indicator,indicator-parse}.test.ts` for
   missing/malformed/duplicate entries and canonical ordering; preserve behavioral assertions.

2. **Sign the size and refuse before recording.** Add `readOfferCopyBytes(db: Database): number`
   in `S/handover-manifest.ts`: use the existing `db.all(sql...)` API to read
   `pragma_page_count()` × `pragma_page_size()` in one statement as the current copy budget.
   Prove it with WAL-backed data; no live-main-file stat alone, checkpoint, or offer-time archive.
   Sign top-level `copyBytes` in `S/handover-source-start-api.ts`, outside settings so growth
   does not trigger `settings_changed`.
   In `S/handover-destination-api.ts`, require a positive safe integer whose doubled budget plus
   floor is safe; reject absent/null/text/fractional/overflow values as `handover.request_invalid`.
   Add `venueDir` and optional existing `Statfs` seam to destination dependencies; wire `venueDir`
   in `S/boot.ts`. After existing checks, before `beginHandoverFromOffer`, compare
   `2 * copyBytes + START_FREE_SPACE_FLOOR` with `lowestFreeBytes([stateDir, venueDir], statfs)`.
   Refuse null or insufficient room as new `handover.no_room_at_offer`; call the route logger with
   `neededBytes` and `availableBytes` before throwing, with no public params. Register in `S/errors.ts`
   and both route status maps and the source's `OFFER_REFUSALS` whitelist. Preserve replay's
   early stored answer and source retry's original signed envelope, including its original size.
   **Tests:** `S/handover-manifest.test.ts`: “WAL-only growth is included in the offer copy budget”
   (disable auto-checkpoint, commit growth, assert the main-file size stays unchanged and below
   the logical-size estimate). `S/handover-destination-api.test.ts`: “one byte below two
   copies plus floor refuses without recording”, exact-boundary pass, `venueDir` being lower,
   neither reporting space, malformed sizes, old-shape offer refusal before recording, and replay
   after room disappears; assert the refusal log carries both amounts. The lower-folder case checks wiring. In
   `S/handover-source-start-api.test.ts`, use its real spare route for “no room or wrong same-version
   key leaves the source selling and the destination unrecorded”; assert no stepdown/restriction,
   source abandonment, exact 409 code and logs excluding key bytes. Add “source growth retries the original signed offer”.
   Retain/run `S/handover-compare.test.ts`'s “one byte short nothing is posted; a pass goes on to
   post once room appears”; give its copy a size larger than the offered estimate to check growth.

3. **Finish the contract and words, then focused verification.** Update affected fixtures/wiring
   in `S/{boot.handover-destination,boot.restricted,handover-capture,handover-place-copy,handover-relinquish,
   handover-two-boxes,handover-browser.e2e,peer-route-limits,promote-api.handover,promote-endpoint-e2e,
   read-only-exemptions}.test.ts` and `S/testing/place-copy-box.ts`. Other `readOfferSettings`
   readers (`S/{adopt,spare-settings-api}.test.ts`) consume settings digests; retain those checks.
   In `D/i18n/codes.ts`, give `no_room_at_offer` EN/ES words: the spare could not confirm enough
   room for two whole copies plus the startup reserve, this attempt ended while the source keeps
   selling, choose Stop, make room on the spare, then hand over again. Broaden `key_ring_mismatch`
   to missing **or different** keys; choose Stop and rejoin
   before handing over, without claiming either box's selling state. Keep `no_room_to_place` confined
   to post-stepdown acceptance. Its setup consumer (`apps/setup/src/screens/handover-screen.ts:1093`)
   uses `handover.space`; no setup flow change. Add
   “offer-space and key refusals give truthful next steps in EN and ES” to `D/i18n/codes.test.ts`;
   run existing `D/screens/servers-screen.handover.test.ts` refusal/retry checks. Update
   `S/guide/{en,es}/servers.md#hand-over`. Delete the completed bundle, both entries/index lines
   in `docs/backlog{.md,/replication-cloud.md}`; remove A1273's stale version-only comparison claim
   while retaining its separate rotation/bucket concern.

**Build:** inline after clearance; each new test fails for its expected reason before minimal
implementation, then passes. Run named cases via
`pnpm --filter @waitron/server exec vitest run src/<file>.test.ts -t '<name>'`, then the touched
server files; likewise `@waitron/handover`'s two indicator files and the two named dashboard files.
No whole-workspace run; normal hook, current-head CI and full handover/key-material finish review.
Run the error-reachability/alert-code and guide-link/content guards. Look at the refusal in EN/ES,
both themes and phone/desktop. Finish review uses two Claude run-it angles, then one fixes read.
Coordinate `handover-source-start-api.ts` with Lane K; the second branch to land rebases.
**Forecast (changed lines, additions + deletions): production 200; behavioral tests 270;
support/fixture wiring 80; docs 100 (including this plan); total 650.** Seek outside opinion and
watcher clearance before exceeding 975 lines (1.5×); a table/fiscal change stops for Lane L.
The two-copy check is deliberately conservative when the two folders are on separate disks.
