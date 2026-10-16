import { mkdtemp, mkdir, rm, writeFile, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { startServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";
import { runRestore } from "./restore-command.js";
import { runStagedReset } from "./reset-request.js";
import { runStagedRestore } from "./restore-request.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "retired-boot-"));
  dirs.push(root);
  const venueDir = join(root, "venue"),
    stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await writeFile(join(venueDir, "first-setup-retirement.json"), '{"version":1}');
  return { root, venueDir, stateDir };
}
it("raw boot refuses retired roots before it can create their missing database", async () => {
  const f = await fixture();
  const [port] = await freePorts(1);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await expect(
      (async () => {
        server = await startServer({
          WAITRON_VENUE_DIR: f.venueDir,
          WAITRON_STATE_DIR: f.stateDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
        });
      })(),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  } finally {
    await server?.close();
  }
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("the restore command refuses retired roots even when the original claim marker was lost", async () => {
  const f = await fixture();
  const source = join(f.root, "archive");
  await writeFile(source, "unopened archive");
  let calls = 0;
  const lines: string[] = [];
  const code = await runRestore({
    argv: ["restore", source],
    env: {
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_BACKUP_RECOVERY_KEY: "synthetic",
    },
    out: (line) => lines.push(line),
    restore: async () => {
      calls++;
    },
  });
  expect(code).toBe(1);
  expect(calls).toBe(0);
  expect(lines.join("\n")).toContain("setup.attempt_uncertain");
  expect(await readFile(source, "utf8")).toBe("unopened archive");
});
it.each(["restore", "reset"])(
  "staged %s refuses retired roots before reading the staged operation",
  async (kind) => {
    const f = await fixture();
    await writeFile(join(f.stateDir, `${kind}-request.json`), "{}");
    await writeFile(join(f.stateDir, "restore-request.node-key"), "retained synthetic secret");
    const deps = { ...f, migrationsRoot: null, log: () => {} };
    let placements = 0;
    await expect(
      kind === "restore"
        ? runStagedRestore(deps, async () => {
            placements++;
          })
        : runStagedReset(deps),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(placements).toBe(0);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
      "retained synthetic secret",
    );
  },
);
