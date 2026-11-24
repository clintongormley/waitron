import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend, IdentityChangeOutcome } from "@waitron/fiscal";
import { AppError, nodeId } from "@waitron/shared";
import {
  deleteLeftoverIdentityChangeNote,
  identityChangeOpening,
} from "./identity-change-opening.js";
import { startClockState } from "./start-clock-check.js";

const NODE = nodeId("33333333-3333-4333-8333-333333333333");
const NOTE = {
  release: "1.4.0",
  producerTaxId: "11111111H",
  fromProducerTaxId: "00000000T",
};
const HEADS = { [NODE]: 7 };
type Open = NonNullable<FiscalBackend["openIdentityChange"]>;

const refusedFor = (reason: string) => new AppError("sif.identity_change_waiting", { reason });

function opening(
  open: (() => Promise<IdentityChangeOutcome>) | null,
  options: { held?: boolean; deleteNote?: () => Promise<void> } = {},
) {
  const onConfirmed = vi.fn();
  const state = startClockState(onConfirmed);
  state.holdForIdentityChange();
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
    expect([asked, note, mayOpen]).toEqual([NODE, NOTE, o.mayOpen]);
    expect(clock).toEqual({ kind: "time-service", read: o.synchronised });
  });

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
    ["the seat does not find the change named", async () => "not-named" as const],
    ["the seat opens none", null],
  ])("never ends the wait when %s", async (_label, open) => {
    const o = opening(open);
    await o.attemptIdentityChange();
    expect(o.state).toMatchObject({ status: "waiting", heldConfirmation: { heads: HEADS } });
    expect(o.latestRefusal()).toEqual({ kind: "blocked", reason: "not_named" });
    expect(o.deleteNote).not.toHaveBeenCalled();
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
  function leftover(open: Open | null, deleteNote: () => Promise<void> = async () => {}) {
    const deps = {
      backend: open === null ? {} : { openIdentityChange: open },
      nodeId: NODE,
      note: NOTE,
      deleteNote: vi.fn(deleteNote),
      log: vi.fn(),
    };
    return { ...deps, run: () => deleteLeftoverIdentityChangeNote(deps) };
  }

  it("deletes a note that names the running change when nothing is left to open", async () => {
    const l = leftover(async () => "nothing-to-open");
    await l.run();
    expect(l.deleteNote).toHaveBeenCalledOnce();
    expect(l.log).toHaveBeenCalledWith("info", "identity_change.leftover_note_deleted", {
      release: "1.4.0",
    });
  });

  it("asks with a clock that vouches for nothing and a mayOpen that refuses", async () => {
    let answers: unknown;
    const l = leftover(async (_node, _note, clock, mayOpen) => {
      answers = [
        clock.kind === "time-service" && (await clock.read()),
        await mayOpen(undefined as never),
      ];
      return "nothing-to-open";
    });
    await l.run();
    expect(answers).toEqual([false, false]);
  });

  it.each([
    ["names another change", async () => "not-named" as const],
    ["is for a seat that opens none", null],
  ])("leaves a note that %s", async (_label, open) => {
    const l = leftover(open);
    await l.run();
    expect(l.deleteNote).not.toHaveBeenCalled();
  });

  it("logs and throws nothing when the seat refuses, or the note cannot be deleted", async () => {
    const refused = leftover(() => Promise.reject(refusedFor("second_clock_missing")));
    await refused.run();
    expect(refused.deleteNote).not.toHaveBeenCalled();
    expect(refused.log).toHaveBeenCalledWith("warn", "identity_change.note_not_deleted", {
      errorCode: "sif.identity_change_waiting",
    });

    const stuck = leftover(
      async () => "nothing-to-open",
      () => Promise.reject(Object.assign(new Error("folder"), { code: "EISDIR" })),
    );
    await stuck.run();
    expect(stuck.log).toHaveBeenCalledExactlyOnceWith("warn", "identity_change.note_not_deleted", {
      errorCode: "EISDIR",
    });
  });
});
