import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { openSmallDisk } from "./full-disk.js";

const VARIABLE = "WAITRON_FULL_DISK_DIR_TEST_ONLY";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("a named variable pointing at a large filesystem is refused, naming that variable", () => {
  vi.stubEnv(VARIABLE, tmpdir());
  const opened = openSmallDisk(VARIABLE);
  expect(opened.ok).toBe(false);
  expect(!opened.ok && opened.reason).toMatch(new RegExp(`^${VARIABLE} \\(`));
});

it("with the named variable unset on Linux, there is no small filesystem, and the reason names that variable", () => {
  vi.stubEnv(VARIABLE, "");
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  // On macOS a failed stub would attach a disk image this case never detaches.
  expect(process.platform).toBe("linux");
  expect(openSmallDisk(VARIABLE)).toEqual({
    ok: false,
    reason: `no small filesystem: set ${VARIABLE} to one of 64 MiB or less`,
  });
});
