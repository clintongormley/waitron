// Dev launcher for apps/server (`pnpm --filter @waitron/server dev`, and via the root `pnpm dev`).
// A generated `.env` must exist first — either `pnpm dev:setup` (brings up the dev Postgres,
// provisions a preproduction venue, and writes a TRADING `.env`) or `pnpm dev:onboard` (migrates but
// provisions no venue, writing a venue-less SETUP-MODE `.env` so the box boots into the slice-1b/2b
// setup surface). This launcher only checks the file EXISTS — either shape passes — then:
//
//   1. refuses to start without a generated `.env` — a clearer failure than letting boot surface
//      a raw `server.config_missing`;
//   2. assembles every migration set under `dist/drizzle/<set>`. boot.ts migrates at startup and,
//      run from SOURCE (tsx), resolves its default migrations root to `apps/server/src/drizzle`,
//      which does not exist (the sets live in each package's own `drizzle/`, and only the build's
//      copy-migrations step gathers them into one root). `WAITRON_MIGRATIONS_DIR` is config.ts's
//      supported from-source override, so we run copy-migrations and point it at the result;
//   3. boots the server under `tsx watch` against `.env`, plus `<stateDir>/secrets.env` and
//      `<stateDir>/trading.env` WHEN THEY EXIST (onboarding slice 2b). A setup-mode box persists
//      `trading.env` on `POST /setup-api/provision` (`trading-config.ts`) and then restarts itself
//      (`requestRestart` in `boot.ts`); `tsx watch` picks the restart straight back up (or the
//      operator re-runs `pnpm dev`), and sourcing the newly-written file is what carries the five
//      `WAITRON_TILL_*_ID` + `DATABASE_URL`/`WAITRON_MIGRATIONS_DATABASE_URL`/`WAITRON_ENV` into the
//      next boot so `tryLoadTillConfig` sees all five ids and enters TRADING mode
//      (`config.ts`/`till-config.ts`). Node's `--env-file` is ADDITIVE — a later file's keys override
//      an earlier file's — and each flag REQUIRES its file to exist (a missing path is a hard error),
//      which is why the two extra files are only added when `existsSync` finds them. The appliance
//      equivalent is a systemd `EnvironmentFile=-<stateDir>/secrets.env` +
//      `EnvironmentFile=-<stateDir>/trading.env` pair (the leading `-` marks each optional, the same
//      "source it if present" shape as the `existsSync` guards below).
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

if (!existsSync(join(pkgRoot, ".env"))) {
  console.error(
    "apps/server/.env is missing — run `pnpm dev:setup` (provisions a venue → trading mode) or " +
      "`pnpm dev:onboard` (no venue → setup mode) from the repo root first.\n" +
      "Both bring up the dev Postgres (docker-compose.yml) and write the `.env` this reads.",
  );
  process.exit(1);
}

// Respect a WAITRON_MIGRATIONS_DIR a developer already exported (they own the migrations root then);
// otherwise assemble the sets the from-source boot migration needs (see the header) and point at them.
let migrationsDir = process.env.WAITRON_MIGRATIONS_DIR;
if (!migrationsDir) {
  const copy = spawnSync(process.execPath, [join(here, "copy-migrations.mjs")], {
    stdio: "inherit",
  });
  if (copy.status !== 0) process.exit(copy.status ?? 1);
  migrationsDir = join(pkgRoot, "dist", "drizzle");
}

// Minimal `KEY=value` reader for OUR OWN generated `.env` — mirrors `dev-setup.ts`'s `parseEnvFile`
// (split on the first `=`, skip blank/`#` lines). Node's `--env-file` owns the runtime parse for the
// child process below; this is only so THIS process can read `WAITRON_STATE_DIR` back out of the
// `.env` it is about to hand to the child, since `--env-file` never touches this process's own
// `process.env`. `dev-setup.ts`'s copy is a `.ts` module and this launcher runs as plain `.mjs`
// (`"dev": "node scripts/dev-server.mjs"`, no tsx), so it cannot be imported here without a build
// step — small enough to duplicate rather than restructure the dev scripts' module boundary for it.
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// The state dir the box persists secrets.env/trading.env under — resolved exactly as `config.ts`
// resolves `stateDir`: an unset OR EMPTY `WAITRON_STATE_DIR` takes the default (`DEFAULT_STATE_ROOT`,
// `apps/server/src/state` run from source, gitignored), a set one is resolved relative to the
// spawned child's cwd (`pkgRoot`, matched here since `resolve()` below would otherwise use THIS
// process's cwd, which need not be `pkgRoot` — `pnpm dev` from the repo root is the common case).
const envFileVars = parseEnvFile(readFileSync(join(pkgRoot, ".env"), "utf8"));
const stateDirValue = envFileVars.WAITRON_STATE_DIR;
const stateDir =
  stateDirValue === undefined || stateDirValue === ""
    ? join(pkgRoot, "src", "state")
    : resolve(pkgRoot, stateDirValue);

// Source `secrets.env` (slice 2a) and `trading.env` (slice 2b) WHEN PRESENT — see the header comment
// for why (`--env-file` is additive/later-overrides, and errors on a missing path, hence the guards).
const envFileFlags = ["--env-file=.env"];
const secretsEnvFile = join(stateDir, "secrets.env");
const tradingEnvFile = join(stateDir, "trading.env");
if (existsSync(secretsEnvFile)) envFileFlags.push(`--env-file=${secretsEnvFile}`);
if (existsSync(tradingEnvFile)) envFileFlags.push(`--env-file=${tradingEnvFile}`);

const server = spawn("tsx", ["watch", ...envFileFlags, "src/bin.ts"], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: { ...process.env, WAITRON_MIGRATIONS_DIR: migrationsDir },
});
server.on("exit", (code) => process.exit(code ?? 0));
