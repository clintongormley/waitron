import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const SCRIPT = join(import.meta.dirname, "github-release.sh");
const IMAGE = "ghcr.io/example/waitron:1.2.3";
const SPAWN_TIMEOUT_MS = 30_000;
// Each case runs the script once, plus an untimed `ls` of its folder.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS + 10_000 });

// Stand-ins built once for the file; each case varies them through STUB_* variables. Both record
// every call; `gh` also records each file it is handed, with its contents at the time of the call.
const bin = mkdtempSync(join(tmpdir(), "github-release-bin-"));
afterAll(() => rmSync(bin, { recursive: true, force: true }));
writeFileSync(
  join(bin, "docker"),
  `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/calls"
case "$1" in
  create) echo container-1 ;;
  cp)
    [ "$STUB_CP_FAILS" = "\${2##*/}" ] && { echo "no such file: $2" >&2; exit 1; }
    printf 'inside %s' "$2" > "$3" ;;
esac
`,
);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
printf 'gh %s\\n' "$*" >> "$STUB_DIR/calls"
for arg in "$@"; do [ -f "$arg" ] && printf '%s: %s\\n' "\${arg##*/}" "$(cat "$arg")" >> "$STUB_DIR/files"; done
if [ "$1 $2" = "release view" ]; then
  case "$STUB_RELEASE" in
    present) echo "title: 1.2.3" ;;
    absent) echo "release not found" >&2; exit 1 ;;
    *) echo "HTTP 401: Bad credentials" >&2; exit 1 ;;
  esac
fi
`,
);
chmodSync(join(bin, "docker"), 0o755);
chmodSync(join(bin, "gh"), 0o755);

function run({ release = "absent", cpFails = "", args = ["1.2.3", IMAGE] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "github-release-"));
  try {
    // A minimal environment, so nothing of the caller's (GIT_*, GH_*) reaches the script.
    const result = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: dir,
        TMPDIR: dir,
        STUB_DIR: dir,
        STUB_RELEASE: release,
        STUB_CP_FAILS: cpFails,
      },
    });
    const read = (name) =>
      existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
    const calls = read("calls").split("\n").filter(Boolean);
    const leftovers = spawnSync("ls", ["-A", dir], { encoding: "utf8" })
      .stdout.split("\n")
      .filter((name) => name && !["calls", "files"].includes(name));
    return { ...result, calls, files: read("files"), leftovers };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const COPIED = [
  "waitron-1.2.3-declaration.pdf: inside container-1:/app/declaration/declaration.pdf",
  "waitron-1.2.3-declaration.txt: inside container-1:/app/declaration/declaration.txt",
];
const ghCalls = (calls) => calls.filter((call) => call.startsWith("gh "));

describe("github-release.sh", () => {
  it("copies both files out of the image and makes the Release when there is none", () => {
    const result = run({ release: "absent" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls[0]).toBe(`create --pull never ${IMAGE}`);
    expect(result.calls).toContain("rm container-1");
    expect(ghCalls(result.calls)).toEqual([
      "gh release view v1.2.3",
      expect.stringMatching(
        /^gh release create v1\.2\.3 --title 1\.2\.3 --verify-tag \S+\/waitron-1\.2\.3-declaration\.pdf \S+\/waitron-1\.2\.3-declaration\.txt$/,
      ),
    ]);
    expect(result.files.split("\n").filter(Boolean)).toEqual(COPIED);
    expect(result.leftovers).toEqual([]);
  });

  it("replaces the two files on a Release that already exists, never making a second", () => {
    const result = run({ release: "present" });
    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls(result.calls)).toEqual([
      "gh release view v1.2.3",
      expect.stringMatching(
        /^gh release upload v1\.2\.3 --clobber \S+\/waitron-1\.2\.3-declaration\.pdf \S+\/waitron-1\.2\.3-declaration\.txt$/,
      ),
    ]);
    expect(result.files.split("\n").filter(Boolean)).toEqual(COPIED);
  });

  it.each(["declaration.pdf", "declaration.txt"])(
    "stops before asking GitHub anything when %s cannot be copied, and still removes the container",
    (file) => {
      const result = run({ cpFails: file });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(file);
      expect(ghCalls(result.calls)).toEqual([]);
      expect(result.calls).toContain("rm container-1");
      expect(result.leftovers).toEqual([]);
    },
  );

  it("stops when GitHub cannot say whether the Release exists, making none", () => {
    const result = run({ release: "unreadable" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HTTP 401: Bad credentials");
    expect(result.stderr).toContain("v1.2.3");
    expect(ghCalls(result.calls)).toEqual(["gh release view v1.2.3"]);
  });

  it.each([[[]], [["1.2.3"]], [["1.2.3", IMAGE, "extra"]]])(
    "refuses to run without exactly a version and an image (%j)",
    (args) => {
      const result = run({ args });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage");
      expect(result.calls).toEqual([]);
    },
  );
});
