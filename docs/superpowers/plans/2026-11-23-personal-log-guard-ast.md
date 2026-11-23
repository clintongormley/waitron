# Read personal-data log fields with TypeScript

CI will report an unmasked personal field in the four source forms named by Lane H's
PERSONAL-LOG-GUARD-AST item (23 November 2026 at 03:17). Keep the guard in
`scripts/personal-log-params.test.ts` and retain every existing case, naming rule, allow-list and
stale-entry check. The backlog entry is A980, S10 follow-ups in `docs/backlog/data-protection.md`.

## Change and checks

1. Add four cases to the existing Vitest file. Run them against the old reader and record each
   missing refusal.

   - **Spread details.** Report `ownerEmail` from a typed property spread into `new AppError`
     details even when the registry omits it. Exercise a spread into logger fields in the same
     case. Report a spread whose keys TypeScript cannot enumerate with its code or event and
     source location. In the real-tree check, assert that the restore throw site's spread yields
     `legalName`, `taxId` and `venueName` from `RestoredVenue`.
   - **Quoted keys.** Report `"guestName"` in a registry and logger fields under its code or event.
   - **Computed level.** Report `guestName` for a conditional level as in
     `apps/server/src/health.ts` and a typed variable as in `apps/server/src/boot.ts`
     (`cloud.emergency_read_failed`).
   - **Lowercase type.** Report an unreviewed lowercase alias and `typeof personFields` reference
     with their paths. Keep the existing check for recognised error code entries.

2. Parse the same source directories with `ts.createSourceFile`. Walk each registry entry's
   signatures and type references and each logger call's inline fields, including nested objects
   and arrays. Keep existing literal-level matching and recognise conditional choices of log
   levels directly. For spreads and other candidate level expressions, make a compiler program
   rooted only in candidate files, using normal workspace import resolution. Use the same scan
   for synthetic strings, supplying their contents through a compiler host when types are needed.
   Walk direct `new AppError` calls with inline details for spreads. A nonliteral code or event is
   reported by source path. Apply the existing allow-lists to all found keys. An opaque spread is
   a reported finding for review. Subclasses, whole objects passed by reference, computed property
   names, free text, runtime value tracing and the watchdog's direct writes remain outside the
   scan. Named registry types still require review by name.

3. Run `pnpm exec vitest run scripts/personal-log-params.test.ts`. In a disposable checkout,
   delete each new recognition path separately and capture the expected failure, then run the
   restored suite. Time the focused guard against the baseline, targeting under five seconds
   locally. Fix any real exposure under the naming rule and run the affected focused tests.
   Run the unedited fiscal and menu checks required by the queue.

4. Update the scan limits in the test header, `CLAUDE.md` and
   `docs/developers/conventions-ui.md`. Add a dated pointer beside the historical receipt in
   `docs/developers/conventions-data.md`. Remove the completed backlog line. Allow roughly 200
   added and 180 removed scanner lines, 70 added test lines, and short documentation edits.
   Product edits depend on what the guard finds.
