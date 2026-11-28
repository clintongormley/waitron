# A1645. Share one Waitron typecheck slot on the Mac

A developer or pre-push hook can start a typecheck in any updated Waitron checkout. When a compiler is already running under the same macOS account, the next one waits and then runs the package's usual check. The 14:09 crash report counted eight compilers at a combined 66.3 GiB. `/usr/bin/time -l` put Server alone at 11.7 GiB peak resident memory on commit `373c1e09c4`, and the crash report recorded one compiler at 21.6 GiB. Start with one slot to leave room for the other lanes and the desktop.

**Files and approach**

- Change the `scripts.typecheck` commands in the 54 package manifests under `apps/` and `packages/` to call `scripts/typecheck.mjs`. Keep each check's arguments and working directory, including Country ES's second project check and flags supplied by callers. The root `pnpm -r typecheck` and `.husky/pre-push` already call those commands, so both get the same limit.
- In `scripts/typecheck.mjs`, run the current package's installed TypeScript CLI with inherited standard streams and return its exit status. On macOS, run it through `/usr/bin/lockf -k` on one file under the account's `~/Library/Caches/`, shared across checkouts. Keep its inode so a waiting process and a new caller cannot lock different files. The operating system releases the lock at the end of the command. Compare the compiler's default against fewer checkers using `/usr/bin/time -l`. Use a macOS flag only on packages where it materially reduces the peak without a disproportionate delay. Linux CI keeps its existing parallelism and memory settings.
- Add `scripts/typecheck.test.mjs` and describe the slot in `docs/developers/ci-and-gates.md`. Include all package peaks and the file-event daemon investigation in the PR. The change requires no shared tooling installation, editor or Docker setting change, compiler upgrade, or hook bypass. Old checkouts need to pick up the change before they share the slot.

**Check the behavior**

1. Start two different package typecheck commands from separate temporary checkouts on macOS, using small compiler stand-ins that report when they start. Hold the first within its check. Confirm the existing commands let the second start early. After implementing the slot, confirm the second enters only after the first exits, including when the first reports a type error.
2. Verify the installed compiler is found from the package, arguments arrive intact and a compiler error reaches the caller. Run `pnpm exec vitest run scripts/typecheck.test.mjs scripts/pre-push.test.mjs` and check one real package's typecheck from the hook's filtered entry point. Let the normal hook and current-head CI cover the remaining workspace.

Expected additions are about 85 implementation lines including the manifest edits, 100 test lines, and this page plus a short developer note.
