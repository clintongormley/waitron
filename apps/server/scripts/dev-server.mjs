// Dev launcher for apps/server (`pnpm --filter @waitron/server dev`, and via the root `pnpm dev`).
// Needs the `.env` that `pnpm dev:setup` (trading mode) or `pnpm dev:onboard` (setup mode) writes,
// or the file `WAITRON_DEV_ENV_FILE` names.
//
// Run from source, boot's default migrations root does not exist (each set lives in its package's
// own `drizzle/`), so this assembles them with copy-migrations and points `WAITRON_MIGRATIONS_DIR`
// at the result.
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const envFile = resolve(process.env.WAITRON_DEV_ENV_FILE?.trim() || join(pkgRoot, ".env"));

if (!existsSync(envFile)) {
  console.error(
    `${envFile} is missing — run \`pnpm dev:setup\` (provisions a venue → trading mode) or ` +
      "`pnpm dev:onboard` (no venue → setup mode) from the repo root first (from a wa-wt stack: " +
      "`wa-wt reset demo <worktree-name>`, or Claude's `wa-wt reset own demo <worktree-name>`).\n" +
      "Both write the settings file this reads, and migrate the local venue directory it points at.",
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
// relative to the child's cwd (`pkgRoot`), not this process's. Node keeps a process value, even an
// empty one, over `--env-file`'s, so the settings file is read only when the process sets none.
const stateDirValue =
  process.env.WAITRON_STATE_DIR ?? parseEnvFile(readFileSync(envFile, "utf8")).WAITRON_STATE_DIR;
const stateDir =
  stateDirValue === undefined || stateDirValue === ""
    ? join(pkgRoot, "src", "state")
    : resolve(pkgRoot, stateDirValue);

// Later flags override earlier ones. `--env-file-if-exists` because setup writes `trading.env`
// after this starts, and a `tsx watch` rerun reuses these flags.
const envFileFlags = [
  `--env-file=${envFile}`,
  `--env-file-if-exists=${join(stateDir, "secrets.env")}`,
  `--env-file-if-exists=${join(stateDir, "trading.env")}`,
];

const server = spawn("tsx", ["watch", ...envFileFlags, "src/bin.ts"], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: { ...process.env, WAITRON_MIGRATIONS_DIR: migrationsDir },
});
server.on("exit", (code) => process.exit(code ?? 0));
