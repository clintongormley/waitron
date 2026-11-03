import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { MICROSOFT_RESERVED_TYPE, WAITRON_LAYOUTS } from "./disk-state.mjs";
import {
  INSTALLER_TIMINGS_MS,
  createInstallerState,
  installerStatus,
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
    ["a 33-code-point erase word", { ...OPTIONS, eraseWord: "\u00C0".repeat(33) }],
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

  it('a complete Waitron disk whose attachment is "unknown" → waitron-found with attachmentUnclear true', () => {
    const [decision] = play([observed(survey([completeWaitronDisk({ attachment: "unknown" })]))]);
    expect(decision.state.phase).toBe("waitron-found");
    expect(decision.state.target).toEqual(
      target({ kind: "waitron", layoutVersion: 1, attachmentUnclear: true }),
    );
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
      observed(survey([completeWaitronDisk()]), { name: "Bar A\u0300ngels", live: true }),
    ]);
    expect(decision).toEqual(waitronFound({ venueTag: { name: "Bar \u00C0ngels", live: true } }));
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
    ["clock-set ok with a negative time", { kind: "clock-set", atMs: AT, ok: true, utcMs: -1 }],
    ["clock-set ok with a string time", { kind: "clock-set", atMs: AT, ok: true, utcMs: "5" }],
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
      "a too-old installer with U+0085 in its version",
      {
        kind: "release-checked",
        atMs: AT,
        outcome: "installer-too-old",
        releaseVersion: "1.0.0\u0085",
      },
    ],
    [
      "a too-old installer with an accented letter in its version",
      {
        kind: "release-checked",
        atMs: AT,
        outcome: "installer-too-old",
        releaseVersion: "1.0.0\u00E9",
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
    const [, removed, inserted] = play([
      { kind: "ram-ready", atMs: AT },
      { kind: "usb-removed", atMs: AT },
      { kind: "usb-inserted", atMs: AT },
    ]);
    expect([removed.state.usbPresent, inserted.state.usbPresent]).toEqual([false, true]);
  });
});

describe("final phases", () => {
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

describe("sequence", () => {
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

const SANTET = Object.freeze({ name: "Bar Santet", live: true });
const key = (atMs) => ({ kind: "key", atMs });
const tick = (atMs) => ({ kind: "tick", atMs });
const submit = (text, atMs) => ({ kind: "submit", atMs, text });
const waitronSeen = (venueTag = SANTET, overrides = {}) =>
  observed(survey([completeWaitronDisk()], overrides), venueTag);
const actions = (decisions) => decisions.map((d) => [d.action, d.diskId]);
const STARTING_INSTALLED = { key: "installer.starting_installed", params: {} };
const LOADING = { key: "installer.loading", params: {} };
const reinstallMessage = ({ venueTag = SANTET, mismatch = false } = {}) => ({
  key: "installer.reinstall",
  params: {
    prompt: venueTag === null ? "erase-word" : "venue-name",
    venueName: venueTag?.name ?? null,
    live: venueTag?.live ?? null,
    mismatch,
  },
});
const NEVER = ["write-owned-target", "download", "set-clock", "find-network"];
/** @param {any[]} decisions */
const noWriteNorNetwork = (decisions) =>
  expect(decisions.filter((d) => NEVER.includes(d.action))).toEqual([]);
/** @param {any[]} decisions */
const last = (decisions) => decisions[decisions.length - 1];

describe("guard 3: a box that already holds Waitron", () => {
  it("Waitron disk observed at 1000, ticks at 15999 and 16000 → wait, then boot-installed with the internal disk id at 16000", () => {
    const decisions = play([waitronSeen(null), tick(15_999), tick(16_000)]);
    expect(actions(decisions)).toEqual([
      ["wait", null],
      ["wait", null],
      ["boot-installed", INTERNAL_ID],
    ]);
    expect(decisions[1].deadlineMs).toBe(16_000);
    expect(decisions[2]).toEqual({
      action: "boot-installed",
      diskId: INTERNAL_ID,
      message: STARTING_INSTALLED,
      deadlineMs: null,
      state: {
        ...waitronFound().state,
        phase: "booting",
        atMs: 16_000,
        deadlineMs: null,
        message: STARTING_INSTALLED,
      },
    });
    noWriteNorNetwork(decisions);
  });

  it('the same with venueTag {name: "Bar Santet", live: true} → the first message is installer.waitron_found with the name', () => {
    const decisions = play([waitronSeen(), tick(15_999), tick(16_000)]);
    expect(decisions[0].message).toEqual({
      key: "installer.waitron_found",
      params: { seconds: 15, venueName: "Bar Santet", live: true, hardware: null },
    });
    expect(actions(decisions)).toEqual([
      ["wait", null],
      ["wait", null],
      ["boot-installed", INTERNAL_ID],
    ]);
  });

  it("Waitron disk observed at 1000, a key at 16500 with no tick before it → confirm-erase, reinstall-screen, deadline 136500", () => {
    const decisions = play([waitronSeen(), key(16_500)]);
    expect(decisions[1]).toMatchObject({
      action: "confirm-erase",
      diskId: null,
      deadlineMs: 136_500,
      message: reinstallMessage(),
      state: { phase: "reinstall-screen", deadlineMs: 136_500 },
    });
    expect(decisions.map((d) => d.action)).not.toContain("boot-installed");
  });

  it("a submit during the 15 seconds only opens the reinstall screen; its text confirms nothing", () => {
    const decisions = play([waitronSeen(), submit("Bar Santet", 2_000)]);
    expect(decisions[1]).toMatchObject({
      action: "confirm-erase",
      message: reinstallMessage(),
      state: { phase: "reinstall-screen", confirmed: null, deadlineMs: 122_000 },
    });
  });

  it("a 513-unit submit during the 15 seconds → confirm-erase, reinstall-screen, like any submit", () => {
    const decisions = play([waitronSeen(), submit("x".repeat(513), 2_000)]);
    expect(decisions[1]).toMatchObject({
      action: "confirm-erase",
      message: reinstallMessage(),
      state: { phase: "reinstall-screen", deadlineMs: 122_000 },
    });
  });

  it.each([16_000, 16_500])(
    "a submit at %i with no tick before it → confirm-erase, reinstall-screen",
    (atMs) => {
      const decisions = play([waitronSeen(), submit("x", atMs)]);
      expect(decisions[1]).toMatchObject({
        action: "confirm-erase",
        deadlineMs: atMs + 120_000,
        message: reinstallMessage(),
        state: { phase: "reinstall-screen", confirmed: null },
      });
    },
  );

  it("ignores a choice in the 15 seconds", () => {
    const decisions = play([waitronSeen(), { kind: "choice", atMs: 2_000, choice: "install-now" }]);
    expect(decisions[1]).toMatchObject({ action: "wait", state: { phase: "waitron-found" } });
  });
});

describe("the reinstall screen", () => {
  it("a key at 5000 → confirm-erase, prompt venue-name, deadline 125000; a key at 60000 → deadline 180000; a tick at 179999 → wait; at 180000 → boot-installed", () => {
    const decisions = play([waitronSeen(), key(5_000), key(60_000), tick(179_999), tick(180_000)]);
    expect(decisions.map((d) => [d.action, d.diskId, d.deadlineMs])).toEqual([
      ["wait", null, 16_000],
      ["confirm-erase", null, 125_000],
      ["wait", null, 180_000],
      ["wait", null, 180_000],
      ["boot-installed", INTERNAL_ID, null],
    ]);
    expect(decisions[1].message).toEqual(reinstallMessage());
    expect(decisions[2].message).toEqual(reinstallMessage());
    expect(last(decisions)).toMatchObject({
      message: STARTING_INSTALLED,
      state: { phase: "booting" },
    });
    noWriteNorNetwork(decisions);
  });

  it("a key after the idle deadline but before the tick counts as typing", () => {
    const decisions = play([waitronSeen(), key(5_000), key(126_000), tick(126_001)]);
    expect(decisions.map((d) => [d.action, d.deadlineMs])).toEqual([
      ["wait", 16_000],
      ["confirm-erase", 125_000],
      ["wait", 246_000],
      ["wait", 246_000],
    ]);
  });

  it("a correct name submitted after the idle deadline but before the tick is accepted", () => {
    const decisions = play([
      waitronSeen(),
      key(5_000),
      submit("Bar Santet", 126_000),
      tick(126_001),
    ]);
    expect(decisions[2]).toMatchObject({
      action: "wait",
      message: LOADING,
      state: { phase: "loading", confirmed: "typed", deadlineMs: null },
    });
    expect(decisions[3]).toMatchObject({ action: "wait", state: { phase: "loading" } });
  });

  it("a key after a mismatching submit keeps mismatch true in the message", () => {
    const decisions = play([waitronSeen(), key(5_000), submit("nope", 6_000), key(7_000)]);
    expect(decisions[3]).toMatchObject({
      action: "wait",
      deadlineMs: 127_000,
      message: reinstallMessage({ mismatch: true }),
      state: { phase: "reinstall-screen", message: reinstallMessage({ mismatch: true }) },
    });
  });

  it('a scanner\'s line "8412345678905" submitted on the screen → mismatch true, no erase path', () => {
    const decisions = play([
      waitronSeen(),
      key(5_000),
      submit("8412345678905", 6_000),
      tick(126_000),
    ]);
    expect(decisions[2]).toMatchObject({
      action: "confirm-erase",
      deadlineMs: 126_000,
      message: reinstallMessage({ mismatch: true }),
      state: { phase: "reinstall-screen", confirmed: null },
    });
    expect(actions(decisions.slice(3))).toEqual([["boot-installed", INTERNAL_ID]]);
    noWriteNorNetwork(decisions);
  });

  it("the exact name typed → confirmed typed, loading", () => {
    const decisions = play([waitronSeen(), key(5_000), submit("Bar Santet", 6_000)]);
    expect(decisions[2]).toEqual({
      action: "wait",
      diskId: null,
      message: LOADING,
      deadlineMs: null,
      state: {
        ...waitronFound({ venueTag: SANTET }).state,
        phase: "loading",
        atMs: 6_000,
        confirmed: "typed",
        deadlineMs: null,
        message: LOADING,
      },
    });
  });

  it.each([
    ['"bar santet" (case)', "bar santet"],
    ['"Bar Santet " (trailing space)', "Bar Santet "],
    ['"ERASE-CONFIRM" with a readable name', "ERASE-CONFIRM"],
  ])("%s → mismatch", (_name, text) => {
    const decisions = play([waitronSeen(), key(5_000), submit(text, 6_000)]);
    expect(decisions[2]).toMatchObject({
      action: "confirm-erase",
      message: reinstallMessage({ mismatch: true }),
      state: { phase: "reinstall-screen", confirmed: null },
    });
  });

  it("the name typed with a decomposed accent when the tag holds the composed one → matches", () => {
    const decisions = play([
      waitronSeen({ name: "Bar \u00C0ngels", live: false }),
      key(5_000),
      submit("Bar A\u0300ngels", 6_000),
    ]);
    expect(decisions[2].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it('with an unreadable tag (venueTag null) the prompt is erase-word, and "ERASE-CONFIRM" confirms; "erase-confirm" → mismatch', () => {
    const decisions = play([
      waitronSeen(null),
      key(5_000),
      submit("erase-confirm", 6_000),
      submit("ERASE-CONFIRM", 7_000),
    ]);
    expect(decisions[1].message).toEqual(reinstallMessage({ venueTag: null }));
    expect(decisions[2].message).toEqual(reinstallMessage({ venueTag: null, mismatch: true }));
    expect(decisions[3].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it('forgery: a tag whose name is "ERASE-CONFIRM" → prompt venue-name, and "ERASE-CONFIRM" confirms', () => {
    const forged = { name: "ERASE-CONFIRM", live: true };
    const decisions = play([waitronSeen(forged), key(5_000), submit("ERASE-CONFIRM", 6_000)]);
    expect(decisions[1].message).toEqual(reinstallMessage({ venueTag: forged }));
    expect(decisions[2].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it.each([
    ["live true", { name: "Bar Santet", live: true }],
    ["live false", { name: "ERASE-CONFIRM", live: false }],
    ["an unreadable tag", null],
  ])(
    "forgery: whatever the tag says (%s), with no key the run ends in boot-installed at 15 s",
    (_name, venueTag) => {
      const decisions = play([waitronSeen(venueTag), tick(16_000)]);
      expect(actions(decisions)).toEqual([
        ["wait", null],
        ["boot-installed", INTERNAL_ID],
      ]);
    },
  );

  it("a long accented name: waitron_found carries the whole name, no key boots, typed exactly it confirms", () => {
    const name = "\u00C0".repeat(30) + " " + "\u00E9".repeat(29);
    const venueTag = { name, live: true };
    const alone = play([waitronSeen(venueTag), tick(16_000)]);
    expect(alone[0].message.params.venueName).toBe(name);
    expect(actions(alone)).toEqual([
      ["wait", null],
      ["boot-installed", INTERNAL_ID],
    ]);
    const typed = play([waitronSeen(venueTag), key(5_000), submit(name, 6_000)]);
    expect(typed[2].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it("a long name typed decomposed: 256 code points typed in 768 units → matches", () => {
    const typedText = "e\u0323\u0302".repeat(256);
    expect(typedText.length).toBe(768);
    const decisions = play([
      waitronSeen({ name: "\u1EC7".repeat(256), live: true }),
      key(5_000),
      submit(typedText, 6_000),
    ]);
    expect(decisions[2].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it("over-long text: a 513-unit submit → mismatch, and the state keeps none of it", () => {
    const decisions = play([
      waitronSeen(null),
      key(5_000),
      submit("CANARY-".padEnd(513, "x"), 6_000),
    ]);
    expect(decisions[2]).toMatchObject({
      action: "confirm-erase",
      deadlineMs: 126_000,
      message: reinstallMessage({ venueTag: null, mismatch: true }),
    });
    expect(JSON.stringify(decisions[2].state)).not.toContain("CANARY");
  });

  it("not kept: a mismatching submit leaves no trace of its text", () => {
    const decisions = play([waitronSeen(), key(5_000), submit("CANARY-2b9c", 6_000)]);
    expect(JSON.stringify(decisions[2])).not.toContain("CANARY");
    expect(JSON.stringify(decisions[2].state)).not.toContain("CANARY");
  });
});

describe("hardware off on a box that holds Waitron", () => {
  it('tpm "disabled", no key → boot-installed at 15 s, the message carries hardware "no-tpm"', () => {
    const decisions = play([waitronSeen(SANTET, { tpm: "disabled" }), tick(16_000)]);
    expect(decisions[0].message.params.hardware).toBe("no-tpm");
    expect(actions(decisions)).toEqual([
      ["wait", null],
      ["boot-installed", INTERNAL_ID],
    ]);
    expect(decisions[1].state.target.hardware).toBe("no-tpm");
  });

  it("the same, name typed on the reinstall screen → refuse no-tpm, and nothing is written after it", () => {
    const decisions = play([
      waitronSeen(SANTET, { tpm: "disabled" }),
      key(5_000),
      submit("Bar Santet", 6_000),
      { kind: "online", atMs: 7_000 },
      { kind: "release-checked", atMs: 8_000, outcome: "verified", releaseVersion: null },
      tick(200_000),
      { kind: "write-finished", atMs: 200_001, ok: true },
    ]);
    expect(decisions[2]).toMatchObject({
      action: "refuse",
      message: {
        key: "installer.refused",
        params: { reason: "no-tpm", hardware: "no-tpm", releaseVersion: null },
      },
      state: { phase: "refused", confirmed: null },
    });
    expect(decisions.slice(3).map((d) => d.action)).toEqual(["wait", "wait", "wait", "wait"]);
  });
});

describe("the unknown disk", () => {
  const damagedSeen = () => observed(survey([waitronWith(luks(damaged(), damaged()))]));

  it('a damaged Waitron disk, "ERASE-CONFIRM" submitted → confirmed typed, loading', () => {
    const decisions = play([damagedSeen(), submit("ERASE-CONFIRM", 2_000)]);
    expect(decisions[1]).toEqual({
      action: "wait",
      diskId: null,
      message: LOADING,
      deadlineMs: null,
      state: {
        ...unknownDisk().state,
        phase: "loading",
        atMs: 2_000,
        confirmed: "typed",
        message: LOADING,
      },
    });
  });

  it.each([
    ['"ERASE-CONFIRM\\n" (the adapter takes off the Enter)', "ERASE-CONFIRM\n"],
    ['"erase-confirm"', "erase-confirm"],
  ])("%s → mismatch", (_name, text) => {
    const decisions = play([damagedSeen(), submit(text, 2_000)]);
    const message = {
      key: "installer.unknown_disk",
      params: { attachmentUnclear: false, mismatch: true },
    };
    expect(decisions[1]).toEqual({
      action: "confirm-erase",
      diskId: null,
      message,
      deadlineMs: null,
      state: { ...unknownDisk().state, atMs: 2_000, message },
    });
  });

  it("compares the erase word exactly: a decomposed spelling of an accented word does not confirm", () => {
    const options = { ...OPTIONS, eraseWord: "ERAS\u00C9" };
    const decomposed = play([damagedSeen(), submit("ERASE\u0301", 2_000)], options);
    expect(decomposed[1].state).toMatchObject({ phase: "awaiting-erase-word", confirmed: null });
    const exact = play([damagedSeen(), submit("ERAS\u00C9", 2_000)], options);
    expect(exact[1].state).toMatchObject({ phase: "loading", confirmed: "typed" });
  });

  it("keeps attachmentUnclear in the mismatch message", () => {
    const decisions = play([
      observed(survey([blankDisk({ attachment: "unknown" })])),
      submit("nope", 2_000),
    ]);
    expect(decisions[1].message.params).toEqual({ attachmentUnclear: true, mismatch: true });
  });

  it("a key, then ticks for an hour → still awaiting-erase-word, no action but wait", () => {
    const ticks = Array.from({ length: 61 }, (_, minute) => tick(2_000 + minute * 60_000));
    const decisions = play([damagedSeen(), key(1_500), ...ticks]);
    expect(decisions.slice(1).every((d) => d.action === "wait" && d.deadlineMs === null)).toBe(
      true,
    );
    expect(last(decisions).state.phase).toBe("awaiting-erase-word");
  });

  it("over-long text: a 513-unit submit → mismatch, and the state keeps none of it", () => {
    const decisions = play([damagedSeen(), submit("CANARY-".padEnd(513, "x"), 2_000)]);
    expect(decisions[1]).toMatchObject({
      action: "confirm-erase",
      message: { key: "installer.unknown_disk", params: { mismatch: true } },
    });
    expect(JSON.stringify(decisions[1].state)).not.toContain("CANARY");
  });
});

const FLOOR = OPTIONS.clockFloorMs;
const ramReady = (atMs) => ({ kind: "ram-ready", atMs });
const usbRemoved = (atMs) => ({ kind: "usb-removed", atMs });
const online = (atMs) => ({ kind: "online", atMs });
const clockSet = (ok, utcMs, atMs) => ({ kind: "clock-set", atMs, ok, utcMs });
const released = (outcome, atMs, releaseVersion = null) => ({
  kind: "release-checked",
  atMs,
  outcome,
  releaseVersion,
});
const windowsSeen = (atMs = AT) => observed(survey([windowsDisk()]), null, atMs);
const SAFE_TO_REMOVE = { key: "installer.safe_to_remove", params: {} };
const SETTING_CLOCK = { key: "installer.setting_clock", params: {} };
const DOWNLOADING = { key: "installer.downloading", params: {} };
const FINDING_NETWORK = { key: "installer.finding_network", params: {} };
const CLOCK_RETRY = { key: "installer.clock_retry", params: { seconds: 60 } };
const DOWNLOAD_RETRY = { key: "installer.download_retry", params: { seconds: 60 } };
const TO_DOWNLOADING = [
  windowsSeen(),
  ramReady(2_000),
  online(3_000),
  clockSet(true, FLOOR, 4_000),
];
const windowsState = (overrides) => ({
  ...loading("windows").state,
  ramReady: true,
  ...overrides,
});
const messageKeys = (decisions) => decisions.map((d) => d.message.key);

describe("in memory first (Review Focus 4)", () => {
  it("Windows disk observed at 0, no ram-ready, ticks to 600000 → only wait, and installer.safe_to_remove never appears", () => {
    const ticks = Array.from({ length: 60 }, (_, i) => tick((i + 1) * 10_000));
    const decisions = play([windowsSeen(0), ...ticks]);
    expect(decisions.every((d) => d.action === "wait")).toBe(true);
    expect(messageKeys(decisions)).not.toContain("installer.safe_to_remove");
    expect(last(decisions).state.phase).toBe("loading");
  });

  it("ram-ready at 3000 → find-network with installer.safe_to_remove", () => {
    const decisions = play([windowsSeen(), ramReady(3_000)]);
    expect(decisions[1]).toEqual({
      action: "find-network",
      diskId: null,
      message: SAFE_TO_REMOVE,
      deadlineMs: null,
      state: windowsState({ phase: "network", atMs: 3_000, message: SAFE_TO_REMOVE }),
    });
  });

  it("ram-ready at 0, then Windows observed at 1000 → find-network at once", () => {
    const decisions = play([ramReady(0), windowsSeen()]);
    expect(decisions[0]).toMatchObject({ action: "wait", state: { phase: "observing" } });
    expect(decisions[1]).toEqual({
      action: "find-network",
      diskId: null,
      message: SAFE_TO_REMOVE,
      deadlineMs: null,
      state: windowsState({ phase: "network", message: SAFE_TO_REMOVE }),
    });
  });

  it("a repeated ram-ready changes nothing", () => {
    const decisions = play([windowsSeen(), ramReady(2_000), ramReady(3_000)]);
    expect(decisions[2]).toEqual({
      ...decisions[1],
      action: "wait",
      state: { ...decisions[1].state, atMs: 3_000 },
    });
  });

  it("a Waitron disk with ram-ready → no installer.safe_to_remove before a typed confirmation", () => {
    const decisions = play([
      waitronSeen(),
      ramReady(2_000),
      key(5_000),
      submit("nope", 6_000),
      tick(7_000),
    ]);
    expect(decisions[1]).toMatchObject({
      action: "wait",
      state: { phase: "waitron-found", ramReady: true },
    });
    expect(messageKeys(decisions)).not.toContain("installer.safe_to_remove");
    noWriteNorNetwork(decisions);
  });

  it("after the venue name is typed → find-network with installer.safe_to_remove", () => {
    const decisions = play([
      waitronSeen(),
      ramReady(2_000),
      key(5_000),
      submit("Bar Santet", 6_000),
    ]);
    expect(decisions[3]).toEqual({
      action: "find-network",
      diskId: null,
      message: SAFE_TO_REMOVE,
      deadlineMs: null,
      state: {
        ...waitronFound({ venueTag: SANTET }).state,
        phase: "network",
        atMs: 6_000,
        ramReady: true,
        confirmed: "typed",
        deadlineMs: null,
        message: SAFE_TO_REMOVE,
      },
    });
  });

  it("an unknown disk with ram-ready → find-network once the erase word is typed", () => {
    const decisions = play([
      observed(survey([foreignLuksDisk()])),
      ramReady(2_000),
      submit("ERASE-CONFIRM", 3_000),
    ]);
    expect(decisions[1]).toMatchObject({
      action: "wait",
      state: { phase: "awaiting-erase-word" },
    });
    expect(decisions[2]).toMatchObject({
      action: "find-network",
      message: SAFE_TO_REMOVE,
      state: { phase: "network", confirmed: "typed" },
    });
  });

  it("a refused box (two disks) with ram-ready → never installer.safe_to_remove", () => {
    const second = disk({ diskId: SECOND_ID });
    for (const events of [
      [ramReady(0), observed(survey([windowsDisk(), second]))],
      [observed(survey([windowsDisk(), second])), ramReady(2_000), online(3_000)],
    ]) {
      const decisions = play(events);
      expect(messageKeys(decisions)).not.toContain("installer.safe_to_remove");
      expect(last(decisions).state.refusal.reason).toBe("disk-multiple");
      noWriteNorNetwork(decisions);
    }
  });
});

describe("early removal", () => {
  const early = {
    key: "installer.refused",
    params: { reason: "usb-removed-early", hardware: null, releaseVersion: null },
  };

  it("usb-removed before ram-ready on the Windows path → refuse usb-removed-early", () => {
    const decisions = play([windowsSeen(), usbRemoved(2_000), ramReady(3_000), online(4_000)]);
    expect(decisions[1]).toEqual({
      action: "refuse",
      diskId: null,
      message: early,
      deadlineMs: null,
      state: {
        ...loading("windows").state,
        phase: "refused",
        atMs: 2_000,
        refusal: early.params,
        message: early,
      },
    });
    expect(decisions.slice(2).map((d) => d.action)).toEqual(["wait", "wait"]);
  });

  it("the same on the Waitron path during the 15 seconds → refuse usb-removed-early, and no boot-installed follows", () => {
    const decisions = play([waitronSeen(), usbRemoved(2_000), tick(16_000), tick(200_000)]);
    expect(decisions[1]).toMatchObject({
      action: "refuse",
      message: early,
      state: { phase: "refused" },
    });
    expect(decisions.slice(2).map((d) => d.action)).toEqual(["wait", "wait"]);
  });

  it("usb-removed before the survey → refuse usb-removed-early", () => {
    expect(play([usbRemoved(AT)])[0]).toMatchObject({ action: "refuse", message: early });
  });

  it("usb-removed after ram-ready → wait, and the run continues to set-clock on online", () => {
    const decisions = play([windowsSeen(), ramReady(2_000), usbRemoved(3_000), online(4_000)]);
    expect(decisions[2]).toEqual({
      action: "wait",
      diskId: null,
      message: SAFE_TO_REMOVE,
      deadlineMs: null,
      state: windowsState({
        phase: "network",
        atMs: 3_000,
        usbPresent: false,
        message: SAFE_TO_REMOVE,
      }),
    });
    expect(decisions[3]).toMatchObject({
      action: "set-clock",
      state: { phase: "clock", usbPresent: false },
    });
  });
});

describe("the clock before the download", () => {
  it("online → set-clock, never download first", () => {
    const decisions = play([windowsSeen(), ramReady(2_000), online(3_000)]);
    expect(decisions[2]).toEqual({
      action: "set-clock",
      diskId: null,
      message: SETTING_CLOCK,
      deadlineMs: null,
      state: windowsState({ phase: "clock", atMs: 3_000, message: SETTING_CLOCK }),
    });
  });

  it("clock-set ok with utcMs equal to the floor → download", () => {
    const decisions = play(TO_DOWNLOADING);
    expect(decisions[3]).toEqual({
      action: "download",
      diskId: null,
      message: DOWNLOADING,
      deadlineMs: null,
      state: windowsState({
        phase: "downloading",
        atMs: 4_000,
        clockSet: true,
        message: DOWNLOADING,
      }),
    });
  });

  it("utcMs one below the floor → clock-retry", () => {
    const decisions = play([
      windowsSeen(),
      ramReady(2_000),
      online(3_000),
      clockSet(true, FLOOR - 1, 4_000),
    ]);
    expect(decisions[3]).toEqual({
      action: "wait",
      diskId: null,
      message: CLOCK_RETRY,
      deadlineMs: 64_000,
      state: windowsState({
        phase: "clock-retry",
        atMs: 4_000,
        deadlineMs: 64_000,
        message: CLOCK_RETRY,
      }),
    });
  });

  it("clock-set ok: false at 10000 → wait with deadline 70000; tick at 70000 → find-network; online → set-clock again", () => {
    const decisions = play([
      windowsSeen(),
      ramReady(2_000),
      online(3_000),
      clockSet(false, null, 10_000),
      tick(69_999),
      tick(70_000),
      online(71_000),
    ]);
    expect(decisions.slice(3).map((d) => [d.action, d.deadlineMs, d.state.phase])).toEqual([
      ["wait", 70_000, "clock-retry"],
      ["wait", 70_000, "clock-retry"],
      ["find-network", null, "network"],
      ["set-clock", null, "clock"],
    ]);
    expect(decisions[3].message).toEqual(CLOCK_RETRY);
    expect(decisions[5]).toEqual({
      action: "find-network",
      diskId: null,
      message: FINDING_NETWORK,
      deadlineMs: null,
      state: windowsState({ phase: "network", atMs: 70_000, message: FINDING_NETWORK }),
    });
  });

  it("once the clock is set, a later online goes straight to download", () => {
    const decisions = play([
      ...TO_DOWNLOADING,
      released("unavailable", 5_000),
      tick(65_000),
      online(66_000),
    ]);
    expect(last(decisions)).toEqual({
      action: "download",
      diskId: null,
      message: DOWNLOADING,
      deadlineMs: null,
      state: windowsState({
        phase: "downloading",
        atMs: 66_000,
        clockSet: true,
        message: DOWNLOADING,
      }),
    });
  });
});

describe("download outcomes (Review Focus 3)", () => {
  const later = [
    online(31_000),
    released("verified", 32_000),
    tick(200_000),
    ramReady(200_001),
    usbRemoved(200_002),
    key(200_003),
    { kind: "write-finished", atMs: 200_004, ok: true },
  ];

  it.each([
    ["signature", "release-signature"],
    ["checksum", "release-checksum"],
    ["too-large", "release-too-large"],
  ])("%s → refuse %s, and every later event answers wait", (outcome, reason) => {
    const decisions = play([...TO_DOWNLOADING, released(outcome, 30_000), ...later]);
    const refusal = { reason, hardware: null, releaseVersion: null };
    const message = { key: "installer.refused", params: refusal };
    expect(decisions[4]).toEqual({
      action: "refuse",
      diskId: null,
      message,
      deadlineMs: null,
      state: windowsState({ phase: "refused", atMs: 30_000, clockSet: true, refusal, message }),
    });
    expect(
      decisions.slice(5).every((d) => d.action === "wait" && d.message === decisions[4].message),
    ).toBe(true);
    expect(decisions.map((d) => d.action)).not.toContain("write-owned-target");
  });

  it('installer-too-old with releaseVersion "1.4.0" → the refusal\'s params carry "1.4.0"', () => {
    const decisions = play([...TO_DOWNLOADING, released("installer-too-old", 30_000, "1.4.0")]);
    const refusal = { reason: "installer-too-old", hardware: null, releaseVersion: "1.4.0" };
    expect(decisions[4]).toMatchObject({
      action: "refuse",
      message: { key: "installer.refused", params: refusal },
      state: { phase: "refused", refusal },
    });
  });

  it.each(["unavailable", "truncated"])(
    "%s at 30000 → deadline 90000, then find-network at 90000",
    (outcome) => {
      const decisions = play([
        ...TO_DOWNLOADING,
        released(outcome, 30_000),
        tick(89_999),
        tick(90_000),
      ]);
      expect(decisions[4]).toEqual({
        action: "wait",
        diskId: null,
        message: DOWNLOAD_RETRY,
        deadlineMs: 90_000,
        state: windowsState({
          phase: "download-retry",
          atMs: 30_000,
          clockSet: true,
          deadlineMs: 90_000,
          message: DOWNLOAD_RETRY,
        }),
      });
      expect(decisions.slice(5).map((d) => [d.action, d.state.phase, d.message.key])).toEqual([
        ["wait", "download-retry", "installer.download_retry"],
        ["find-network", "network", "installer.finding_network"],
      ]);
    },
  );

  describe("on a typed reinstall, where a write would erase a venue's disk", () => {
    const typedToDownloading = [
      waitronSeen(),
      key(2_000),
      ramReady(3_000),
      submit("Bar Santet", 4_000),
      online(5_000),
      clockSet(true, FLOOR, 6_000),
    ];

    it.each([
      ["signature", "release-signature", null],
      ["checksum", "release-checksum", null],
      ["too-large", "release-too-large", null],
      ["installer-too-old", "installer-too-old", "1.4.0"],
    ])("%s → refuse %s, and no write-owned-target in the run", (outcome, reason, version) => {
      const decisions = play([
        ...typedToDownloading,
        released(outcome, 30_000, version),
        tick(200_000),
        choice("install-now", 200_001),
      ]);
      expect(decisions[6]).toMatchObject({
        action: "refuse",
        state: {
          phase: "refused",
          confirmed: "typed",
          refusal: { reason, hardware: null, releaseVersion: version },
        },
      });
      expect(writes(decisions)).toEqual([]);
    });

    it.each(["unavailable", "truncated"])(
      "%s → download-retry, and no write-owned-target in the run",
      (outcome) => {
        const decisions = play([
          ...typedToDownloading,
          released(outcome, 30_000),
          tick(89_999),
          tick(90_000),
        ]);
        expect(decisions[6]).toMatchObject({
          action: "wait",
          message: DOWNLOAD_RETRY,
          deadlineMs: 90_000,
          state: { phase: "download-retry", confirmed: "typed" },
        });
        expect(decisions.slice(7).map((d) => d.action)).toEqual(["wait", "find-network"]);
        expect(writes(decisions)).toEqual([]);
      },
    );
  });

  it("no fallback: after signature, a further online or release-checked verified answers wait", () => {
    const decisions = play([
      ...TO_DOWNLOADING,
      released("signature", 30_000),
      online(31_000),
      released("verified", 32_000),
    ]);
    expect(decisions.slice(5).map((d) => d.action)).toEqual(["wait", "wait"]);
    expect(decisions.slice(4).map((d) => d.action)).not.toContain("download");
    expect(decisions.map((d) => d.action)).not.toContain("write-owned-target");
  });

  it("a key or a tick while finding the network or setting the clock answers wait", () => {
    const decisions = play([
      windowsSeen(),
      ramReady(2_000),
      key(2_500),
      tick(2_600),
      online(3_000),
      key(3_500),
      tick(3_600),
    ]);
    expect(decisions.slice(2).map((d) => [d.action, d.state.phase])).toEqual([
      ["wait", "network"],
      ["wait", "network"],
      ["set-clock", "clock"],
      ["wait", "clock"],
      ["wait", "clock"],
    ]);
  });

  it("a person's key, line or choice while downloading answers wait", () => {
    const decisions = play([
      ...TO_DOWNLOADING,
      key(5_000),
      submit("ERASE-CONFIRM", 6_000),
      { kind: "choice", atMs: 7_000, choice: "install-now" },
    ]);
    expect(decisions.slice(4).map((d) => [d.action, d.state.phase])).toEqual([
      ["wait", "downloading"],
      ["wait", "downloading"],
      ["wait", "downloading"],
    ]);
  });
});

describe("out-of-turn adapter results", () => {
  const sequenceInvalid = { reason: "sequence-invalid", hardware: null, releaseVersion: null };

  it("release-checked while in clock → refuse sequence-invalid", () => {
    const decisions = play([
      windowsSeen(),
      ramReady(2_000),
      online(3_000),
      released("verified", 4_000),
    ]);
    expect(decisions[3]).toMatchObject({
      action: "refuse",
      state: { phase: "refused", refusal: sequenceInvalid },
    });
  });

  it("write-finished while in downloading → refuse sequence-invalid", () => {
    const decisions = play([...TO_DOWNLOADING, { kind: "write-finished", atMs: 5_000, ok: true }]);
    expect(decisions[4]).toMatchObject({
      action: "refuse",
      state: { phase: "refused", refusal: sequenceInvalid },
    });
  });

  it("online while in waitron-found → refuse sequence-invalid", () => {
    const decisions = play([waitronSeen(), online(2_000)]);
    expect(decisions[1]).toMatchObject({
      action: "refuse",
      state: { phase: "refused", refusal: sequenceInvalid },
    });
  });
});

const usbInserted = (atMs) => ({ kind: "usb-inserted", atMs });
const choice = (value, atMs) => ({ kind: "choice", atMs, choice: value });
const writeFinished = (ok, atMs) => ({ kind: "write-finished", atMs, ok });
const TO_VERIFIED = [
  windowsSeen(0),
  ramReady(0),
  online(0),
  clockSet(true, FLOOR, 0),
  released("verified", 1_000),
];
const COUNTDOWN = {
  key: "installer.erase_countdown",
  params: { seconds: 60, recognised: "windows" },
};
const ERASE_STOPPED = { key: "installer.erase_stopped", params: {} };
const WRITING = { key: "installer.writing", params: {} };
const REMOVE_USB = { key: "installer.remove_usb", params: {} };
const POWERING_OFF = { key: "installer.powering_off", params: {} };
const writes = (decisions) => decisions.filter((d) => d.action === "write-owned-target");
const hourOfTicks = (fromMs) =>
  Array.from({ length: 60 }, (_, i) => tick(fromMs + (i + 1) * 60_000));

describe("the 60 seconds before an unattended erase", () => {
  it("Windows disk, ram-ready, online, clock set, verified at 1000 → wait with deadline 61000; tick at 60999 → wait; tick at 61000 → write-owned-target with the internal disk id", () => {
    const decisions = play([...TO_VERIFIED, tick(60_999), tick(61_000)]);
    expect(decisions[4]).toEqual({
      action: "wait",
      diskId: null,
      message: COUNTDOWN,
      deadlineMs: 61_000,
      state: windowsState({
        phase: "erase-countdown",
        atMs: 1_000,
        clockSet: true,
        deadlineMs: 61_000,
        message: COUNTDOWN,
      }),
    });
    expect(decisions[5]).toMatchObject({ action: "wait", diskId: null, deadlineMs: 61_000 });
    expect(decisions[6]).toEqual({
      action: "write-owned-target",
      diskId: INTERNAL_ID,
      message: WRITING,
      deadlineMs: null,
      state: windowsState({
        phase: "writing",
        atMs: 61_000,
        clockSet: true,
        message: WRITING,
      }),
    });
    expect(actions(decisions).filter(([, diskId]) => diskId !== null)).toEqual([
      ["write-owned-target", INTERNAL_ID],
    ]);
  });

  it("a key at 61500 with no tick before it → confirm-erase, erase-stopped, and no write-owned-target in the run", () => {
    const decisions = play([...TO_VERIFIED, key(61_500), tick(61_501), tick(200_000)]);
    expect(decisions[5]).toEqual({
      action: "confirm-erase",
      diskId: null,
      message: ERASE_STOPPED,
      deadlineMs: null,
      state: windowsState({
        phase: "erase-stopped",
        atMs: 61_500,
        clockSet: true,
        message: ERASE_STOPPED,
      }),
    });
    expect(writes(decisions)).toEqual([]);
  });

  it("a 513-unit submit during the 60 seconds → confirm-erase, erase-stopped, and no write-owned-target in the run", () => {
    const decisions = play([...TO_VERIFIED, submit("x".repeat(513), 30_000), tick(61_000)]);
    expect(decisions[5]).toMatchObject({
      action: "confirm-erase",
      message: ERASE_STOPPED,
      state: { phase: "erase-stopped" },
    });
    expect(writes(decisions)).toEqual([]);
  });

  it("a second verification at 2000 → refuse sequence-invalid, and no write-owned-target in the run", () => {
    const decisions = play([...TO_VERIFIED, released("verified", 2_000), tick(61_000)]);
    expect(decisions[5]).toMatchObject({
      action: "refuse",
      state: {
        phase: "refused",
        refusal: { reason: "sequence-invalid", hardware: null, releaseVersion: null },
      },
    });
    expect(writes(decisions)).toEqual([]);
  });

  it("a choice during the 60 seconds is ignored, and the erase still comes at 61000", () => {
    const decisions = play([...TO_VERIFIED, choice("power-off", 2_000), tick(61_000)]);
    expect(decisions[5]).toMatchObject({ action: "wait", state: { phase: "erase-countdown" } });
    expect(decisions[6]).toMatchObject({ action: "write-owned-target", diskId: INTERNAL_ID });
  });

  it("a choice after the deadline with no tick before it → wait; only the tick writes", () => {
    const decisions = play([...TO_VERIFIED, choice("power-off", 61_500), tick(61_501)]);
    expect(decisions[5]).toMatchObject({
      action: "wait",
      diskId: null,
      state: { phase: "erase-countdown" },
    });
    expect(decisions[6]).toMatchObject({ action: "write-owned-target", diskId: INTERNAL_ID });
  });

  it("clock-set with utcMs 1_900_000_000_000 at 10000, verified at 20000 → the deadline is 80000", () => {
    const decisions = play([
      windowsSeen(0),
      ramReady(0),
      online(0),
      clockSet(true, 1_900_000_000_000, 10_000),
      released("verified", 20_000),
      tick(79_999),
      tick(80_000),
    ]);
    expect(decisions[4]).toMatchObject({ action: "wait", deadlineMs: 80_000 });
    expect(decisions.slice(5).map((d) => d.action)).toEqual(["wait", "write-owned-target"]);
  });
});

describe("after a key stops the 60 seconds", () => {
  const stopped = [...TO_VERIFIED, key(30_000)];

  it("a key at 30000 → confirm-erase, installer.erase_stopped; ticks, keys and lines to 3600000 → wait only", () => {
    const decisions = play([
      ...stopped,
      ...hourOfTicks(30_000),
      key(3_700_000),
      submit("ERASE-CONFIRM", 3_700_001),
    ]);
    expect(decisions[5]).toMatchObject({
      action: "confirm-erase",
      message: ERASE_STOPPED,
      deadlineMs: null,
      state: { phase: "erase-stopped" },
    });
    expect(decisions.slice(6).every((d) => d.action === "wait")).toBe(true);
    expect(last(decisions).state.phase).toBe("erase-stopped");
  });

  it("then choice install-now → write-owned-target", () => {
    const decisions = play([...stopped, ...hourOfTicks(30_000), choice("install-now", 3_700_000)]);
    expect(last(decisions)).toEqual({
      action: "write-owned-target",
      diskId: INTERNAL_ID,
      message: WRITING,
      deadlineMs: null,
      state: windowsState({
        phase: "writing",
        atMs: 3_700_000,
        clockSet: true,
        message: WRITING,
      }),
    });
  });

  it("or choice power-off → power-off, and no write-owned-target ever", () => {
    const decisions = play([
      ...stopped,
      choice("power-off", 40_000),
      choice("install-now", 41_000),
      tick(200_000),
    ]);
    expect(decisions[6]).toEqual({
      action: "power-off",
      diskId: null,
      message: POWERING_OFF,
      deadlineMs: null,
      state: windowsState({
        phase: "powering-off",
        atMs: 40_000,
        clockSet: true,
        message: POWERING_OFF,
      }),
    });
    expect(decisions.slice(7).map((d) => d.action)).toEqual(["wait", "wait"]);
    expect(writes(decisions)).toEqual([]);
  });
});

describe("a typed confirmation erases once the download is verified", () => {
  it("unknown disk, the erase word, ram-ready, online, clock set, verified → write-owned-target at once", () => {
    const decisions = play([
      observed(survey([waitronWith(luks(damaged(), damaged()))])),
      ramReady(2_000),
      submit("ERASE-CONFIRM", 3_000),
      online(4_000),
      clockSet(true, FLOOR, 5_000),
      released("verified", 6_000),
    ]);
    expect(last(decisions)).toMatchObject({
      action: "write-owned-target",
      diskId: INTERNAL_ID,
      message: WRITING,
      deadlineMs: null,
      state: { phase: "writing", confirmed: "typed" },
    });
  });

  it("Waitron disk, name typed, ram-ready, online, clock set, verified → write-owned-target at once", () => {
    const decisions = play([
      waitronSeen(),
      key(2_000),
      ramReady(3_000),
      submit("Bar Santet", 4_000),
      online(5_000),
      clockSet(true, FLOOR, 6_000),
      released("verified", 7_000),
    ]);
    expect(last(decisions)).toMatchObject({
      action: "write-owned-target",
      diskId: INTERNAL_ID,
      message: WRITING,
      state: { phase: "writing", confirmed: "typed" },
    });
  });
});

describe("guard 2: no final restart while the stick is in (Review Focus 4)", () => {
  const toWriting = [...TO_VERIFIED, tick(61_000)];

  it("write-finished ok with the stick in → wait, installer.remove_usb; usb-removed → boot-installed", () => {
    const decisions = play([...toWriting, writeFinished(true, 100_000), usbRemoved(110_000)]);
    expect(decisions[6]).toEqual({
      action: "wait",
      diskId: null,
      message: REMOVE_USB,
      deadlineMs: null,
      state: windowsState({
        phase: "remove-usb",
        atMs: 100_000,
        clockSet: true,
        message: REMOVE_USB,
      }),
    });
    expect(decisions[7]).toEqual({
      action: "boot-installed",
      diskId: INTERNAL_ID,
      message: STARTING_INSTALLED,
      deadlineMs: null,
      state: windowsState({
        phase: "booting",
        atMs: 110_000,
        clockSet: true,
        usbPresent: false,
        message: STARTING_INSTALLED,
      }),
    });
  });

  it("stick removed after safe-to-remove and before the write ends → write-finished ok → boot-installed at once", () => {
    const decisions = play([
      ...TO_VERIFIED,
      usbRemoved(30_000),
      tick(61_000),
      writeFinished(true, 100_000),
    ]);
    expect(decisions[5]).toMatchObject({ action: "wait", state: { phase: "erase-countdown" } });
    expect(last(decisions)).toMatchObject({
      action: "boot-installed",
      diskId: INTERNAL_ID,
      state: { phase: "booting", usbPresent: false },
    });
  });

  it("stick removed during writing, then inserted again, then write-finished ok → wait, remove_usb", () => {
    const decisions = play([
      ...toWriting,
      usbRemoved(70_000),
      usbInserted(80_000),
      writeFinished(true, 100_000),
    ]);
    expect(last(decisions)).toMatchObject({
      action: "wait",
      message: REMOVE_USB,
      state: { phase: "remove-usb", usbPresent: true },
    });
  });

  it("ticks for an hour with the stick in → only wait; a stick put back in changes nothing", () => {
    const decisions = play([
      ...toWriting,
      writeFinished(true, 100_000),
      ...hourOfTicks(100_000),
      usbInserted(3_800_000),
      key(3_800_001),
    ]);
    expect(decisions.slice(6).every((d) => d.action === "wait")).toBe(true);
    expect(last(decisions).state.phase).toBe("remove-usb");
  });

  it("a key, a line, a choice or a tick while writing → wait, and the target is not written twice", () => {
    const decisions = play([
      ...toWriting,
      key(62_000),
      submit("ERASE-CONFIRM", 63_000),
      choice("install-now", 64_000),
      tick(65_000),
    ]);
    expect(decisions.slice(6).map((d) => [d.action, d.state.phase])).toEqual([
      ["wait", "writing"],
      ["wait", "writing"],
      ["wait", "writing"],
      ["wait", "writing"],
    ]);
    expect(writes(decisions)).toHaveLength(1);
  });

  it("write-finished ok: false → refuse write-failed, then every event answers wait", () => {
    const decisions = play([
      ...toWriting,
      writeFinished(false, 100_000),
      usbRemoved(110_000),
      tick(200_000),
      choice("install-now", 200_001),
    ]);
    expect(decisions[6]).toMatchObject({
      action: "refuse",
      diskId: null,
      state: {
        phase: "refused",
        refusal: { reason: "write-failed", hardware: null, releaseVersion: null },
      },
    });
    expect(decisions.slice(7).map((d) => d.action)).toEqual(["wait", "wait", "wait"]);
  });

  it("a second write-finished after the write → refuse sequence-invalid", () => {
    const decisions = play([
      ...toWriting,
      writeFinished(true, 100_000),
      writeFinished(true, 100_001),
    ]);
    expect(last(decisions)).toMatchObject({
      action: "refuse",
      state: { refusal: { reason: "sequence-invalid" } },
    });
  });
});

describe("the public status", () => {
  const stateAfter = (events) => last(play(events)).state;

  it("a new state → observing, nothing else", () => {
    const status = installerStatus(createInstallerState(OPTIONS));
    expect(status).toEqual({
      stage: "observing",
      safeToRemove: false,
      stopReason: null,
      hardware: null,
      releaseVersion: null,
    });
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.keys(status)).toEqual([
      "stage",
      "safeToRemove",
      "stopReason",
      "hardware",
      "releaseVersion",
    ]);
  });

  it("the Windows path: not safe to remove before ram-ready, safe after it, through the write and remove-usb, not once booting", () => {
    expect(installerStatus(stateAfter([windowsSeen()])).safeToRemove).toBe(false);
    expect(installerStatus(stateAfter([windowsSeen(), ramReady(2_000)]))).toEqual({
      stage: "network",
      safeToRemove: true,
      stopReason: null,
      hardware: null,
      releaseVersion: null,
    });
    const toRemoveUsb = [...TO_VERIFIED, tick(61_000), writeFinished(true, 100_000)];
    expect(installerStatus(stateAfter(toRemoveUsb))).toMatchObject({
      stage: "remove-usb",
      safeToRemove: true,
    });
    expect(installerStatus(stateAfter([...toRemoveUsb, usbRemoved(110_000)]))).toMatchObject({
      stage: "booting",
      safeToRemove: false,
    });
  });

  it("a Waitron path before a typed confirmation → not safe to remove", () => {
    const status = installerStatus(stateAfter([waitronSeen(), ramReady(2_000), key(3_000)]));
    expect(status).toMatchObject({ stage: "reinstall-screen", safeToRemove: false });
  });

  it('refuse disk-multiple with tpm "absent" → stopReason and hardware', () => {
    const state = stateAfter([
      ramReady(0),
      observed(survey([blankDisk(), windowsDisk({ diskId: SECOND_ID })], { tpm: "absent" })),
    ]);
    expect(installerStatus(state)).toEqual({
      stage: "refused",
      safeToRemove: false,
      stopReason: "disk-multiple",
      hardware: "no-tpm",
      releaseVersion: null,
    });
  });

  it('a Waitron disk with tpm "disabled" during its 15 seconds → hardware no-tpm, no stop reason', () => {
    expect(installerStatus(stateAfter([waitronSeen(SANTET, { tpm: "disabled" })]))).toEqual({
      stage: "waitron-found",
      safeToRemove: false,
      stopReason: null,
      hardware: "no-tpm",
      releaseVersion: null,
    });
  });

  it('a refused installer-too-old "1.4.0" → releaseVersion "1.4.0"', () => {
    const state = stateAfter([...TO_DOWNLOADING, released("installer-too-old", 30_000, "1.4.0")]);
    expect(installerStatus(state)).toEqual({
      stage: "refused",
      safeToRemove: false,
      stopReason: "installer-too-old",
      hardware: null,
      releaseVersion: "1.4.0",
    });
  });

  it("never carries the venue name or the disk id, at any step of a reinstall", () => {
    const decisions = play([
      waitronSeen(),
      key(2_000),
      ramReady(3_000),
      submit("Bar Santet", 4_000),
      online(5_000),
      clockSet(true, FLOOR, 6_000),
      released("verified", 7_000),
      writeFinished(true, 100_000),
    ]);
    for (const decision of decisions) {
      const text = JSON.stringify(installerStatus(decision.state));
      expect(text).not.toContain("Bar Santet");
      expect(text).not.toContain(INTERNAL_ID);
    }
  });

  it.each([
    ["a hand-made state", () => initialState()],
    ["null", () => null],
    ["a frozen copy of a real state", () => Object.freeze({ ...createInstallerState(OPTIONS) })],
  ])("%s → throws installer.state_invalid", (_name, make) => {
    expect(thrown(() => installerStatus(make()))).toEqual({
      message: "installer.state_invalid",
      code: "installer.state_invalid",
      reason: "state-invalid",
    });
  });
});

const EXTERNAL_ID = "usb-WD_Elements_2620_575843324433-0:0";
const externalDisk = () => blankDisk({ diskId: EXTERNAL_ID, attachment: "external" });
const sweepSeen = (disks, venueTag = null, overrides = {}, atMs = AT) =>
  observed(survey([...disks, externalDisk()], overrides), venueTag, atMs);
const COMPOSED = Object.freeze({ name: "Bar \u00C0ngels", live: true });
const UNREADABLE = Object.freeze({ name: "", live: false });
const ERASE = OPTIONS.eraseWord;
const CANARIES = ["CANARY-7f3a", "Bar Santet extra", "CANARY-scan-8412345678905"];
const ACTIONS = [
  "wait",
  "find-network",
  "set-clock",
  "download",
  "confirm-erase",
  "write-owned-target",
  "boot-installed",
  "power-off",
  "refuse",
];
const FINAL_ACTIONS = ["boot-installed", "power-off", "refuse"];
const REASONS = [
  "observation-invalid",
  "disk-none",
  "disk-multiple",
  "no-tpm",
  "secure-boot-off",
  "usb-removed-early",
  "sequence-invalid",
  "release-signature",
  "release-checksum",
  "release-too-large",
  "installer-too-old",
  "write-failed",
];

/** From the network to a finished write with the stick still in, then out. @param {number} from */
const toBooted = (from) => [
  online(from),
  clockSet(true, FLOOR, from + 1_000),
  released("verified", from + 2_000),
  tick(from + 61_999),
  tick(from + 62_000),
  writeFinished(true, from + 300_000),
  usbRemoved(from + 301_000),
];
const unattended = (disks, overrides) => [
  sweepSeen(disks, null, overrides),
  ramReady(2_000),
  ...toBooted(3_000),
];
const verified = (seen = sweepSeen([windowsDisk()], null, {}, 0)) => [
  seen,
  ramReady(0),
  online(0),
  clockSet(true, FLOOR, 0),
  released("verified", 1_000),
];

/**
 * Each run is a complete list of events. `unattended` marks runs no one confirmed by typing;
 * `guard3` marks runs on a Waitron disk with no matching submit.
 */
const RUNS = [
  {
    name: "blank, unattended",
    events: unattended([blankDisk()]),
    unattended: true,
    ends: "boot-installed",
  },
  {
    name: "Windows, unattended",
    events: unattended([windowsDisk()]),
    unattended: true,
    ends: "boot-installed",
  },
  {
    name: "BitLocker, unattended",
    events: unattended([bitlockerDisk()]),
    unattended: true,
    ends: "boot-installed",
  },
  {
    name: "an unknown disk, a wrong word, then the erase word",
    ends: "boot-installed",
    events: [
      sweepSeen([foreignLuksDisk()]),
      ramReady(2_000),
      submit("CANARY-7f3a", 3_000),
      submit(ERASE, 4_000),
      ...toBooted(5_000),
    ],
  },
  {
    name: "a Waitron reinstall by the name, typed decomposed",
    ends: "boot-installed",
    events: [
      sweepSeen([completeWaitronDisk()], COMPOSED),
      key(2_000),
      ramReady(3_000),
      submit("Bar Santet extra", 4_000),
      submit("Bar A\u0300ngels", 5_000),
      ...toBooted(6_000),
    ],
  },
  {
    name: "a Waitron reinstall by the erase word, the tag unreadable",
    ends: "boot-installed",
    events: [
      sweepSeen([completeWaitronDisk()], UNREADABLE),
      key(2_000),
      ramReady(3_000),
      submit("CANARY-7f3a", 4_000),
      submit(ERASE, 5_000),
      ...toBooted(6_000),
    ],
  },
  {
    name: "a Waitron disk left alone for 15 seconds",
    ends: "boot-installed",
    events: [
      sweepSeen([completeWaitronDisk()], SANTET),
      ramReady(2_000),
      tick(16_000),
      tick(99_000),
    ],
    guard3: true,
  },
  {
    name: "a Waitron disk, a scanner's line, and two minutes later the installed box",
    ends: "boot-installed",
    events: [
      sweepSeen([completeWaitronDisk()], SANTET),
      ramReady(2_000),
      key(5_000),
      submit("CANARY-scan-8412345678905", 6_000),
      tick(125_999),
      tick(126_000),
      online(127_000),
    ],
    guard3: true,
  },
  {
    name: "a Waitron box with the TPM off, left alone",
    ends: "boot-installed",
    events: [
      sweepSeen([completeWaitronDisk()], SANTET, { tpm: "disabled" }),
      ramReady(2_000),
      tick(16_000),
    ],
    guard3: true,
  },
  {
    name: "a Waitron box with the TPM off, the name typed → refuse no-tpm",
    ends: "refuse:no-tpm",
    events: [
      sweepSeen([completeWaitronDisk()], SANTET, { tpm: "disabled" }),
      key(2_000),
      ramReady(3_000),
      submit("Bar Santet", 4_000),
      online(5_000),
      released("verified", 6_000),
      tick(70_000),
    ],
  },
  {
    name: "refuse observation-invalid",
    ends: "refuse:observation-invalid",
    events: [sweepSeen([blankDisk({ diskId: "../sda" })]), ramReady(2_000), tick(70_000)],
  },
  { name: "refuse disk-none", events: [sweepSeen([]), tick(70_000)], ends: "refuse:disk-none" },
  {
    name: "refuse disk-multiple",
    ends: "refuse:disk-multiple",
    events: [sweepSeen([blankDisk(), windowsDisk({ diskId: SECOND_ID })]), tick(70_000)],
  },
  {
    name: "refuse secure-boot-off",
    ends: "refuse:secure-boot-off",
    events: [sweepSeen([windowsDisk()], null, { secureBoot: "setup-mode" }), tick(70_000)],
  },
  {
    name: "refuse usb-removed-early",
    ends: "refuse:usb-removed-early",
    events: [sweepSeen([windowsDisk()]), usbRemoved(2_000), ramReady(3_000), online(4_000)],
  },
  {
    name: "refuse sequence-invalid (a verified release while finding the network)",
    ends: "refuse:sequence-invalid",
    events: [
      sweepSeen([windowsDisk()]),
      ramReady(2_000),
      released("verified", 3_000),
      tick(70_000),
    ],
  },
  {
    name: "refuse write-failed",
    ends: "refuse:write-failed",
    events: [...verified(), tick(61_000), writeFinished(false, 90_000), usbRemoved(91_000)],
    unattended: true,
  },
  ...[
    ["signature", "release-signature"],
    ["checksum", "release-checksum"],
    ["too-large", "release-too-large"],
  ].map(([outcome, reason]) => ({
    name: `a run interrupted by release-checked ${outcome}`,
    events: [
      sweepSeen([windowsDisk()]),
      ramReady(2_000),
      online(3_000),
      clockSet(true, FLOOR, 4_000),
      released(outcome, 5_000),
      tick(65_000),
      ...toBooted(66_000),
    ],
    unattended: true,
    ends: `refuse:${reason}`,
  })),
  ...["unavailable", "truncated"].map((outcome) => ({
    name: `a run interrupted by release-checked ${outcome}, then a retry that verifies`,
    events: [
      sweepSeen([windowsDisk()]),
      ramReady(2_000),
      online(3_000),
      clockSet(true, FLOOR, 4_000),
      released(outcome, 5_000),
      tick(65_000),
      online(66_000),
      released("verified", 68_000),
      tick(127_999),
      tick(128_000),
      writeFinished(true, 300_000),
      usbRemoved(301_000),
    ],
    unattended: true,
    ends: "boot-installed",
  })),
  {
    name: "a run interrupted by release-checked installer-too-old",
    ends: "refuse:installer-too-old",
    events: [
      sweepSeen([windowsDisk()]),
      ramReady(2_000),
      online(3_000),
      clockSet(true, FLOOR, 4_000),
      released("installer-too-old", 5_000, "1.4.0"),
      tick(70_000),
    ],
    unattended: true,
  },
  {
    name: "a clock failure, then success",
    ends: "boot-installed",
    events: [
      sweepSeen([windowsDisk()]),
      ramReady(2_000),
      online(3_000),
      clockSet(false, null, 4_000),
      tick(64_000),
      ...toBooted(65_000),
    ],
    unattended: true,
  },
  {
    name: "an erase stopped, then powered off",
    ends: "power-off",
    events: [...verified(), key(30_000), choice("power-off", 40_000), tick(200_000)],
    unattended: true,
  },
  {
    name: "an erase stopped, then install-now before the 60 seconds end",
    ends: "write-owned-target",
    events: [
      ...verified(),
      key(30_000),
      choice("install-now", 31_000),
      writeFinished(true, 90_000),
    ],
    unattended: true,
  },
  {
    name: "a second verification during the 60 seconds",
    ends: "refuse:sequence-invalid",
    events: [...verified(), released("verified", 2_000), tick(61_000), tick(62_000)],
    unattended: true,
  },
  {
    name: "a key at 61500 with no tick at 61000, then install-now",
    ends: "write-owned-target",
    events: [...verified(), key(61_500), tick(61_501), choice("install-now", 70_000)],
    unattended: true,
  },
  {
    name: "install-now during the 60 seconds with no key, then the deadline",
    ends: "write-owned-target",
    events: [...verified(), choice("install-now", 30_000), tick(61_000)],
    unattended: true,
  },
  {
    name: "a typed line during the 60 seconds stops the erase",
    ends: "confirm-erase",
    events: [...verified(), submit("CANARY-7f3a", 30_000), tick(61_000)],
    unattended: true,
  },
];

/** @param {unknown} value @returns {boolean} */
const deepFrozen = (value) =>
  value === null ||
  typeof value !== "object" ||
  (Object.isFrozen(value) && Object.values(value).every(deepFrozen));

/** @param {unknown} value @param {string} word @param {string} [path] @returns {string[]} */
const pathsHolding = (value, word, path = "") => {
  if (value === word) return [path];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) =>
    pathsHolding(v, word, path === "" ? k : `${path}.${k}`),
  );
};

/** @param {{events: any[]}} run */
const sweep = (run) => {
  const decisions = play(run.events);
  const tag = run.events[0].venueTag?.name.normalize("NFC") ?? null;
  return { decisions, tag };
};
const laterTexts = (decisions, from) =>
  decisions
    .slice(from)
    .flatMap((d) => [
      JSON.stringify(d),
      JSON.stringify(installerStatus(d.state)),
      inspect(d.state, { depth: 10, showHidden: true }),
    ]);

describe("whole runs", () => {
  it("the table reaches every action and every refusal reason", () => {
    const all = RUNS.flatMap((run) => sweep(run).decisions);
    expect(new Set(all.map((d) => d.action))).toEqual(new Set(ACTIONS));
    expect(
      new Set(all.flatMap((d) => (d.action === "refuse" ? [d.state.refusal.reason] : []))),
    ).toEqual(new Set(REASONS));
  });

  for (const run of RUNS)
    describe(run.name, () => {
      const { decisions, tag } = sweep(run);

      it(`ends with ${run.ends}`, () => {
        const ending = decisions.findLast((d) => d.action !== "wait");
        expect(ending).toBeDefined();
        expect(
          ending.action === "refuse" ? `refuse:${ending.state.refusal.reason}` : ending.action,
        ).toBe(run.ends);
      });

      it("answers only with the nine actions", () => {
        for (const decision of decisions) expect(ACTIONS).toContain(decision.action);
      });

      it("names only the frozen target, and never the stick, the external disk or a second disk", () => {
        for (const decision of decisions) {
          if (decision.diskId !== null) expect(decision.diskId).toBe(INTERNAL_ID);
          const text = JSON.stringify([
            decision.diskId,
            decision.message,
            installerStatus(decision.state),
          ]);
          for (const id of [STICK_ID, EXTERNAL_ID, SECOND_ID]) expect(text).not.toContain(id);
        }
      });

      it("writes at most once, and only after a verified release", () => {
        const at = decisions.flatMap((d, i) => (d.action === "write-owned-target" ? [i] : []));
        expect(at.length).toBeLessThanOrEqual(1);
        for (const i of at)
          expect(
            run.events
              .slice(0, i + 1)
              .some((e) => e.kind === "release-checked" && e.outcome === "verified"),
          ).toBe(true);
      });

      it("ends at most once, and answers only wait after it", () => {
        const end = decisions.findIndex((d) => FINAL_ACTIONS.includes(d.action));
        if (end === -1) return;
        expect(decisions.slice(end + 1).map((d) => d.action)).toEqual(
          decisions.slice(end + 1).map(() => "wait"),
        );
      });

      it("keeps no typed text", () => {
        run.events.forEach((event, i) => {
          if (event.kind !== "submit" || event.text === ERASE) return;
          const texts = laterTexts(decisions, i);
          if (event.text.normalize("NFC") === tag) {
            if (event.text !== tag) for (const text of texts) expect(text).not.toContain("A\u0300");
            return;
          }
          expect(CANARIES).toContain(event.text);
          for (const text of texts) expect(text).not.toContain(event.text);
        });
        const states = [createInstallerState(OPTIONS), ...decisions.map((d) => d.state)];
        for (const state of states) expect(pathsHolding(state, ERASE)).toEqual(["eraseWord"]);
        for (const decision of decisions)
          expect(pathsHolding(decision, ERASE)).toEqual(["state.eraseWord"]);
      });

      it("freezes every state, decision and status", () => {
        for (const decision of decisions) {
          expect(deepFrozen(decision)).toBe(true);
          expect(deepFrozen(installerStatus(decision.state))).toBe(true);
        }
      });
    });

  for (const run of RUNS.filter((r) => r.guard3))
    describe(`${run.name}, nothing typed`, () => {
      it("is a Waitron disk, and nothing is written or fetched", () => {
        const { decisions } = sweep(run);
        expect(decisions[0].state.target.kind).toBe("waitron");
        noWriteNorNetwork(decisions);
      });
    });

  for (const run of RUNS.filter((r) => r.unattended))
    describe(`${run.name}, unattended`, () => {
      it("holds the 60 seconds unless a person chose install-now", () => {
        const { decisions } = sweep(run);
        decisions.forEach((decision, i) => {
          if (decision.action !== "write-owned-target") return;
          const event = run.events[i];
          const before = run.events.slice(0, i + 1);
          const latest = before.findLastIndex(
            (e) => e.kind === "release-checked" && e.outcome === "verified",
          );
          expect(latest).toBeGreaterThanOrEqual(0);
          const stopped = before.slice(latest).some((e) => e.kind === "key" || e.kind === "submit");
          if (event.kind === "choice" && event.choice === "install-now" && stopped) return;
          expect(event.atMs).toBeGreaterThanOrEqual(
            run.events[latest].atMs + INSTALLER_TIMINGS_MS.eraseWait,
          );
        });
      });
    });
});
