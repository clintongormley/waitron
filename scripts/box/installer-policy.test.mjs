import { describe, expect, it } from "vitest";
import { MICROSOFT_RESERVED_TYPE, WAITRON_LAYOUTS } from "./disk-state.mjs";
import {
  INSTALLER_TIMINGS_MS,
  createInstallerState,
  nextInstallerStep,
} from "./installer-policy.mjs";

const EFI_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const XBOOTLDR_TYPE = "bc13c2ff-59e6-4262-a352-b275fd6f7172";
const BASIC_DATA_TYPE = "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7";
const WINDOWS_RECOVERY_TYPE = "de94bba4-06d1-4d40-a16a-bfd50179d6ac";
const FOREIGN_LUKS_TYPE = "0fc63daf-8483-4772-8e79-3d69d8477de4";
const LUKS_UUID = "2f0e8c1a-5b7d-4e3f-9a6c-1d2b3c4d5e6f";
const LAYOUT = WAITRON_LAYOUTS[0];
const INTERNAL_ID = "nvme-Samsung_SSD_980_500GB_S64DNF0R123456A";
const SECOND_ID = "ata-WDC_WD10EZEX-08WN4A0_WD-WCC6Y1234567";
const STICK_ID = "usb-SanDisk_Ultra_4C531001234567-0:0";

const valid = (subsystem = LAYOUT.subsystem, uuid = LUKS_UUID) => ({
  state: "valid",
  subsystem,
  uuid,
});
const damaged = () => ({ state: "damaged", subsystem: null, uuid: null });
const plain = (content) => ({ content, luks: null });
const luks = (primary = valid(), secondary = valid()) => ({
  content: "luks2",
  luks: [primary, secondary],
});
const partition = (signature, typeGuid, name = "") => ({ ...signature, typeGuid, name });

const efi = () => partition(plain("vfat"), EFI_TYPE, "EFI System Partition");
const boot = () => partition(plain("other"), XBOOTLDR_TYPE, "boot");
const waitronPartition = (signature = luks()) =>
  partition(signature, LAYOUT.typeGuid, LAYOUT.partitionName);

const disk = (overrides = {}) => ({
  diskId: INTERNAL_ID,
  attachment: "internal",
  table: "gpt",
  partitions: [],
  whole: plain("none"),
  nameTag: null,
  ...overrides,
});
const blankDisk = (overrides = {}) => disk({ table: "none", ...overrides });
const completeWaitronDisk = (overrides = {}) =>
  disk({ partitions: [efi(), boot(), waitronPartition()], ...overrides });
const waitronWith = (signature, overrides = {}) =>
  completeWaitronDisk({ partitions: [efi(), boot(), waitronPartition(signature)], ...overrides });
const windowsDisk = (overrides = {}) =>
  disk({
    partitions: [
      efi(),
      partition(plain("none"), MICROSOFT_RESERVED_TYPE, "Microsoft reserved partition"),
      partition(plain("ntfs"), BASIC_DATA_TYPE, "Basic data partition"),
      partition(plain("ntfs"), WINDOWS_RECOVERY_TYPE, ""),
    ],
    ...overrides,
  });
const bitlockerDisk = () =>
  disk({
    partitions: [
      efi(),
      partition(plain("none"), MICROSOFT_RESERVED_TYPE, "Microsoft reserved partition"),
      partition(plain("bitlocker"), BASIC_DATA_TYPE, "Basic data partition"),
    ],
  });
const foreignLuksDisk = (overrides = {}) =>
  disk({
    partitions: [efi(), partition(luks(valid(""), valid("")), FOREIGN_LUKS_TYPE, "root")],
    ...overrides,
  });
const machine = (disks, overrides = {}) => ({
  tpm: "enabled",
  secureBoot: "user-mode",
  disks,
  ...overrides,
});

const stick = () => disk({ diskId: STICK_ID, attachment: "installer", partitions: [efi()] });
const survey = (disks, overrides = {}) => machine([...disks, stick()], overrides);

const OPTIONS = Object.freeze({
  atMs: 0,
  clockFloorMs: 1_700_000_000_000,
  eraseWord: "ERASE-CONFIRM",
});
const AT = 1_000;

const observed = (observation, venueTag = null, atMs = AT) => ({
  kind: "observed",
  atMs,
  observation,
  venueTag,
});

/** @param {object[]} events @param {object} [options] */
function play(events, options = OPTIONS) {
  let state = createInstallerState(options);
  return events.map((event) => {
    const decision = nextInstallerStep(state, event);
    state = decision.state;
    return decision;
  });
}

const STARTING = { key: "installer.starting", params: {} };
const initialState = (overrides = {}) => ({
  phase: "observing",
  atMs: 0,
  clockFloorMs: OPTIONS.clockFloorMs,
  eraseWord: OPTIONS.eraseWord,
  ramReady: false,
  usbPresent: true,
  target: null,
  confirmed: null,
  clockSet: false,
  deadlineMs: null,
  refusal: null,
  message: STARTING,
  ...overrides,
});
const target = (overrides = {}) => ({
  diskId: INTERNAL_ID,
  kind: "recognised-other",
  recognised: null,
  layoutVersion: null,
  hardware: null,
  attachmentUnclear: false,
  venueTag: null,
  ...overrides,
});

const refused = (reason, hardware, stateOverrides = {}) => {
  const message = {
    key: "installer.refused",
    params: { reason, hardware, releaseVersion: null },
  };
  return {
    action: "refuse",
    diskId: null,
    message,
    deadlineMs: null,
    state: initialState({
      phase: "refused",
      atMs: AT,
      refusal: { reason, hardware, releaseVersion: null },
      message,
      ...stateOverrides,
    }),
  };
};

const loading = (recognised) => {
  const message = { key: "installer.loading", params: {} };
  return {
    action: "wait",
    diskId: null,
    message,
    deadlineMs: null,
    state: initialState({
      phase: "loading",
      atMs: AT,
      confirmed: "unattended",
      target: target({ recognised }),
      message,
    }),
  };
};

const waitronFound = ({ hardware = null, venueTag = null } = {}) => {
  const deadlineMs = AT + 15_000;
  const message = {
    key: "installer.waitron_found",
    params: {
      seconds: 15,
      venueName: venueTag?.name ?? null,
      live: venueTag?.live ?? null,
      hardware,
    },
  };
  return {
    action: "wait",
    diskId: null,
    message,
    deadlineMs,
    state: initialState({
      phase: "waitron-found",
      atMs: AT,
      deadlineMs,
      target: target({ kind: "waitron", layoutVersion: 1, hardware, venueTag }),
      message,
    }),
  };
};

const unknownDisk = ({ attachmentUnclear = false, recognised = null, kind = "unknown" } = {}) => {
  const message = { key: "installer.unknown_disk", params: { attachmentUnclear, mismatch: false } };
  return {
    action: "confirm-erase",
    diskId: null,
    message,
    deadlineMs: null,
    state: initialState({
      phase: "awaiting-erase-word",
      atMs: AT,
      target: target({ kind, recognised, attachmentUnclear }),
      message,
    }),
  };
};

const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return { message: error.message, code: error.code, reason: error.reason };
  }
  return null;
};
const eventInvalid = {
  message: "installer.event_invalid",
  code: "installer.event_invalid",
  reason: "event-invalid",
};

describe("INSTALLER_TIMINGS_MS", () => {
  it("holds the spec's timings, frozen", () => {
    expect(INSTALLER_TIMINGS_MS).toEqual({
      waitronStart: 15_000,
      reinstallIdle: 120_000,
      eraseWait: 60_000,
      retry: 60_000,
    });
    expect(Object.isFrozen(INSTALLER_TIMINGS_MS)).toBe(true);
  });
});

describe("createInstallerState", () => {
  it("starts observing, frozen, with the starting message", () => {
    const state = createInstallerState(OPTIONS);
    expect(state).toEqual(initialState());
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.message)).toBe(true);
    expect(Object.isFrozen(state.message.params)).toBe(true);
  });

  it.each([
    ["a missing key", { atMs: 0, clockFloorMs: 0 }],
    ["an extra key", { ...OPTIONS, extra: 1 }],
    ["a negative time", { ...OPTIONS, atMs: -1 }],
    ["a fractional time", { ...OPTIONS, atMs: 1.5 }],
    ["a string clock floor", { ...OPTIONS, clockFloorMs: "1700000000000" }],
    ["an empty erase word", { ...OPTIONS, eraseWord: "" }],
    ["a 33-code-point erase word", { ...OPTIONS, eraseWord: "À".repeat(33) }],
    ["an erase word holding a newline", { ...OPTIONS, eraseWord: "ERASE\n" }],
    ["an erase word holding U+0085", { ...OPTIONS, eraseWord: "ERASE\u0085" }],
    ["an erase word that is not well formed", { ...OPTIONS, eraseWord: "ERASE\uD800" }],
    ["an erase word that is not a string", { ...OPTIONS, eraseWord: 5 }],
    ["null options", null],
  ])("refuses %s", (_name, options) => {
    expect(thrown(() => createInstallerState(options))).toEqual({
      message: "installer.options_invalid",
      code: "installer.options_invalid",
      reason: "options-invalid",
    });
  });

  it("accepts a 32-code-point erase word made of astral characters", () => {
    const eraseWord = "\u{1F600}".repeat(32);
    expect(createInstallerState({ ...OPTIONS, eraseWord }).eraseWord).toBe(eraseWord);
  });
});

describe("the path chosen from the disk survey", () => {
  it("one internal blank disk → wait, loading, confirmed unattended, target recognised blank", () => {
    expect(play([observed(survey([blankDisk()]))])).toEqual([loading("blank")]);
  });

  it("one internal Windows disk → loading, target recognised windows", () => {
    expect(play([observed(survey([windowsDisk()]))])).toEqual([loading("windows")]);
  });

  it("one internal BitLocker disk → loading, target recognised bitlocker", () => {
    expect(play([observed(survey([bitlockerDisk()]))])).toEqual([loading("bitlocker")]);
  });

  it("one internal complete Waitron disk → wait, waitron-found, deadlineMs atMs + 15000", () => {
    expect(play([observed(survey([completeWaitronDisk()]))])).toEqual([waitronFound()]);
  });

  it("an interrupted header write: primary header damaged, secondary valid → waitron-found", () => {
    expect(play([observed(survey([waitronWith(luks(damaged(), valid()))]))])).toEqual([
      waitronFound(),
    ]);
  });

  it("a damaged Waitron disk (both headers damaged) → confirm-erase, awaiting-erase-word, installer.unknown_disk", () => {
    expect(play([observed(survey([waitronWith(luks(damaged(), damaged()))]))])).toEqual([
      unknownDisk(),
    ]);
  });

  it("a foreign LUKS2 disk → confirm-erase", () => {
    expect(play([observed(survey([foreignLuksDisk()]))])).toEqual([unknownDisk()]);
  });

  it('a lone blank disk whose attachment is "unknown" → confirm-erase with attachmentUnclear true', () => {
    expect(play([observed(survey([blankDisk({ attachment: "unknown" })]))])).toEqual([
      unknownDisk({ attachmentUnclear: true, kind: "recognised-other", recognised: "blank" }),
    ]);
  });

  it('a lone foreign LUKS2 disk whose attachment is "unknown" → confirm-erase with attachmentUnclear true', () => {
    expect(play([observed(survey([foreignLuksDisk({ attachment: "unknown" })]))])).toEqual([
      unknownDisk({ attachmentUnclear: true }),
    ]);
  });

  it('the same foreign LUKS2 disk attached "internal" → attachmentUnclear false', () => {
    const [decision] = play([observed(survey([foreignLuksDisk()]))]);
    expect(decision.message.params.attachmentUnclear).toBe(false);
    expect(decision.state.target.attachmentUnclear).toBe(false);
  });

  it("two internal disks → refuse disk-multiple", () => {
    expect(play([observed(survey([blankDisk(), windowsDisk({ diskId: SECOND_ID })]))])).toEqual([
      refused("disk-multiple", null),
    ]);
  });

  it('an internal and an "unknown"-attachment disk → refuse disk-multiple', () => {
    expect(
      play([
        observed(survey([blankDisk(), windowsDisk({ diskId: SECOND_ID, attachment: "unknown" })])),
      ]),
    ).toEqual([refused("disk-multiple", null)]);
  });

  it("no internal disk (only the stick) → refuse disk-none", () => {
    expect(play([observed(survey([]))])).toEqual([refused("disk-none", null)]);
  });

  it('tpm "disabled" with a Windows disk → refuse no-tpm', () => {
    expect(play([observed(survey([windowsDisk()], { tpm: "disabled" }))])).toEqual([
      refused("no-tpm", "no-tpm"),
    ]);
  });

  it('secureBoot "setup-mode" → refuse secure-boot-off', () => {
    expect(play([observed(survey([windowsDisk()], { secureBoot: "setup-mode" }))])).toEqual([
      refused("secure-boot-off", "secure-boot-off"),
    ]);
  });

  it("both off → refuse no-tpm", () => {
    expect(
      play([observed(survey([foreignLuksDisk()], { tpm: "absent", secureBoot: "off" }))]),
    ).toEqual([refused("no-tpm", "no-tpm")]);
  });

  it('two internal disks and tpm "absent" → refuse disk-multiple with hardware "no-tpm"', () => {
    expect(
      play([
        observed(survey([blankDisk(), windowsDisk({ diskId: SECOND_ID })], { tpm: "absent" })),
      ]),
    ).toEqual([refused("disk-multiple", "no-tpm")]);
  });

  it('a Waitron disk with tpm "disabled" → waitron-found with hardware "no-tpm"', () => {
    expect(play([observed(survey([completeWaitronDisk()], { tpm: "disabled" }))])).toEqual([
      waitronFound({ hardware: "no-tpm" }),
    ]);
  });

  it('a survey classifyDisk refuses (a disk id "../sda") → refuse observation-invalid', () => {
    expect(play([observed(survey([blankDisk({ diskId: "../sda" })]))])).toEqual([
      refused("observation-invalid", null),
    ]);
  });

  it("names neither the stick nor any disk in its actions", () => {
    const decisions = [
      blankDisk(),
      completeWaitronDisk(),
      foreignLuksDisk({ attachment: "unknown" }),
    ].flatMap((d) => play([observed(survey([d]))]));
    expect(decisions.map((d) => [d.action, d.diskId])).toEqual([
      ["wait", null],
      ["wait", null],
      ["confirm-erase", null],
    ]);
  });
});

describe("the venue name tag", () => {
  it("normalises a decomposed name with NFC", () => {
    const [decision] = play([
      observed(survey([completeWaitronDisk()]), { name: "Bar Àngels", live: true }),
    ]);
    expect(decision).toEqual(waitronFound({ venueTag: { name: "Bar Àngels", live: true } }));
  });

  it.each([
    ["an empty name", ""],
    ["a 257-code-point name", "\u{1F600}".repeat(257)],
    ["a name holding U+0007", "Bar\u0007"],
    ["a name holding U+0085", "Bar\u0085"],
    ["a name holding U+007F", "Bar\u007F"],
    ["a name holding a lone surrogate", "Bar\uD800"],
  ])("counts %s as unreadable", (_name, name) => {
    const [decision] = play([observed(survey([completeWaitronDisk()]), { name, live: false })]);
    expect(decision).toEqual(waitronFound());
  });

  it("keeps a 256-code-point name", () => {
    const name = "\u{1F600}".repeat(256);
    const [decision] = play([observed(survey([completeWaitronDisk()]), { name, live: false })]);
    expect(decision.state.target.venueTag).toEqual({ name, live: false });
  });

  it("drops the tag on a Windows disk and keeps the path", () => {
    expect(play([observed(survey([windowsDisk()]), { name: "Bar Angels", live: true })])).toEqual([
      loading("windows"),
    ]);
  });

  it.each([
    ["a name that is not a string", { name: 5, live: true }],
    ["live that is not a boolean", { name: "Bar", live: "yes" }],
    ["an extra key", { name: "Bar", live: true, extra: 1 }],
    ["a string tag", "Bar"],
  ])("throws on a tag with %s", (_name, venueTag) => {
    expect(thrown(() => play([observed(survey([completeWaitronDisk()]), venueTag)]))).toEqual(
      eventInvalid,
    );
  });
});

describe("events", () => {
  it.each([
    ["an unknown kind", { kind: "reboot", atMs: AT }],
    ["an extra key", { kind: "tick", atMs: AT, extra: 1 }],
    ["a missing atMs", { kind: "tick" }],
    ["a negative atMs", { kind: "tick", atMs: -1 }],
    ["a fractional atMs", { kind: "tick", atMs: 1.5 }],
    ["a submit text of 5", { kind: "submit", atMs: AT, text: 5 }],
    ["a submit text of null", { kind: "submit", atMs: AT, text: null }],
    ["a choice of erase", { kind: "choice", atMs: AT, choice: "erase" }],
    ["clock-set ok without a time", { kind: "clock-set", atMs: AT, ok: true, utcMs: null }],
    ["clock-set failed with a time", { kind: "clock-set", atMs: AT, ok: false, utcMs: 5 }],
    ["clock-set ok not a boolean", { kind: "clock-set", atMs: AT, ok: 1, utcMs: 5 }],
    [
      "a verified release with a version",
      { kind: "release-checked", atMs: AT, outcome: "verified", releaseVersion: "1.0.0" },
    ],
    [
      "a too-old installer with a newline in its version",
      {
        kind: "release-checked",
        atMs: AT,
        outcome: "installer-too-old",
        releaseVersion: "1.0.0\n",
      },
    ],
    [
      "a too-old installer with an empty version",
      { kind: "release-checked", atMs: AT, outcome: "installer-too-old", releaseVersion: "" },
    ],
    [
      "a too-old installer with a 33-character version",
      {
        kind: "release-checked",
        atMs: AT,
        outcome: "installer-too-old",
        releaseVersion: "1".repeat(33),
      },
    ],
    [
      "an unknown release outcome",
      { kind: "release-checked", atMs: AT, outcome: "fine", releaseVersion: null },
    ],
    ["write-finished ok not a boolean", { kind: "write-finished", atMs: AT, ok: "yes" }],
    ["an observed event without a tag", { kind: "observed", atMs: AT, observation: {} }],
    ["null", null],
  ])("throws on %s", (_name, event) => {
    expect(thrown(() => nextInstallerStep(createInstallerState(OPTIONS), event))).toEqual(
      eventInvalid,
    );
  });

  it.each([
    ["clock-set ok", { kind: "clock-set", atMs: AT, ok: true, utcMs: 5 }],
    ["clock-set failed", { kind: "clock-set", atMs: AT, ok: false, utcMs: null }],
    [
      "a too-old installer",
      { kind: "release-checked", atMs: AT, outcome: "installer-too-old", releaseVersion: "1.0.0" },
    ],
    [
      "an unavailable release",
      { kind: "release-checked", atMs: AT, outcome: "unavailable", releaseVersion: null },
    ],
    ["write-finished", { kind: "write-finished", atMs: AT, ok: true }],
    ["online", { kind: "online", atMs: AT }],
  ])("accepts the shape of %s and refuses it out of sequence", (_name, event) => {
    expect(play([event])).toEqual([refused("sequence-invalid", null)]);
  });

  it("throws time-backwards for an event before the state's time", () => {
    const [decision] = play([observed(survey([completeWaitronDisk()]))]);
    expect(thrown(() => nextInstallerStep(decision.state, { kind: "tick", atMs: AT - 1 }))).toEqual(
      { ...eventInvalid, reason: "time-backwards" },
    );
  });

  it("throws on a hand-made copy of a genuine state", () => {
    const state = createInstallerState(OPTIONS);
    expect(thrown(() => nextInstallerStep({ ...state }, { kind: "tick", atMs: AT }))).toEqual({
      message: "installer.state_invalid",
      code: "installer.state_invalid",
      reason: "state-invalid",
    });
  });
});

describe("events a phase does not name", () => {
  it.each([
    ["a tick with no deadline", { kind: "tick", atMs: AT }],
    ["a key", { kind: "key", atMs: AT }],
    ["a submit", { kind: "submit", atMs: AT, text: "ERASE-CONFIRM" }],
    ["a choice", { kind: "choice", atMs: AT, choice: "install-now" }],
  ])("answers %s while observing with wait and the same state", (_name, event) => {
    expect(play([event])).toEqual([
      {
        action: "wait",
        diskId: null,
        message: STARTING,
        deadlineMs: null,
        state: initialState({ atMs: AT }),
      },
    ]);
  });

  it("answers a tick before the Waitron deadline with wait", () => {
    const decisions = play([
      observed(survey([completeWaitronDisk()])),
      { kind: "tick", atMs: AT + 14_999 },
    ]);
    const found = waitronFound();
    expect(decisions[1]).toEqual({ ...found, state: { ...found.state, atMs: AT + 14_999 } });
  });

  it("records the stick and the memory as their events arrive", () => {
    const decisions = play([
      { kind: "ram-ready", atMs: AT },
      { kind: "usb-removed", atMs: AT },
    ]);
    expect(decisions.map((d) => [d.action, d.state.ramReady, d.state.usbPresent])).toEqual([
      ["wait", true, true],
      ["wait", true, false],
    ]);
    const [inserted] = play([{ kind: "usb-inserted", atMs: AT }]);
    expect(inserted.state.usbPresent).toBe(true);
  });
});

describe("final phases (D14)", () => {
  it("answers every later event after refuse disk-multiple with wait and the refusal's message", () => {
    const later = [
      { kind: "tick", atMs: AT + 1 },
      { kind: "key", atMs: AT + 2 },
      { kind: "submit", atMs: AT + 3, text: "ERASE-CONFIRM" },
      { kind: "write-finished", atMs: AT + 4, ok: true },
    ];
    const decisions = play([
      observed(survey([blankDisk(), windowsDisk({ diskId: SECOND_ID })])),
      ...later,
    ]);
    const refusal = refused("disk-multiple", null);
    expect(decisions.slice(1)).toEqual(
      later.map((event) => ({
        action: "wait",
        diskId: null,
        message: refusal.message,
        deadlineMs: null,
        state: { ...refusal.state, atMs: event.atMs },
      })),
    );
  });
});

describe("sequence (D13)", () => {
  it("refuses a second observed after a Waitron path with sequence-invalid", () => {
    const decisions = play([
      observed(survey([completeWaitronDisk()])),
      observed(survey([completeWaitronDisk()]), null, AT),
    ]);
    const found = waitronFound();
    const message = {
      key: "installer.refused",
      params: { reason: "sequence-invalid", hardware: null, releaseVersion: null },
    };
    expect(decisions[1]).toEqual({
      action: "refuse",
      diskId: null,
      message,
      deadlineMs: null,
      state: {
        ...found.state,
        phase: "refused",
        deadlineMs: null,
        refusal: { reason: "sequence-invalid", hardware: null, releaseVersion: null },
        message,
      },
    });
  });
});

describe("copies", () => {
  it("keeps the target when the caller changes its survey and tag afterwards", () => {
    const observation = survey([completeWaitronDisk()]);
    const venueTag = { name: "Bar", live: true };
    const [decision] = play([observed(observation, venueTag)]);
    observation.disks[0].diskId = SECOND_ID;
    observation.disks[0].attachment = "unknown";
    venueTag.name = "Changed";
    venueTag.live = false;
    expect(decision.state.target).toEqual(
      target({ kind: "waitron", layoutVersion: 1, venueTag: { name: "Bar", live: true } }),
    );
  });

  it("freezes the decision, its message and its state", () => {
    const [decision] = play([
      observed(survey([completeWaitronDisk()]), { name: "Bar", live: true }),
    ]);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.message)).toBe(true);
    expect(Object.isFrozen(decision.message.params)).toBe(true);
    expect(Object.isFrozen(decision.state)).toBe(true);
    expect(Object.isFrozen(decision.state.target)).toBe(true);
    expect(Object.isFrozen(decision.state.target.venueTag)).toBe(true);
  });
});
