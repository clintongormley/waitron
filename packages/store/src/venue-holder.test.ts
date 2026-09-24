import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isVenueHolderFresh,
  readVenueHolder,
  readVenueHolderAsync,
  VENUE_HOLDER_FILE,
  VENUE_HOLDER_KINDS,
  VENUE_HOLDER_STALE_MS,
  writeVenueHolder,
  type VenueHolder,
} from "./venue-holder.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const tempDir = () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-venue-holder-"));
  directories.push(directory);
  return directory;
};

const HOLDER: VenueHolder = {
  kind: "server",
  pid: 4242,
  host: "3f2a9c1b7d4e",
  lockedAt: "2026-09-24T20:00:00.000Z",
  heartbeatAt: "2026-09-24T20:05:00.000Z",
};

const withFile = (content: string) => {
  const directory = tempDir();
  writeFileSync(join(directory, VENUE_HOLDER_FILE), content);
  return directory;
};

describe("the holder file's fixed values", () => {
  it("names the file, the kinds and the staleness bound", () => {
    expect(VENUE_HOLDER_FILE).toBe("venue.holder.json");
    expect(VENUE_HOLDER_KINDS).toEqual(["server", "restore", "rejoin", "provisioning", "script"]);
    expect(VENUE_HOLDER_STALE_MS).toBe(30_000);
  });
});

// The same cases for both readers: the synchronous one a refused start uses, and the one `/health`
// awaits.
describe.each([
  ["readVenueHolder", (directory: string) => Promise.resolve(readVenueHolder(directory))],
  ["readVenueHolderAsync", readVenueHolderAsync],
])("%s", (_name, read) => {
  it("reads a well-formed record", async () => {
    expect(await read(withFile(JSON.stringify(HOLDER)))).toEqual(HOLDER);
  });

  it("reads every kind in the set", async () => {
    for (const kind of VENUE_HOLDER_KINDS) {
      expect((await read(withFile(JSON.stringify({ ...HOLDER, kind }))))?.kind).toBe(kind);
    }
  });

  it("answers null when there is no file", async () => {
    expect(await read(tempDir())).toBeNull();
  });

  it("answers null when the folder does not exist", async () => {
    expect(await read(join(tempDir(), "missing"))).toBeNull();
  });

  it("answers null for bytes that are not JSON", async () => {
    expect(await read(withFile('{"kind": "server", "pid'))).toBeNull();
  });

  it("answers null for JSON that is not an object", async () => {
    for (const content of ["null", "42", '"server"', "[]"]) {
      expect(await read(withFile(content))).toBeNull();
    }
  });

  it("answers null for a kind outside the set, rather than a record with no kind", async () => {
    expect(await read(withFile(JSON.stringify({ ...HOLDER, kind: "break-glass" })))).toBeNull();
  });

  it("answers null when any one field is missing or of the wrong shape", async () => {
    const broken: Record<string, unknown>[] = [
      { kind: undefined },
      { kind: 1 },
      { pid: undefined },
      { pid: "4242" },
      { pid: 0 },
      { pid: -1 },
      { pid: 1.5 },
      { host: undefined },
      { host: "" },
      { host: 7 },
      { lockedAt: undefined },
      { lockedAt: "yesterday" },
      { lockedAt: "2026-09-24" },
      { lockedAt: 1_790_000_000_000 },
      { heartbeatAt: undefined },
      { heartbeatAt: "not a time" },
      { heartbeatAt: "2026-09-24T20:05:00Z" },
    ];
    for (const change of broken) {
      const record = { ...HOLDER, ...change };
      expect(await read(withFile(JSON.stringify(record))), JSON.stringify(change)).toBeNull();
    }
  });
});

describe("isVenueHolderFresh", () => {
  const beat = Date.parse(HOLDER.heartbeatAt);
  const at = (offsetMs: number) => new Date(beat + offsetMs);

  it("is fresh for a heartbeat younger than the bound", () => {
    expect(isVenueHolderFresh(HOLDER, at(0))).toBe(true);
    expect(isVenueHolderFresh(HOLDER, at(VENUE_HOLDER_STALE_MS - 1))).toBe(true);
  });

  it("is stale at exactly the bound and beyond it", () => {
    expect(isVenueHolderFresh(HOLDER, at(VENUE_HOLDER_STALE_MS))).toBe(false);
    expect(isVenueHolderFresh(HOLDER, at(10 * VENUE_HOLDER_STALE_MS))).toBe(false);
  });

  it("is stale for a heartbeat a whole bound or more in the future", () => {
    expect(isVenueHolderFresh(HOLDER, at(-(VENUE_HOLDER_STALE_MS - 1)))).toBe(true);
    expect(isVenueHolderFresh(HOLDER, at(-VENUE_HOLDER_STALE_MS))).toBe(false);
  });
});

describe("writeVenueHolder", () => {
  it("throws the write's own error when its half-written copy cannot be removed either", () => {
    const directory = tempDir();
    mkdirSync(join(directory, `${VENUE_HOLDER_FILE}.partial`, "occupied"), { recursive: true });
    expect(() => writeVenueHolder(directory, HOLDER)).toThrow(
      expect.objectContaining({ code: "EISDIR", syscall: "open" }),
    );
  });
});
