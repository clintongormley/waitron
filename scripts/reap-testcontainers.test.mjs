import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STALE_CONTAINER_MS, reap } from "./reap-testcontainers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A fixed clock so the age filter is deterministic, plus a helper to date a container N ms in the past.
const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const now = () => NOW;
const createdAgo = (ms) => new Date(NOW - ms).toISOString();
const STALE = STALE_CONTAINER_MS + 60_000; // comfortably past the threshold → reapable
const FRESH = 60_000; // a minute old → a concurrent session may still hold it → spared

// A fake `docker` CLI: returns configured stdout for `ps` and `inspect`, records every invocation, and
// can be told to fail on one subcommand (to model a Docker daemon that is not running, or a container
// that vanished mid-run). `exec(args)` stands in for `execFileSync("docker", args)` — the real one throws
// on a non-zero exit / missing daemon, which is what `failOn` reproduces.
function fakeDocker({ ps = "", inspect = "", failOn = null } = {}) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    const sub = args[0];
    if (failOn !== null && sub === failOn) throw new Error("Cannot connect to the Docker daemon");
    if (sub === "ps") return ps;
    if (sub === "inspect") return inspect;
    return "";
  };
  return { exec, calls };
}

describe("reap-testcontainers", () => {
  it("scopes the query to waitron's own label, never the generic org.testcontainers", () => {
    // The bare `org.testcontainers` label is on EVERY testcontainers container (this repo's, another
    // repo's, a live one in a concurrent run). Filtering on waitron's own label is what stops the reaper
    // touching anything but this project's containers.
    const { exec, calls } = fakeDocker({ ps: "", inspect: "" });
    reap({ exec, now });
    expect(calls[0]).toEqual(["ps", "-aq", "--filter", "label=com.waitron.reapable"]);
  });

  it("force-removes only STALE waitron containers (older than the threshold), sparing recent ones", () => {
    // The age filter is the second guard: a container younger than the threshold may belong to a
    // watch-mode session running RIGHT NOW in another terminal, so it must survive.
    const { exec, calls } = fakeDocker({
      ps: "old111\nnew222\n",
      inspect: `old111 ${createdAgo(STALE)}\nnew222 ${createdAgo(FRESH)}\n`,
    });
    const result = reap({ exec, now });
    expect(result).toEqual({ dockerAvailable: true, containersRemoved: 1 });
    // Removed the stale one by id with -f (force, even if running) and -v (its anonymous data volume).
    expect(calls).toContainEqual(["rm", "-f", "-v", "old111"]);
    // The recent one is inspected (all ids are age-checked together) but never removed.
    const removals = calls.filter((c) => c[0] === "rm");
    expect(removals.some((c) => c.includes("new222"))).toBe(false);
  });

  it("removes nothing when every candidate is younger than the threshold", () => {
    const { exec, calls } = fakeDocker({
      ps: "fresh1\nfresh2\n",
      inspect: `fresh1 ${createdAgo(FRESH)}\nfresh2 ${createdAgo(10 * 60_000)}\n`,
    });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("does no inspect or removal when there are no waitron containers at all (empty-arg safety)", () => {
    // `docker inspect`/`docker rm` with no ids are both errors; the reaper must skip them when empty.
    const { exec, calls } = fakeDocker({ ps: "\n  \n" });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "inspect")).toBe(false);
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("never removes images, named volumes, or blanket-prunes — removal is scoped to the stale ids", () => {
    const { exec, calls } = fakeDocker({
      ps: "old111\n",
      inspect: `old111 ${createdAgo(STALE)}\n`,
    });
    reap({ exec, now });
    expect(calls.some((c) => c[0] === "rmi")).toBe(false); // no image removal
    // No blanket `volume prune` (which would reach another project's dangling volumes); the stale ids'
    // own anonymous volumes go with `rm -v`.
    expect(calls.some((c) => c[0] === "volume")).toBe(false);
  });

  it("no-ops gracefully when Docker is unavailable (returns dockerAvailable:false, does not throw)", () => {
    const { exec } = fakeDocker({ failOn: "ps" });
    // A throw would fail this via an uncaught exception, so the single call proves both the shape and
    // that the reaper swallows the daemon-unavailable error rather than failing its caller.
    expect(reap({ exec, now })).toEqual({ dockerAvailable: false, containersRemoved: 0 });
  });

  it("removes nothing if `docker inspect` fails — never reaps a container it could not age-check", () => {
    const { exec, calls } = fakeDocker({ ps: "old111\n", failOn: "inspect" });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("swallows a `docker rm` failure (a container that vanished, a permission error) — stays best-effort", () => {
    // The daemon disconnects or the container is gone between `inspect` and `rm`. The reaper must not
    // throw (its whole contract is "never fail the caller") and reports 0 removed.
    const { exec } = fakeDocker({
      ps: "old111\n",
      inspect: `old111 ${createdAgo(STALE)}\n`,
      failOn: "rm",
    });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
  });

  it("defaults to the real clock when no `now` is injected", () => {
    // Exercises the default `now` (real `Date.now`): a decades-old container is stale under any real clock.
    const { exec, calls } = fakeDocker({
      ps: "ancient1\n",
      inspect: "ancient1 2000-01-01T00:00:00.000Z\n",
    });
    expect(reap({ exec })).toEqual({ dockerAvailable: true, containersRemoved: 1 });
    expect(calls).toContainEqual(["rm", "-f", "-v", "ancient1"]);
  });

  // The v8-ignored CLI entry: run the script for real against a FAKE `docker` on PATH, so the shell-out
  // wiring is proven without touching the machine's actual Docker. The fake records its argv to a file.
  describe("the CLI entry", () => {
    let dir;
    afterEach(() => {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    });

    it("invokes docker to reap the stale labelled containers and exits 0", () => {
      dir = mkdtempSync(join(tmpdir(), "reap-fakedocker-"));
      const argLog = join(dir, "args.log");
      // A fake `docker`: `ps` prints one container id, `inspect` dates it decades ago (always stale),
      // every call is recorded, exit 0.
      const fake = join(dir, "docker");
      writeFileSync(
        fake,
        `#!/bin/sh
echo "$@" >> "${argLog}"
if [ "$1" = "ps" ]; then echo orphan123; fi
if [ "$1" = "inspect" ]; then echo "orphan123 2000-01-01T00:00:00.000Z"; fi
exit 0
`,
      );
      chmodSync(fake, 0o755);

      const result = spawnSync(process.execPath, [join(HERE, "reap-testcontainers.mjs")], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
        encoding: "utf8",
      });

      expect(result.status).toBe(0); // best-effort: never fails its caller
      const calls = readFileSync(argLog, "utf8");
      expect(calls).toContain("ps -aq --filter label=com.waitron.reapable");
      expect(calls).toContain("rm -f -v orphan123");
    });
  });
});
