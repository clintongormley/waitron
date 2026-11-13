import * as fs from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { expect, it, onTestFinished, vi } from "vitest";
import { applyUpgrade, recoverUpgrade, upgradeStatus } from "./transaction.mjs";
import { VENUE_LOCK_FILE } from "../../../packages/store/src/venue-lock.js";
import { RECOVERY_LOCK_FILE, VENUE_DIR_NAME } from "../../../packages/store/src/state-layout.js";

const gnuCopy =
  process.platform === "darwin"
    ? execFileSync("which", ["gcp"], { encoding: "utf8" }).trim()
    : null;

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "waitron-upgrade-transaction-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  if (gnuCopy !== null) {
    const bin = join(root, "bin");
    await fs.mkdir(bin);
    await fs.symlink(gnuCopy, join(bin, "cp"));
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH}`);
    onTestFinished(() => vi.unstubAllEnvs());
  }
  const state = join(root, "state");
  const config = join(root, ".env");
  await fs.mkdir(state);
  await fs.writeFile(join(state, "venue.db"), "old venue");
  await fs.writeFile(config, "old config", { mode: 0o600 });
  const directory = join(root, "attempt");
  const events = [];
  const host = {
    abortPreparation: async () => undefined,
    async prepareImages() {
      events.push("pin images");
      return { old: { app: "sha256:old" }, candidate: { app: "sha256:new" } };
    },
    async stop() {
      events.push("stop");
    },
    async installCandidate(images) {
      events.push(["install", images]);
      await fs.writeFile(join(state, "venue.db"), "candidate venue");
      await fs.writeFile(config, "candidate config");
    },
    async checkCandidate() {
      return [{ name: "sale", ok: true }];
    },
    async resume(images) {
      events.push({
        resume: images,
        marker: await upgradeStatus(directory),
        venue: await fs.readFile(join(state, "venue.db"), "utf8"),
        config: await fs.readFile(config, "utf8"),
      });
    },
    async cleanup(images) {
      events.push(["cleanup", images]);
    },
  };
  const input = { directory, paths: [state, config], host };
  return { ...input, input, root, state, config, events };
}

it("records completion before reopening the candidate and removes its recovery copies", async () => {
  const f = await fixture();
  const result = await applyUpgrade({ ...f.input, mode: "manual" });

  expect(result).toMatchObject({ phase: "committed", target: "candidate" });
  expect(f.events[0]).toBe("pin images");
  expect(f.events[1]).toBe("stop");
  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:new" },
    venue: "candidate venue",
    config: "candidate config",
    marker: { phase: "committed", target: "candidate" },
  });
  expect(await fs.readdir(f.directory)).toEqual(["attempt.json"]);
});

it("keeps a failed manual candidate held across a new invocation until restore is chosen", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];

  const result = await applyUpgrade({ ...f.input, mode: "manual" });
  expect(result).toMatchObject({ phase: "awaiting-choice", checks: [{ name: "sale", ok: false }] });
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  expect(await recoverUpgrade(f.input)).toEqual(result);
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  await recoverUpgrade({ ...f.input, choice: "restore" });

  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:old" },
    venue: "old venue",
    config: "old config",
    marker: { phase: "committed", target: "old" },
  });
  expect(await fs.readdir(f.directory)).toEqual(["attempt.json"]);
});

it("restores automatically when candidate checks fail", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => {
    throw new Error("listener refused");
  };

  const result = await applyUpgrade({ ...f.input, mode: "automatic" });

  expect(result).toMatchObject({ phase: "committed", target: "old", failure: "listener refused" });
  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:old" },
    venue: "old venue",
    config: "old config",
  });
});

it("returns to the old service without copying or installing after an unconfirmed drain", async () => {
  const f = await fixture();
  f.host.stop = async () => {
    throw new Error("shutdown deadline without completion");
  };

  const result = await applyUpgrade({ ...f.input, mode: "manual" });

  expect(result).toMatchObject({ phase: "committed", target: "old", copied: false });
  expect(f.events.filter((event) => Array.isArray(event) && event[0] === "install")).toEqual([]);
  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:old" },
    venue: "old venue",
    config: "old config",
  });
});

it("never restores after completion even if reopening the candidate failed", async () => {
  const f = await fixture();
  const resume = f.host.resume;
  f.host.resume = async () => {
    throw new Error("service start failed");
  };
  await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toThrow(
    "service start failed",
  );
  await fs.writeFile(join(f.state, "venue.db"), "later business data");
  f.host.resume = resume;

  await recoverUpgrade({ ...f.input, choice: "restore" });

  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:new" },
    venue: "later business data",
    marker: { phase: "committed", target: "candidate" },
  });
});

it("records a manual keep before reopening without replacing failed checks with a pass", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });

  await recoverUpgrade({ ...f.input, choice: "keep" });

  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:new" },
    venue: "candidate venue",
    marker: { phase: "committed", target: "candidate", checks: [{ name: "sale", ok: false }] },
  });
});

it("an interrupted restore starts again from the intact saved copy before Keep", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  await fs.rm(f.config);
  await fs.mkdir(f.config);
  await fs.writeFile(join(f.config, "blocker"), "interrupted config replacement");

  await expect(recoverUpgrade({ ...f.input, choice: "restore" })).rejects.toThrow();
  expect(await upgradeStatus(f.directory)).toMatchObject({ phase: "restoring" });
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  expect(await fs.readFile(join(f.directory, "copies", "0", "venue.db"), "utf8")).toBe("old venue");
  await fs.rm(f.config, { recursive: true });
  await fs.writeFile(join(f.state, "venue.db"), "half restored");
  await fs.writeFile(join(f.state, "partial-restored-entry"), "discard on restart");

  await recoverUpgrade({ ...f.input, choice: "keep" });

  await expect(fs.stat(join(f.state, "partial-restored-entry"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:old" },
    venue: "old venue",
    config: "old config",
  });
});

it.each(["manual", "automatic"])(
  "recovers %s interruption before checks completed",
  async (mode) => {
    const f = await fixture();
    f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
    await applyUpgrade({ ...f.input, mode: "manual" });
    const marker = await upgradeStatus(f.directory);
    await fs.writeFile(
      join(f.directory, "attempt.json"),
      JSON.stringify({
        ...marker,
        mode,
        phase: "candidate",
        checks: null,
        failure: null,
      }),
    );

    const result = await recoverUpgrade(
      mode === "automatic" ? { ...f.input, choice: "keep" } : f.input,
    );

    if (mode === "manual") {
      expect(result).toMatchObject({ phase: "awaiting-choice", failure: "checks interrupted" });
      expect(f.events.filter((event) => event.resume)).toEqual([]);
      await recoverUpgrade({ ...f.input, choice: "restore" });
    }
    expect(f.events.find((event) => event.resume)).toMatchObject({
      resume: { app: "sha256:old" },
      venue: "old venue",
    });
  },
);

it("uses the untouched old data after an incomplete copy, and refuses keep", async () => {
  const f = await fixture();
  f.input.paths.push(join(f.root, "missing-volume"));
  const result = await applyUpgrade({ ...f.input, mode: "manual" });
  expect(result).toMatchObject({ phase: "awaiting-choice", copied: false });
  await expect(recoverUpgrade({ ...f.input, choice: "keep" })).rejects.toThrow(
    "candidate was not installed",
  );

  await recoverUpgrade({ ...f.input, choice: "restore" });

  expect(f.events.find((event) => event.resume)).toMatchObject({
    resume: { app: "sha256:old" },
    venue: "old venue",
    config: "old config",
  });
});

it("refuses a malformed marker without reopening, restoring or deleting its copies", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  const marker = await upgradeStatus(f.directory);
  await fs.writeFile(
    join(f.directory, "attempt.json"),
    JSON.stringify({ ...marker, phase: "unknown" }),
  );

  await expect(recoverUpgrade({ ...f.input, choice: "restore" })).rejects.toThrow(
    "invalid upgrade marker",
  );
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("candidate venue");
  expect(await fs.readFile(join(f.directory, "copies", "0", "venue.db"), "utf8")).toBe("old venue");
});

it.each([[], [{ name: "sale" }]])("does not reopen on incomplete checks %j", async (checks) => {
  const f = await fixture();
  f.host.checkCandidate = async () => checks;

  expect(await applyUpgrade({ ...f.input, mode: "manual" })).toMatchObject({
    phase: "awaiting-choice",
  });
  expect(f.events.filter((event) => event.resume)).toEqual([]);
});

it("flushes the completion file and its parent before cleanup or business service", async () => {
  const f = await fixture();
  const handle = await fs.open(f.config, "r");
  const prototype = Object.getPrototypeOf(handle);
  const sync = prototype.sync;
  await handle.close();
  const observations = [];
  const spy = vi.spyOn(prototype, "sync").mockImplementation(async function () {
    const stat = await this.stat();
    let stagedPhase = null;
    try {
      stagedPhase = JSON.parse(
        await fs.readFile(join(f.directory, "attempt.json.tmp"), "utf8"),
      ).phase;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    observations.push({ inode: stat.ino, stagedPhase, marker: await upgradeStatus(f.directory) });
    return sync.call(this);
  });
  onTestFinished(() => spy.mockRestore());
  f.host.cleanup = async () => observations.push({ cleanup: true });

  await applyUpgrade({ ...f.input, mode: "manual" });

  const inode = (await fs.stat(join(f.directory, "attempt.json"))).ino;
  const fileFlush = observations.findIndex(
    (o) => o.inode === inode && o.stagedPhase === "committed",
  );
  const parentFlush = observations.findIndex((o) => o.marker?.phase === "committed");
  expect(fileFlush).toBeGreaterThanOrEqual(0);
  expect(parentFlush).toBeGreaterThan(fileFlush);
  expect(observations.findIndex((o) => o.cleanup)).toBeGreaterThan(parentFlush);
});

it.each(["file", "folder"])(
  "holds on a refused completion %s flush and never restores a recorded commit",
  async (where) => {
    const f = await fixture();
    const handle = await fs.open(f.config, "r");
    const prototype = Object.getPrototypeOf(handle);
    const sync = prototype.sync;
    await handle.close();
    const spy = vi.spyOn(prototype, "sync").mockImplementation(async function () {
      let temporary;
      try {
        temporary = JSON.parse(await fs.readFile(join(f.directory, "attempt.json.tmp"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const marker = await upgradeStatus(f.directory);
      if (
        (where === "file" && (await this.stat()).isFile() && temporary?.phase === "committed") ||
        (where === "folder" && marker?.phase === "committed")
      )
        throw new Error("completion flush refused");
      return sync.call(this);
    });
    onTestFinished(() => spy.mockRestore());

    await expect(applyUpgrade({ ...f.input, mode: "automatic" })).rejects.toThrow(
      "completion flush refused",
    );
    expect(f.events.filter((event) => event.resume)).toEqual([]);
    expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("candidate venue");
    expect(await fs.readFile(join(f.directory, "copies", "0", "venue.db"), "utf8")).toBe(
      "old venue",
    );
    spy.mockRestore();
    await recoverUpgrade(f.input);
    expect(f.events.find((event) => event.resume)).toMatchObject({
      resume: { app: where === "file" ? "sha256:old" : "sha256:new" },
      venue: where === "file" ? "old venue" : "candidate venue",
    });
  },
);

it("leaves no attempt behind when image preparation fails before writers stop", async () => {
  const f = await fixture();
  const prepare = f.host.prepareImages;
  f.host.prepareImages = async () => {
    throw new Error("pull failed");
  };

  await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toThrow("pull failed");
  expect(await upgradeStatus(f.directory)).toBeNull();
  expect(f.events).toEqual([]);
  f.host.prepareImages = prepare;
  expect(await applyUpgrade({ ...f.input, mode: "manual" })).toMatchObject({ phase: "committed" });
});

it("refuses another attempt and invalid choices without losing the held copy", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });

  await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toMatchObject({
    code: "EEXIST",
  });
  await expect(recoverUpgrade({ ...f.input, choice: "anything" })).rejects.toThrow(
    "invalid upgrade choice",
  );
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  expect(await fs.readFile(join(f.directory, "copies", "0", "venue.db"), "utf8")).toBe("old venue");
});

it("rejects an invalid mode before allocating an attempt", async () => {
  const f = await fixture();
  await expect(applyUpgrade({ ...f.input, mode: "unknown" })).rejects.toThrow(
    "invalid upgrade mode",
  );
  expect(await recoverUpgrade(f.input)).toBeNull();
  expect(f.events).toEqual([]);
});

it.each([[], ["relative-state"]])(
  "refuses invalid paths %j before stopping or installing",
  async (paths) => {
    const f = await fixture();
    await expect(applyUpgrade({ ...f.input, paths, mode: "manual" })).rejects.toThrow(
      "invalid upgrade marker",
    );
    expect(f.events).toEqual([]);
    expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("old venue");
    expect(await upgradeStatus(f.directory)).toBeNull();
    await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([{}, "sha256:old", ["sha256:old"]])(
  "refuses malformed image maps %j before stopping",
  async (old) => {
    const f = await fixture();
    f.host.prepareImages = async () => ({ old, candidate: { app: "sha256:new" } });
    await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toThrow(
      "invalid upgrade marker",
    );
    expect(f.events).toEqual([]);
    expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("old venue");
    expect(await upgradeStatus(f.directory)).toBeNull();
    await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("retains image pins through a failed reopen and cleans them only after a successful one", async () => {
  const f = await fixture();
  const resume = f.host.resume;
  f.host.resume = async () => {
    throw new Error("start failed");
  };
  await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toThrow("start failed");
  expect(f.events.filter((e) => Array.isArray(e) && e[0] === "cleanup")).toEqual([]);
  f.host.resume = resume;
  await recoverUpgrade(f.input);
  expect(f.events.findIndex((e) => e.resume)).toBeLessThan(
    f.events.findIndex((e) => Array.isArray(e) && e[0] === "cleanup"),
  );
});

it.each([null, "listener refused"])(
  "restores automatically and retains a non-Error failure %j",
  async (failure) => {
    const f = await fixture();
    f.host.checkCandidate = async () => {
      throw failure;
    };
    expect(await applyUpgrade({ ...f.input, mode: "automatic" })).toMatchObject({
      phase: "committed",
      target: "old",
      failure: String(failure),
    });
    expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("old venue");
  },
);

it("keeps incomplete-check evidence when Keep follows an interrupted candidate", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  const marker = await upgradeStatus(f.directory);
  await fs.writeFile(
    join(f.directory, "attempt.json"),
    JSON.stringify({
      ...marker,
      phase: "candidate",
      checks: null,
      failure: null,
    }),
  );
  expect(await recoverUpgrade({ ...f.input, choice: "keep" })).toMatchObject({
    phase: "committed",
    target: "candidate",
    checks: null,
    failure: "checks interrupted",
  });
});

it("removes only an empty unpublished attempt directory during recovery", async () => {
  const f = await fixture();
  await fs.mkdir(f.directory);
  expect(await recoverUpgrade(f.input)).toBeNull();
  await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await fs.mkdir(f.directory);
  await fs.writeFile(join(f.directory, "unknown"), "do not discard");
  await expect(recoverUpgrade(f.input)).rejects.toMatchObject({ code: "ENOTEMPTY" });
  expect(await fs.readFile(join(f.directory, "unknown"), "utf8")).toBe("do not discard");
});

it("restores data without unlinking or replacing the host's retained lock files", async () => {
  const f = await fixture();
  const venue = join(f.state, VENUE_DIR_NAME);
  await fs.mkdir(venue, { mode: 0o750 });
  await fs.chmod(f.state, 0o700);
  await fs.writeFile(join(venue, "venue.db"), "old nested venue");
  const paths = [join(venue, VENUE_LOCK_FILE), join(f.state, RECOVERY_LOCK_FILE)];
  for (const path of paths) await fs.writeFile(path, "original lock bytes");
  const inodes = await Promise.all(paths.map(async (path) => (await fs.stat(path)).ino));
  f.host.installCandidate = async () =>
    fs.writeFile(join(venue, "venue.db"), "candidate nested venue");
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  for (const path of paths) await fs.writeFile(path, "retained lock bytes");
  await fs.chmod(f.state, 0o755);
  await fs.chmod(venue, 0o777);
  await recoverUpgrade({ ...f.input, choice: "restore" });
  for (const [index, path] of paths.entries()) {
    expect((await fs.stat(path)).ino).toBe(inodes[index]);
    expect(await fs.readFile(path, "utf8")).toBe("retained lock bytes");
  }
  expect(await fs.readFile(join(venue, "venue.db"), "utf8")).toBe("old nested venue");
  expect((await fs.stat(f.state)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(venue)).mode & 0o777).toBe(0o750);
});

it("keeps a new venue lock but removes candidate data when the old copy had no venue folder", async () => {
  const f = await fixture();
  const venue = join(f.state, VENUE_DIR_NAME);
  f.host.installCandidate = async () => {
    await fs.mkdir(venue);
    await fs.writeFile(join(venue, VENUE_LOCK_FILE), "new lock bytes");
    await fs.writeFile(join(venue, "venue.db"), "candidate only");
  };
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  const inode = (await fs.stat(join(venue, VENUE_LOCK_FILE))).ino;
  await recoverUpgrade({ ...f.input, choice: "restore" });
  expect((await fs.stat(join(venue, VENUE_LOCK_FILE))).ino).toBe(inode);
  expect(await fs.readFile(join(venue, VENUE_LOCK_FILE), "utf8")).toBe("new lock bytes");
  await expect(fs.stat(join(venue, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("leaves a truncated attempt and candidate bytes held for inspection", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  await fs.writeFile(join(f.directory, "attempt.json"), "{");
  await expect(recoverUpgrade({ ...f.input, choice: "restore" })).rejects.toBeInstanceOf(
    SyntaxError,
  );
  expect(f.events.filter((event) => event.resume)).toEqual([]);
  expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("candidate venue");
});

it("retains copies and image pins when boot recovery defers reopening until Docker starts", async () => {
  const f = await fixture();
  f.host.checkCandidate = async () => [{ name: "sale", ok: false }];
  await applyUpgrade({ ...f.input, mode: "manual" });
  f.host.resume = async () => false;
  await recoverUpgrade({ ...f.input, choice: "restore" });
  expect(await fs.readFile(join(f.directory, "copies", "0", "venue.db"), "utf8")).toBe("old venue");
  expect(f.events.some((event) => Array.isArray(event) && event[0] === "cleanup")).toBe(false);
  expect(await upgradeStatus(f.directory)).toMatchObject({ phase: "committed", target: "old" });
  f.host.resume = async () => true;
  await recoverUpgrade(f.input);
  expect(await fs.readdir(f.directory)).toEqual(["attempt.json"]);
  expect(f.events.at(-1)[0]).toBe("cleanup");
});

it.each(["prepare", "marker"])(
  "repairs policies without stopping writers after a pre-marker %s failure",
  async (where) => {
    const f = await fixture();
    const prepare = f.host.prepareImages;
    f.host.prepareImages = async () => {
      const images = await prepare();
      if (where === "prepare") throw new Error("partial policy update");
      await fs.symlink(join(f.root, "missing", "marker"), join(f.directory, "attempt.json.tmp"));
      return images;
    };
    f.host.abortPreparation = async () => {
      f.events.push("restore policies");
    };
    await expect(applyUpgrade({ ...f.input, mode: "manual" })).rejects.toMatchObject(
      where === "prepare" ? { message: "partial policy update" } : { code: "ENOENT" },
    );
    expect(f.events).toEqual(["pin images", "restore policies"]);
    expect(await fs.readFile(join(f.state, "venue.db"), "utf8")).toBe("old venue");
    await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
