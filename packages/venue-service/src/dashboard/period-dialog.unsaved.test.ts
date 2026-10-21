import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PeriodDialog } from "./period-dialog.js";
import "./period-dialog.js";

class PeriodLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  draftParent?: object;
  override render() {
    return html`<period-dialog
        .open=${true}
        .draftParent=${this.draftParent}
        departmentName="Restaurant"
        .menus=${[{ id: "lunch", name: "Lunch", active: true, includes: [] }]}
        .period=${{ id: "p1", name: "Lunch", colour: "blue", menuId: "lunch", staffMenuIds: [], weekdays: [1] }}
      ></period-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("period-dialog-leave-test-app", PeriodLeaveApp);
let app: PeriodLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(draftParent?: object) {
  app = document.createElement("period-dialog-leave-test-app") as PeriodLeaveApp;
  app.draftParent = draftParent;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<PeriodDialog>("period-dialog")!;
  await el.updateComplete;
  return el;
}
function name(el: PeriodDialog) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]");
  expect(field).not.toBeNull();
  return field!;
}
async function change(el: PeriodDialog, value: string) {
  name(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function modal(el: PeriodDialog) {
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal");
  expect(modal).not.toBeNull();
  return modal!;
}
function save(el: PeriodDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-period]",
  )!;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function reconnect(el: PeriodDialog) {
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  expect(unload()).toBe(false);
  parent.appendChild(el);
  await el.updateComplete;
}

it("asks before closing a changed period and Keep preserves the editor", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "Dinner");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(el.open).toBe(true);
  expect(name(el).value).toBe("Dinner");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.open).toBe(false);
  expect(unload()).toBe(false);
});

it("restoring the opened values makes Save quiet and closes without asking", async () => {
  const el = await mount();
  await change(el, "Dinner");
  await change(el, "Lunch");
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
});

it("asks for an edit made after removal and reconnect", async () => {
  const el = await mount();
  await reconnect(el);
  await change(el, "Dinner");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("retains an edit made before removal and still compares it to the opened values", async () => {
  const el = await mount();
  await change(el, "Dinner");
  await reconnect(el);
  expect(name(el).value).toBe("Dinner");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
});

it("a saved submission becomes the baseline without losing edits made while it was saving", async () => {
  const el = await mount();
  await change(el, "Dinner");
  save(el).click();
  await change(el, "Evening");
  expect(
    el.commitSubmitted({ name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: [] }),
  ).toBe(false);
  expect(name(el).value).toBe("Evening");
  expect(unload()).toBe(true);
  await reconnect(el);
  await change(el, "Dinner");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});

it("a submission that began before removal cannot commit after reconnect", async () => {
  const el = await mount();
  await change(el, "Dinner");
  save(el).click();
  await reconnect(el);
  expect(
    el.commitSubmitted({ name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: [] }),
  ).toBe(false);
  expect(unload()).toBe(true);
  expect(save(el).disabled).toBe(false);
});

it("changing the draft cancels a pending discard answer", async () => {
  const el = await mount();
  await change(el, "Dinner");
  const close = modal(el).requestClose("cancel");
  expect((await question()).open).toBe(true);
  await change(el, "Evening");
  expect(await close).toBe(false);
  expect((await question()).open).toBe(false);
  expect(el.open).toBe(true);
  expect(unload()).toBe(true);
});

it("busy and disconnected editors refuse a retained close guard", async () => {
  const el = await mount();
  await change(el, "Dinner");
  const guard = modal(el).beforeClose!;
  el.busy = true;
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
  expect((await question()).open).toBe(false);
  el.busy = false;
  el.remove();
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
});

class PeriodLeaveConfigApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<period-dialog></period-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("period-dialog-leave-config-app", PeriodLeaveConfigApp);
async function mountWith(setup: (el: PeriodDialog) => void) {
  app = document.createElement("period-dialog-leave-config-app") as PeriodLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<PeriodDialog>("period-dialog")!;
  el.menus = [{ id: "lunch", name: "Lunch", active: true, includes: [] }];
  setup(el);
  el.open = true;
  await el.updateComplete;
  return el;
}

it("Delete… on a changed draft asks first: keep emits nothing and keeps the draft; discard closes and emits once", async () => {
  const el = await mountWith((el) => {
    el.departmentName = "Restaurant";
    el.period = {
      id: "p1",
      name: "Lunch",
      colour: "blue",
      menuId: "lunch",
      staffMenuIds: [],
      endOffsetMinutes: 0,
      floorPlanSetId: null,
      weekdays: [1],
      routingUses: [],
    };
    el.deletable = true;
  });
  const events: { type: string; detail: unknown }[] = [];
  for (const type of ["period-close", "period-delete"])
    el.addEventListener(type, (e) => events.push({ type, detail: (e as CustomEvent).detail }));
  const button = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=delete-period]")!;
  await change(el, "Dinner");
  button().click();
  await choose("keep");
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(el.open).toBe(true);
  expect(name(el).value).toBe("Dinner");
  button().click();
  await choose("discard");
  await expect.poll(() => events.length).toBe(2);
  expect(events).toEqual([
    { type: "period-close", detail: null },
    { type: "period-delete", detail: { periodId: "p1" } },
  ]);
  expect(el.open).toBe(false);
});

it("changing only the department of a new period makes it dirty, and choosing it back makes it clean", async () => {
  const el = await mountWith((el) => {
    el.departments = [
      {
        id: "restaurant",
        name: "Restaurant",
        colourUsers: [
          { name: "Lunch", colour: "red" },
          { name: "Dinner", colour: "amber" },
        ],
      },
      { id: "bar", name: "Bar", colourUsers: [{ name: "All day", colour: "red" }] },
    ];
  });
  const department = async (value: string) => {
    el.shadowRoot!.querySelector("[name=departmentId]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
  expect(unload()).toBe(false);
  await department("bar");
  expect(unload()).toBe(true);
  expect(save(el).variant).toBe("primary");
  await department("");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});

it("a dialog given a draft parent is asked about only with that parent", async () => {
  const root = {};
  const el = await mount(root);
  await change(el, "Dinner");
  const asked = app.leave.coordinator.request({
    scopes: [root],
    reason: "navigation",
    proceed() {},
  });
  await choose("keep");
  expect(await asked).not.toBe("proceeded");
  expect(
    await app.leave.coordinator.request({ scopes: [{}], reason: "navigation", proceed() {} }),
  ).toBe("proceeded");
  expect((await question()).open).toBe(false);
  app.remove();
  const plain = await mount();
  await change(plain, "Dinner");
  expect(
    await app.leave.coordinator.request({ scopes: [root], reason: "navigation", proceed() {} }),
  ).toBe("proceeded");
  expect((await question()).open).toBe(false);
});

it("a Floor plan-only change protects navigation and choosing the default back makes it clean", async () => {
  const el = await mount();
  el.departmentId = "restaurant";
  el.floorPlans = [
    {
      id: "restaurant",
      sets: [
        { id: "house", name: "House", isDefault: true },
        { id: "dinner", name: "Dinner", isDefault: false },
      ],
    },
  ];
  await el.updateComplete;
  const plan =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=floorPlanSetId]")!;
  expect(plan).not.toBeNull();
  const pick = async (value: string) => {
    plan.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
  expect(save(el).disabled).toBe(true);
  await pick("dinner");
  expect(unload()).toBe(true);
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(plan.value).toBe("dinner");
  await pick("");
  expect(unload()).toBe(false);
  expect(save(el).disabled).toBe(true);
});
