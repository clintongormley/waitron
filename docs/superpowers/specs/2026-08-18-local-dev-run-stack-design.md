# Local dev run stack — design (2026-08-18)

## Problem

`wa-wt <worktree>` (the dev-server switcher, `~/.local/bin/wa-wt`) starts a dev server by running
`pnpm dev` at the worktree root. The repo has **no root `dev` script** — and never has, per the full
git history of `package.json` — so the command fails immediately with
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL / Command "dev" not found` and wa-wt reports the instance failed
to start.

There is no scripted or documented way to run the whole app locally. The two browser front-ends are
trivial Vite servers, but `apps/server` cannot boot without three things, in order:

1. a **real Postgres** (`DATABASE_URL` is required with no default; and it must be real Postgres, not
   PGlite, because the server writes fiscal records as the least-privilege app role under FORCE RLS);
2. that database **migrated** (the server also migrates itself at boot — `apps/server/README.md`,
   spec §11 — but a venue cannot be provisioned into an unmigrated database);
3. a **provisioned venue** — a tenant + location + till + node-as-SIF + invoice series — whose five
   UUIDs are handed to the server as `WAITRON_TILL_{TENANT,TILL,NODE,SERIES,LOCATION}_ID`
   (`apps/server/src/till-config.ts`).

The proven end-to-end recipe for (1)–(3) already exists in `apps/server/scripts/till-demo.ts`:
connect to a fresh `postgres:18-alpine`, `runMigrations`, then `applyVenue(planVenue(...))` to mint
the ids. Dev-setup is a trimmed version of that demo that stops after provisioning and **persists**
the ids so restarts reuse them.

## Goal

One command brings up the full local stack, and `wa-wt <worktree>` works unchanged:

| Process          | What it is                     | URL                     |
| ---------------- | ------------------------------ | ----------------------- |
| `apps/till`      | browser POS front-end (Vite)   | http://localhost:5190   |
| `apps/dashboard` | browser admin front-end (Vite) | http://localhost:5191   |
| `apps/server`    | the HTTP API both call         | http://localhost:8080   |

The server runs against a locally-provisioned **preproduction** venue, seeded so the till is
sellable out of the box (a small catalogue + a cashier with a known PIN).

## Non-goals

- Production shape: least-privilege deployment roles, TLS, LAN binding, integrated card terminals,
  sync peers. Dev runs as the container superuser, single tenant, cash / manual-card tenders only.
- Re-provisioning on every start. The venue is provisioned **once** and reused (see the fiscal note).

## Components

1. **`docker-compose.yml`** (committed): `postgres:18-alpine`, `POSTGRES_PASSWORD=pg`, `5432:5432`, a
   named volume `waitron-dev-db` so data — and therefore the provisioned venue — survives restarts,
   and a healthcheck so `dev:setup` can wait for readiness.
2. **`scripts/dev-setup.mjs`** — the idempotent bootstrap (details below). Run via `pnpm dev:setup`.
   Written to be tsx/node-run and to reuse the same `@waitron/*` building blocks as `till-demo.ts`.
3. **`apps/server` `dev` script**: `tsx watch --env-file=.env src/bin.ts` (Node's `--env-file`, passed
   through by tsx; pnpm runs the script with cwd = `apps/server`, so `.env` resolves there). A
   preflight prints "run `pnpm dev:setup` first" and exits non-zero if the `.env` is absent, rather
   than surfacing a raw `server.config_missing`.
4. **root `dev` script**: runs the server + both Vite servers in parallel — so `pnpm dev` (and
   therefore `wa-wt`) brings up everything.
5. **`apps/server/.env.example`** (committed) documenting every variable; the real `.env` is
   gitignored (`.env` / `.env.*` already are, with `!.env.example` un-ignored).
6. **wa-wt label fix** — a separate change in the `workspace-tools` repo: correct the advertised URLs
   (`APP_URLS`) from the wrong `5173 / 5174 / 3000` to `5190 / 5191 / 8080`. No CI/PR ceremony there
   (that repo has none); a signed-off commit to its default branch.

## `dev:setup` flow (idempotent)

`pnpm dev:setup`:

1. `docker compose up -d db`; poll until Postgres accepts connections.
2. **Already set up?** If `apps/server/.env` exists AND its `DATABASE_URL` reaches a database that
   already holds a venue (a `tenants` row), **reuse it**: print the ids/URLs and exit. It must never
   re-provision a live dev database — **re-registering a till starts a new hash chain**
   (CLAUDE.md §5). This is the guard the tests prove by deletion.
3. **Otherwise bootstrap:**
   a. Ensure a dedicated `waitron_dev` database exists (create if absent), so `reset` can drop it
      without touching the container's default `postgres` database.
   b. Apply the full migration manifest as the superuser — the same sets the server runs at boot.
   c. `applyVenue(planVenue({ country: "ES", taxId: "50000000K", legalName: "Waitron Dev SL",
      location: { …Madrid, Europe/Madrid, 05:00 cutover… }, tillName: "Caja 1", seriesCode: "A",
      rectificativeSeriesCode: "R", admin: { pinHash: hashPin("1234"), passwordHash: hashPassword(…) }
      }))` → `{ tenantId, tillId, nodeId, seriesIds[0], locationId }`.
   d. Generate `WAITRON_CREDENTIALS_KEY` (32 random bytes, base64) + `WAITRON_CREDENTIALS_KEY_VERSION=1`.
   e. Seed a minimal catalogue (one weight product, one each product, assigned to the location) and a
      cashier `person` with a known PIN — the same seed shape as `till-demo.ts`, as `app_user` under
      `withTenant`. This is what makes the running stack immediately usable rather than an empty till.
   f. Write `apps/server/.env` (gitignored): `DATABASE_URL`, `WAITRON_ENV=preproduction`,
      `WAITRON_HTTP_PORT=8080`, the credentials key + version, and the five `WAITRON_TILL_*` ids.
4. Print the URLs, the seeded cashier's PIN, and the admin PIN.

`pnpm dev:reset` (`dev-setup --force`): drop & recreate `waitron_dev`, delete `.env`, then bootstrap
fresh. The sanctioned "start over" — safe because this is throwaway **preproduction** data (the
no-new-chain rule protects a *live* chain within one database's life; a deliberately reset dev
database is fine, and pre-production holes are expected — CLAUDE.md §5).

## Data flow

```
wa-wt <wt>  →  pnpm dev (root)  →  parallel:
    ├─ pnpm --filter @waitron/till       dev   # Vite 5190, proxies /api → 127.0.0.1:8080
    ├─ pnpm --filter @waitron/dashboard  dev   # Vite 5191, proxies /api → 127.0.0.1:8080
    └─ pnpm --filter @waitron/server     dev   # tsx watch --env-file, listens :8080,
                                               #   migrates idempotently at boot
```

## Server-as-superuser (recorded so no one "fixes" it)

Dev sets `DATABASE_URL` to the container's `postgres` superuser, exactly as every demo does. This is
deliberately **not** production's least-privilege split (`apps/server/README.md` §"Database roles"):
dev wants one connection string that can both migrate and run duty passes, and `till-demo.ts` already
proves a real huella-chained `registros_facturacion` row files correctly under RLS this way (the
routes still drop to `app_user` via `withTenant` + `asAppUser`). A multi-role dev setup would be
strictly more moving parts for no dev benefit.

## Testing

- **`dev-setup` against real Postgres** (Testcontainers, as the provisioning suite does — PGlite
  can't exercise this): first run provisions, writes a bootable `.env`, and leaves exactly one
  `tills` row; second run **reuses** — asserts still exactly one `tills` row and the same five ids in
  `.env`. Prove the reuse guard by deletion (remove the "already set up?" check → a second run mints a
  second venue → the one-`tills`-row assertion fails).
- **The written `.env` is valid server config**: feed it through `loadConfig` and assert it resolves
  (no `server.config_missing` / `server.till_config_*`). A full boot-and-`/health` smoke is optional
  and may be too heavy for the default gate.
- Mind the root-Vitest coverage rules if `dev-setup` lands in `scripts/` (CLAUDE.md §4): a module
  tested only from the root project must be named in the root `vitest.config.ts` `coverage.include`
  and excluded from any package's, or it is measured twice or not at all.

## Ports (corrected)

till **5190**, dashboard **5191**, server **8080** (each app's own config; the till README documents
the 5190→8080 `/api` proxy). wa-wt's `5173 / 5174 / 3000` labels are simply wrong and get fixed.
