import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, DashboardTable } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./floor-screen.js";

class FloorLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-floor-screen .api=${this.api}></dashboard-floor-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("floor-leave-test-app", FloorLeaveApp);
const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", originalUrl);
});
type Screen = HTMLElementTagNameMap["dashboard-floor-screen"];
const seed: DashboardTable[] = [
  {
    id: "t1",
    label: "One",
    capacity: 2,
    zoneId: "z1",
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "t2",
    label: "Two",
    capacity: null,
    zoneId: "z1",
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
async function mount(overrides: Partial<DashboardApi> = {}) {
  history.replaceState(null, "", "/manage/floor/view/config");
  const liveData = new LiveData();
  const api = {
    liveData,
    listZones: async () => [{ id: "z1", name: "Dining", displayOrder: 0, active: true }],
    listTables: async () => seed.map((row) => ({ ...row })),
    createTable: async () => ({ id: "t3" }),
    updateTable: async () => {},
    deactivateTable: async () => {},
    setTablePlacement: async () => {},
    clearPlacement: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<FloorLeaveApp>("floor-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-floor-screen")!;
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[data-test=table-row-t2]"))
    .toBeTruthy();
  return { app, screen, liveData };
}
function field(screen: Screen, selector: string) {
  return screen.shadowRoot!.querySelector<
    HTMLElement & { value: string; updateComplete: Promise<unknown> }
  >(selector)!;
}
async function change(screen: Screen, selector: string, value: string) {
  const host = field(screen, selector);
  await host.updateComplete;
  const input = host.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await screen.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: FloorLeaveApp, proceed = () => {}) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
}
async function choose(app: FloorLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
}
const label = "[data-test=table-label-t1]";
const capacity = "[data-test=table-capacity-t1]";
const add = "[data-new-table]";
const save = "[data-test=table-save-t1]";
for (const [selector, changed, original] of [
  [label, " One ", "One"],
  [capacity, "6", "2"],
  [add, "New table", ""],
]) {
  it(`protects ${selector} and clears protection on revert`, async () => {
    const { screen } = await mount();
    expect(unload()).toBe(false);
    await change(screen, selector!, changed!);
    expect(unload()).toBe(true);
    await change(screen, selector!, original!);
    expect(unload()).toBe(false);
  });
}
it("trims only the new-table comparison and compares capacity at its existing integer scale", async () => {
  const { screen } = await mount();
  await change(screen, add, "   ");
  expect(unload()).toBe(false);
  await change(screen, capacity, "2.8");
  expect(unload()).toBe(false);
  await change(screen, label, " One ");
  expect(unload()).toBe(true);
});
it("Keep preserves independent drafts and Discard restores native fields without issuing a write", async () => {
  let writes = 0;
  const { app, screen } = await mount({
    updateTable: async () => {
      writes++;
    },
    createTable: async () => {
      writes++;
      return { id: "t3" };
    },
  });
  await change(screen, label, "Changed");
  await change(screen, capacity, "6");
  await change(screen, add, "New");
  let left = 0;
  const kept = leave(app, () => {
    left++;
  });
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(left).toBe(0);
  expect(field(screen, label).value).toBe("Changed");
  const discarded = leave(app, () => {
    left++;
  });
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(left).toBe(1);
  expect(field(screen, label).shadowRoot!.querySelector("input")!.value).toBe("One");
  expect(field(screen, capacity).shadowRoot!.querySelector("input")!.value).toBe("2");
  expect(field(screen, add).value).toBe("");
  expect(writes).toBe(0);
  expect(unload()).toBe(false);
});
it("retained Plano and zone view tabs keep drafts without a discard question", async () => {
  const { app, screen } = await mount();
  await change(screen, label, "Changed");
  field(screen, "[data-tab=plano]").click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-floor-canvas")).toBeTruthy();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(true);
  field(screen, "[data-tab=config]").click();
  await screen.updateComplete;
  expect(field(screen, label).value).toBe("Changed");
});
it("commits the exact row body before a failed refresh and leaves its sibling and Add drafts protected", async () => {
  let body: unknown;
  let written = false;
  const { app, screen } = await mount({
    updateTable: async (id, input) => {
      body = { id, input };
      written = true;
    },
    listTables: async () => {
      if (written) throw { code: "connection.failed" };
      return seed;
    },
  });
  await change(screen, label, " One saved ");
  await change(screen, capacity, "6");
  await change(screen, "[data-test=table-label-t2]", "Sibling");
  await change(screen, add, "New");
  field(screen, save).click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(body).toEqual({ id: "t1", input: { label: " One saved ", capacity: 6 } });
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, label).value).toBe(" One saved ");
  expect(field(screen, capacity).value).toBe("6");
  expect(field(screen, "[data-test=table-label-t2]").value).toBe("Two");
  expect(field(screen, add).value).toBe("");
  expect(unload()).toBe(false);
});
it("omits null capacity from the existing request and commits a row without waiting for refresh", async () => {
  let body: unknown;
  const refresh = deferred<DashboardTable[]>();
  let written = false;
  const { screen } = await mount({
    updateTable: async (id, input) => {
      body = { id, input };
      written = true;
    },
    listTables: async () => (written ? refresh.promise : seed),
  });
  await change(screen, capacity, "");
  await change(screen, label, "Saved");
  field(screen, save).click();
  await expect.poll(() => body).toEqual({ id: "t1", input: { label: "Saved" } });
  await expect.poll(unload).toBe(false);
  refresh.resolve([{ ...seed[0]!, label: "Saved", capacity: null }, seed[1]!]);
});
it("keeps newer row input dirty against the submitted snapshot", async () => {
  const write = deferred<void>();
  let rows = seed;
  const { app, screen } = await mount({
    updateTable: async () => write.promise,
    listTables: async () => rows,
  });
  await change(screen, label, "Submitted");
  field(screen, save).click();
  await change(screen, label, "Newer");
  rows = [{ ...seed[0]!, label: "Submitted" }, seed[1]!];
  write.resolve();
  await expect.poll(() => field(screen, save).getAttribute("disabled")).toBeNull();
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, label).value).toBe("Submitted");
});
it("a refused row save retains its dirty values and retry action", async () => {
  const { app, screen } = await mount({
    updateTable: async () => {
      throw { code: "table.not_found" };
    },
  });
  await change(screen, label, "Refused");
  field(screen, save).click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  await pending;
  expect(field(screen, label).value).toBe("Refused");
  expect(field(screen, save).getAttribute("disabled")).toBeNull();
});
it("Create sends its trimmed body directly and commits before a failed refresh", async () => {
  let body: unknown;
  let written = false;
  const { app, screen } = await mount({
    createTable: async (input) => {
      body = input;
      written = true;
      return { id: "t3" };
    },
    listTables: async () => {
      if (written) throw { code: "connection.failed" };
      return seed;
    },
  });
  await change(screen, add, " New ");
  field(screen, "[data-add-table]").click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(body).toEqual({ label: "New" });
  expect(field(screen, add).value).toBe("");
  expect(unload()).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("Create keeps later input and Discard restores its last accepted empty baseline", async () => {
  const write = deferred<{ id: string }>();
  const { app, screen } = await mount({ createTable: async () => write.promise });
  await change(screen, add, "Submitted");
  field(screen, "[data-add-table]").click();
  await change(screen, add, "Newer");
  write.resolve({ id: "t3" });
  await expect.poll(() => field(screen, "[data-add-table]").getAttribute("disabled")).toBeNull();
  expect(field(screen, add).value).toBe("Newer");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, add).value).toBe("");
});
it("a refused Create retains the changed label", async () => {
  const { screen } = await mount({
    createTable: async () => {
      throw { code: "table.not_found" };
    },
  });
  await change(screen, add, "Refused");
  field(screen, "[data-add-table]").click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  expect(unload()).toBe(true);
  expect(field(screen, add).value).toBe("Refused");
});
it("live reads update clean capacity while preserving the label draft and its original baseline", async () => {
  let rows = seed;
  const { app, screen, liveData } = await mount({ listTables: async () => rows });
  await change(screen, label, "Changed");
  rows = [{ ...seed[0]!, label: "External", capacity: 8 }, seed[1]!];
  liveData.refresh();
  await expect.poll(() => field(screen, capacity).value).toBe("8");
  expect(field(screen, label).value).toBe("Changed");
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, label).value).toBe("One");
  expect(field(screen, capacity).value).toBe("8");
  expect(unload()).toBe(false);
});
it("live removal keeps a dirty table but disposes clean rows before they disappear", async () => {
  let rows = seed;
  const { app, screen, liveData } = await mount({ listTables: async () => rows });
  await change(screen, label, "Retained");
  rows = [];
  liveData.refresh();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=table-row-t2]")).toBeNull();
  expect(field(screen, label).value).toBe("Retained");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, label).value).toBe("One");
  liveData.refresh();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=table-row-t1]")).toBeNull();
  expect(unload()).toBe(false);
});
it("unchanged live reads preserve a pending question", async () => {
  const { app, screen, liveData } = await mount();
  await change(screen, label, "Changed");
  const pending = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  liveData.refresh();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});
for (const action of ["zone", "deactivate", "enable", "placement"] as const) {
  it(`the immediate ${action} write remains exempt and cannot commit an edited row label`, async () => {
    let rows = seed;
    let body: unknown;
    const { app, screen } = await mount({
      listTables: async () => rows,
      updateTable: async (id, patch) => {
        body = { id, patch };
        rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
      },
      deactivateTable: async (id) => {
        body = id;
        rows = rows.map((row) => (row.id === id ? { ...row, active: false } : row));
      },
      setTablePlacement: async (id, patch) => {
        body = { id, patch };
        rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
      },
    });
    if (action === "enable") {
      field(screen, "[data-test=table-deactivate-t1]").click();
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=table-enable-t1]"))
        .toBeTruthy();
    }
    await change(screen, label, "Unsaved");
    body = undefined;
    if (action === "zone")
      field(screen, "[data-test=table-zone-t1]").dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "z1" }, bubbles: true, composed: true }),
      );
    else if (action === "placement") {
      field(screen, "[data-tab=plano]").click();
      await screen.updateComplete;
      screen.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
        new CustomEvent("wt-placement-change", {
          detail: {
            tableId: "t1",
            posX: 500,
            posY: 500,
            shape: "round",
            rotation: 0,
            zoneId: "z1",
          },
          bubbles: true,
          composed: true,
        }),
      );
    } else field(screen, `[data-test=table-${action}-t1]`).click();
    await expect.poll(() => body).toBeDefined();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(true);
    if (action === "placement") {
      field(screen, "[data-tab=config]").click();
      await screen.updateComplete;
    }
    const pending = leave(app);
    await choose(app, "discard");
    await pending;
    await screen.updateComplete;
    expect(field(screen, label).value).toBe("One");
  });
}
it("child disposal removes the unload scope and reconnect starts from fetched rows", async () => {
  const { app, screen } = await mount();
  await change(screen, label, "Departed");
  await change(screen, add, "New");
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=table-row-t2]"))
    .toBeTruthy();
  expect(field(screen, label).value).toBe("One");
  expect(field(screen, add).value).toBe("");
  expect(unload()).toBe(false);
});
for (const kind of ["create", "save", "zone", "disable", "enable", "placement", "clear"] as const) {
  for (const outcome of ["success", "refusal"] as const) {
    it(`ignores a departed ${kind} ${outcome} after reconnect`, async () => {
      const write = deferred<never>();
      const override =
        kind === "create"
          ? { createTable: async () => write.promise }
          : kind === "save" || kind === "zone" || kind === "enable"
            ? { updateTable: async () => write.promise }
            : kind === "disable"
              ? { deactivateTable: async () => write.promise }
              : kind === "placement"
                ? { setTablePlacement: async () => write.promise }
                : { clearPlacement: async () => write.promise };
      let reads = 0;
      const rows = kind === "enable" ? [{ ...seed[0]!, active: false }, seed[1]!] : seed;
      const { app, screen } = await mount({
        ...override,
        listTables: async () => {
          reads++;
          return rows;
        },
      });
      await change(screen, kind === "create" ? add : label, "Departed");
      if (kind === "create" || kind === "save" || kind === "disable" || kind === "enable")
        field(
          screen,
          kind === "create"
            ? "[data-add-table]"
            : kind === "save"
              ? save
              : kind === "enable"
                ? "[data-test=table-enable-t1]"
                : "[data-test=table-deactivate-t1]",
        ).click();
      else if (kind === "zone")
        field(screen, "[data-test=table-zone-t1]").dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "z1" }, bubbles: true, composed: true }),
        );
      else {
        field(screen, "[data-tab=plano]").click();
        await screen.updateComplete;
        screen.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
          new CustomEvent(kind === "clear" ? "wt-placement-clear" : "wt-placement-change", {
            detail: {
              tableId: "t1",
              posX: 500,
              posY: 500,
              shape: "round",
              rotation: 0,
              zoneId: "z1",
            },
            bubbles: true,
            composed: true,
          }),
        );
      }
      screen.remove();
      app.shadowRoot!.prepend(screen);
      await screen.updateComplete;
      if (
        screen.shadowRoot!.querySelector("[data-tab=config]")!.getAttribute("variant") !== "primary"
      ) {
        field(screen, "[data-tab=config]").click();
        await screen.updateComplete;
      }
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=table-row-t2]"))
        .toBeTruthy();
      await change(screen, label, "Replacement");
      await change(screen, add, "Replacement new");
      const readsBeforeReply = reads;
      if (outcome === "success") write.resolve(undefined as never);
      else write.reject({ code: "table.not_found" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await screen.updateComplete;
      expect(reads).toBe(readsBeforeReply);
      expect(field(screen, label).value).toBe("Replacement");
      expect(field(screen, add).value).toBe("Replacement new");
      expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      expect(field(screen, save).getAttribute("disabled")).toBeNull();
      expect(unload()).toBe(true);
    });
  }
}

it("a clean live row adopts its new baseline and later Discard restores that value", async () => {
  let rows = seed;
  const { app, screen, liveData } = await mount({ listTables: async () => rows });
  rows = [{ ...seed[0]!, label: "External", capacity: 8 }, seed[1]!];
  liveData.refresh();
  await expect.poll(() => field(screen, label).value).toBe("External");
  expect(unload()).toBe(false);
  await change(screen, label, "Changed");
  const pending = leave(app);
  await choose(app, "discard");
  await pending;
  await screen.updateComplete;
  expect(field(screen, label).value).toBe("External");
  expect(field(screen, capacity).value).toBe("8");
  expect(unload()).toBe(false);
});
it("removing all clean rows releases their scopes without another unload warning", async () => {
  let rows = seed;
  const { screen, liveData } = await mount({ listTables: async () => rows });
  rows = [];
  liveData.refresh();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=table-row-t1]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[data-test=table-row-t2]")).toBeNull();
  expect(unload()).toBe(false);
});
it("new input invalidates a pending decision without discarding the replacement draft", async () => {
  const { app, screen } = await mount();
  await change(screen, label, "Changed");
  let left = 0;
  const pending = leave(app, () => {
    left++;
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await change(screen, capacity, "7");
  expect(await pending).toBe("stale");
  expect(left).toBe(0);
  expect(field(screen, label).value).toBe("Changed");
  expect(field(screen, capacity).value).toBe("7");
  expect(unload()).toBe(true);
});
it("a successful row write invalidates an older decision before refresh finishes", async () => {
  const write = deferred<void>();
  const refresh = deferred<DashboardTable[]>();
  let written = false;
  const { app, screen } = await mount({
    updateTable: async () => {
      await write.promise;
      written = true;
    },
    listTables: async () => (written ? refresh.promise : seed),
  });
  await change(screen, label, "Saved");
  field(screen, save).click();
  let left = 0;
  const pending = leave(app, () => {
    left++;
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  write.resolve();
  expect(await pending).toBe("stale");
  expect(left).toBe(0);
  expect(unload()).toBe(false);
  refresh.resolve([{ ...seed[0]!, label: "Saved" }, seed[1]!]);
});

it("a clean page leaves directly once without a question", async () => {
  const { app } = await mount();
  let left = 0;
  expect(
    await leave(app, () => {
      left++;
    }),
  ).toBe("proceeded");
  expect(left).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
