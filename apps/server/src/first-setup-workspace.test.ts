import { dirname, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { startServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";
import { startAgainMarkerFor, writeStartAgainMarker } from "@waitron/provisioning";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("raw boot refuses an unfinishable deletion with setup.start_again_incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "marked-boot-"));
  dirs.push(root);
  const venueDir = join(root, "venue"),
    stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await mkdir(dirname(join(stateDir, "flows/setup/record.json")), { recursive: true });
  await writeFile(join(stateDir, "flows/setup/record.json"), '{"synthetic":"attempt"}');
  await writeStartAgainMarker(
    { venueDir, stateDir },
    await startAgainMarkerFor(
      { venueDir, stateDir },
      { attemptId: "33333333-3333-4333-8333-333333333333", frozenDigest: "a".repeat(64) },
    ),
  );
  await mkdir(dirname(join(stateDir, "flows/setup/record.json")), { recursive: true });
  await writeFile(join(stateDir, "flows/setup/record.json"), '{"changed":"after the marker"}');
  const [port] = await freePorts(1);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await expect(
      (async () => {
        server = await startServer({
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
        });
      })(),
    ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  } finally {
    await server?.close();
  }
  expect(await readFile(join(stateDir, "flows/setup/record.json"), "utf8")).toBe(
    '{"changed":"after the marker"}',
  );
  await expect(stat(join(venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
});
