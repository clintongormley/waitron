// Dev launcher for apps/server (`pnpm --filter @waitron/server dev`, and via the root `pnpm dev`).
// Needs the `.env` that `pnpm dev:setup` (trading mode) or `pnpm dev:onboard` (setup mode) writes.
//
// Run from source, boot's default migrations root does not exist (each set lives in its package's
// own `drizzle/`), so this assembles them with copy-migrations and points `WAITRON_MIGRATIONS_DIR`
// at the result.
//
// A setup-mode box writes `<stateDir>/trading.env` on provision and restarts; sourcing it is what
// carries the `WAITRON_TILL_*_ID` into the next boot. `--env-file` errors on a missing path, so the
// state-dir files are added only when they exist.
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
      "Both write the `.env` this reads, and migrate the local venue directory it points at.",
  );
  process.exit(1);
}

let migrationsDir = process.env.WAITRON_MIGRATIONS_DIR;
if (!migrationsDir) {
  const copy = spawnSync(process.execPath, [join(here, "copy-migrations.mjs")], {
    stdio: "inherit",
  });
  if (copy.status !== 0) process.exit(copy.status ?? 1);
  migrationsDir = join(pkgRoot, "dist", "drizzle");
}

// A copy of `src/env-file.ts`'s parser, which this plain-`.mjs` launcher cannot import without tsx.
// Only this process's own read of `WAITRON_STATE_DIR`; `--env-file` parses for the child.
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

// Resolved as `config.ts` resolves `stateDir`: unset or empty takes the default; a set value is
// relative to the child's cwd (`pkgRoot`), not this process's.
const envFileVars = parseEnvFile(readFileSync(join(pkgRoot, ".env"), "utf8"));
const stateDirValue = envFileVars.WAITRON_STATE_DIR;
const stateDir =
  stateDirValue === undefined || stateDirValue === ""
    ? join(pkgRoot, "src", "state")
    : resolve(pkgRoot, stateDirValue);

// Later `--env-file` flags override earlier ones.
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
