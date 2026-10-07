import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ServiceStatus } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./service-status-screen.js";

class StatusLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  readOnly = false;
  override render() {
    return html`<dashboard-service-status-screen .api=${this.api} .readOnly=${this.readOnly}>
      </dashboard-service-status-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("status-leave-test-app", StatusLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-service-status-screen"];
const seed: ServiceStatus[] = [
  {
    id: "s1",
    label: "Bill requested",
    color: "#ef4444",
    displayOrder: 0,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "s2",
    label: "Needs cleaning",
    color: "#f59e0b",
    displayOrder: 1,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}, readOnly = false) {
  const liveData = new LiveData();
  const api = {
    liveData,
    listStatuses: async () => seed.map((row) => ({ ...row })),
    createStatus: async () => ({ id: "s3" }),
    updateStatus: async () => {},
    deactivateStatus: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<StatusLeaveApp>("status-leave-test-app", { api, readOnly });
  const screen = app.shadowRoot!.querySelector("dashboard-service-status-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("[data-test=row-s2]")).toBeTruthy();
  return { app, screen, liveData };
}
function field(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElement & { value: string; checked: boolean }>(
    `[data-test=${name}]`,
  )!;
}
async function change(screen: Screen, name: string, value: string | boolean) {
  field(screen, name).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
}
function click(screen: Screen, name: string) {
  field(screen, name).click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: StatusLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  app.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision },
      bubbles: true,
      composed: true,
    }),
  );
}
function leave(app: StatusLeaveApp, proceed = () => {}) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
}

for (const [name, changed, original] of [
  ["label-s1", " Bill please ", "Bill requested"],
  ["color-s1", "#22c55e", "#ef4444"],
  ["order-s1", "4", "0"],
  ["active-s1", false, true],
  ["new-label", "New status", ""],
  ["new-color", "#22c55e", "#ef4444"],
] as const) {
  it(`protects ${name} and clears protection after its exact revert`, async () => {
    const { screen } = await mount();
    expect(unload()).toBe(false);
    await change(screen, name, changed);
    expect(unload()).toBe(true);
    await change(screen, name, original);
    expect(unload()).toBe(false);
  });
}
it("compares the trimmed new label but preserves whitespace in a row's submitted label", async () => {
  const { screen } = await mount();
  await change(screen, "new-label", "   ");
  expect(unload()).toBe(false);
  await change(screen, "label-s1", " Bill requested ");
  expect(unload()).toBe(true);
});
it("Keep retains all drafts and Discard restores their native controls before leaving once", async () => {
  const { app, screen } = await mount();
  await change(screen, "label-s1", "Changed row");
  await change(screen, "active-s2", false);
  await change(screen, "new-label", "New row");
  let left = 0;
  const kept = leave(app, () => {
    left++;
  });
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(left).toBe(0);
  expect(field(screen, "label-s1").value).toBe("Changed row");
  expect(field(screen, "new-label").value).toBe("New row");
  const discarded = leave(app, () => {
    left++;
  });
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(left).toBe(1);
  expect(field(screen, "label-s1").shadowRoot!.querySelector("input")!.value).toBe(
    "Bill requested",
  );
  expect(field(screen, "active-s2").shadowRoot!.querySelector("input")!.checked).toBe(true);
  expect(field(screen, "new-label").shadowRoot!.querySelector("input")!.value).toBe("");
  expect(unload()).toBe(false);
});
it("a row save commits its raw submitted body before a failed refresh and keeps other drafts dirty", async () => {
  let body: unknown;
  let written = false;
  const { app, screen } = await mount({
    updateStatus: async (id, input) => {
      body = { id, input };
      written = true;
    },
    listStatuses: async () => {
      if (written) throw { code: "connection.failed" };
      return seed;
    },
  });
  await change(screen, "label-s1", " Bill please ");
  await change(screen, "color-s1", "#22c55e");
  await change(screen, "order-s1", "4");
  await change(screen, "active-s1", false);
  await change(screen, "label-s2", "Other draft");
  await change(screen, "new-label", "New draft");
  click(screen, "save-s1");
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(body).toEqual({
    id: "s1",
    input: { label: " Bill please ", color: "#22c55e", displayOrder: 4, active: false },
  });
  await change(screen, "label-s2", "Needs cleaning");
  await change(screen, "new-label", "");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("create commits only its submitted form before a failed refresh", async () => {
  let body: unknown;
  let written = false;
  const { screen } = await mount({
    createStatus: async (input) => {
      body = input;
      written = true;
      return { id: "s3" };
    },
    listStatuses: async () => {
      if (written) throw { code: "connection.failed" };
      return seed;
    },
  });
  await change(screen, "new-label", " New status ");
  await change(screen, "new-color", "#22c55e");
  await change(screen, "label-s1", "Still editing");
  click(screen, "add");
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(body).toEqual({ label: "New status", color: "#22c55e", displayOrder: 2 });
  expect(field(screen, "new-label").value).toBe("");
  expect(unload()).toBe(true);
  await change(screen, "label-s1", "Bill requested");
  expect(unload()).toBe(false);
});
for (const kind of ["row", "create"] as const) {
  it(`a refused ${kind} write retains values and warning`, async () => {
    const refuse = async () => {
      throw { code: "connection.failed" };
    };
    const { screen } = await mount({ updateStatus: refuse, createStatus: refuse });
    const name = kind === "row" ? "label-s1" : "new-label";
    await change(screen, name, "Still editing");
    click(screen, kind === "row" ? "save-s1" : "add");
    await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
    expect(field(screen, name).value).toBe("Still editing");
    expect(unload()).toBe(true);
  });
  it(`newer input survives an accepted ${kind} write and keeps protection`, async () => {
    const write = deferred<{ id: string }>();
    let reads = 0;
    const { screen } = await mount({
      createStatus: () => write.promise,
      updateStatus: async () => {
        await write.promise;
      },
      listStatuses: async () => {
        reads++;
        return seed;
      },
    });
    const name = kind === "row" ? "label-s1" : "new-label";
    await change(screen, name, "Submitted");
    click(screen, kind === "row" ? "save-s1" : "add");
    await change(screen, name, "Newer input");
    write.resolve({ id: "s3" });
    await expect.poll(() => reads).toBe(2);
    await screen.updateComplete;
    expect(field(screen, name).value).toBe("Newer input");
    expect(unload()).toBe(true);
    await change(screen, name, "Submitted");
    expect(unload()).toBe(false);
  });
  it(`an old ${kind} reply cannot change a reconnected editor`, async () => {
    const write = deferred<{ id: string }>();
    let reads = 0;
    const { app, screen } = await mount({
      createStatus: () => write.promise,
      updateStatus: async () => {
        await write.promise;
      },
      listStatuses: async () => {
        reads++;
        return seed;
      },
    });
    const name = kind === "row" ? "label-s1" : "new-label";
    await change(screen, name, "Submitted");
    click(screen, kind === "row" ? "save-s1" : "add");
    screen.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.prepend(screen);
    await expect.poll(() => reads).toBe(2);
    await screen.updateComplete;
    await change(screen, name, "Replacement draft");
    write.resolve({ id: "s3" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(reads).toBe(2);
    expect(field(screen, name).value).toBe("Replacement draft");
    expect(unload()).toBe(true);
    await change(screen, name, kind === "row" ? "Bill requested" : "");
    expect(unload()).toBe(false);
  });
}
it("live snapshots keep dirty rows intact while adopting clean rows without aborting the leave question", async () => {
  let rows = seed;
  let reads = 0;
  const { app, screen, liveData } = await mount({
    listStatuses: async () => {
      reads++;
      return rows;
    },
  });
  await change(screen, "label-s1", "Local draft");
  const pending = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  liveData.invalidate([{ type: "table_service_statuses", id: "s1" }]);
  await expect.poll(() => reads).toBe(2);
  await screen.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  rows = seed.map((row) => ({ ...row, label: "Remote " + row.id, color: "#22c55e" }));
  liveData.invalidate([{ type: "table_service_statuses", id: "s2" }]);
  await expect.poll(() => field(screen, "label-s2").value).toBe("Remote s2");
  expect(field(screen, "label-s1").value).toBe("Local draft");
  expect(field(screen, "color-s1").value).toBe("#ef4444");
  await change(screen, "label-s1", "Bill requested");
  expect(unload()).toBe(false);
});
it.each([false, true])("a clean readOnly=%s screen leaves without prompting", async (readOnly) => {
  const { app } = await mount({}, readOnly);
  expect(await leave(app)).toBe("proceeded");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});

it("a successful immediate Disable adopts only active=false while preserving unsaved row fields", async () => {
  let rows = seed;
  let written = false;
  const { app, screen } = await mount({
    listStatuses: async () => rows,
    deactivateStatus: async (id) => {
      expect(id).toBe("s1");
      written = true;
      rows = seed.map((row) => (row.id === id ? { ...row, active: false } : row));
    },
  });
  await change(screen, "label-s1", "Still editing");
  click(screen, "deactivate-s1");
  await expect.poll(() => written).toBe(true);
  await expect.poll(() => field(screen, "active-s1").checked).toBe(false);
  expect(field(screen, "label-s1").value).toBe("Still editing");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "label-s1").value).toBe("Bill requested");
  expect(field(screen, "active-s1").checked).toBe(false);
  expect(unload()).toBe(false);
});

it.each(["success", "refusal"] as const)(
  "an old Disable %s cannot alter a replacement editor",
  async (result) => {
    const write = deferred<void>();
    let reads = 0;
    const { app, screen } = await mount({
      deactivateStatus: () => write.promise,
      listStatuses: async () => {
        reads++;
        return seed;
      },
    });
    click(screen, "deactivate-s1");
    screen.remove();
    app.shadowRoot!.prepend(screen);
    await expect.poll(() => reads).toBe(2);
    await screen.updateComplete;
    await change(screen, "label-s1", "Replacement draft");
    if (result === "success") write.resolve();
    else write.reject({ code: "status.not_found" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(field(screen, "label-s1").value).toBe("Replacement draft");
    expect(reads).toBe(2);
  },
);

for (const kind of ["row", "create"] as const) {
  it(`an old ${kind} refusal cannot report an error in a reconnected editor`, async () => {
    const write = deferred<{ id: string }>();
    let reads = 0;
    const { app, screen } = await mount({
      createStatus: () => write.promise,
      updateStatus: async () => {
        await write.promise;
      },
      listStatuses: async () => {
        reads++;
        return seed;
      },
    });
    const name = kind === "row" ? "label-s1" : "new-label";
    await change(screen, name, "Submitted");
    click(screen, kind === "row" ? "save-s1" : "add");
    screen.remove();
    app.shadowRoot!.prepend(screen);
    await expect.poll(() => reads).toBe(2);
    await screen.updateComplete;
    await change(screen, name, "Replacement draft");
    write.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(field(screen, name).value).toBe("Replacement draft");
    expect(unload()).toBe(true);
  });
}

it("a dirty missing row stays mounted while clean missing rows leave and release their scopes", async () => {
  let rows = seed;
  let reads = 0;
  const { app, screen, liveData } = await mount({
    listStatuses: async () => {
      reads++;
      return rows;
    },
  });
  await change(screen, "label-s1", "Unsubmitted");
  rows = [];
  liveData.invalidate([{ type: "table_service_statuses", id: "s2" }]);
  await expect.poll(() => reads).toBe(2);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=row-s2]")).toBeNull();
  expect(field(screen, "label-s1").value).toBe("Unsubmitted");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  expect(unload()).toBe(false);
});

it("several clean missing rows release their scopes before their values leave the list", async () => {
  let rows = seed;
  const { app, screen, liveData } = await mount({ listStatuses: async () => rows });
  rows = [];
  liveData.invalidate([{ type: "table_service_statuses", id: "s1" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=row-s1]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[data-test=row-s2]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("a retained missing draft does not change the new status's fetched-list display order", async () => {
  let rows = seed;
  let body: unknown;
  const { screen, liveData } = await mount({
    listStatuses: async () => rows,
    createStatus: async (input) => {
      body = input;
      return { id: "s3" };
    },
  });
  await change(screen, "label-s1", "Unsubmitted");
  rows = [];
  liveData.invalidate([{ type: "table_service_statuses", id: "s2" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=row-s2]")).toBeNull();
  await change(screen, "new-label", "New status");
  click(screen, "add");
  await expect.poll(() => body).toEqual({ label: "New status", color: "#ef4444", displayOrder: 0 });
  expect(field(screen, "label-s1").value).toBe("Unsubmitted");
  expect(unload()).toBe(true);
});

for (const kind of ["row", "create"] as const) {
  it(`an accepted ${kind} write invalidates its pending leave answer`, async () => {
    const write = deferred<{ id: string }>();
    const { app, screen } = await mount({
      createStatus: () => write.promise,
      updateStatus: async () => {
        await write.promise;
      },
    });
    await change(screen, kind === "row" ? "label-s1" : "new-label", "Submitted");
    click(screen, kind === "row" ? "save-s1" : "add");
    let left = 0;
    const pending = leave(app, () => {
      left++;
    });
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    write.resolve({ id: "s3" });
    expect(await pending).toBe("stale");
    expect(left).toBe(0);
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  });
}
