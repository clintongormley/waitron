# Diagnose the Server typecheck kills and reduce their risk

Collect memory evidence from a disposable CI guest for the previously failed #4258 merge. Use it
to choose the smallest change that lets the existing full typecheck finish with usable headroom.

- Five first attempts on 24 November killed the Server compiler with exit 137. The runs were
  [45455114871](https://github.com/clintongormley/waitron/actions/runs/45455114871),
  [45468324299](https://github.com/clintongormley/waitron/actions/runs/45468324299),
  [45474194511](https://github.com/clintongormley/waitron/actions/runs/45474194511) (#4258's PR),
  [45478090008](https://github.com/clintongormley/waitron/actions/runs/45478090008) and
  [45479529468](https://github.com/clintongormley/waitron/actions/runs/45479529468) (#4258's main
  merge, `01ec75f7e065`). Four exact heads passed on hosted retries. In every failed job, the
  other package compilers finished before Server started. The current disposable controller at
  `f4c9c3c82fc6` allocates 16,384 MiB and four CPUs to typecheck. GitHub lists 16 GB and four CPUs
  for public Ubuntu runners. The failed jobs did not record guest memory.
  [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories).
- On macOS, `/usr/bin/time -l pnpm --filter @waitron/server typecheck --extendedDiagnostics`
  with TypeScript 7.0.2 and frozen installs passed at all three commits.

  | Commit | Peak resident memory | Files | Type instantiations |
  | --- | ---: | ---: | ---: |
  | 1 Nov `eee4006f8362` | 7.80 GiB | 5,234 | 10,792,009 |
  | 10 Nov `53bb877a5e15` | 7.55 GiB | 5,546 | 11,598,795 |
  | 24 Nov `c5e7ee392417` | 11.38 GiB | 6,342 | 13,271,509 |

  On current main, `--generateTrace` showed four workers each creating types from shared
  libraries. The heap profile includes about 1.1 GiB under symbol-table instantiation.
  Sample intervening commits and narrow any step change before proposing a source rewrite.
- In a four-CPU Linux arm64 container at the failed merge, default compiler settings passed
  at a 12 GiB limit with a 10.76 GiB peak and exited 137 at a 9 GiB limit with one kernel memory
  kill. `GOMEMLIMIT=6GiB` passed both limits, peaking at 8.37 GiB in the 12 GiB container and
  reaching the ceiling without a kill in the 9 GiB container. Both successful settings checked
  6,327 files. Full measurements and trace summaries are in Lane I's
  `receipts/typecheck-memory-20261124/`.

Use one unmerged scratch ref. Reuse `ci.yml`'s manual `server_probe` route and copy its normal
bounded checkout, Node and pnpm setup into that job on the scratch ref. Check out `01ec75f7e065`
and run the full `pnpm typecheck` on fresh disposable guests, once per setting first. Capture
guest RAM and swap, mount types, the job's cgroup limit, peak and memory events, the kernel's
kill log if available, and compiler and job elapsed time. Log before and after the run, including
failure. Repeat a comparison only to resolve a conflicting result. Delete the probe branch after
retaining the job IDs and logs.

If the guest's effective limit is below its configured allowance, bring the evidence to the
watcher under the A1454 memory-kill decision. If the compiler is the pressure source and the
controlled guest comparisons show margin inside the existing five-minute job, set the measured
`GOMEMLIMIT` on the existing typecheck step as a stopgap. Keep the cause of growth open whenever
the measurements leave it unresolved. Go treats this as a soft limit.
[Go's garbage collector guide](https://go.dev/doc/gc-guide#Memory_limit).

Verify the constrained run and a deliberately mistyped test file in a disposable copy. Run the
existing whole-workspace check guard. A workflow-only PR and merge use root scope and skip
typecheck. Record their exact-head checks, then follow the first code-selected disposable main
run with the change. The committed patch would add two workflow lines and about 20–30 lines
to the CI guide and backlog, with zero committed test lines.
