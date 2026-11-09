import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { expectRefusedUnchanged, ordinaryServer } from "../test/stop-route-server.js";
import { FULL_DISK_BYTES } from "./boot-failure.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const free = vi.hoisted(() => ({ bytes: null as number | null, dirs: [] as string[][] }));
vi.mock("./start-space.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./start-space.js")>()),
  lowestFreeBytes: async (dirs: string[]) => {
    free.dirs.push([...dirs]);
    return free.bytes;
  },
}));

it.each([
  ["a nearly full disk", 507, "storage.disk_full", 1024 * 1024],
  ["a disk with room", 409, "setup.attempt_invalid", 4 * FULL_DISK_BYTES],
])(
  "a stop whose record write is refused on %s answers %i %s, as the repair page's Start again does",
  async (_, status, code, bytes) => {
    const s = await ordinaryServer();
    const ids = await s.ids();
    const before = await s.record();
    free.bytes = bytes;
    free.dirs = [];
    vi.spyOn(s.host.store, "update").mockRejectedValueOnce(
      new AppError("setup.attempt_invalid", {}),
    );
    await expectRefusedUnchanged(s, await s.stop(ids), status, code, before);
    expect(free.dirs).toEqual([[s.stateDir, s.venueDir]]);
  },
);
