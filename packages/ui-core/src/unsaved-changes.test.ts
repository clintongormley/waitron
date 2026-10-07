import { afterEach, expect, it } from "vitest";
import * as core from "./index.js";
import type {
  ConfirmLeave,
  DraftOwner,
  LeaveCoordinator,
  LeaveDecision,
} from "./unsaved-changes.js";

const coordinators: LeaveCoordinator[] = [];

it("an already aborted leave neither asks nor restores or continues", async () => {
  const f = fixture("discard");
  const d = draft(f.coordinator, "saved");
  d.set("edited");
  const controller = new AbortController();
  controller.abort();
  const request = {
    scopes: [d.id],
    reason: "navigation" as const,
    signal: controller.signal,
    proceed: () => {
      throw new Error("aborted request proceeded");
    },
  };
  expect(await f.coordinator.request(request)).toBe("stale");
  expect(f.questions).toEqual([]);
  expect(d.value).toBe("edited");
  expect(d.restored).toEqual([]);
});

it("an abandoned navigation aborts its question without restoring the draft", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "saved");
  d.set("edited");
  f.defer();
  const controller = new AbortController();
  const pending = f.coordinator.request({
    scopes: [d.id],
    reason: "navigation",
    signal: controller.signal,
    proceed: () => {
      throw new Error("abandoned navigation proceeded");
    },
  });
  controller.abort();
  expect(f.questions[0]!.signal.aborted).toBe(true);
  expect(await pending).toBe("stale");
  f.answer("discard");
  expect(d.value).toBe("edited");
  expect(d.restored).toEqual([]);
  expect(d.scope.isDirty()).toBe(true);
  const retry = f.request([d.id]);
  f.answer("keep");
  expect(await retry).toBe("kept");
});
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

for (const decision of ["keep", "discard"] as const) {
  it(`an application-wide ${decision} covers independent drafts and descendants once`, async () => {
    const f = fixture(decision);
    const page = draft(f.coordinator, "page saved");
    const modal = draft(f.coordinator, "modal saved");
    const child = draft(f.coordinator, "child saved", { parent: modal.id });
    const clean = draft(f.coordinator, "clean");
    page.set("page edited");
    child.set("child edited");
    let proceeds = 0;
    const result = await f.coordinator.request({
      scopes: "all",
      reason: "signout",
      proceed: () => {
        proceeds++;
      },
    });
    expect(f.questions.map(({ dirtyScopes }) => dirtyScopes)).toEqual([[page.id, child.id]]);
    expect(result).toBe(decision === "keep" ? "kept" : "proceeded");
    expect(proceeds).toBe(decision === "keep" ? 0 : 1);
    expect(page.value).toBe(decision === "keep" ? "page edited" : "page saved");
    expect(child.value).toBe(decision === "keep" ? "child edited" : "child saved");
    expect(page.restored).toEqual(decision === "keep" ? [] : ["page saved"]);
    expect(child.restored).toEqual(decision === "keep" ? [] : ["child saved"]);
    expect(modal.restored).toEqual([]);
    expect(clean.restored).toEqual([]);
  });
}
for (const action of ["edit", "commit", "dispose", "register"] as const) {
  it(`${action} invalidates an application-wide pending leave`, async () => {
    const f = fixture();
    const d = draft(f.coordinator, "saved");
    d.set("edited");
    f.defer();
    let proceeds = 0;
    const pending = f.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        proceeds++;
      },
    });
    expect(f.questions).toHaveLength(1);
    if (action === "edit") d.set("new edit");
    else if (action === "commit") d.scope.commit("edited");
    else if (action === "dispose") d.scope.dispose();
    else draft(f.coordinator, "new owner");
    expect(await pending).toBe("stale");
    expect(f.questions[0]!.signal.aborted).toBe(true);
    f.answer("discard");
    expect(proceeds).toBe(0);
    expect(d.restored).toEqual([]);
  });
}
it("an empty scope selection stays distinct from an application-wide leave", async () => {
  const f = fixture();
  const d = draft(f.coordinator, "saved");
  d.set("edited");
  expect(await f.request([])).toBe("proceeded");
  expect(f.questions).toEqual([]);
  expect(d.value).toBe("edited");
  d.set("saved");
  let proceeds = 0;
  expect(
    await f.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        proceeds++;
      },
    }),
  ).toBe("proceeded");
  expect(proceeds).toBe(1);
  expect(f.questions).toEqual([]);
});

it("an application-wide discard retains explicitly excluded owners and their descendants", async () => {
  const f = fixture("discard");
  const page = draft(f.coordinator, "page");
  const retained = draft(f.coordinator, "retained");
  const child = draft(f.coordinator, "child", { parent: retained.id });
  page.set("page edit");
  retained.set("retained edit");
  child.set("child edit");
  let proceeds = 0;
  expect(
    await f.coordinator.request({
      scopes: "all",
      except: [retained.id],
      reason: "navigation",
      proceed: () => {
        proceeds++;
      },
    }),
  ).toBe("proceeded");
  expect(f.questions[0]!.dirtyScopes).toEqual([page.id]);
  expect(proceeds).toBe(1);
  expect(page.value).toBe("page");
  expect(retained.value).toBe("retained edit");
  expect(child.value).toBe("child edit");
  expect(retained.restored).toEqual([]);
  expect(child.restored).toEqual([]);
  expect(unload(f.target).defaultPrevented).toBe(true);
});
it("a retained owner change does not invalidate another page's pending decision", async () => {
  const f = fixture();
  const page = draft(f.coordinator, "page");
  const retained = draft(f.coordinator, "retained");
  page.set("page edit");
  f.defer();
  let proceeds = 0;
  const pending = f.coordinator.request({
    scopes: "all",
    except: [retained.id],
    reason: "navigation",
    proceed: () => {
      proceeds++;
    },
  });
  retained.set("retained edit");
  const child = draft(f.coordinator, "child", { parent: retained.id });
  child.set("child edit");
  expect(f.questions[0]!.signal.aborted).toBe(false);
  f.answer("discard");
  expect(await pending).toBe("proceeded");
  expect(proceeds).toBe(1);
  expect(retained.value).toBe("retained edit");
  expect(child.value).toBe("child edit");
});
it("retained dirty scopes alone do not ask when the departing scopes are clean", async () => {
  const f = fixture();
  const retained = draft(f.coordinator, "retained");
  retained.set("retained edit");
  let proceeds = 0;
  expect(
    await f.coordinator.request({
      scopes: "all",
      except: [retained.id],
      reason: "navigation",
      proceed: () => {
        proceeds++;
      },
    }),
  ).toBe("proceeded");
  expect(f.questions).toEqual([]);
  expect(proceeds).toBe(1);
  expect(retained.value).toBe("retained edit");
});

it("disposing an old handle twice cannot unregister its replacement owner", async () => {
  const f = fixture();
  const old = draft(f.coordinator, "old");
  old.scope.dispose();
  const replacement = draft(f.coordinator, "new", { id: old.id });
  replacement.set("new edit");
  old.scope.dispose();
  expect(await f.request([old.id])).toBe("kept");
  expect(f.questions[0]!.dirtyScopes).toEqual([old.id]);
  expect(replacement.value).toBe("new edit");
  expect(replacement.scope.isDirty()).toBe(true);
  expect(unload(f.target).defaultPrevented).toBe(true);
});
it("aborting a request after acceptance does not cancel its asynchronous continuation", async () => {
  const f = fixture("discard");
  const d = draft(f.coordinator, "saved");
  d.set("edited");
  const controller = new AbortController();
  let finish!: () => void;
  let started = false;
  const pending = f.coordinator.request({
    scopes: [d.id],
    reason: "navigation",
    signal: controller.signal,
    proceed: () =>
      new Promise<void>((resolve) => {
        started = true;
        finish = resolve;
      }),
  });
  await expect.poll(() => started).toBe(true);
  controller.abort();
  expect(f.questions[0]!.signal.aborted).toBe(false);
  expect(d.restored).toEqual(["saved"]);
  expect(await f.request([d.id])).toBe("busy");
  finish();
  expect(await pending).toBe("proceeded");
  expect(await f.request([d.id])).toBe("proceeded");
});

it("ignores retained scopes for navigation while keeping their unload protection", () => {
  const f = fixture();
  const retained = draft(f.coordinator, "saved");
  const child = draft(f.coordinator, "saved", { parent: retained.id });
  const page = draft(f.coordinator, "saved");
  retained.set("basket");
  child.set("retained child");
  expect(f.coordinator.isDirty(undefined, [retained.id])).toBe(false);
  expect(unload(f.target).defaultPrevented).toBe(true);
  page.set("page edit");
  expect(f.coordinator.isDirty(undefined, [retained.id])).toBe(true);
  expect(f.coordinator.isDirty([retained.id], [retained.id])).toBe(false);
  page.scope.commit("page edit");
  expect(f.coordinator.isDirty(undefined, [retained.id])).toBe(false);
  expect(f.coordinator.isDirty()).toBe(true);
});

function tracked<T>(initial: T) {
  let value = initial;
  const id = {};
  const scope = core.trackDraft<T>({
    id,
    current: () => value,
    snapshot: (input) => structuredClone(input),
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    restore: () => {
      throw new Error("a tracked draft is never restored");
    },
  });
  return {
    id,
    scope,
    set(input: T) {
      value = input;
      scope.changed();
    },
  };
}

it("a tracked draft starts unchanged, follows edits and is clean again once reverted", () => {
  const d = tracked({ name: "saved" });
  expect(d.scope.id).toBe(d.id);
  expect(d.scope.isDirty()).toBe(false);
  d.set({ name: "edited" });
  expect(d.scope.isDirty()).toBe(true);
  d.set({ name: "saved" });
  expect(d.scope.isDirty()).toBe(false);
});

it("a tracked draft's baseline is a detached snapshot of the opened value", () => {
  const initial = { rows: [1, 2] };
  const d = tracked(initial);
  initial.rows.push(3);
  expect(d.scope.isDirty()).toBe(true);
});

it("committing a tracked draft makes the submitted value its new baseline", () => {
  const d = tracked({ name: "saved" });
  const submitted = { name: "submitted" };
  d.set({ name: "submitted" });
  d.scope.commit(submitted);
  expect(d.scope.isDirty()).toBe(false);
  submitted.name = "changed after commit";
  expect(d.scope.isDirty()).toBe(false);
  d.set({ name: "saved" });
  expect(d.scope.isDirty()).toBe(true);
});

it("a disposed tracked draft stays clean and ignores later commits", () => {
  const d = tracked("saved");
  d.set("edited");
  d.scope.dispose();
  expect(d.scope.isDirty()).toBe(false);
  d.set("another edit");
  expect(() => d.scope.commit("committed")).not.toThrow();
  expect(d.scope.isDirty()).toBe(false);
  expect(() => d.scope.dispose()).not.toThrow();
});

it("a dirty tracked draft adds no unload protection", () => {
  const d = tracked("saved");
  d.set("edited");
  expect(d.scope.isDirty()).toBe(true);
  expect(unload(window).defaultPrevented).toBe(false);
});
