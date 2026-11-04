// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_START_AGAIN names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import "@waitron/provisioning";
import { SPARE_SPACE_FILE } from "@waitron/provisioning";
import { heldSetup } from "../test/held-setup-database.js";
import { diskSnapshot } from "../test/start-again-deleted.js";
import "./testing/hour-test-clock.js";
import { PASSWORD } from "../test/first-fiscal.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import { SPARE_SPACE_BYTES } from "./spare-space.js";

vi.mock("@waitron/provisioning", { spy: true });

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

// Runs after useVenueDb's own beforeAll, registered when the fixture is imported, so the suite's
// database stays off the small disk and only each case's folders land on it.
beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_START_AGAIN", 32);
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

/** The folders `runEntry` hands first-setup resolution when it is given no log folder. */
const spareOption = (roots: { stateDir: string; venueDir: string }) => ({
  stateDir: roots.stateDir,
  venueDir: roots.venueDir,
  logDir: join(roots.stateDir, "logs"),
});

type Inspection = { inspectionId: string; revision: number; ownerGeneration: number };

it("on a full disk, Continue's password step answers 507 storage.disk_full", async (ctx) => {
  const small = needDisk(ctx);
  const f = await heldSetup();
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    spareOption(f.roots),
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
  expect(await recovered.json()).toEqual({
    error: { code: "storage.disk_full", params: { restartDeletesLogs: true } },
  });
});

it("in the held state with no recovery, on a full disk with the box's spare file, the spare is not released, and the summary and Start again answer 507 storage.disk_full, deleting nothing", async (ctx) => {
  const small = needDisk(ctx);
  const f = await heldSetup();
  expect(realpathSync(f.roots.venueDir).startsWith(`${process.env.TMPDIR}/`)).toBe(true);
  const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(SPARE_SPACE_BYTES, 1));
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    () => {},
    spareOption(f.roots),
  );
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  small.fill();
  expect(small.free()).toBeLessThan(65_536);
  const inspected = (await (await entry.app.request(ROUTE, {}, tls())).json()) as Inspection;
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const before = await diskSnapshot(f.roots);
  const send = (path: string) =>
    entry.app.request(
      `${ROUTE}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      },
      tls(),
    );
  for (const path of ["/start-again/summary", "/start-again"]) {
    const answer = await send(path);
    expect(answer.status, path).toBe(507);
    expect(await answer.json()).toMatchObject({ error: { code: "storage.disk_full" } });
  }
  expect(await diskSnapshot(f.roots)).toEqual(before);
  expect((await stat(spare)).size).toBe(SPARE_SPACE_BYTES);
});
