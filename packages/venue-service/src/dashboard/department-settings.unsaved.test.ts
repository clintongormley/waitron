import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import "./department-settings.js";
import "./department-page.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      defaultServiceMode: "table_tab",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", defaultServiceMode: "prepay", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      defaultServiceMode: "prepay",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Terrace",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
      active: true,
    },
  ],
  floorZones: [],
  readiness: [],
  salePolicies: {
    departments: [
      {
        departmentId: "d1",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    ],
    zones: [
      {
        zoneId: "z1",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        effective: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
      {
        zoneId: "z2",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
          printTradingName: false,
        },
      },
      {
        zoneId: "z3",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
    ],
  },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-settings></department-settings
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a8-settings-leave-app", App);
let app: App;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(request?: DashboardRequest) {
  app = document.createElement("a8-settings-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-settings")!;
  el.model = structuredClone(model);
  el.departmentId = "d1";
  el.api = new VenueServiceApi(
    request ??
      ((async (path) =>
        path.endsWith("/profiles")
          ? []
          : {
              departmentId: "d1",
              receivingProfileId: null,
              destinationDepartmentIds: [],
            }) as DashboardRequest),
  );
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choice(value: "keep" | "discard") {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

it("Cancel asks, Keep retains and Discard restores the whole form", async () => {
  const el = await mount();
  const change = async (value: string) => {
    el.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
  expect(unload()).toBe(false);
  await change("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("keep");
  expect(
    (el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("discard");
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Restaurant");
  expect(unload()).toBe(false);
});
it("reconnect retains the draft against its original baseline", async () => {
  const el = await mount();
  el.shadowRoot!.querySelector("[name=tradingName]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Draft" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(unload()).toBe(true);
  el.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(el);
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector("[name=tradingName]")! as HTMLElementTagNameMap["wt-input"])
      .value,
  ).toBe("Draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("keep");
  expect(unload()).toBe(true);
});

it.each(["read-before-write", "write-before-read"] as const)(
  "a non-transfer save stays committed when %s completes",
  async (order) => {
    let readSettings!: (value: unknown) => void,
      readProfiles!: (value: unknown) => void,
      write!: () => void;
    const submitted: unknown[] = [];
    const el = await mount(((path, method, body) => {
      if (method === "GET")
        return new Promise<unknown>((resolve) => {
          if (path.endsWith("/profiles")) readProfiles = resolve;
          else readSettings = resolve;
        });
      submitted.push(body);
      return new Promise<void>((resolve) => (write = resolve));
    }) as DashboardRequest);
    const name = el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"];
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Saved name" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const save = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
    save().click();
    await el.updateComplete;
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).not.toHaveProperty("transfers");
    const finishRead = async () => {
      readSettings({
        departmentId: "d1",
        receivingProfileId: "p1",
        destinationDepartmentIds: ["d2"],
      });
      readProfiles([{ id: "p1", name: "Restaurant desk" }]);
      await expect
        .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
        .not.toBeNull();
    };
    if (order === "read-before-write") {
      await finishRead();
      write();
    } else {
      write();
      await expect.poll(() => name.disabled).toBe(false);
      await finishRead();
    }
    await expect.poll(() => name.disabled).toBe(false);
    await el.updateComplete;
    expect(save().disabled).toBe(true);
    expect(save().variant).toBe("secondary");
    expect(unload()).toBe(false);
    let proceeded = false;
    expect(
      await app.leave.coordinator.request({
        scopes: "all",
        reason: "navigation",
        proceed: () => {
          proceeded = true;
        },
      }),
    ).toBe("proceeded");
    expect(proceeded).toBe(true);
    await app.updateComplete;
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    name.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "New draft" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await choice("discard");
    await el.updateComplete;
    expect(name.value).toBe("Saved name");
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.checked,
    ).toBe(true);
    expect(unload()).toBe(false);
  },
);
it("destination deactivation retains other drafts against their original baseline", async () => {
  const el = await mount((async (path) =>
    path.endsWith("/profiles")
      ? []
      : {
          departmentId: "d1",
          receivingProfileId: null,
          destinationDepartmentIds: ["d2"],
        }) as DashboardRequest);
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  const view = structuredClone(model);
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",
    defaultServiceMode: "prepay",
    active: true,
  });
  el.model = view;
  await el.updateComplete;
  const name = el.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"];
  name.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Name draft" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.checked,
  ).toBe(true);
  await el.updateComplete;
  const live = structuredClone(view);
  live.departments[1]!.active = false;
  el.model = live;
  await el.updateComplete;
  expect(name.value).toBe("Name draft");
  expect(unload()).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("discard");
  await el.updateComplete;
  expect(name.value).toBe("Restaurant");
  expect(unload()).toBe(false);
  const bodies: unknown[] = [];
  el.api = new VenueServiceApi((async (_path, _method, body) => {
    bodies.push(body);
  }) as DashboardRequest);
  name.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Valid correction" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => bodies.length).toBe(1);
  expect((bodies[0] as { transfers: unknown }).transfers).toEqual({
    receivingProfileId: null,
    destinationDepartmentIds: [],
  });
});

async function nativeSettingsDraft(kind: "tradingName" | "receivingProfileId" | "destination") {
  const writes: unknown[][] = [];
  const el = await mount((async (path, method, body) => {
    if (method !== "GET") {
      writes.push([path, method, body]);
      return;
    }
    return path.endsWith("/profiles")
      ? [{ id: "p1", name: "Restaurant desk" }]
      : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
  }) as DashboardRequest);
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  const field =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tradingName]")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  const profile = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "[name=receivingProfileId]",
  )!;
  const destination = el.shadowRoot!.querySelector<HTMLInputElement>(
    "[name=transferDestination-d2]",
  )!;
  const change = async (edited: boolean) => {
    if (kind === "tradingName")
      await userEvent.fill(page.elementLocator(input), edited ? "Draft trading name" : "Casa");
    else if (kind === "receivingProfileId") await chooseOption(profile, edited ? "p1" : "");
    else if (destination.checked !== edited)
      await userEvent.click(page.elementLocator(destination));
    await el.updateComplete;
  };
  const value = () =>
    kind === "tradingName"
      ? input.value
      : kind === "receivingProfileId"
        ? profile.value
        : destination.checked;
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
  const state = async () => {
    await save.updateComplete;
    return {
      variant: save.variant,
      disabled: save.disabled,
      nativeDisabled: save.shadowRoot!.querySelector("button")!.disabled,
    };
  };
  const cancel = async () => {
    const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=cancel-editor]",
    )!;
    await button.updateComplete;
    await userEvent.click(page.elementLocator(button.shadowRoot!.querySelector("button")!));
  };
  return { el, writes, change, value, save, state, cancel };
}

it.each(["tradingName", "receivingProfileId", "destination"] as const)(
  "native %s retains Keep, reverts cleanly and discards without writing",
  async (kind) => {
    const { writes, change, value, state, cancel } = await nativeSettingsDraft(kind);
    const original = kind === "tradingName" ? "Casa" : kind === "receivingProfileId" ? "" : false;
    const edited =
      kind === "tradingName" ? "Draft trading name" : kind === "receivingProfileId" ? "p1" : true;
    expect(await state()).toEqual({ variant: "secondary", disabled: true, nativeDisabled: true });
    await change(true);
    expect(await state()).toEqual({ variant: "primary", disabled: false, nativeDisabled: false });
    expect(unload()).toBe(true);
    await cancel();
    await choice("keep");
    expect(value()).toBe(edited);
    expect(unload()).toBe(true);
    expect(writes).toEqual([]);
    await change(false);
    expect(await state()).toEqual({ variant: "secondary", disabled: true, nativeDisabled: true });
    expect(unload()).toBe(false);
    await cancel();
    await app.updateComplete;
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    await change(true);
    await cancel();
    await choice("discard");
    await expect.poll(value).toBe(original);
    expect(unload()).toBe(false);
    expect(await state()).toEqual({ variant: "secondary", disabled: true, nativeDisabled: true });
    expect(writes).toEqual([]);
  },
);

it.each(["tradingName", "receivingProfileId"] as const)(
  "an accepted %s save cancels a pending discard and protects the next draft",
  async (kind) => {
    const { el, writes, change, value, state, save, cancel } = await nativeSettingsDraft(kind);
    await change(true);
    await cancel();
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    save.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => save.disabled).toBe(true);
    await expect.poll(() => question.open).toBe(false);
    expect(writes).toEqual([
      [
        "/management-api/venue-service/departments/d1/settings",
        "PUT",
        {
          name: "Restaurant",
          tradingName: kind === "tradingName" ? "Draft trading name" : "Casa",
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
          transfers: {
            receivingProfileId: kind === "receivingProfileId" ? "p1" : null,
            destinationDepartmentIds: [],
          },
        },
      ],
    ]);
    expect(unload()).toBe(false);
    await change(false);
    const newValue = kind === "tradingName" ? "Casa" : "";
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(value()).toBe(newValue);
    expect(unload()).toBe(true);
    expect(await state()).toEqual({ variant: "primary", disabled: false, nativeDisabled: false });
    await cancel();
    await choice("discard");
    await expect.poll(value).toBe(kind === "tradingName" ? "Draft trading name" : "p1");
    expect(unload()).toBe(false);
    expect(writes).toHaveLength(1);
  },
);

it.each(["tradingName", "receivingProfileId"] as const)(
  "a refused %s save remains dirty and retryable through Keep",
  async (kind) => {
    const { el, change, value, state, save, cancel } = await nativeSettingsDraft(kind);
    const request = vi.fn(async () => {
      throw { code: "management.request_invalid", params: { field: kind } };
    });
    el.api = new VenueServiceApi(request as DashboardRequest);
    await change(true);
    save.click();
    await expect.poll(() => request.mock.calls.length).toBe(1);
    await expect
      .poll(() => el.shadowRoot!.querySelector(`[name=${kind}]`)!.getAttribute("error"))
      .not.toBe("");
    expect(await state()).toEqual({ variant: "primary", disabled: false, nativeDisabled: false });
    await cancel();
    await choice("keep");
    expect(value()).toBe(kind === "tradingName" ? "Draft trading name" : "p1");
    expect(unload()).toBe(true);
    expect(await state()).toEqual({ variant: "primary", disabled: false, nativeDisabled: false });
    expect(request.mock.calls).toEqual([
      [
        "/management-api/venue-service/departments/d1/settings",
        "PUT",
        {
          name: "Restaurant",
          tradingName: kind === "tradingName" ? "Draft trading name" : "Casa",
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
          transfers: {
            receivingProfileId: kind === "receivingProfileId" ? "p1" : null,
            destinationDepartmentIds: [],
          },
        },
      ],
    ]);
  },
);

it("keeps native edits made during Save dirty against the submitted Settings snapshot", async () => {
  let finish!: () => void;
  const writes: unknown[][] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? []
        : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
    writes.push([path, method, body]);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  const control =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tradingName]")!;
  await control.updateComplete;
  const native = control.shadowRoot!.querySelector("input")!;
  try {
    await userEvent.fill(page.elementLocator(native), "Submitted name");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    await el.updateComplete;
    await control.updateComplete;
    expect(native.disabled).toBe(false);
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
    const cancel = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=cancel-editor]",
    )!;
    await save.updateComplete;
    await cancel.updateComplete;
    expect(save.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    expect(cancel.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    save.click();
    await el.updateComplete;
    expect(writes).toHaveLength(1);
    await userEvent.fill(page.elementLocator(native), "Newer name");
    finish();
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
            "[data-test=cancel-editor]",
          )!.disabled,
      )
      .toBe(false);
    expect(native.value).toBe("Newer name");
    expect(unload()).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await choice("keep");
    expect(native.value).toBe("Newer name");
    await userEvent.fill(page.elementLocator(native), " Submitted name ");
    expect(unload()).toBe(false);
    expect(writes[0]).toEqual([
      "/management-api/venue-service/departments/d1/settings",
      "PUT",
      {
        name: "Restaurant",
        tradingName: "Submitted name",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
        transfers: { receivingProfileId: null, destinationDepartmentIds: [] },
      },
    ]);
    expect(writes).toHaveLength(1);
  } finally {
    finish?.();
  }
});

it("a native receiving-profile edit during Save retains the submitted baseline and action states", async () => {
  let finish!: () => void;
  const writes: unknown[][] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? [
            { id: "p1", name: "Restaurant desk" },
            { id: "p2", name: "Deli desk" },
          ]
        : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
    writes.push([path, method, body]);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "[name=receivingProfileId]",
  )!;
  const pick = async (value: string) => {
    await control.updateComplete;
    await userEvent.click(
      page.elementLocator(control.shadowRoot!.querySelector<HTMLElement>(".trigger")!),
    );
    await control.updateComplete;
    const label = control.options.find((option) => option.value === value)!.label;
    const option = [...control.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (node) => node.textContent!.trim() === label,
    )!;
    await userEvent.click(page.elementLocator(option));
    await el.updateComplete;
  };
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
  const state = async () => {
    await save.updateComplete;
    return {
      variant: save.variant,
      disabled: save.disabled,
      innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
    };
  };
  const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
  const ready = { variant: "primary", disabled: false, innerDisabled: false };
  expect(await state()).toEqual(quiet);
  await pick("p1");
  expect(await state()).toEqual(ready);
  save.click();
  try {
    await expect.poll(() => writes.length).toBe(1);
    await el.updateComplete;
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    expect((await state()).innerDisabled).toBe(true);
    save.dispatchEvent(new MouseEvent("click"));
    await pick("p2");
    finish();
    await expect.poll(() => save.disabled).toBe(false);
    expect(control.value).toBe("p2");
    expect(unload()).toBe(true);
    expect(await state()).toEqual(ready);
    await pick("p1");
    expect(unload()).toBe(false);
    expect(await state()).toEqual(quiet);
    expect(writes).toEqual([
      [
        "/management-api/venue-service/departments/d1/settings",
        "PUT",
        {
          name: "Restaurant",
          tradingName: "Casa",
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
          transfers: { receivingProfileId: "p1", destinationDepartmentIds: [] },
        },
      ],
    ]);
  } finally {
    finish?.();
  }
});

it("Settings left out of the page for a tick protects its retained native draft", async () => {
  const request = vi.fn(async (path: string, method = "GET") => {
    if (method !== "GET") throw new Error("Unexpected Settings write");
    return path.endsWith("/profiles")
      ? []
      : {
          departmentId: "d1",
          receivingProfileId: null,
          destinationDepartmentIds: [],
        };
  });
  const el = await mount(request as DashboardRequest);
  await expect.poll(() => request.mock.calls.length).toBe(2);
  const field =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tradingName]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Retained draft",
  );
  await el.updateComplete;
  expect(unload()).toBe(true);
  el.remove();
  expect(unload()).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  app.shadowRoot!.append(el);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unload()).toBe(true);
  expect(field.shadowRoot!.querySelector("input")!.value).toBe("Retained draft");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choice("keep");
  expect(field.shadowRoot!.querySelector("input")!.value).toBe("Retained draft");
  expect(unload()).toBe(true);
  expect(request.mock.calls.filter((call) => call[1] !== undefined && call[1] !== "GET")).toEqual(
    [],
  );
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Casa");
  await el.updateComplete;
  expect(unload()).toBe(false);
});
