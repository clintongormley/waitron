import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BOX = dirname(fileURLToPath(import.meta.url));

// The USB drive module's set sits behind a link, box/storage, that build.sh makes and waitron.sh's
// install_storage_modules renames over to switch sets. A module whose entry check compares the
// path as typed answers nothing when started through it.
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
  // Weaker than its name: reads source text, one line at a time.
  it("compare the resolved real path of the script node was given, never its path as typed", () => {
    const checks = readdirSync(BOX, { recursive: true })
      .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
      .flatMap((name) =>
        readFileSync(join(BOX, name), "utf8")
          .split("\n")
          .filter((line) => line.includes("process.argv[1]") && line.includes("import.meta.url"))
          .map((line) => ({ name, line })),
      );
    expect(checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "disk-start.mjs",
        "installer-return.mjs",
        "name-tag-host.mjs",
        "network-change.mjs",
        "network-host.mjs",
        "storage-host.mjs",
        join("upgrades", "cli.mjs"),
      ]),
    );
    expect(
      checks.filter(
        ({ line }) =>
          !line.includes("realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)"),
      ),
    ).toEqual([]);
  });
});
