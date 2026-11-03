import { afterEach, describe, expect, it, vi } from "vitest";
import { WAITRON_LAYOUTS } from "./disk-state.mjs";
import {
  UNLOCK_DELAYS_MS,
  createUnlockGate,
  freezeUnlockTarget,
  prebootUnlockGate,
} from "./preboot.mjs";

const EFI_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const XBOOTLDR_TYPE = "bc13c2ff-59e6-4262-a352-b275fd6f7172";
const BASIC_DATA_TYPE = "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7";
const FOREIGN_LUKS_TYPE = "0fc63daf-8483-4772-8e79-3d69d8477de4";
const LUKS_UUID = "2f0e8c1a-5b7d-4e3f-9a6c-1d2b3c4d5e6f";
const OTHER_UUID = "7a1b2c3d-4e5f-4061-8172-93a4b5c6d7e8";
const LAYOUT = WAITRON_LAYOUTS[0];
const INTERNAL_ID = "nvme-Samsung_SSD_980_500GB_S64DNF0R123456A";
const SECOND_ID = "ata-WDC_WD10EZEX-08WN4A0_WD-WCC6Y1234567";
const EXTERNAL_ID = "usb-Samsung_PSSD_T7_S5TANS0R654321-0:0";
const STICK_ID = "usb-SanDisk_Ultra_4C531001234567-0:0";

const valid = (uuid = LUKS_UUID, subsystem = LAYOUT.subsystem) => ({
  state: "valid",
  subsystem,
  uuid,
});
const damaged = () => ({ state: "damaged", subsystem: null, uuid: null });
const absent = () => ({ state: "absent", subsystem: null, uuid: null });
const plain = (content) => ({ content, luks: null });
const luks = (primary = valid(), secondary = valid()) => ({
  content: "luks2",
  luks: [primary, secondary],
});
const partition = (signature, typeGuid, name = "") => ({ ...signature, typeGuid, name });
const efi = () => partition(plain("vfat"), EFI_TYPE, "EFI System Partition");
const boot = () => partition(plain("other"), XBOOTLDR_TYPE, "boot");
const waitronPartition = (signature) => partition(signature, LAYOUT.typeGuid, LAYOUT.partitionName);

const waitronDisk = ({
  diskId = INTERNAL_ID,
  uuid = LUKS_UUID,
  attachment = "internal",
  signature = luks(valid(uuid), valid(uuid)),
  extra = [],
} = {}) => ({
  diskId,
  attachment,
  table: "gpt",
  partitions: [efi(), boot(), waitronPartition(signature), ...extra],
  whole: plain("none"),
  nameTag: null,
});
const windowsDisk = () => ({
  diskId: INTERNAL_ID,
  attachment: "internal",
  table: "gpt",
  partitions: [efi(), partition(plain("ntfs"), BASIC_DATA_TYPE, "Basic data partition")],
  whole: plain("none"),
  nameTag: null,
});
const machine = (disks, { tpm = "enabled", secureBoot = "user-mode" } = {}) => ({
  tpm,
  secureBoot,
  disks,
});
const observation = (overrides = {}) => ({
  expectedDiskUuid: LUKS_UUID,
  firstStart: "complete",
  machine: machine([waitronDisk()]),
  ...overrides,
});

const ready = {
  kind: "ready",
  handle: { diskId: INTERNAL_ID, diskUuid: LUKS_UUID, layoutVersion: 1 },
};
const refused = (reason) => ({ kind: "refused", reason });

describe("freezeUnlockTarget", () => {
  it("answers ready with a frozen handle for one internal Waitron disk with the expected UUID", () => {
    const result = freezeUnlockTarget(observation());
    expect(result).toEqual(ready);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.handle)).toBe(true);
  });

  it("answers ready when the primary header is damaged and the secondary valid", () => {
    const disk = waitronDisk({ signature: luks(damaged(), valid()) });
    expect(freezeUnlockTarget(observation({ machine: machine([disk]) }))).toEqual(ready);
  });

  it("answers ready when the primary header is valid and the secondary absent", () => {
    const disk = waitronDisk({ signature: luks(valid(), absent()) });
    expect(freezeUnlockTarget(observation({ machine: machine([disk]) }))).toEqual(ready);
  });

  it("answers ready with the TPM disabled and Secure Boot off", () => {
    const m = machine([waitronDisk()], { tpm: "disabled", secureBoot: "off" });
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(ready);
  });

  it("keeps the handle unchanged when the observation changes after freezing", () => {
    const input = observation();
    const result = freezeUnlockTarget(input);
    input.machine.disks[0].diskId = SECOND_ID;
    input.machine.disks[0].partitions[2].luks[0].uuid = OTHER_UUID;
    input.expectedDiskUuid = OTHER_UUID;
    expect(result).toEqual(ready);
  });
});

describe("freezeUnlockTarget refusals", () => {
  it("answers disk-mismatch when the Waitron disk's UUID differs from the expected one", () => {
    const m = machine([waitronDisk({ uuid: OTHER_UUID })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-mismatch"));
  });

  it("answers disk-duplicate when an external disk carries the expected UUID too", () => {
    const m = machine([
      waitronDisk(),
      waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
    ]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-duplicate when the installer stick carries the expected UUID", () => {
    const stick = {
      diskId: STICK_ID,
      attachment: "installer",
      table: "none",
      partitions: [],
      whole: luks(damaged(), valid()),
      nameTag: null,
    };
    const m = machine([waitronDisk(), stick]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-duplicate when a foreign LUKS2 partition on the same disk carries the expected UUID", () => {
    const foreign = partition(
      luks(valid(LUKS_UUID, "other"), valid(LUKS_UUID, "other")),
      FOREIGN_LUKS_TYPE,
      "data",
    );
    const m = machine([waitronDisk({ extra: [foreign] })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-not-waitron when only an external disk carries the UUID and the internal one is Windows", () => {
    const m = machine([
      windowsDisk(),
      waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
    ]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-not-waitron"));
  });

  it("answers disk-not-waitron when both headers are damaged", () => {
    const m = machine([waitronDisk({ signature: luks(damaged(), damaged()) })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-not-waitron"));
  });

  it("answers disk-multiple for two internal Waitron disks", () => {
    const m = machine([waitronDisk(), waitronDisk({ diskId: SECOND_ID, uuid: OTHER_UUID })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-multiple"));
  });

  it("answers disk-missing with no internal disk", () => {
    const m = machine([waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-missing"));
  });

  it.each(["pending", "unknown"])(
    "answers first-start-pending when firstStart is %s",
    (firstStart) => {
      expect(freezeUnlockTarget(observation({ firstStart }))).toEqual(
        refused("first-start-pending"),
      );
    },
  );
});

describe("freezeUnlockTarget bad shapes", () => {
  const withoutFirstStart = observation();
  delete withoutFirstStart.firstStart;
  const throwing = observation();
  Object.defineProperty(throwing, "firstStart", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const badDisk = { ...waitronDisk(), diskId: "../sda" };
  it.each([
    ["null", null],
    ["an extra key", { ...observation(), extra: 1 }],
    ["a missing firstStart", withoutFirstStart],
    ["firstStart done", observation({ firstStart: "done" })],
    ["an upper-case expectedDiskUuid", observation({ expectedDiskUuid: LUKS_UUID.toUpperCase() })],
    ["a numeric expectedDiskUuid", observation({ expectedDiskUuid: 42 })],
    ["a String-object expectedDiskUuid", observation({ expectedDiskUuid: new String(LUKS_UUID) })],
    ["a machine classifyDisk refuses", observation({ machine: machine([badDisk]) })],
    ["a function", observation({ machine: () => {} })],
    ["a getter that throws", throwing],
  ])("answers observation-invalid for %s", (_name, input) => {
    expect(freezeUnlockTarget(input)).toEqual(refused("observation-invalid"));
  });

  it("follows one read of a getter that changes its answer", () => {
    let reads = 0;
    const input = observation();
    Object.defineProperty(input, "firstStart", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "complete" : "pending";
      },
    });
    expect(freezeUnlockTarget(input)).toEqual(ready);
    expect(reads).toBe(1);
  });
});

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  /** @type {(error: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const KEY_BYTES = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const goodKey = () => Uint8Array.from(KEY_BYTES);
const isZeros = (bytes) => bytes.every((byte) => byte === 0);
const answer = (kind, retryAt = null, reason = null) => ({ kind, retryAt, reason });
const status = (state, retryAt = null, reason = null) => ({ state, retryAt, reason });

function harness({ obs = observation(), verify = async () => false, open = async () => {} } = {}) {
  const h = { clock: 0 };
  h.now = () => h.clock;
  h.verify = vi.fn(verify);
  h.open = vi.fn(open);
  h.gate = createUnlockGate({ observation: obs, now: h.now, verify: h.verify, open: h.open });
  /** @param {unknown} key */
  h.at = (clock, key = goodKey()) => {
    h.clock = clock;
    return h.gate.submit(key);
  };
  return h;
}

describe("createUnlockGate wait", () => {
  it("holds the proposed delays in one frozen constant", () => {
    expect(UNLOCK_DELAYS_MS).toEqual([2000, 4000, 8000, 16000, 32000, 60000]);
    expect(Object.isFrozen(UNLOCK_DELAYS_MS)).toBe(true);
  });

  it("answers failed keys at 0, 2000 and 6000 with retryAt 2000, 6000 and 14000", async () => {
    const h = harness();
    const first = await h.at(0);
    expect(first).toEqual(answer("wrong-key", 2000));
    expect(Object.isFrozen(first)).toBe(true);
    expect(await h.at(2000)).toEqual(answer("wrong-key", 6000));
    expect(await h.at(6000)).toEqual(answer("wrong-key", 14000));
    expect(h.verify).toHaveBeenCalledTimes(3);
  });

  it("caps the wait at 60 seconds when failing at each deadline from 14000 on", async () => {
    const h = harness();
    for (const clock of [0, 2000, 6000]) await h.at(clock);
    const retries = [];
    let clock = 14000;
    for (let i = 0; i < 4; i += 1) {
      const result = await h.at(clock);
      retries.push(result.retryAt);
      clock = result.retryAt;
    }
    expect(retries).toEqual([30000, 62000, 122000, 182000]);
  });

  it("answers wait at 1999 without checking, then counts the next failure as the second", async () => {
    const h = harness();
    await h.at(0);
    const waiting = await h.at(1999);
    expect(waiting).toEqual(answer("wait", 2000));
    expect(Object.isFrozen(waiting)).toBe(true);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(await h.at(2000)).toEqual(answer("wrong-key", 6000));
  });

  it("checks a submission exactly at retryAt", async () => {
    const h = harness();
    await h.at(0);
    await h.at(2000);
    expect(h.verify).toHaveBeenCalledTimes(2);
  });

  it("shares the wait between two routes holding the same gate", async () => {
    const h = harness();
    const routeA = h.gate.submit.bind(h.gate);
    const routeB = h.gate.submit.bind(h.gate);
    h.clock = 0;
    expect(await routeA(goodKey())).toEqual(answer("wrong-key", 2000));
    h.clock = 1000;
    expect(await routeB(goodKey())).toEqual(answer("wait", 2000));
    expect(h.verify).toHaveBeenCalledTimes(1);
  });

  it("starts a new gate's wait afresh after six failures on the old one", async () => {
    const h = harness();
    let clock = 0;
    for (let i = 0; i < 6; i += 1) clock = (await h.at(clock)).retryAt;
    const restarted = createUnlockGate({
      observation: observation(),
      now: h.now,
      verify: h.verify,
      open: h.open,
    });
    h.clock = clock;
    expect(await restarted.submit(goodKey())).toEqual(answer("wrong-key", clock + 2000));
  });

  it("starts the wait from when a slow checker answers", async () => {
    const check = deferred();
    const h = harness({ verify: () => check.promise });
    const pending = h.at(0);
    h.clock = 1500;
    check.resolve(false);
    expect(await pending).toEqual(answer("wrong-key", 3500));
  });
});

describe("createUnlockGate one check at a time", () => {
  it("calls the checker once for two submissions while it is pending", async () => {
    const check = deferred();
    const h = harness({ verify: () => check.promise });
    const first = h.at(0);
    const second = h.at(0);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(await second).toEqual(answer("wait"));
    check.resolve(true);
    expect(await first).toEqual(answer("opened"));
  });

  it("answers wait while open is pending", async () => {
    const opening = deferred();
    const opened = deferred();
    const h = harness({
      verify: async () => true,
      open: () => {
        opening.resolve();
        return opened.promise;
      },
    });
    const first = h.at(0);
    await opening.promise;
    const second = h.at(0);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(await second).toEqual(answer("wait"));
    opened.resolve();
    expect(await first).toEqual(answer("opened"));
  });

  it("answers wait for a malformed submission while the checker is pending", async () => {
    const check = deferred();
    const h = harness({ verify: () => check.promise });
    const first = h.at(0);
    expect(await h.at(0, "not a key")).toEqual(answer("wait"));
    expect(h.verify).toHaveBeenCalledTimes(1);
    check.resolve(false);
    expect(await first).toEqual(answer("wrong-key", 2000));
  });

  it.each([
    ["a string", "k".repeat(32)],
    ["31 bytes", new Uint8Array(31)],
    ["33 bytes", new Uint8Array(33)],
    ["an Array of 32 numbers", Array.from({ length: 32 }, () => 7)],
    ["null", null],
  ])("answers wrong-key without checking for %s", async (_name, key) => {
    const h = harness();
    expect(await h.at(0, key)).toEqual(answer("wrong-key", 2000));
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("answers wait for a malformed submission during a wait without counting it", async () => {
    const h = harness();
    await h.at(0);
    expect(await h.at(1000, "not a key")).toEqual(answer("wait", 2000));
    expect(await h.at(2000)).toEqual(answer("wrong-key", 6000));
  });
});

describe("createUnlockGate outcomes", () => {
  it("opens with the same handle and bytes the checker accepted", async () => {
    const h = harness({ verify: async () => true });
    const key = goodKey();
    const result = await h.at(0, key);
    expect(result).toEqual(answer("opened"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(h.open).toHaveBeenCalledTimes(1);
    const [verifyHandle, verifyKey] = h.verify.mock.calls[0];
    const [openHandle, openKey] = h.open.mock.calls[0];
    expect(openHandle).toBe(verifyHandle);
    expect(openKey).toBe(verifyKey);
    expect(openKey).not.toBe(key);
    expect(h.gate.status()).toEqual(status("opened"));
  });

  it("refuses the right key again after opening", async () => {
    const h = harness({ verify: async () => true });
    await h.at(0);
    expect(await h.at(0)).toEqual(answer("refused-state", null, "opened"));
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["1", 1],
    ['"true"', "true"],
    ["undefined", undefined],
  ])("refuses with verifier-failed when the checker answers %s", async (_name, value) => {
    const h = harness({ verify: async () => value });
    expect(await h.at(0)).toEqual(answer("refused-state", null, "verifier-failed"));
    expect(await h.at(5000)).toEqual(answer("refused-state", null, "verifier-failed"));
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.gate.status()).toEqual(status("refused", null, "verifier-failed"));
  });

  it.each([
    [
      "rejects",
      async () => {
        throw new Error("boom");
      },
    ],
    [
      "throws",
      () => {
        throw new Error("boom");
      },
    ],
  ])("refuses with verifier-failed when the checker %s", async (_name, verify) => {
    const h = harness({ verify });
    expect(await h.at(0)).toEqual(answer("refused-state", null, "verifier-failed"));
    expect(h.open).not.toHaveBeenCalled();
    expect(await h.at(5000)).toEqual(answer("refused-state", null, "verifier-failed"));
    expect(h.gate.status()).toEqual(status("refused", null, "verifier-failed"));
  });

  it("refuses with open-failed when the opener throws, and never opens again", async () => {
    const h = harness({
      verify: async () => true,
      open: async () => {
        throw new Error("boom");
      },
    });
    expect(await h.at(0)).toEqual(answer("refused-state", null, "open-failed"));
    expect(await h.at(0)).toEqual(answer("refused-state", null, "open-failed"));
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.gate.status()).toEqual(status("refused", null, "open-failed"));
  });

  it.each([
    ["observation-invalid", null],
    [
      "disk-missing",
      observation({
        machine: machine([waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" })]),
      }),
    ],
    [
      "disk-multiple",
      observation({
        machine: machine([waitronDisk(), waitronDisk({ diskId: SECOND_ID, uuid: OTHER_UUID })]),
      }),
    ],
    [
      "disk-not-waitron",
      observation({ machine: machine([waitronDisk({ signature: luks(damaged(), damaged()) })]) }),
    ],
    ["disk-mismatch", observation({ machine: machine([waitronDisk({ uuid: OTHER_UUID })]) })],
    [
      "disk-duplicate",
      observation({
        machine: machine([
          waitronDisk(),
          waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
        ]),
      }),
    ],
    ["first-start-pending", observation({ firstStart: "pending" })],
  ])("refuses every submission with %s when the target is refused", async (reason, obs) => {
    expect(freezeUnlockTarget(obs)).toEqual(refused(reason));
    const h = harness({ obs, verify: async () => true });
    expect(h.gate.status()).toEqual(status("refused", null, reason));
    expect(await h.at(0)).toEqual(answer("refused-state", null, reason));
    expect(await h.at(0, "not a key")).toEqual(answer("refused-state", null, reason));
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  });

  it("hands the checker and the opener Task 1's frozen handle, the same object every call", async () => {
    const answers = [false, true];
    const h = harness({ verify: async () => answers.shift() });
    await h.at(0);
    await h.at(2000);
    const handles = [...h.verify.mock.calls, ...h.open.mock.calls].map(([handle]) => handle);
    expect(handles).toHaveLength(3);
    expect(handles[0]).toEqual(ready.handle);
    expect(Object.isFrozen(handles[0])).toBe(true);
    expect(handles[1]).toBe(handles[0]);
    expect(handles[2]).toBe(handles[0]);
  });
});

describe("createUnlockGate status", () => {
  it("moves from ready to verifying to waiting and back to ready", async () => {
    const checks = [deferred(), deferred()];
    const openCalled = deferred();
    const opening = deferred();
    const h = harness({
      verify: () => checks.shift().promise,
      open: () => {
        openCalled.resolve();
        return opening.promise;
      },
    });
    const first = h.gate.status();
    expect(first).toEqual(status("ready"));
    expect(Object.isFrozen(first)).toBe(true);

    const check1 = checks[0];
    const failing = h.at(0);
    expect(h.gate.status()).toEqual(status("verifying"));
    check1.resolve(false);
    await failing;
    expect(h.gate.status()).toEqual(status("waiting", 2000));
    h.clock = 1999;
    expect(h.gate.status()).toEqual(status("waiting", 2000));
    h.clock = 2000;
    expect(h.gate.status()).toEqual(status("ready"));

    const check2 = checks[0];
    const opened = h.at(2000);
    expect(h.gate.status()).toEqual(status("verifying"));
    check2.resolve(true);
    await openCalled.promise;
    expect(h.gate.status()).toEqual(status("verifying"));
    opening.resolve();
    await opened;
    expect(h.gate.status()).toEqual(status("opened"));
  });
});

describe("createUnlockGate options", () => {
  const base = () => ({
    observation: observation(),
    now: () => 0,
    verify: async () => false,
    open: async () => {},
  });
  const withoutNow = base();
  delete withoutNow.now;
  it.each([
    ["null", null],
    ["a missing now", withoutNow],
    ["verify not a function", { ...base(), verify: true }],
    ["open not a function", { ...base(), open: "open" }],
    ["now not a function", { ...base(), now: 0 }],
    ["an extra key", { ...base(), extra: 1 }],
  ])("throws unlock.options_invalid for %s", (_name, options) => {
    expect(() => createUnlockGate(options)).toThrow(
      expect.objectContaining({ code: "unlock.options_invalid", reason: "options-invalid" }),
    );
  });
});

describe("createUnlockGate options are read once", () => {
  it("reads each option once", () => {
    const reads = { observation: 0, now: 0, verify: 0, open: 0 };
    const values = {
      observation: observation(),
      now: () => 0,
      verify: async () => false,
      open: async () => {},
    };
    const options = {};
    for (const name of Object.keys(values))
      Object.defineProperty(options, name, {
        enumerable: true,
        get() {
          reads[name] += 1;
          return values[name];
        },
      });
    createUnlockGate(options);
    expect(reads).toEqual({ observation: 1, now: 1, verify: 1, open: 1 });
  });
});

describe("createUnlockGate key shape", () => {
  class LyingLength extends Uint8Array {
    get length() {
      return 32;
    }
  }
  const forged = () => {
    const fake = Object.setPrototypeOf({ length: 32 }, Uint8Array.prototype);
    return fake;
  };
  it.each([
    ["an object with Uint8Array's prototype", forged],
    ["a subclass claiming 32 bytes over 31", () => LyingLength.from(KEY_BYTES.slice(0, 31))],
    ["a subclass claiming 32 bytes over 64", () => LyingLength.from([...KEY_BYTES, ...KEY_BYTES])],
    ["a proxy over a 32-byte array", () => new Proxy(goodKey(), {})],
  ])("answers wrong-key without checking for %s", async (_name, make) => {
    const h = harness({ verify: async () => true });
    expect(await h.at(0, make())).toEqual(answer("wrong-key", 2000));
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("clears a subclass whose length lies, through the built-in fill", async () => {
    class NoFill extends LyingLength {
      fill() {
        return this;
      }
    }
    const key = NoFill.from(KEY_BYTES.slice(0, 31));
    const h = harness();
    const pending = h.at(0, key);
    expect(isZeros(Uint8Array.from(new Uint8Array(key.buffer)))).toBe(true);
    await pending;
  });

  it("copies the real bytes of a genuine subclass whose iterator lies", async () => {
    class LyingIterator extends Uint8Array {
      *[Symbol.iterator]() {
        for (let i = 0; i < 32; i += 1) yield 0;
      }
    }
    let received = [];
    const h = harness({
      verify: async (_handle, key) => {
        received = [...new Uint8Array(key.buffer, key.byteOffset, 32)];
        return false;
      },
    });
    await h.at(0, LyingIterator.from(goodKey().values()));
    expect(received).toEqual(KEY_BYTES);
  });
});

describe("createUnlockGate clock", () => {
  function clockHarness() {
    const c = { mode: "ok", clock: 0 };
    c.verify = vi.fn(async () => false);
    c.gate = createUnlockGate({
      observation: observation(),
      now: () => {
        if (c.mode === "throw") throw new Error("clock broke");
        if (c.mode === "ok") return c.clock;
        return c.mode;
      },
      verify: c.verify,
      open: async () => {},
    });
    return c;
  }

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a throw", "throw"],
  ])("refuses with clock-failed when the clock answers %s after a wrong key", async (_n, mode) => {
    const c = clockHarness();
    c.mode = mode;
    expect(await c.gate.submit(goodKey())).toEqual(answer("refused-state", null, "clock-failed"));
    expect(await c.gate.submit(goodKey())).toEqual(answer("refused-state", null, "clock-failed"));
    expect(c.verify).toHaveBeenCalledTimes(1);
    expect(c.gate.status()).toEqual(status("refused", null, "clock-failed"));
  });

  it.each([
    ["NaN", Number.NaN],
    ["a throw", "throw"],
  ])("refuses with clock-failed when the clock answers %s during a wait", async (_n, mode) => {
    const c = clockHarness();
    await c.gate.submit(goodKey());
    c.mode = mode;
    const key = goodKey();
    expect(await c.gate.submit(key)).toEqual(answer("refused-state", null, "clock-failed"));
    expect(isZeros(key)).toBe(true);
    expect(c.verify).toHaveBeenCalledTimes(1);
  });

  it("answers status refused clock-failed when the clock throws while waiting", async () => {
    const c = clockHarness();
    await c.gate.submit(goodKey());
    c.mode = "throw";
    expect(c.gate.status()).toEqual(status("refused", null, "clock-failed"));
    c.mode = "ok";
    expect(await c.gate.submit(goodKey())).toEqual(answer("refused-state", null, "clock-failed"));
  });

  it("refuses with clock-failed for a malformed key when the clock throws", async () => {
    const c = clockHarness();
    c.mode = "throw";
    const key = new Uint8Array(31).fill(9);
    expect(await c.gate.submit(key)).toEqual(answer("refused-state", null, "clock-failed"));
    expect(isZeros(key)).toBe(true);
    expect(c.verify).not.toHaveBeenCalled();
  });
});

const REFUSED_OBS = () => observation({ firstStart: "pending" });

/** Each sets a gate up and answers the submission under test; `after` lets a held check finish. */
const paths = {
  opened: () => {
    const h = harness({ verify: async () => true });
    return { submit: (key) => h.at(0, key) };
  },
  "wrong-key": () => {
    const h = harness();
    return { submit: (key) => h.at(0, key) };
  },
  "wait during a delay": async () => {
    const h = harness();
    await h.at(0);
    return { submit: (key) => h.at(1000, key) };
  },
  "wait while verify runs": () => {
    const check = deferred();
    const h = harness({ verify: () => check.promise });
    const first = h.at(0);
    return {
      submit: (key) => h.at(0, key),
      after: async () => {
        check.resolve(false);
        await first;
      },
    };
  },
  "wait while open runs": async () => {
    const opening = deferred();
    const opened = deferred();
    const h = harness({
      verify: async () => true,
      open: () => {
        opening.resolve();
        return opened.promise;
      },
    });
    const first = h.at(0);
    await opening.promise;
    return {
      submit: (key) => h.at(0, key),
      after: async () => {
        opened.resolve();
        await first;
      },
    };
  },
  "refused-state": () => {
    const h = harness({ obs: REFUSED_OBS() });
    return { submit: (key) => h.at(0, key) };
  },
  closed: () => {
    const h = harness();
    h.gate.close();
    return { submit: (key) => h.at(0, key) };
  },
  "a 31-byte array": () => {
    const h = harness();
    return { submit: (key) => h.at(0, key), key: () => Uint8Array.from(KEY_BYTES.slice(0, 31)) };
  },
};
paths.malformed = paths["a 31-byte array"];

describe("createUnlockGate key buffers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "opened",
    "wrong-key",
    "wait during a delay",
    "wait while verify runs",
    "wait while open runs",
    "refused-state",
    "closed",
    "a 31-byte array",
  ])(
    "%s: the caller's array is all zeros as soon as submit returns its promise, before it is awaited",
    async (name) => {
      const path = await paths[name]();
      const key = path.key ? path.key() : goodKey();
      const pending = path.submit(key);
      expect(isZeros(key)).toBe(true);
      await pending;
      await path.after?.();
    },
  );

  it.each([
    "wait during a delay",
    "wait while verify runs",
    "refused-state",
    "closed",
    "malformed",
  ])("%s: no copy is made", async (name) => {
    const path = await paths[name]();
    const key = path.key ? path.key() : goodKey();
    const from = vi.spyOn(Uint8Array, "from");
    await path.submit(key);
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    await path.after?.();
  });

  it("every array Uint8Array.from returned during a verify-path submission is zeros once submit settles", async () => {
    for (const name of ["opened", "wrong-key"]) {
      const path = await paths[name]();
      const key = goodKey();
      const from = vi.spyOn(Uint8Array, "from");
      await path.submit(key);
      const made = from.mock.results.map((r) => r.value);
      from.mockRestore();
      expect(made.length).toBeGreaterThan(0);
      for (const array of made) expect(isZeros(array)).toBe(true);
    }
  });

  it("the checker receives the original bytes in an array that is not the caller's, and the opener that same array", async () => {
    const seen = {};
    const h = harness({
      verify: async (_handle, key) => {
        seen.verifyKey = key;
        seen.verifyBytes = [...key];
        return true;
      },
      open: async (_handle, key) => {
        seen.openKey = key;
        seen.openBytes = [...key];
      },
    });
    const key = goodKey();
    expect(await h.at(0, key)).toEqual(answer("opened"));
    expect(seen.verifyKey).not.toBe(key);
    expect(seen.verifyKey).toBeInstanceOf(Uint8Array);
    expect(seen.verifyBytes).toEqual(KEY_BYTES);
    expect(seen.openKey).toBe(seen.verifyKey);
    expect(seen.openBytes).toEqual(KEY_BYTES);
  });

  const boom = () => {
    throw new Error("boom");
  };
  it.each([
    ["opened", async () => true, async () => {}],
    ["wrong-key", async () => false, async () => {}],
    ["checker throws", boom, async () => {}],
    ["opener throws", async () => true, boom],
  ])(
    "%s: the array the checker received is all zeros once submit settles",
    async (_name, verify, open) => {
      let held = null;
      const h = harness({
        verify: (handle, key) => {
          held = key;
          return verify();
        },
        open: () => open(),
      });
      await h.at(0);
      expect(held).not.toBeNull();
      expect(isZeros(held)).toBe(true);
    },
  );
});

describe("createUnlockGate close", () => {
  function heldHarness() {
    const c = { check: deferred(), opening: deferred(), opened: deferred(), held: null };
    c.h = harness({
      verify: (_handle, key) => {
        c.held = key;
        return c.check.promise;
      },
      open: () => {
        c.opening.resolve();
        return c.opened.promise;
      },
    });
    return c;
  }

  it("close while the checker is pending: keeps the bytes until it answers, never opens, answers closed", async () => {
    const c = heldHarness();
    c.opened.resolve();
    const pending = c.h.at(0);
    c.h.gate.close();
    expect([...c.held]).toEqual(KEY_BYTES);
    expect(c.h.gate.status()).toEqual(status("verifying"));
    c.check.resolve(true);
    expect(await pending).toEqual(answer("refused-state", null, "closed"));
    expect(c.h.open).not.toHaveBeenCalled();
    expect(isZeros(c.held)).toBe(true);
    expect(c.h.gate.status()).toEqual(status("closed"));
  });

  it("close while the checker is pending, and the checker then rejects: answers closed", async () => {
    const c = heldHarness();
    const pending = c.h.at(0);
    c.h.gate.close();
    c.check.reject(new Error("boom"));
    expect(await pending).toEqual(answer("refused-state", null, "closed"));
    expect(c.h.gate.status()).toEqual(status("closed"));
    expect(isZeros(c.held)).toBe(true);
  });

  it("close while the opener is pending: the open finishes and is reported", async () => {
    const c = heldHarness();
    const pending = c.h.at(0);
    c.check.resolve(true);
    await c.opening.promise;
    c.h.gate.close();
    expect([...c.held]).toEqual(KEY_BYTES);
    expect(c.h.gate.status()).toEqual(status("verifying"));
    c.opened.resolve();
    expect(await pending).toEqual(answer("opened"));
    expect(c.h.gate.status()).toEqual(status("opened"));
    expect(isZeros(c.held)).toBe(true);
  });

  it("close while the opener is pending, and the opener then throws: answers open-failed, status closed", async () => {
    const c = heldHarness();
    const pending = c.h.at(0);
    c.check.resolve(true);
    await c.opening.promise;
    c.h.gate.close();
    c.opened.reject(new Error("boom"));
    expect(await pending).toEqual(answer("refused-state", null, "open-failed"));
    expect(c.h.gate.status()).toEqual(status("closed"));
    expect(await c.h.at(0)).toEqual(answer("refused-state", null, "closed"));
  });

  it("close while the opener is pending, then a second submission: answers closed", async () => {
    const c = heldHarness();
    const pending = c.h.at(0);
    c.check.resolve(true);
    await c.opening.promise;
    c.h.gate.close();
    expect(await c.h.at(0)).toEqual(answer("refused-state", null, "closed"));
    expect(c.h.verify).toHaveBeenCalledTimes(1);
    expect(c.h.open).toHaveBeenCalledTimes(1);
    c.opened.resolve();
    await pending;
  });

  it("close on a gate whose target was refused keeps it refused with its reason", () => {
    const h = harness({ obs: REFUSED_OBS() });
    h.gate.close();
    expect(h.gate.status()).toEqual(status("refused", null, "first-start-pending"));
  });

  it("close on prebootUnlockGate() keeps it refused adapter-missing", () => {
    prebootUnlockGate().close();
    expect(prebootUnlockGate().status()).toEqual(status("refused", null, "adapter-missing"));
  });

  it("close, then submit: answers closed without checking", async () => {
    const h = harness();
    h.gate.close();
    expect(await h.at(0)).toEqual(answer("refused-state", null, "closed"));
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("close twice: status closed", () => {
    const h = harness();
    h.gate.close();
    h.gate.close();
    expect(h.gate.status()).toEqual(status("closed"));
  });

  it("close after opened: status still opened", async () => {
    const h = harness({ verify: async () => true });
    await h.at(0);
    h.gate.close();
    expect(h.gate.status()).toEqual(status("opened"));
    expect(await h.at(0)).toEqual(answer("refused-state", null, "opened"));
  });
});

describe("prebootUnlockGate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is one gate, refused adapter-missing, that clears the key and copies nothing", async () => {
    const gate = prebootUnlockGate();
    expect(prebootUnlockGate()).toBe(gate);
    expect(gate.status()).toEqual(status("refused", null, "adapter-missing"));
    const key = goodKey();
    const from = vi.spyOn(Uint8Array, "from");
    const pending = gate.submit(key);
    expect(isZeros(key)).toBe(true);
    expect(await pending).toEqual(answer("refused-state", null, "adapter-missing"));
    expect(from).not.toHaveBeenCalled();
  });
});
