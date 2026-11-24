import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend, IdentityChangeOutcome } from "@waitron/fiscal";
import { AppError, nodeId } from "@waitron/shared";
import {
  deleteLeftoverIdentityChangeNote,
  identityChangeOpening,
} from "./identity-change-opening.js";
import { startClockState } from "./start-clock-check.js";
import { standingHold } from "./testing/standing-hold.js";

const NODE = nodeId("33333333-3333-4333-8333-333333333333");
const NOTE = {
  release: "1.4.0",
  producerTaxId: "11111111H",
  fromProducerTaxId: "00000000T",
};
const HEADS = { [NODE]: 7 };
const TX = { fake: "tx" } as unknown as Transaction;
type Open = NonNullable<FiscalBackend["openIdentityChange"]>;

const refusedFor = (reason: string) => new AppError("sif.identity_change_waiting", { reason });

function opening(
  open: (() => Promise<IdentityChangeOutcome>) | null,
  options: { held?: boolean; deleteNote?: () => Promise<void> } = {},
) {
  const onConfirmed = vi.fn();
  const state = startClockState(onConfirmed);
  state.holdForIdentityChange(standingHold());
  if (options.held !== false) state.confirm("by_internet", HEADS);
  const openIdentityChange = vi.fn<Open>(async () => open!());
  const deleteNote = vi.fn(options.deleteNote ?? (async () => {}));
  const log = vi.fn();
  const mayOpen = vi.fn<(tx: Transaction) => Promise<boolean>>(async () => true);
  const synchronised = vi.fn(async () => true);
  const made = identityChangeOpening({
    backend: open === null ? {} : { openIdentityChange },
    nodeId: NODE,
    note: NOTE,
    state,
    synchronised,
    mayOpen,
    deleteNote,
    log,
  });
  return {
    ...made,
    state,
    onConfirmed,
    openIdentityChange,
    deleteNote,
    log,
    mayOpen,
    synchronised,
  };
}

describe("attemptIdentityChange", () => {
  it("opens nothing while no confirmation is held", async () => {
    const o = opening(async () => "opened", { held: false });
    await o.attemptIdentityChange();
    expect(o.openIdentityChange).not.toHaveBeenCalled();
    expect(o.state.status).toBe("waiting");

    o.state.confirm("by_internet", HEADS);
    await o.attemptIdentityChange();
    expect(o.openIdentityChange).toHaveBeenCalledOnce();
  });

  it("asks the seat for this node and note, on the time service read again and the caller's mayOpen", async () => {
    const o = opening(async () => "opened");
    await o.attemptIdentityChange();
    const [asked, note, clock, mayOpen] = o.openIdentityChange.mock.calls[0]!;
    expect([asked, note]).toEqual([NODE, NOTE]);
    for (const answer of [true, false]) {
      o.mayOpen.mockResolvedValueOnce(answer);
      expect(await mayOpen(TX)).toBe(answer);
    }
    expect(o.mayOpen.mock.calls).toEqual([[TX], [TX]]);
    expect(clock).toEqual({ kind: "time-service", read: o.synchronised });
  });

  it("gives the seat a person's confirmation as its second clock, standing while it is held, and never asks the time service", async () => {
    const o = opening(async () => "opened", { held: false });
    o.state.confirm("by_person", HEADS);
    let stood: boolean | undefined;
    o.openIdentityChange.mockImplementationOnce(async (_node, _note, clock) => {
      stood = clock.kind === "confirmed-start" && clock.standing();
      return "opened";
    });
    await o.attemptIdentityChange();
    const clock = o.openIdentityChange.mock.calls[0]![2];
    expect(clock).toEqual({ kind: "confirmed-start", standing: expect.any(Function) });
    expect(stood).toBe(true);
    expect(clock.kind === "confirmed-start" && clock.standing()).toBe(false);
    expect(o.synchronised).not.toHaveBeenCalled();
    expect(o.state).toMatchObject({ status: "by_person", mark: HEADS, heldConfirmation: null });
    expect(o.deleteNote).toHaveBeenCalledOnce();
  });

  it.each(["confirmation_stale", "clock_unconfirmed", "clock_corrected"])(
    "drops a person's confirmation refused %s, and opens at the next one",
    async (reason) => {
      const o = opening(async () => "opened", { held: false });
      o.state.confirm("by_person", HEADS);
      o.openIdentityChange.mockRejectedValueOnce(refusedFor(reason));
      await o.attemptIdentityChange();
      expect(o.state).toMatchObject({ status: "waiting", heldConfirmation: null });
      await o.attemptIdentityChange();
      expect(o.openIdentityChange).toHaveBeenCalledOnce();

      o.state.confirm("by_person", HEADS);
      await o.attemptIdentityChange();
      expect(o.state.status).toBe("by_person");
    },
  );

  it.each(["opened", "nothing-to-open"] as const)(
    "deletes the note and then ends the wait when the seat answers %s",
    async (outcome) => {
      let statusAtDelete: string | undefined;
      const o = opening(async () => outcome, {
        deleteNote: async () => {
          statusAtDelete = o.state.status;
        },
      });
      await o.attemptIdentityChange();
      expect(o.deleteNote).toHaveBeenCalledOnce();
      expect(statusAtDelete).toBe("waiting");
      expect(o.state).toMatchObject({ status: "by_internet", mark: HEADS });
      expect(o.onConfirmed).toHaveBeenCalledOnce();
      expect(o.latestRefusal()).toBeNull();
      expect(o.log).toHaveBeenCalledWith("info", "identity_change.done", {
        outcome,
        release: "1.4.0",
      });
    },
  );

  it("ends the wait when the note cannot be deleted, and logs that", async () => {
    const o = opening(async () => "opened", {
      deleteNote: async () => {
        throw Object.assign(new Error("folder"), { code: "EISDIR" });
      },
    });
    await o.attemptIdentityChange();
    expect(o.state.status).toBe("by_internet");
    expect(o.latestRefusal()).toBeNull();
    expect(o.log).toHaveBeenCalledWith("warn", "identity_change.note_not_deleted", {
      errorCode: "EISDIR",
    });
  });

  it("waits on, with the hold off, when the held confirmation was dropped while it opened", async () => {
    const o = opening(async () => {
      o.state.backToWaiting("clock_jumped");
      return "opened";
    });
    await o.attemptIdentityChange();
    expect(o.state).toMatchObject({ status: "waiting", cause: "clock_jumped" });
    expect(o.deleteNote).toHaveBeenCalledOnce();
    expect(o.onConfirmed).not.toHaveBeenCalled();
  });

  it.each([
    ["clock_unconfirmed", "clock"],
    ["second_clock_missing", "clock"],
    ["clock_disagreement", "clock"],
    ["confirmation_stale", "clock"],
    ["clock_corrected", "clock"],
    ["head_moved", "retry"],
    ["minute_in_use", "retry"],
    ["not_sole_primary", "blocked"],
    ["history_invalid", "blocked"],
    ["a_reason_added_later", "blocked"],
  ] as const)("keeps waiting when refused for %s, kept as %s", async (reason, kind) => {
    const o = opening(() => Promise.reject(refusedFor(reason)));
    await o.attemptIdentityChange();
    expect(o.state).toMatchObject({ status: "waiting", cause: "identity_change" });
    // Only a refusal for the clock takes the confirmation back.
    expect(o.state.heldConfirmation === null).toBe(kind === "clock");
    expect(o.latestRefusal()).toEqual({ kind, reason });
    expect(o.deleteNote).not.toHaveBeenCalled();
    expect(o.onConfirmed).not.toHaveBeenCalled();
    expect(o.log).toHaveBeenCalledWith("warn", "identity_change.refused", { kind, reason });
  });

  it.each([
    ["another refusal", new AppError("sif.producer_changed", {}), "sif.producer_changed"],
    ["an error with no code", new Error("broken"), "unknown"],
  ])("keeps %s as blocked, with the confirmation held", async (_label, error, reason) => {
    const o = opening(() => Promise.reject(error));
    await o.attemptIdentityChange();
    expect(o.state).toMatchObject({ status: "waiting", heldConfirmation: { heads: HEADS } });
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason });
  });

  it.each([
    ["an error with no code", new TypeError("text of a record"), "unknown", "TypeError", null],
    [
      "a database error wrapped by the query layer",
      new Error("insert into sales", {
        cause: Object.assign(new Error("text of a record"), { code: "ERR_SQLITE_ERROR" }),
      }),
      "unknown",
      "Error",
      "ERR_SQLITE_ERROR",
    ],
    ["a file error", Object.assign(new Error("/state/x"), { code: "EIO" }), "EIO", "Error", "EIO"],
    [
      "another refusal",
      new AppError("sif.producer_changed", {}),
      "sif.producer_changed",
      "AppError",
      null,
    ],
    ["a thrown text", "text of a record", "unknown", "string", null],
  ])(
    "logs %s by its class and code, and none of its text",
    async (_label, error, reason, errorClass, errno) => {
      const o = opening(() => Promise.reject(error));
      await o.attemptIdentityChange();
      expect(o.log).toHaveBeenCalledExactlyOnceWith("warn", "identity_change.refused", {
        kind: "blocked",
        reason,
        errorClass,
        errno,
      });
      expect(o.latestRefusal()).toEqual({ kind: "blocked", reason });
    },
  );

  it.each([
    ["the seat does not find the change named", async () => "not-named" as const],
    ["the seat opens none", null],
  ])("never ends the wait when %s", async (_label, open) => {
    const o = opening(open);
    await o.attemptIdentityChange();
    expect(o.state).toMatchObject({ status: "waiting", heldConfirmation: { heads: HEADS } });
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason: "not_named" });
    expect(o.deleteNote).not.toHaveBeenCalled();
  });

  it.each([
    ["the opening's own refusal", () => refusedFor("not_sole_primary")],
    ["an unexpected error", () => new Error("broken")],
  ])("logs %s once while it repeats", async (_label, error) => {
    const o = opening(() => Promise.reject(error()));
    for (let look = 0; look < 3; look++) await o.attemptIdentityChange();
    expect(o.openIdentityChange).toHaveBeenCalledTimes(3);
    expect(o.log).toHaveBeenCalledOnce();
  });

  it("logs a refusal for the clock once, though the confirmation is dropped and held again between attempts", async () => {
    const o = opening(() => Promise.reject(refusedFor("second_clock_missing")));
    for (let look = 0; look < 3; look++) {
      await o.attemptIdentityChange();
      o.state.confirm("by_internet", HEADS);
    }
    expect(o.openIdentityChange).toHaveBeenCalledTimes(3);
    expect(o.log).toHaveBeenCalledOnce();
  });

  it("logs each change of refusal, and one seen before that comes back", async () => {
    const errors: unknown[] = [
      refusedFor("minute_in_use"),
      refusedFor("history_invalid"),
      refusedFor("history_invalid"),
      new TypeError("broken"),
      new RangeError("broken"),
      refusedFor("minute_in_use"),
    ];
    const o = opening(() => Promise.reject(errors.shift()));
    for (let look = 0; look < 6; look++) await o.attemptIdentityChange();
    expect(o.log.mock.calls).toEqual(
      [
        { kind: "retry", reason: "minute_in_use" },
        { kind: "blocked", reason: "history_invalid" },
        { kind: "blocked", reason: "unknown", errorClass: "TypeError", errno: null },
        { kind: "blocked", reason: "unknown", errorClass: "RangeError", errno: null },
        { kind: "retry", reason: "minute_in_use" },
      ].map((fields) => ["warn", "identity_change.refused", fields]),
    );
  });

  /** The seat's transaction check, after `reads` have run. */
  function seatAsking(reads: () => void = () => {}): Open {
    return async (_node, _note, _clock, mayOpen) => {
      reads();
      if (!(await mayOpen(TX))) throw refusedFor("not_sole_primary");
      return "opened";
    };
  }

  it.each([
    ["asked with no stop", undefined],
    ["not stopped", () => false],
  ])("opens as the caller's mayOpen allows when %s", async (_label, stopped) => {
    const o = opening(async () => "opened");
    o.openIdentityChange.mockImplementation(seatAsking());
    o.mayOpen.mockResolvedValueOnce(false);
    await o.attemptIdentityChange(stopped);
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason: "not_sole_primary" });
    expect(o.log).toHaveBeenCalledExactlyOnceWith("warn", "identity_change.refused", {
      kind: "blocked",
      reason: "not_sole_primary",
    });
    expect(o.state.status).toBe("waiting");

    await o.attemptIdentityChange(stopped);
    expect(o.mayOpen.mock.calls).toEqual([[TX], [TX]]);
    expect(o.state.status).toBe("by_internet");
  });

  it("opens nothing when stopped while the seat reads, and refuses, logs, deletes and drops nothing", async () => {
    const o = opening(async () => "opened");
    let stopped = false;
    o.openIdentityChange.mockImplementation(
      seatAsking(() => {
        stopped = true;
      }),
    );
    await o.attemptIdentityChange(() => stopped);
    expect(o.openIdentityChange).toHaveBeenCalledOnce();
    expect(o.mayOpen).not.toHaveBeenCalled();
    expect(o.state).toMatchObject({
      status: "waiting",
      cause: "identity_change",
      heldConfirmation: { heads: HEADS },
    });
    expect(o.latestRefusal()).toBeNull();
    expect(o.log).not.toHaveBeenCalled();
    expect(o.deleteNote).not.toHaveBeenCalled();
    expect(o.onConfirmed).not.toHaveBeenCalled();
  });

  it("keeps an earlier refusal when a later attempt is stopped", async () => {
    const o = opening(async () => "opened");
    o.openIdentityChange.mockRejectedValueOnce(refusedFor("history_invalid"));
    await o.attemptIdentityChange(() => false);
    o.openIdentityChange.mockImplementation(seatAsking());
    await o.attemptIdentityChange(() => true);
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason: "history_invalid" });
    expect(o.log).toHaveBeenCalledOnce();
  });

  it("keeps and logs a refusal the seat makes before asking, though stopped by then", async () => {
    const o = opening(() => Promise.reject(refusedFor("history_invalid")));
    await o.attemptIdentityChange(() => true);
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason: "history_invalid" });
    expect(o.log).toHaveBeenCalledExactlyOnceWith("warn", "identity_change.refused", {
      kind: "blocked",
      reason: "history_invalid",
    });
  });

  it("forgets a refusal once a later attempt opens", async () => {
    let refuse = true;
    const o = opening(async () => {
      if (refuse) throw refusedFor("minute_in_use");
      return "opened";
    });
    await o.attemptIdentityChange();
    expect(o.latestRefusal()).toEqual({ kind: "retry", reason: "minute_in_use" });
    refuse = false;
    await o.attemptIdentityChange();
    expect(o.state.status).toBe("by_internet");
    expect(o.latestRefusal()).toBeNull();
  });
});

describe("deleteLeftoverIdentityChangeNote", () => {
  it("deletes the note and logs it", async () => {
    const deleteNote = vi.fn(async () => {});
    const log = vi.fn();
    await deleteLeftoverIdentityChangeNote({ note: NOTE, deleteNote, log });
    expect(deleteNote).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledExactlyOnceWith("info", "identity_change.leftover_note_deleted", {
      release: "1.4.0",
    });
  });

  it("logs and throws nothing when the note cannot be deleted", async () => {
    const log = vi.fn();
    await deleteLeftoverIdentityChangeNote({
      note: NOTE,
      deleteNote: () => Promise.reject(Object.assign(new Error("folder"), { code: "EISDIR" })),
      log,
    });
    expect(log).toHaveBeenCalledExactlyOnceWith("warn", "identity_change.note_not_deleted", {
      errorCode: "EISDIR",
    });
  });
});
