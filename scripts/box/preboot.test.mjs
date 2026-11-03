import { describe, expect, it, vi } from "vitest";
import { WAITRON_LAYOUTS } from "./disk-state.mjs";
import { UNLOCK_DELAYS_MS, createUnlockGate, freezeUnlockTarget } from "./preboot.mjs";

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

const goodKey = () => new Uint8Array(32).fill(7);
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
    expect(openKey).toBe(key);
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
