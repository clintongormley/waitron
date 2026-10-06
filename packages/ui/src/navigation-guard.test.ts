import { afterEach, expect, it, vi } from "vitest";
import {
  createLeaveCoordinator,
  type LeaveCoordinator,
  type LeaveDecision,
} from "@waitron/ui-core/unsaved-changes";
import { NavigationGuard, observeNavigation } from "./navigation-guard.js";

const originalUrl = location.href;
let guard: NavigationGuard;
let coordinator: LeaveCoordinator;
let stop: (() => void) | undefined;

function fixture() {
  history.replaceState({ marker: "original" }, "", "/guarded/a?dev=1#keep");
  const answers: ((decision: LeaveDecision) => void)[] = [];
  const signals: AbortSignal[] = [];
  const owner = {};
  let value = "saved";
  coordinator = createLeaveCoordinator(
    (_question, signal) =>
      new Promise((resolve) => {
        answers.push(resolve);
        signals.push(signal);
      }),
    window,
  );
  const scope = coordinator.register({
    id: owner,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  guard = new NavigationGuard(window, {
    isDirty: () => coordinator.isDirty([owner]),
    request: (proceed, signal) =>
      coordinator.request({ scopes: [owner], reason: "navigation", proceed, signal }),
  });
  const routes: string[] = [];
  const view = document.createElement("output");
  document.body.append(view);
  stop = observeNavigation(window, () => {
    routes.push(new URL(guard.href).pathname);
    view.textContent = new URL(guard.href).pathname;
  });
  view.textContent = "/guarded/a";
  return {
    scope,
    answers,
    signals,
    routes,
    view,
    get value() {
      return value;
    },
    edit(v = "edited") {
      value = v;
      scope.changed();
    },
  };
}

afterEach(() => {
  stop?.();
  stop = undefined;
  guard?.dispose();
  coordinator?.dispose();
  document.querySelectorAll("output").forEach((el) => el.remove());
  vi.restoreAllMocks();
  history.replaceState(null, "", originalUrl);
});

async function idle() {
  await expect.poll(() => guard.write(guard.href)).toBe("proceeded");
}

it.each(["back", "forward"] as const)(
  "indexed %s holds the accepted view for Keep and replays only Discard",
  async (direction) => {
    const f = fixture();
    await guard.write("/guarded/b?dev=1#keep");
    if (direction === "forward") {
      history.back();
      await expect.poll(() => location.pathname).toBe("/guarded/a");
    }
    const accepted = direction === "back" ? "/guarded/b" : "/guarded/a";
    const destination = direction === "back" ? "/guarded/a" : "/guarded/b";
    const published = f.routes.length;
    const length = history.length;
    f.edit();
    history[direction]();
    await expect.poll(() => f.answers.length).toBe(1);
    expect(location.pathname).toBe(accepted);
    expect(f.view.textContent).toBe(accepted);
    expect(f.routes).toHaveLength(published);
    f.answers[0]!("keep");
    await idle();
    expect(location.pathname).toBe(accepted);
    expect(f.value).toBe("edited");
    history[direction]();
    await expect.poll(() => f.answers.length).toBe(2);
    f.answers[1]!("discard");
    await expect.poll(() => f.view.textContent).toBe(destination);
    await idle();
    expect(location.pathname).toBe(destination);
    expect(f.routes).toHaveLength(published + 1);
    expect(f.value).toBe("saved");
    expect(history.length).toBe(length);
    expect(history.state.marker).toBe("original");
    expect(location.search).toBe("?dev=1");
    expect(location.hash).toBe("#keep");
  },
);

it.each(["back", "forward"] as const)(
  "unindexed %s replaces the traversed entry without guessing a distance",
  async (direction) => {
    const f = fixture();
    const initial = history.state;
    if (direction === "back") {
      history.pushState({ marker: "destination", unrelated: 7 }, "", "/guarded/unknown");
      history.pushState(initial, "", guard.href);
    } else {
      history.pushState({ marker: "destination", unrelated: 7 }, "", "/guarded/unknown");
      const back = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await back;
    }
    guard.reset();
    f.routes.length = 0;
    f.edit();
    const length = history.length;
    const go = vi.spyOn(history, "go");
    history[direction]();
    await expect.poll(() => f.answers.length).toBe(1);
    expect(location.pathname).toBe("/guarded/a");
    expect(f.view.textContent).toBe("/guarded/a");
    expect(history.state.marker).toBe("original");
    expect(f.routes).toEqual([]);
    f.answers[0]!("discard");
    await expect.poll(() => f.view.textContent).toBe("/guarded/unknown");
    await idle();
    expect(f.routes).toEqual(["/guarded/unknown"]);
    expect(history.state.marker).toBe("destination");
    expect(history.state.unrelated).toBe(7);
    expect(history.length).toBe(length);
    expect(go).not.toHaveBeenCalled();
  },
);

it("Keep on an old-epoch entry stays at the replaced URL without publishing or pushing", async () => {
  const f = fixture();
  const old = history.state;
  history.pushState({ ...old, marker: "destination" }, "", "/guarded/old");
  history.pushState(history.state, "", "/guarded/a?dev=1#keep");
  guard.reset();
  const epoch = history.state.__wtNavigation.epoch;
  f.edit();
  const length = history.length;
  history.back();
  await expect.poll(() => f.answers.length).toBe(1);
  expect(location.pathname).toBe("/guarded/a");
  expect(history.state.__wtNavigation.epoch).not.toBe(epoch);
  f.answers[0]!("keep");
  await idle();
  expect(f.routes).toEqual([]);
  expect(f.value).toBe("edited");
  expect(history.length).toBe(length);
  expect(location.pathname).toBe("/guarded/a");
});

it("a second Back and a sidebar request cannot replace the first pending destination", async () => {
  const f = fixture();
  await guard.write("/guarded/b");
  await guard.write("/guarded/c");
  f.edit();
  history.back();
  await expect.poll(() => f.answers.length).toBe(1);
  const traversed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.go(-2);
  await traversed;
  await expect.poll(() => location.pathname).toBe("/guarded/c");
  expect(await guard.write("/guarded/sidebar")).toBe("busy");
  expect(f.answers).toHaveLength(1);
  f.answers[0]!("discard");
  await expect.poll(() => f.view.textContent).toBe("/guarded/b");
  await idle();
  expect(location.pathname).toBe("/guarded/b");
});

it("two rapid Back events keep the first destination and do not create another question", async () => {
  const f = fixture();
  await guard.write("/guarded/b");
  await guard.write("/guarded/c");
  f.routes.length = 0;
  f.edit();
  history.back();
  history.back();
  await expect.poll(() => f.answers.length).toBe(1);
  expect(location.pathname).toBe("/guarded/c");
  expect(f.routes).toEqual([]);
  f.answers[0]!("discard");
  await expect.poll(() => f.view.textContent).toBe("/guarded/b");
  await idle();
  expect(f.answers).toHaveLength(1);
  expect(f.routes).toEqual(["/guarded/b"]);
});

it("disposing an earlier guard again cannot remove its replacement or rewrite history", async () => {
  const f = fixture();
  const earlier = guard;
  earlier.dispose();
  guard = new NavigationGuard(window, {
    isDirty: () => coordinator.isDirty([f.scope.id]),
    request: (proceed, signal) =>
      coordinator.request({ scopes: [f.scope.id], reason: "navigation", proceed, signal }),
  });
  f.edit();
  const current = history.state;
  earlier.dispose();
  expect(history.state).toEqual(current);
  const pending = guard.write("/guarded/b");
  expect(f.answers).toHaveLength(1);
  f.answers[0]!("keep");
  expect(await pending).toBe("kept");
  expect(location.pathname).toBe("/guarded/a");
});

it.each(["save", "reset", "disconnect"] as const)(
  "%s makes an outstanding Discard inert",
  async (action) => {
    const f = fixture();
    f.edit();
    const pending = guard.write("/guarded/b");
    expect(f.answers).toHaveLength(1);
    if (action === "save") f.scope.commit("edited");
    else if (action === "reset") guard.reset();
    else guard.dispose();
    expect(f.signals[0]!.aborted).toBe(true);
    f.answers[0]!("discard");
    expect(await pending).toBe("stale");
    expect(f.value).toBe("edited");
    expect(location.pathname).toBe("/guarded/a");
    expect(f.routes).toEqual([]);
  },
);

it("same URL, reverted entry and committed entry skip the question; replacement does not push", async () => {
  const f = fixture();
  f.edit();
  expect(await guard.write(guard.href)).toBe("proceeded");
  f.edit("saved");
  const length = history.length;
  await guard.write("/guarded/b", true);
  expect(history.length).toBe(length);
  f.edit();
  f.scope.commit("edited");
  await guard.write("/guarded/c");
  expect(f.answers).toEqual([]);
  expect(f.routes).toEqual(["/guarded/b", "/guarded/c"]);
  expect(history.state.marker).toBe("original");
});

it("disconnect removes interception and subscriptions; reconnect starts a new epoch", async () => {
  const f = fixture();
  const epoch = history.state.__wtNavigation.epoch;
  stop!();
  stop = undefined;
  guard.dispose();
  expect(await guard.write("/guarded/b")).toBe("stale");
  guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async (proceed) => {
      await proceed();
      return "proceeded";
    },
  });
  expect(history.state.__wtNavigation.epoch).not.toBe(epoch);
  await guard.write("/guarded/c");
  expect(f.routes).toEqual([]);
});

it("refuses a second adapter and external route without losing the current draft", () => {
  const f = fixture();
  f.edit();
  expect(
    () =>
      new NavigationGuard(window, {
        isDirty: () => false,
        request: async () => "proceeded",
      }),
  ).toThrow("already has a navigation guard");
  expect(() => guard.write("https://example.invalid/elsewhere")).toThrow("stay in this app");
  expect(f.value).toBe("edited");
  expect(location.pathname).toBe("/guarded/a");
});

it("accepts a clean unindexed traversal once and preserves its unrelated state", async () => {
  const f = fixture();
  const initial = history.state;
  history.pushState({ marker: "destination", unrelated: 7 }, "", "/guarded/unknown");
  history.pushState(initial, "", guard.href);
  history.back();
  await expect.poll(() => f.view.textContent).toBe("/guarded/unknown");
  expect(f.answers).toEqual([]);
  expect(f.routes).toEqual(["/guarded/unknown"]);
  expect(history.state.marker).toBe("destination");
  expect(history.state.unrelated).toBe(7);
});

it("disconnect during restoration settles the abandoned attempt without opening a question", async () => {
  const f = fixture();
  await guard.write("/guarded/b");
  f.routes.length = 0;
  f.edit();
  const go = vi.spyOn(history, "go").mockImplementation(() => {});
  history.back();
  await expect.poll(() => go.mock.calls.length).toBe(1);
  expect(f.answers).toEqual([]);
  guard.dispose();
  await Promise.resolve();
  expect(f.answers).toEqual([]);
  expect(f.routes).toEqual([]);
  expect(f.value).toBe("edited");
});

it("Discard received during a second restoration waits before replaying the original destination", async () => {
  const f = fixture();
  await guard.write("/guarded/b");
  await guard.write("/guarded/c");
  f.routes.length = 0;
  f.edit();
  history.back();
  await expect.poll(() => f.answers.length).toBe(1);
  window.addEventListener("popstate", () => f.answers[0]!("discard"), { once: true });
  history.go(-2);
  await expect.poll(() => f.view.textContent).toBe("/guarded/b");
  await idle();
  expect(f.routes).toEqual(["/guarded/b"]);
  expect(f.answers).toHaveLength(1);
});

it.each(["indexed", "unindexed"] as const)(
  "an unexpected %s report while replaying publishes only the requested destination",
  async (kind) => {
    const f = fixture();
    const a = history.state;
    await guard.write("/guarded/b");
    const b = history.state;
    await guard.write("/guarded/c");
    f.routes.length = 0;
    f.edit();
    history.back();
    await expect.poll(() => f.answers.length).toBe(1);
    const go = vi.spyOn(history, "go").mockImplementation(() => {});
    f.answers[0]!("discard");
    await expect.poll(() => go.mock.calls.length).toBe(1);
    history.replaceState(kind === "indexed" ? a : { unrelated: "interruption" }, "", "/guarded/a");
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (kind === "indexed") {
      expect(f.routes).toEqual([]);
      expect(go).toHaveBeenLastCalledWith(1);
      history.replaceState(b, "", "/guarded/b");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    await idle();
    expect(f.routes).toEqual(["/guarded/b"]);
    expect(f.view.textContent).toBe("/guarded/b");
    expect(location.pathname).toBe("/guarded/b");
    expect(f.value).toBe("saved");
  },
);
