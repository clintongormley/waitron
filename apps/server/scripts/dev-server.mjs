// Dev launcher for apps/server (`pnpm --filter @waitron/server dev`, and via the root `pnpm dev`).
// `pnpm dev:setup` must have run first — it brings up the dev Postgres, provisions a preproduction
// venue, and writes the `.env` this reads. This launcher then:
//
//   1. refuses to start without that generated `.env` — a clearer failure than letting boot surface
//      a raw `server.config_missing`;
//   2. assembles every migration set under `dist/drizzle/<set>`. boot.ts migrates at startup and,
//      run from SOURCE (tsx), resolves its default migrations root to `apps/server/src/drizzle`,
//      which does not exist (the sets live in each package's own `drizzle/`, and only the build's
//      copy-migrations step gathers them into one root). `WAITRON_MIGRATIONS_DIR` is config.ts's
//      supported from-source override, so we run copy-migrations and point it at the result;
//   3. boots the server under `tsx watch` against the `.env`.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

if (!existsSync(join(pkgRoot, ".env"))) {
  console.error(
    "apps/server/.env is missing — run `pnpm dev:setup` from the repo root first.\n" +
      "It brings up the dev Postgres (docker-compose.yml) and provisions a preproduction venue.",
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

const server = spawn("tsx", ["watch", "--env-file=.env", "src/bin.ts"], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: { ...process.env, WAITRON_MIGRATIONS_DIR: migrationsDir },
});
server.on("exit", (code) => process.exit(code ?? 0));
