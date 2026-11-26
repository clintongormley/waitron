import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BOX = dirname(fileURLToPath(import.meta.url));

// The box image and deploy/waitron.sh both install the USB drive module's set in a folder of its
// own and reach it through a link (box/storage -> .storage.recipe), and waitron-box.sh runs it
// through that link. A module whose entry check compares the unresolved path runs nothing there.
describe("a host module run through a linked folder", () => {
  let scratch;
  let linked;
  beforeAll(() => {
    // Resolved first, so the only link on the way is the one under test (macOS's /var is another).
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "host-entry-")));
    linked = join(scratch, "storage");
    symlinkSync(BOX, linked);
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const run = (module, input = "") =>
    spawnSync(process.execPath, [join(linked, module)], {
      input,
      encoding: "utf8",
      timeout: 20_000,
    });

  it.each(["storage-host.mjs", "network-host.mjs", "name-tag-host.mjs"])(
    "%s answers a request it cannot read",
    (module) => {
      const child = run(module, "not a request\n");
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ ok: false, reason: "request_invalid" });
    },
  );

  it("disk-start.mjs refuses to start without root and a mode", () => {
    const child = run("disk-start.mjs");
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("disk_start.refused");
  });
});

describe("host module entry checks", () => {
  it("compare the resolved real path of the script node was given, never its path as typed", () => {
    const modules = readdirSync(BOX, { recursive: true }).filter(
      (name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"),
    );
    const typed = modules.filter((name) =>
      /resolve\(process\.argv\[1\]\)/.test(readFileSync(join(BOX, name), "utf8")),
    );
    expect(typed).toEqual([]);
  });
});
