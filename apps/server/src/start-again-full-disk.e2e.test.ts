// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_START_AGAIN names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, lstat, readdir, stat, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import "@waitron/provisioning";
import {
  SPARE_SPACE_FILE,
  isEmptiedTombstone,
  readStartAgainNote,
  type StartAgainSummary,
} from "@waitron/provisioning";
import { selectedRepair } from "../test/first-setup-backup-recovery-fixture.js";
import "./testing/hour-test-clock.js";
import { PASSWORD } from "../test/first-fiscal.js";
import "./first-setup-backup-source.js";
import * as backupEntry from "./first-setup-backup-entry.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";

vi.mock("./first-setup-backup-source.js", { spy: true });
vi.mock("./first-setup-backup-entry.js", { spy: true });
vi.mock("@waitron/provisioning", { spy: true });

const SPARE = 1024 * 1024;

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

// Runs after useVenueDb's own beforeAll, registered when the fixture is imported, so the suite's
// database stays off the small disk and only each case's folders land on it.
beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_START_AGAIN");
  if (!opened.ok) {
    if (!REQUIRE_FULL_DISK) console.warn(`start-again-full-disk tests SKIPPED: ${opened.reason}`);
    return;
  }
  disk = opened.disk;
  vi.stubEnv("TMPDIR", realpathSync(disk.folder("tmp")));
});
afterEach(() => disk?.unfill());
afterAll(() => {
  vi.unstubAllEnvs();
  disk?.close();
});

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

const sockets: TLSSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

const ROUTE = "https://box.test/setup-api/first-setup/resolution";

type Owner = {
  state: { attemptId: string; revision: number; ownerGeneration: number };
  capability: string;
};

type Inspection = { inspectionId: string; revision: number; ownerGeneration: number };

/** The repair page's Start-again flow over the box's real routes: inspection, password, summary, Start again. */
async function startAgainOverRoutes(app: Hono) {
  const read = async () => {
    const answer = await app.request(ROUTE, {}, tls());
    expect(answer.status, await answer.clone().text()).toBe(200);
    const inspected = (await answer.json()) as Inspection;
    return {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    };
  };
  const recovered = await app.request(
    `${ROUTE}/recover`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(await read()),
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      }),
    },
    tls(),
  );
  expect(recovered.status, await recovered.clone().text()).toBe(200);
  const owner = (await recovered.json()) as Owner;
  const headers = {
    "Content-Type": "application/json",
    "X-Waitron-Setup-Owner": owner.capability,
    "X-Waitron-Setup-Attempt": owner.state.attemptId,
    "X-Waitron-Setup-Revision": String(owner.state.revision),
    "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
  };
  const ids = await read();
  const summary = await app.request(
    `${ROUTE}/start-again/summary`,
    { method: "POST", headers, body: JSON.stringify(ids) },
    tls(),
  );
  expect(summary.status, await summary.clone().text()).toBe(200);
  const shown = (await summary.json()) as StartAgainSummary;
  const done = await app.request(
    `${ROUTE}/start-again`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    },
    tls(),
  );
  expect(done.status, await done.clone().text()).toBe(200);
  return shown;
}

async function filesUnder(dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await lstat(path)).isDirectory())
      names.push(...(await filesUnder(path)).map((inner) => `${name}/${inner}`));
    else names.push(name);
  }
  return names;
}

it("with the box's spare file, the password step, the summary and Start again all work on a full disk, the stopped recovery's copy is emptied, and the note carries its series name", async (ctx) => {
  const small = needDisk(ctx);
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockReturnValue(f.service);
  const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(SPARE, 1));
  const copy = dirname(dirname(f.record.target.target.stateDir));
  expect(await filesUnder(copy)).toContain("target/state/module-preparation-state.json");
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    { stateDir: f.roots.stateDir },
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  small.fill();
  expect(small.free()).toBeLessThan(65_536);

  const shown = await startAgainOverRoutes(entry.app);

  expect(shown.recovery).toMatchObject({ lastName: f.selected.identity });
  await expect(stat(spare)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.workspace.read()).at(-1)).toMatchObject({
    phase: "abandoned",
    target: { recoveryId: f.session.recoveryId },
  });
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  expect(await filesUnder(copy)).not.toContain("target/state/module-preparation-state.json");
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName).toBe(f.selected.identity);
});

it("a recovery whose placement fills the disk stops, and Start again on the same page, still on a full disk, discards it and deletes the spare", async (ctx) => {
  const small = needDisk(ctx);
  const f = await selectedRepair();
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockReturnValue(f.service);
  const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(SPARE, 1));
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    { stateDir: f.roots.stateDir },
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  // With 64 KiB left the refusal came before the placement was recorded, and the recovery still
  // counted as running; 128 KiB lets the placement begin and fail.
  small.fill(128 * 1024);

  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "ENOSPC" });
  expect(f.service.runningInMemory()).toBe(false);
  expect((await f.workspace.read()).at(-1)?.phase).toBe("placement-started");
  // Fill again, so the page opens on a full disk whatever the failed placement left free.
  small.fill();
  expect(small.free()).toBeLessThan(65_536);

  const shown = await startAgainOverRoutes(entry.app);

  expect(shown.recovery).toMatchObject({ lastName: f.selected.identity, failed: true });
  await expect(stat(spare)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.workspace.read()).at(-1)).toMatchObject({
    phase: "abandoned",
    target: { recoveryId: f.session.recoveryId },
  });
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName).toBe(f.selected.identity);
});

it("without a spare file, the password step of the Start-again flow on a full disk answers 507 storage.disk_full", async (ctx) => {
  const small = needDisk(ctx);
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockReturnValue(f.service);
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    { stateDir: f.roots.stateDir },
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  const inspected = (await (await entry.app.request(ROUTE, {}, tls())).json()) as Inspection;
  small.fill();
  expect(small.free()).toBeLessThan(65_536);

  const recovered = await entry.app.request(
    `${ROUTE}/recover`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionId: inspected.inspectionId,
        revision: inspected.revision,
        ownerGeneration: inspected.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      }),
    },
    tls(),
  );

  expect(recovered.status, await recovered.clone().text()).toBe(507);
  expect(await recovered.json()).toMatchObject({ error: { code: "storage.disk_full" } });
});
