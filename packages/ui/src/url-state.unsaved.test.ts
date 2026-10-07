import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import {
  createLeaveCoordinator,
  type LeaveDecision,
  type LeaveCoordinator,
} from "@waitron/ui-core/unsaved-changes";
import { UrlStateController } from "./url-state.js";
import { navigationGuardFor } from "./navigation-guard.js";
import { cleanup, mount } from "./test-helpers.js";

const originalUrl = location.href;
const decisions: ((choice: LeaveDecision) => void)[] = [];
let coordinator: LeaveCoordinator;
const owner = {};
let value = "saved";

class GuardedUrlScreen extends LitElement {
  selected: string | null = null;
  readonly url = new UrlStateController(
    this,
    () => {
      this.selected = this.url.read("tab");
      this.requestUpdate();
    },
    {
      basePath: "/guarded",
      primary: "tab",
      children: {},
      leave: {
        isDirty: () => coordinator.isDirty([owner]),
        request: (proceed: () => void | Promise<void>, signal: AbortSignal) =>
          coordinator.request({ scopes: [owner], reason: "navigation", proceed, signal }),
      },
    },
  );
  override render() {
    return html`${this.selected}`;
  }
}
customElements.define("test-guarded-url-screen", GuardedUrlScreen);

class ObservingUrlScreen extends LitElement {
  selected: string | null = null;
  readonly url = new UrlStateController(
    this,
    () => {
      this.selected = this.url.read("tab");
      this.requestUpdate();
    },
    { basePath: "/guarded", primary: "tab", children: {} },
  );
  override render() {
    return html`${this.selected}`;
  }
}
customElements.define("test-observing-url-screen", ObservingUrlScreen);

async function screen() {
  value = "saved";
  decisions.length = 0;
  coordinator = createLeaveCoordinator(
    (_question, signal) =>
      new Promise<LeaveDecision>((resolve) => {
        decisions.push(resolve);
        signal.addEventListener("abort", () => resolve("keep"), { once: true });
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
  history.replaceState({ marker: "retained" }, "", "/guarded/floor?dev=1#kept");
  const el = (await mount(
    "<test-guarded-url-screen></test-guarded-url-screen>",
  )) as GuardedUrlScreen;
  return { el, scope };
}

afterEach(() => {
  cleanup();
  coordinator?.dispose();
  history.replaceState(null, "", originalUrl);
});

it("holds an edited owner and its URL until Keep or Discard answers the route request", async () => {
  const { el, scope } = await screen();
  value = "edited";
  scope.changed();
  const pending = el.url.write({ tab: "counter" });
  expect(location.pathname).toBe("/guarded/floor");
  expect(el.selected).toBe("floor");
  expect(decisions).toHaveLength(1);
  decisions[0]!("keep");
  await pending;
  expect(value).toBe("edited");
  expect(location.pathname).toBe("/guarded/floor");
  const discarded = el.url.write({ tab: "counter" });
  decisions[1]!("discard");
  await discarded;
  expect(value).toBe("saved");
  expect(location.pathname).toBe("/guarded/counter");
  expect(location.search).toBe("?dev=1");
  expect(location.hash).toBe("#kept");
  expect(history.state.marker).toBe("retained");
  expect(el.selected).toBe("counter");
});

it("does not let a second route replace the pending destination", async () => {
  const { el, scope } = await screen();
  value = "edited";
  scope.changed();
  const first = el.url.write({ tab: "counter" });
  await el.url.write({ tab: "kitchen" });
  expect(location.pathname).toBe("/guarded/floor");
  expect(decisions).toHaveLength(1);
  decisions[0]!("discard");
  await first;
  expect(location.pathname).toBe("/guarded/counter");
});

it("makes a pending navigation inert when the editor saves", async () => {
  const { el, scope } = await screen();
  value = "edited";
  scope.changed();
  const pending = el.url.write({ tab: "counter" });
  expect(location.pathname).toBe("/guarded/floor");
  scope.commit("edited");
  decisions[0]!("discard");
  await pending;
  expect(location.pathname).toBe("/guarded/floor");
  expect(value).toBe("edited");
});

it("restores indexed Back before asking and publishes only an accepted route", async () => {
  const { el, scope } = await screen();
  await el.url.write({ tab: "counter" });
  value = "edited";
  scope.changed();
  const length = history.length;
  history.back();
  await expect.poll(() => decisions.length).toBe(1);
  expect(location.pathname).toBe("/guarded/counter");
  expect(el.selected).toBe("counter");
  decisions[0]!("keep");
  await el.updateComplete;
  expect(location.pathname).toBe("/guarded/counter");
  expect(value).toBe("edited");
  expect(history.length).toBe(length);
});

it("every controller reads only the accepted URL, including one connected before the guard", async () => {
  history.replaceState(null, "", "/guarded/floor");
  const observer = (await mount(
    "<test-observing-url-screen></test-observing-url-screen>",
  )) as ObservingUrlScreen;
  const { el, scope } = await screen();
  await el.url.write({ tab: "counter" });
  expect(observer.selected).toBe("counter");
  value = "edited";
  scope.changed();
  history.back();
  await expect.poll(() => decisions.length).toBe(1);
  expect(el.selected).toBe("counter");
  expect(observer.selected).toBe("counter");
  expect(observer.url.read("tab")).toBe("counter");
  decisions[0]!("discard");
  await expect.poll(() => observer.selected).toBe("floor");
  expect(el.selected).toBe("floor");
  observer.remove();
  await el.url.write({ tab: "kitchen" });
  expect(observer.selected).toBe("floor");
});

it("disconnected URL controllers cannot leave or push, and their late decision cannot reset entry", async () => {
  const { el, scope } = await screen();
  value = "edited";
  scope.changed();
  const pending = el.url.write({ tab: "counter" });
  el.remove();
  decisions[0]!("discard");
  await pending;
  expect(value).toBe("edited");
  expect(location.pathname).toBe("/guarded/floor");
  const length = history.length;
  await el.url.write({ tab: "kitchen" });
  expect(history.length).toBe(length);
});

it("query removal and path replacement share the leave decision and preserve unrelated URL parts", async () => {
  const { el, scope } = await screen();
  await el.url.write({ tab: "floor" }, true);
  const guard = navigationGuardFor(window)!;
  await guard.write("/guarded/floor?field=image&dev=1#kept", true);
  value = "edited";
  scope.changed();
  const kept = el.url.write({ tab: "counter" }, true, ["field"]);
  expect(location.search).toBe("?field=image&dev=1");
  decisions[0]!("keep");
  await kept;
  expect(location.pathname).toBe("/guarded/floor");
  expect(location.search).toBe("?field=image&dev=1");
  const discarded = el.url.write({ tab: "counter" }, true, ["field"]);
  decisions[1]!("discard");
  await discarded;
  expect(location.pathname).toBe("/guarded/counter");
  expect(location.search).toBe("?dev=1");
  expect(location.hash).toBe("#kept");
});
