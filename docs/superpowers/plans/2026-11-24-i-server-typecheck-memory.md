# Keep the Server typecheck within the CI runner's memory

Give the native TypeScript compiler enough room to finish the existing full typecheck on ordinary
pull requests and main pushes. The Lane I queue records five kills in one day without a compiler
diagnostic.

## Measurements

- The jobs API and logs identify all five kills as disposable server jobs on attempt 1 of
  [45455114871](https://github.com/clintongormley/waitron/actions/runs/45455114871),
  [45468324299](https://github.com/clintongormley/waitron/actions/runs/45468324299),
  [45474194511](https://github.com/clintongormley/waitron/actions/runs/45474194511),
  [45478090008](https://github.com/clintongormley/waitron/actions/runs/45478090008) and
  [45479529468](https://github.com/clintongormley/waitron/actions/runs/45479529468).
  Four exact heads passed a hosted retry. The installed controller at `f4c9c3c82fc6` assigns
  typecheck guests 16,384 MiB and four CPUs. In all five logs the other package compilers had
  finished before the Server compiler began. The original guest kernel evidence is unavailable
  in these job logs. A separate checkout on the same guest pool passed at `c5e7ee392417`.
- On macOS, `/usr/bin/time -l pnpm --filter @waitron/server typecheck --extendedDiagnostics`
  reported peak resident memory of 7.80 GiB at `eee4006f8362` (1 November), 7.55 GiB at
  `53bb877a5e15` (10 November), and 11.38 GiB at `c5e7ee392417` (24 November). All used
  TypeScript 7.0.2, were installed with the checkout's lockfile, and passed.
- On current main, `--generateTrace` showed four checker workers each creating types from
  TypeScript's standard library, Hono, Drizzle and Vitest. The longest file accounted for 1.6%
  of traced file-check time. The matching heap profile attributed memory to compiler data
  structures, including about 1.1 GiB across the symbol-table instantiation call tree. The
  profiles identify repeated work on shared types and do not assign the peak to one Waitron file.
- A four-CPU Linux arm64 container checked the failed #4258 merge `01ec75f7e065`. With a 12 GiB
  container limit, the default check passed and the container peaked at 10.76 GiB. Under 9 GiB
  with swap disabled, the same check hit exit 137 and the kernel's `oom_kill` counter rose to 1.
  With only `GOMEMLIMIT=6GiB` added, it passed at the 9 GiB limit with zero kills and the same
  6,327 files and 13,107,016 type instantiations. This is a memory-pressure control on Linux arm64.

## Change and proof

Set `GOMEMLIMIT: 6GiB` on the `pnpm typecheck` step in `.github/workflows/ci.yml`. Go uses a
soft memory limit to decide when to collect garbage. The setting leaves headroom for the rest of
the job and the measured peak can exceed it. Keep the existing command, job, routing, compiler,
file selection and time limit. The evidence points to reducing the compiler's peak inside its
existing job. A job split would repeat the observed compiler order. [Go's garbage collector guide](https://go.dev/doc/gc-guide#Memory_limit).

Use the captured failed run and the 9 GiB control as the failing cases. Repeat the constrained
check with the final setting and verify a deliberately mistyped Server test file still produces
TS2322 in a disposable copy. Run the existing whole-workspace typecheck guard in
`scripts/ci-workflow.test.mjs`. Use the exact pull request head and merge run to check that the
normal typecheck passes, and confirm a disposable job used the candidate before calling that
route qualified. Record the test, runner and measured peaks in the CI guide and link the receipt
from the existing CI incident summary. Expected size is two workflow lines, about 20–30
documentation lines and zero committed test lines.
