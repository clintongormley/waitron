import { afterEach, expect, it } from "vitest";
import * as core from "./index.js";
import type {
  ConfirmLeave,
  DraftOwner,
  LeaveCoordinator,
  LeaveDecision,
} from "./unsaved-changes.js";

const coordinators: LeaveCoordinator[] = [];
afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
});

function fixture(decision: LeaveDecision = "keep") {
  const target = new EventTarget();
  const questions: { reason: string; dirtyScopes: readonly object[]; signal: AbortSignal }[] = [];
  let answer: ((decision: LeaveDecision) => void) | undefined;
  let deferred = false;
  const confirm: ConfirmLeave = (question, signal) => {
    questions.push({ ...question, signal });
    return deferred
      ? new Promise<LeaveDecision>((resolve) => (answer = resolve))
      : Promise.resolve(decision);
  };
  const coordinator = core.createLeaveCoordinator(confirm, target as Window);
  coordinators.push(coordinator);
  let proceeds = 0;
  const request = (scopes: readonly object[], reason: "cancel" | "navigation" = "cancel") =>
    coordinator.request({
      scopes,
      reason,
      proceed: () => {
        proceeds++;
      },
    });
  return {
    coordinator,
    target,
    questions,
    request,
    get proceeds() {
      return proceeds;
    },
    defer() {
      deferred = true;
    },
    answer(value: LeaveDecision) {
      answer!(value);
    },
  };
}

function draft<T>(coordinator: LeaveCoordinator, initial: T, options?: Partial<DraftOwner<T>>) {
  let value = initial;
  const restored: T[] = [];
  const id = {};
  const scope = coordinator.register<T>({
    id,
    current: () => value,
    snapshot: (input) => structuredClone(input),
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    restore: (input) => {
      value = input;
      restored.push(input);
    },
    ...options,
  });
  return {
    id,
    scope,
    restored,
    get value() {
      return value;
    },
    set(input: T) {
      value = input;
      scope.changed();
    },
  };
}

function unload(target: EventTarget) {
  const event = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(event, "returnValue", { value: "", writable: true });
  target.dispatchEvent(event);
  return event as BeforeUnloadEvent;
}

it("exposes the coordinator through the browser barrel", () => {
  expect(core).toHaveProperty("createLeaveCoordinator", expect.any(Function));
});

it("runs a clean continuation once without asking or resetting", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  expect(await f.request([d.id])).toBe("proceeded");
  expect(f.proceeds).toBe(1);
  expect(f.questions).toEqual([]);
  expect(d.restored).toEqual([]);
});

it("keeps an edited draft and refuses the leave", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("edited");
  expect(await f.request([d.id], "navigation")).toBe("kept");
  expect(f.proceeds).toBe(0);
  expect(d.value).toBe("edited");
  expect(d.restored).toEqual([]);
  expect(f.questions.map(({ reason, dirtyScopes }) => ({ reason, dirtyScopes }))).toEqual([
    { reason: "navigation", dirtyScopes: [d.id] },
  ]);
});

it("a revert removes both the confirmation and unload protection", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  expect(unload(f.target).defaultPrevented).toBe(false);
  d.set("edited");
  expect(f.coordinator.isDirty()).toBe(true);
  const event = unload(f.target);
  expect(event.defaultPrevented).toBe(true);
  expect(event.returnValue).not.toBe("");
  d.set("initial");
  expect(f.coordinator.isDirty()).toBe(false);
  expect(unload(f.target).defaultPrevented).toBe(false);
  expect(await f.request([d.id])).toBe("proceeded");
  expect(f.questions).toEqual([]);
});

it("discards only the affected dirty drafts once", async () => {
  const f = fixture("discard");
  const d = draft(f.coordinator, { name: "initial", rows: [1, 2] });
  const other = draft(f.coordinator, "other");
  d.set({ name: "edited", rows: [2, 1] });
  other.set("other edit");
  expect(await f.request([d.id, d.id])).toBe("proceeded");
  expect(f.proceeds).toBe(1);
  expect(d.value).toEqual({ name: "initial", rows: [1, 2] });
  expect(d.restored).toEqual([{ name: "initial", rows: [1, 2] }]);
  expect(other.value).toBe("other edit");
  expect(other.restored).toEqual([]);
  expect(f.coordinator.isDirty([d.id])).toBe(false);
  expect(f.coordinator.isDirty()).toBe(true);
});

it("captures a detached initial baseline and keeps it detached after restore", async () => {
  const f = fixture("discard");
  const initial = { rows: [1, 2] };
  const d = draft(f.coordinator, initial);
  initial.rows.push(3);
  d.scope.changed();
  expect(await f.request([d.id])).toBe("proceeded");
  expect(d.value).toEqual({ rows: [1, 2] });
  d.value.rows.push(4);
  d.scope.changed();
  expect(await f.request([d.id])).toBe("proceeded");
  expect(d.value).toEqual({ rows: [1, 2] });
});

it("uses owner normalization for defaults on both sides", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "  name  ", {
    snapshot: (value) => value.trim(),
    equal: (a, b) => a.trim() === b.trim(),
  });
  d.set("name");
  expect(await f.request([d.id])).toBe("proceeded");
  expect(f.questions).toEqual([]);
});

it("uses owner equality for unordered sets without flattening ordered rows", () => {
  const f = fixture();
  const d = draft(f.coordinator, new Set(["a", "b"]), {
    equal: (a, b) => a.size === b.size && [...a].every((value) => b.has(value)),
  });
  d.set(new Set(["b", "a"]));
  expect(d.scope.isDirty()).toBe(false);
  d.set(new Set(["a", "c"]));
  expect(d.scope.isDirty()).toBe(true);
  const rows = draft(f.coordinator, ["a", "b"]);
  rows.set(["b", "a"]);
  expect(rows.scope.isDirty()).toBe(true);
});

it("retains invalid raw inputs as dirty values", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "1.00");
  d.set("invalid");
  expect(await f.request([d.id])).toBe("kept");
  expect(d.value).toBe("invalid");
});

it("retains dirty values after a rejected write", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("submitted");
  await expect(Promise.reject(new Error("write refused"))).rejects.toThrow("write refused");
  expect(await f.request([d.id])).toBe("kept");
  expect(d.value).toBe("submitted");
});

it("a committed submitted snapshot remains clean despite a later refresh refusal", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("submitted");
  d.scope.commit("submitted");
  await expect(Promise.reject(new Error("refresh refused"))).rejects.toThrow("refresh refused");
  expect(unload(f.target).defaultPrevented).toBe(false);
  expect(await f.request([d.id])).toBe("proceeded");
  expect(f.questions).toEqual([]);
});

it("edits made during save stay dirty against the detached submitted snapshot", () => {
  const f = fixture();
  const d = draft(f.coordinator, { name: "initial" });
  const submitted = { name: "submitted" };
  d.set({ name: "newer edit" });
  d.scope.commit(submitted);
  submitted.name = "newer edit";
  expect(d.scope.isDirty()).toBe(true);
  d.set({ name: "submitted" });
  expect(d.scope.isDirty()).toBe(false);
});

it("closing a parent covers its dirty child even when the parent is clean", async () => {
  const f = fixture();
  const parent = draft(f.coordinator, "parent");
  const child = draft(f.coordinator, "child", { parent: parent.id });
  child.set("child edit");
  expect(await f.request([parent.id])).toBe("kept");
  expect(f.questions[0]!.dirtyScopes).toEqual([child.id]);
  expect(f.coordinator.isDirty([parent.id])).toBe(true);
});

it("a clean child does not conceal a dirty parent and child save commits only the child", async () => {
  const f = fixture();
  const parent = draft(f.coordinator, "parent");
  const child = draft(f.coordinator, "child", { parent: parent.id });
  parent.set("parent edit");
  child.set("child edit");
  child.scope.commit("child edit");
  expect(await f.request([child.id])).toBe("proceeded");
  expect(await f.request([parent.id])).toBe("kept");
  expect(f.questions[0]!.dirtyScopes).toEqual([parent.id]);
  expect(parent.value).toBe("parent edit");
});

it("discarding a child does not restore its dirty parent", async () => {
  const f = fixture("discard");
  const parent = draft(f.coordinator, "parent");
  const child = draft(f.coordinator, "child", { parent: parent.id });
  parent.set("parent edit");
  child.set("child edit");
  expect(await f.request([child.id])).toBe("proceeded");
  expect(child.value).toBe("child");
  expect(parent.value).toBe("parent edit");
  expect(parent.restored).toEqual([]);
});

it("one pending decision refuses another leave without replacing its destination", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("edited");
  f.defer();
  const first = f.request([d.id]);
  expect(await f.request([])).toBe("busy");
  expect(f.questions).toHaveLength(1);
  f.answer("discard");
  expect(await first).toBe("proceeded");
  expect(f.proceeds).toBe(1);
  expect(d.value).toBe("initial");
});

it.each(["commit", "dispose", "replace", "reset", "coordinator-dispose"] as const)(
  "%s invalidates a pending answer, aborts its renderer and never restores saved or replacement values",
  async (action) => {
    const f = fixture();
    const d = draft(f.coordinator, "initial");
    d.set("edited");
    f.defer();
    const pending = f.request([d.id]);
    if (action === "commit") d.scope.commit("edited");
    else if (action === "dispose") d.scope.dispose();
    else if (action === "replace") draft(f.coordinator, "replacement", { id: d.id });
    else if (action === "reset") f.coordinator.forceReset();
    else f.coordinator.dispose();
    expect(f.questions[0]!.signal.aborted).toBe(true);
    expect(await pending).toBe("stale");
    f.answer("discard");
    await Promise.resolve();
    expect(f.proceeds).toBe(0);
    expect(d.value).toBe("edited");
    expect(d.restored).toEqual([]);
    expect(unload(f.target).defaultPrevented).toBe(false);
  },
);

it("an unrelated save does not invalidate the current question", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  const other = draft(f.coordinator, "other");
  d.set("edited");
  f.defer();
  const pending = f.request([d.id]);
  other.scope.commit("other");
  expect(f.questions[0]!.signal.aborted).toBe(false);
  f.answer("discard");
  expect(await pending).toBe("proceeded");
});

it("registering a new child invalidates the pending parent decision", async () => {
  const f = fixture();
  const parent = draft(f.coordinator, "parent");
  parent.set("edited");
  f.defer();
  const pending = f.request([parent.id]);
  const child = draft(f.coordinator, "new child", { parent: parent.id });
  child.set("child edit");
  expect(await pending).toBe("stale");
  f.answer("discard");
  expect(parent.value).toBe("edited");
  expect(child.value).toBe("child edit");
  expect(f.proceeds).toBe(0);
});

it("replacing a child under a different parent invalidates the old parent's question", async () => {
  const f = fixture();
  const parent = draft(f.coordinator, "parent");
  const child = draft(f.coordinator, "child", { parent: parent.id });
  child.set("edited");
  f.defer();
  const pending = f.request([parent.id]);
  const replacement = draft(f.coordinator, "replacement", { id: child.id, parent: {} });
  expect(f.questions[0]!.signal.aborted).toBe(true);
  expect(await pending).toBe("stale");
  f.answer("discard");
  expect(f.proceeds).toBe(0);
  expect(replacement.value).toBe("replacement");
});

it("opaque selections retain identity and exact decimal payloads use owner comparison", () => {
  const f = fixture();
  const file = new File(["first"], "same.pfx");
  const d = draft(
    f.coordinator,
    { file, amount: "1.23000000000000000001" },
    {
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.file === b.file && a.amount === b.amount,
    },
  );
  d.set({ file, amount: "1.23000000000000000002" });
  expect(d.scope.isDirty()).toBe(true);
  d.set({ file: new File(["second"], "same.pfx"), amount: "1.23000000000000000001" });
  expect(d.scope.isDirty()).toBe(true);
  d.set({ file, amount: "1.23000000000000000001" });
  expect(d.scope.isDirty()).toBe(false);
});

it("an edit while asking invalidates the decision before it can discard newer values", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("edited");
  f.defer();
  const pending = f.request([d.id]);
  d.set("newer edit");
  expect(await pending).toBe("stale");
  f.answer("discard");
  expect(d.value).toBe("newer edit");
  expect(d.restored).toEqual([]);
});

it("force reset unregisters scopes without restoring data and old handles stay inert", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "initial");
  d.set("edited");
  f.coordinator.forceReset();
  d.scope.changed();
  d.scope.commit("initial");
  expect(d.scope.isDirty()).toBe(false);
  expect(f.coordinator.isDirty()).toBe(false);
  expect(unload(f.target).defaultPrevented).toBe(false);
  expect(d.value).toBe("edited");
  const replacement = draft(f.coordinator, "new");
  replacement.set("new edit");
  expect(await f.request([replacement.id])).toBe("kept");
});

it("a disposed coordinator cannot approve a later leave or retain new owners", async () => {
  const f = fixture();
  f.coordinator.dispose();
  expect(await f.request([])).toBe("stale");
  expect(f.proceeds).toBe(0);
  expect(() => draft(f.coordinator, "new")).toThrow();
});

it("propagates failed continuations and releases the pending gate", async () => {
  const f = fixture("discard");
  const d = draft(f.coordinator, "initial");
  d.set("edited");
  await expect(
    f.coordinator.request({
      scopes: [d.id],
      reason: "signout",
      proceed: () => {
        throw new Error("leave refused");
      },
    }),
  ).rejects.toThrow("leave refused");
  expect(await f.request([d.id])).toBe("proceeded");
});

it("holds the request gate until its asynchronous continuation finishes", async () => {
  const f = fixture();
  let finish!: () => void;
  const pending = f.coordinator.request({
    scopes: [],
    reason: "cancel",
    proceed: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  expect(await f.request([])).toBe("busy");
  finish();
  expect(await pending).toBe("proceeded");
});

it("a rejected renderer releases the request gate without resetting a draft", async () => {
  const coordinator = core.createLeaveCoordinator(async () => {
    throw new Error("renderer failed");
  }, new EventTarget() as Window);
  coordinators.push(coordinator);
  const d = draft(coordinator, "initial");
  d.set("edited");
  const request = {
    scopes: [d.id],
    reason: "escape" as const,
    proceed: () => {
      throw new Error("should not leave");
    },
  };
  await expect(coordinator.request(request)).rejects.toThrow("renderer failed");
  await expect(coordinator.request(request)).rejects.toThrow("renderer failed");
  expect(d.value).toBe("edited");
});
