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
if [ "$1 $2" = "release view" ] && [ "$5" = "assets" ]; then
  if [ "$STUB_SIGNED_ASSET" = "unreadable" ]; then
    echo "HTTP 401: Bad credentials" >&2
    exit 1
  fi
  [ "$STUB_SIGNED_ASSET" = "absent" ] || echo waitron-release.json
  exit 0
fi
if [ "$1 $2" = "release download" ]; then
  [ "$STUB_SIGNED_ASSET" = "identical" ] && printf 'signed bytes' || printf 'different bytes'
  exit 0
fi
if [ "$1 $2" = "release view" ]; then
  case "$STUB_RELEASE" in
    present) echo "$STUB_IS_PRERELEASE" ;;
    absent) echo "release not found" >&2; exit 1 ;;
    *) echo "HTTP 401: Bad credentials" >&2; exit 1 ;;
  esac
fi
`,
);
chmodSync(join(bin, "docker"), 0o755);
chmodSync(join(bin, "gh"), 0o755);

function run({
  release = "absent",
  cpFails = "",
  args = ["1.2.3", IMAGE],
  signedAsset,
  prerelease = "false",
  isPrerelease = "false",
  maintenance = "false",
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "github-release-"));
  try {
    if (signedAsset) {
      const manifest = join(dir, "waitron-release.json");
      writeFileSync(manifest, "signed bytes");
      args = ["--signed-file", "1.2.3", manifest];
    }
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
        STUB_SIGNED_ASSET: signedAsset ?? "",
        STUB_IS_PRERELEASE: isPrerelease,
        ...(maintenance === null ? {} : { RELEASE_MAINTENANCE: maintenance }),
        ...(prerelease === null ? {} : { RELEASE_PRERELEASE: prerelease }),
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
const VIEW = "gh release view v1.2.3 --json isPrerelease --jq .isPrerelease";

describe("github-release.sh", () => {
  it.each([null, "unknown"])(
    "refuses to create a release with an invalid maintenance result (%s)",
    (maintenance) => {
      const result = run({ maintenance });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("RELEASE_MAINTENANCE must be true or false");
      expect(result.calls).toEqual([]);
    },
  );

  it("creates a stable maintenance release without taking GitHub's Latest slot", () => {
    const result = run({ maintenance: "true" });
    expect(result.status, result.stderr).toBe(0);
    const create = result.calls.find((line) => line.startsWith("gh release create"));
    expect(create).toContain("--latest=false");
    expect(create).not.toContain("--prerelease");
  });

  it("copies both files out of the image and makes the Release when there is none", () => {
    const result = run({ release: "absent" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls[0]).toBe(`create --pull never ${IMAGE}`);
    expect(result.calls).toContain("rm container-1");
    expect(ghCalls(result.calls)).toEqual([
      VIEW,
      expect.stringMatching(
        /^gh release create v1\.2\.3 --title 1\.2\.3 --verify-tag \S+\/waitron-1\.2\.3-declaration\.pdf \S+\/waitron-1\.2\.3-declaration\.txt$/,
      ),
    ]);
    expect(result.files.split("\n").filter(Boolean)).toEqual(COPIED);
    expect(result.leftovers).toEqual([]);
  });

  it("creates a prerelease without making it Latest", () => {
    const result = run({ prerelease: "true" });
    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls(result.calls)).toEqual([
      VIEW,
      expect.stringMatching(/^gh release create v1\.2\.3 .* --prerelease --latest=false /),
    ]);
    expect(result.files.split("\n").filter(Boolean)).toEqual(COPIED);
  });

  it("replaces the two files on a Release that already exists, never making a second", () => {
    const result = run({ release: "present" });
    expect(result.status, result.stderr).toBe(0);
    expect(ghCalls(result.calls)).toEqual([
      VIEW,
      expect.stringMatching(
        /^gh release upload v1\.2\.3 --clobber \S+\/waitron-1\.2\.3-declaration\.pdf \S+\/waitron-1\.2\.3-declaration\.txt$/,
      ),
    ]);
    expect(result.files.split("\n").filter(Boolean)).toEqual(COPIED);
  });

  it("leaves an existing stable Release alone when retrying a prerelease", () => {
    const result = run({ release: "present", prerelease: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("prerelease flag");
    expect(ghCalls(result.calls)).toEqual([VIEW]);
  });

  it.each([null, "yes"])("refuses to publish with prerelease input %j", (prerelease) => {
    const result = run({ prerelease });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("RELEASE_PRERELEASE");
    expect(result.calls).toEqual([]);
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
    expect(ghCalls(result.calls)).toEqual([VIEW]);
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

describe("attaching the signed release file", () => {
  it("refuses an incomplete signed-file command without touching Docker or GitHub", () => {
    const result = run({ args: ["--signed-file", "1.2.3"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
    expect(result.calls).toEqual([]);
  });

  it("uploads the asset once without replacing any file", () => {
    const result = run({ signedAsset: "absent" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toMatch(/^gh release view v1\.2\.3 --json assets /);
    expect(result.calls[1]).toMatch(/^gh release upload v1\.2\.3 \S+\/waitron-release\.json$/);
    expect(result.files).toBe("waitron-release.json: signed bytes\n");
  });

  it.each([
    ["identical", 0],
    ["different", 1],
  ])("on retry keeps the %s existing asset and exits %d", (signedAsset, status) => {
    const result = run({ signedAsset });
    expect(result.status, result.stderr).toBe(status);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1]).toBe(
      "gh release download v1.2.3 --pattern waitron-release.json --output -",
    );
    if (status) expect(result.stderr).toContain("differs");
  });

  it("refuses to upload if the existing assets cannot be checked", () => {
    const result = run({ signedAsset: "unreadable" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP 401");
    expect(result.calls).toHaveLength(1);
  });
});
