import { afterEach, describe, expect, it, vi } from "vitest";
import { bootReader } from "./boot-reader.js";

const UPTIME = "/proc/uptime";
const BOOT_ID = "/proc/sys/kernel/random/boot_id";
const ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  vi.restoreAllMocks();
});

function unreadable(path: string): never {
  throw Object.assign(new Error(`no ${path}`), { code: "ENOENT" });
}

/** A file reader over `files`; a path holding `null`, or absent, cannot be read. */
function files(contents: Record<string, string | null>) {
  const reads: string[] = [];
  const read = (path: string) => {
    reads.push(path);
    const text = contents[path];
    return text === undefined || text === null ? unreadable(path) : text;
  };
  return { contents, reads, read };
}

describe("the boot reader", () => {
  it("answers /proc/uptime's milliseconds and the boot id when both can be read", () => {
    const f = files({ [UPTIME]: "5000.25 1234.56\n", [BOOT_ID]: `${ID}\n` });
    const reader = bootReader(f.read);
    expect(reader.readBoot()).toEqual({ ms: 5_000_250, id: ID });
    f.contents[UPTIME] = "5060.50 1234.56\n";
    expect(reader.readBoot()).toEqual({ ms: 5_060_500, id: ID });
  });

  it("answers performance.now() and no boot id where /proc/uptime cannot be read", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_234.5);
    const f = files({ [UPTIME]: null, [BOOT_ID]: `${ID}\n` });
    expect(bootReader(f.read).readBoot()).toEqual({ ms: 1_234.5, id: null });
  });

  it.each(["", "not a number\n"])(
    "answers performance.now() and no boot id where /proc/uptime holds %j",
    (text) => {
      vi.spyOn(performance, "now").mockReturnValue(77);
      const f = files({ [UPTIME]: text, [BOOT_ID]: `${ID}\n` });
      expect(bootReader(f.read).readBoot()).toEqual({ ms: 77, id: null });
    },
  );

  it("keeps to performance.now() once it started there, even if /proc/uptime becomes readable", () => {
    vi.spyOn(performance, "now").mockReturnValue(9);
    const f = files({ [UPTIME]: null, [BOOT_ID]: `${ID}\n` });
    const reader = bootReader(f.read);
    f.contents[UPTIME] = "5000.00 1.00\n";
    expect(reader.readBoot()).toEqual({ ms: 9, id: null });
  });

  it("answers NaN and no boot id when a later read of /proc/uptime fails or gives no number", () => {
    vi.spyOn(performance, "now").mockReturnValue(9);
    const f = files({ [UPTIME]: "5000.00 1.00\n", [BOOT_ID]: `${ID}\n` });
    const reader = bootReader(f.read);
    f.contents[UPTIME] = null;
    expect(reader.readBoot()).toEqual({ ms: Number.NaN, id: null });
    f.contents[UPTIME] = "garbage";
    expect(reader.readBoot()).toEqual({ ms: Number.NaN, id: null });
    f.contents[UPTIME] = "5001.00 1.00\n";
    expect(reader.readBoot()).toEqual({ ms: 5_001_000, id: ID });
  });

  it.each([null, "", "\n"])(
    "answers no boot id where the boot id file holds %j, with /proc/uptime readable",
    (bootId) => {
      const f = files({ [UPTIME]: "5000.00 1.00\n", [BOOT_ID]: bootId });
      expect(bootReader(f.read).readBoot()).toEqual({ ms: 5_000_000, id: null });
    },
  );

  it("does not read the boot id when the milliseconds did not come from /proc/uptime", () => {
    vi.spyOn(performance, "now").mockReturnValue(9);
    const f = files({ [UPTIME]: null, [BOOT_ID]: `${ID}\n` });
    bootReader(f.read).readBoot();
    expect(f.reads).not.toContain(BOOT_ID);
  });

  it("its elapsed clock answers the same milliseconds without reading the boot id", () => {
    const f = files({ [UPTIME]: "5000.00 1.00\n", [BOOT_ID]: `${ID}\n` });
    const reader = bootReader(f.read);
    f.reads.length = 0;
    expect(reader.elapsed()).toBe(5_000_000);
    expect(f.reads).toEqual([UPTIME]);
  });
});
