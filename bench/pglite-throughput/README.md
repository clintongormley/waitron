# @waitron/bench-pglite

A spike, not a product package. Measures whether embedded PGlite can carry the throughput the
§5 local-server deployment topology implies, before any schema exists to build on top of it.

See `docs/research/2026-07-20-pglite-throughput.md` for the method, the criterion and the
measured results.

## Running it

```bash
pnpm --filter @waitron/bench-pglite typecheck
pnpm --filter @waitron/bench-pglite bench
```

Docker must be running: the benchmark starts a real PostgreSQL 18 container via Testcontainers
as a control target, alongside the in-memory PGlite target. `bench` prints two Markdown tables
to stdout, then either `PASS against the criterion.` or `FAIL against the criterion: ...` to
stderr, exiting non-zero on failure.

## Why this lives in the workspace, not a bare `bench/` directory

This package is a pnpm workspace member specifically so it resolves the same pinned dependency
versions the product packages will — a throughput number measured against a different
`@electric-sql/pglite` build than the one `packages/db` ships is not evidence about the thing
being shipped. That's also why there's a `pnpm-lock.yaml` entry for it rather than a separate,
unpinned `npm install`.

## Why it can't join `pnpm -r test`

It defines no `test` script (only `bench` and `typecheck`), and it contains no `*.test.ts` file.
Both are deliberate and independent: root `pnpm test` ends in `pnpm -r test`, which skips workspace
members without a `test` script rather than failing on them, and even if a `test` script were
added by reflex later, Vitest's default include pattern would match nothing here. This keeps a
20-second, Docker-dependent benchmark out of CI's test shards and the pre-push hook permanently.

Root `pnpm test` also runs `vitest run` at the repository root first, but that project cannot reach
here either: its `include` is `[".github/scripts/**/*.test.mjs", "scripts/**/*.test.mjs"]` (see the
root `vitest.config.ts`). Neither pattern reaches `bench/`.

## Single-file constraint

`bench/bench.ts` runs directly via `node src/bench.ts` — Node 26 strips TypeScript types natively
with no build step and no `tsx` dependency. That native stripping does not perform the
`.js`-suffix specifier remapping the rest of the repo relies on for relative imports, so this
package is deliberately a single self-contained file rather than several files importing each
other. Bare specifiers into `node_modules` (e.g. `pg`, `@electric-sql/pglite`) are unaffected.
