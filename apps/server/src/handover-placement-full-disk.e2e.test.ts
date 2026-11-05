// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_PLACEMENT names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { existsSync, statSync } from "node:fs";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import {
  ACCEPTED_VERSION,
  copyPlacedEvents,
  OLD_VERSION,
  PLACE_COPY_MIGRATIONS,
  placeCopyBoxes,
  sha,
  userVersion,
  type Box,
  type StartResult,
} from "./testing/place-copy-box.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const { beforeServerStarts, startServer } = ephemeralServerFixture();

const MIB = 1024 * 1024;
/** Where `fullDiskFailure` stops counting ENOSPC as a full disk (`boot-failure.ts`). */
const FULL_DISK_LINE = 16 * MIB;
const ACCEPTED_BYTES = 24 * MIB;

const suite = useVenueDb({ migrations: PLACE_COPY_MIGRATIONS });
const { buildBox, entryStart, cleanUp } = placeCopyBoxes({
  suite,
  beforeServerStarts,
  startServer,
});

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_PLACEMENT", 64);
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`placement full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(async () => {
  disk?.unfill();
  await cleanUp();
});
afterAll(() => disk?.close());

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

/** Real starts through production's entry, until the box stops booting and shows its page. */
async function startsUntilPage(b: Box): Promise<StartResult> {
  let start: StartResult = {};
  for (let attempt = 0; attempt < 5 && start.page === undefined; attempt += 1) {
    start = await entryStart(b);
    if (start.page === undefined) {
      expect(start.thrown?.code, start.thrown?.message).toBe("handover.placement_no_room");
    }
  }
  return start;
}

const CASES: readonly (readonly [string, number])[] = [
  ["with over 16 MiB free, more than a full disk counts as", 20 * MIB],
  ["on a truly full disk", 2 * MIB],
];

for (const [name, leave] of CASES) {
  it(`a copy the disk has no room for ${name}: its own page, the bytes needed, and a later start places`, async (ctx) => {
    const small = needDisk(ctx);
    const b = await buildBox({
      on: small.folder(name.replaceAll(/\W/g, "-")),
      acceptedBytes: ACCEPTED_BYTES,
    });
    const acceptedSize = statSync(b.accepted).size;
    const acceptedDigest = sha(b.accepted);
    small.fill(leave);
    expect(small.free()).toBeLessThan(acceptedSize);
    if (leave > FULL_DISK_LINE) expect(small.free()).toBeGreaterThan(FULL_DISK_LINE);

    const start = await startsUntilPage(b);

    // Failing case, ENOSPC left as it was: `unknown` over the line, and a page that says nothing of the
    // handover, the kept copy or the old box, and sends the person to whoever installed the box.
    const state = await readRecoveryState(b.stateDir);
    expect(state.lastErrorCode).toBe("handover.placement_no_room");
    expect(start.page).toContain("This box&#39;s disk has no room for the copy of the venue");
    expect(start.page).toContain(`&quot;neededBytes&quot;:${acceptedSize}`);
    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(sha(b.accepted)).toBe(acceptedDigest);
    expect(existsSync(`${b.live}.incoming`)).toBe(false);
    expect(copyPlacedEvents(b)).toBe(0);

    small.unfill();
    await writeRecoveryState(b.stateDir, { ...state, level: "normal", failures: 0 });
    const later = await entryStart(b);
    expect(later.thrown).toBeUndefined();
    await later.started!.close();
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
  }, 240_000);
}
