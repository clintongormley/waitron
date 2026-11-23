# Read personal-data log fields with TypeScript

CI will report an unmasked personal field in the requested source forms. The guard stays in
`scripts/personal-log-params.test.ts`, with its existing cases, naming rules, allow-lists and stale-entry
checks. Use the root's TypeScript 6 compiler API. The queue item is PERSONAL-LOG-GUARD-AST (Lane H,
23 November 2026 at 03:17). The backlog entry is A980, S10 follow-ups in
`docs/backlog/data-protection.md`.

## Change and checks

1. Add four cases in the existing Vitest file. Run them against the old reader and record each
   expected refusal that is missing.

   - **Spread details.** An `AppError` detail spreads a typed venue property like the one in
     `apps/server/src/restore-request.ts` and `restore-stream.ts`. A synthetic `ownerEmail` on the
     spread source is reported against the error's code even when absent from the registry. Exercise
     a spread in a logger's fields in the same case.
   - **Quoted keys.** A quoted `"guestName"` in a registry detail and in logger fields is reported
     under its code or event, just like the bare spelling.
   - **Computed level.** A caller that chooses between warning and error by condition reports
     `guestName` under its event. Include a level held in a typed variable with no level literal
     at the call.
   - **Lowercase type.** A lowercase alias and a `typeof personFields` reference in registry
     details are reported with their source path when they lack review entries.

2. Replace the text reader with syntax-tree walks over the same source directories. Read property
   signatures and type references inside each valid `ErrorParams` entry. Keep the recognised-code
   check. Read keys from object and array literals in the logger's third argument. Keep the
   established positional call check and recognise a computed level whose possible values are log
   levels. Use one compiler program and its type checker for spread properties and computed level
   expressions, so the restore code's imported types can be read at the call. Report visible spread
   keys under the same error code or log event and apply the same allow-lists. Keep this a source
   check. Runtime-only keys, free-text logging, tracing values through arbitrary functions and the
   watchdog's direct writes are outside this change. Named registry references still require review
   by name.

3. Run `pnpm exec vitest run scripts/personal-log-params.test.ts`. In a disposable checkout, delete
   each new recognition path in turn and capture the expected failing case, then run the restored
   suite. Compare the guard's run time with the old reader. Correct any real exposure under the
   existing naming rule and run the affected focused tests. Run the lane's fiscal and menu gates
   unedited before finishing the branch.

4. Update the limits stated in the test header, `CLAUDE.md` and
   `docs/developers/conventions-ui.md`. Point the historical receipt in
   `docs/developers/conventions-data.md` to the current limits and remove the completed backlog
   line. Expected size is about 150 scanner lines in place of about 180, about 60 added test
   lines, and small documentation edits. Any product edit depends on what the strengthened guard finds.
