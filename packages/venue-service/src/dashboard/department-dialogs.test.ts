import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import type { DepartmentDialogs, DepartmentDialog } from "./department-dialogs.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
  setLocale("en");
});
export const view: VenueServiceView = {
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
      name: "Patio",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "ticket_then_pay",
      serviceModeOverride: "ticket_then_pay",
      active: true,
    },
  ],
  floorZones: [{ id: "z1", name: "Patio", active: true }],
  salePolicies: { departments: [], zones: [] },
  readiness: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};
export const dialogs: DepartmentDialog[] = [
  { kind: "add-department" },
  { kind: "rename-department", row: view.departments[0]! },
  { kind: "add-zone", departmentId: "d1" },
  { kind: "rename-zone", row: view.floorZones[0]! },
  { kind: "move-zone", row: view.floorZones[0]! },
  { kind: "add-to-department", row: { id: "z2", name: "Garden" } },
  { kind: "disable-department", row: view.departments[0]! },
  { kind: "disable-zone", row: view.floorZones[0]! },
];
async function mount(
  dialog: DepartmentDialog,
  request = vi.fn<(path: string, method?: string) => Promise<unknown>>(async () => ({
    id: "new",
    zones: [{ id: "z1", name: "Patio", activeTableCount: 2 }],
  })),
) {
  await import("./department-dialogs.js");
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("department-dialogs") as DepartmentDialogs;
  el.api = new VenueServiceApi(request as DashboardRequest);
  el.model = structuredClone(view);
  el.dialog = dialog;
  host.append(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return { el, request };
}
function field(el: DepartmentDialogs, name: string) {
  const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`);
  expect(box, name).not.toBeNull();
  return box!;
}
function save(el: DepartmentDialogs) {
  const button =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]");
  expect(button).not.toBeNull();
  return button!;
}
async function change(el: DepartmentDialogs, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function bottom(el: DepartmentDialogs) {
  return (
    (await formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!))?.textContent?.trim() ??
    ""
  );
}

it.each(dialogs.slice(0, 6))(
  "$kind starts quiet and saves only a changed draft",
  async (dialog) => {
    const { el, request } = await mount(dialog);
    expect(save(el).variant).toBe("secondary");
    expect(save(el).disabled).toBe(true);
    save(el).click();
    await el.updateComplete;
    expect(request).not.toHaveBeenCalled();
    if (dialog.kind === "move-zone" || dialog.kind === "add-to-department")
      await chooseOption(field(el, "departmentId"), "d2");
    else await change(el, "name", "New name");
    expect(save(el).variant).toBe("primary");
    expect(save(el).disabled).toBe(false);
    save(el).click();
    await expect.poll(() => el.dialog).toBeUndefined();
  },
);
it.each(dialogs)("$kind orders Cancel before its action", async (dialog) => {
  const { el } = await mount(dialog);
  const footer = el.shadowRoot!.querySelector("wt-form-actions")!;
  expect([...footer.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test"))).toEqual(
    ["cancel-editor", "save-editor"],
  );
});
it("creates a department with name only and emits the saved id", async () => {
  const { el, request } = await mount(dialogs[0]!);
  const saved = vi.fn();
  el.addEventListener("saved", saved);
  await change(el, "name", " Brunch ");
  save(el).click();
  await expect.poll(() => saved.mock.calls.length).toBe(1);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/departments", "POST", {
    name: "Brunch",
  });
  expect(saved.mock.calls[0]![0].detail).toEqual({ departmentId: "new" });
});

it("a move cannot save a destination removed by a live read", async () => {
  const { el, request } = await mount({ kind: "move-zone", row: view.floorZones[0]! });
  const destination =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
  await chooseOption(destination, "d2");
  expect(destination.value).toBe("d2");
  const next = structuredClone(view);
  next.departments = next.departments.filter((row) => row.id !== "d2");
  el.model = next;
  await el.updateComplete;
  expect(destination.options).toEqual([]);
  save(el).click();
  await el.updateComplete;
  expect(request).not.toHaveBeenCalled();
  expect(destination.error).toBe("This field is required.");
  expect(save(el).disabled).toBe(true);
  expect(el.dialog?.kind).toBe("move-zone");
});
it("move lists only other active departments and preserves the override", async () => {
  const { el, request } = await mount(dialogs[4]!);
  const box = field(el, "departmentId") as unknown as HTMLElementTagNameMap["wt-combobox"];
  expect(box.options).toEqual([{ value: "d2", label: "Deli" }]);
  await chooseOption(box, "d2");
  save(el).click();
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/zones/z1", "PUT", {
    departmentId: "d2",
    serviceMode: "ticket_then_pay",
  });
});
it.each(["department", "zone"] as const)(
  "renames a disabled %s without enabling it",
  async (kind) => {
    const row =
      kind === "department"
        ? { ...view.departments[0]!, active: false }
        : { ...view.floorZones[0]!, active: false };
    const { el, request } = await mount({
      kind: kind === "department" ? "rename-department" : "rename-zone",
      row,
    } as DepartmentDialog);
    await change(el, "name", "Renamed");
    save(el).click();
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      kind === "department"
        ? "/management-api/venue-service/departments/d1"
        : "/management-api/zones/z1",
      "PATCH",
      kind === "department"
        ? { name: "Renamed", tradingName: "Casa", defaultServiceMode: "table_tab" }
        : { name: "Renamed" },
    );
  },
);
it.each(dialogs)("$kind stays open on a real Escape during its request", async (dialog) => {
  let finish!: () => void;
  const { el } = await mount(
    dialog,
    vi.fn(async (_path: string, method?: string) =>
      method === "GET"
        ? { id: "new", zones: [] }
        : await new Promise<{ id: string; zones: [] }>((r) => {
            finish = () => r({ id: "new", zones: [] });
          }),
    ),
  );
  if (dialog.kind === "move-zone" || dialog.kind === "add-to-department")
    await chooseOption(field(el, "departmentId"), "d2");
  else if (!dialog.kind.startsWith("disable")) await change(el, "name", "Changed");
  save(el).click();
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(modal.dismissible).toBe(false);
  modal.shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  finish();
  await expect.poll(() => el.dialog).toBeUndefined();
});
it("saves on Enter in the shared name field", async () => {
  const { el, request } = await mount(dialogs[0]!);
  const box = field(el, "name");
  await box.updateComplete;
  box.shadowRoot!.querySelector<HTMLInputElement>("input")!.focus();
  await userEvent.keyboard("Brunch{Enter}");
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/departments", "POST", {
    name: "Brunch",
  });
});
it("marks a blank changed name beside the field and above Save", async () => {
  const { el, request } = await mount(dialogs[1]!);
  await change(el, "name", " ");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "name").error).toBe("This field is required.");
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
  await change(el, "name", "Fixed");
  expect(field(el, "name").error).toBe("");
  expect(await bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
});
it.each(["department", "zone"] as const)(
  "offers Enable beside a disabled %s name refusal without creating another row",
  async (kind) => {
    const id = kind === "department" ? "d2" : "z1",
      name = kind === "department" ? "Deli" : "Patio";
    const request = vi.fn(async (_path: string, method?: string) => {
      if (method === "POST")
        throw { code: `${kind}.name_disabled`, params: { name, [`${kind}Id`]: id } };
      return { id: "new", zones: [] };
    });
    const { el } = await mount(kind === "department" ? dialogs[0]! : dialogs[2]!, request);
    await change(el, "name", name);
    save(el).click();
    await expect
      .poll(() => field(el, "name").error)
      .toBe(`A disabled ${kind} already has this name. Enable it instead.`);
    expect(save(el).disabled).toBe(false);
    const enable = el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-name-clash]");
    expect(enable).not.toBeNull();
    expect(enable!.textContent!.trim()).toBe(`Enable ${name}`);
    enable!.click();
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      kind === "department"
        ? `/management-api/venue-service/departments/${id}`
        : `/management-api/zones/${id}`,
      "PATCH",
      { active: true },
    );
    expect(request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(1);
  },
);
it("keeps a refusal usable and puts only a shown field refusal beside it", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce({ code: "management.request_invalid", params: { field: "name" } })
    .mockRejectedValueOnce({
      code: "management.request_invalid",
      params: { field: "tradingName" },
    });
  const { el } = await mount(dialogs[0]!, request);
  await change(el, "name", "Brunch");
  save(el).click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe("This value was not accepted. Change it and save again.");
  expect(save(el).disabled).toBe(false);
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("shows the removal impact before disabling", async () => {
  const { el, request } = await mount(dialogs[6]!);
  expect(el.shadowRoot!.textContent).toContain("Patio");
  expect(el.shadowRoot!.textContent).toContain("2 active tables");
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/departments/d1/removal-impact",
    "GET",
    undefined,
    { passive: false },
  );
  save(el).click();
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/departments/d1", "DELETE");
});
it("holds the shared name field to the form width at 1280px", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 800);
  try {
    const { el } = await mount(dialogs[1]!);
    await change(el, "name", " ");
    save(el).click();
    await el.updateComplete;
    const probe = document.createElement("div");
    probe.style.width = "var(--wt-form-max-width)";
    el.shadowRoot!.append(probe);
    const form = probe.getBoundingClientRect().width;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.shadowRoot!.querySelector(".body")!.clientWidth).toBeGreaterThan(form);
    for (const part of [
      field(el, "name"),
      ...field(el, "name").shadowRoot!.querySelectorAll("[data-error]"),
    ])
      expect(part.getBoundingClientRect().width, part.outerHTML).toBeCloseTo(form, 0);
  } finally {
    await page.viewport(width, height);
  }
});

it.each(dialogs)("$kind puts Cancel before the action in native keyboard order", async (dialog) => {
  const { el } = await mount(dialog);
  if (dialog.kind === "move-zone" || dialog.kind === "add-to-department")
    await chooseOption(field(el, "departmentId"), "d2");
  else if (!dialog.kind.startsWith("disable")) await change(el, "name", "Changed");
  const cancel = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=cancel-editor]",
  )!;
  await cancel.updateComplete;
  cancel.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
  await userEvent.keyboard("{Tab}");
  expect(el.shadowRoot!.activeElement).toBe(save(el));
  expect(save(el).shadowRoot!.activeElement).toBe(save(el).shadowRoot!.querySelector("button"));
});

it("retains a disabled-name Enable offer when enabling fails", async () => {
  const request = vi.fn(async (_path: string, method?: string) => {
    if (method === "POST")
      throw { code: "department.name_disabled", params: { name: "Brunch", departmentId: "d2" } };
    throw { code: "connection.failed" };
  });
  const { el } = await mount(dialogs[0]!, request);
  await change(el, "name", "Brunch");
  save(el).click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=enable-name-clash]"))
    .not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-name-clash]")!.click();
  await expect.poll(() => bottom(el)).toContain("The change could not be saved.");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).not.toBeNull();
  expect(save(el).disabled).toBe(false);
});

it.each(["department", "zone"] as const)(
  "explains an active %s name refusal without offering Enable",
  async (kind) => {
    const { el } = await mount(
      kind === "department" ? dialogs[0]! : dialogs[2]!,
      vi.fn(async () => {
        throw { code: `${kind}.name_taken`, params: { name: "Taken" } };
      }),
    );
    await change(el, "name", "Taken");
    save(el).click();
    await expect
      .poll(() => field(el, "name").error)
      .toBe(`A ${kind} with this name already exists.`);
    expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
    expect(save(el).disabled).toBe(false);
    await change(el, "name", "Available");
    expect(field(el, "name").error).toBe("");
    expect(await bottom(el)).toBe("");
  },
);
it("shows a failed impact load and cannot disable without its impact", async () => {
  const { el, request } = await mount(
    dialogs[6]!,
    vi.fn(async () => {
      throw { code: "connection.failed" };
    }),
  );
  expect(await bottom(el)).toBe("The change could not be saved.");
  expect(save(el).disabled).toBe(true);
  save(el).click();
  await el.updateComplete;
  expect(request).toHaveBeenCalledTimes(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
});
it.each([
  [{ code: "department.last_active" }, "You cannot disable the last active department."],
  [
    { code: "zone.department_inactive" },
    "That zone needs an active department. Enable its department or assign it to an active one first",
  ],
  [
    { code: "zone.table_in_use", params: { tableName: "Table 4" } },
    "Table Table 4 has an open tab. Close it before disabling this department.",
  ],
  [{ code: "zone.table_in_use", params: { tableName: 1 } }, "The change could not be saved."],
  [undefined, "The change could not be saved."],
] as const)("keeps a disable refusal available to retry: %j", async (error, message) => {
  const { el } = await mount(
    dialogs[7]!,
    vi.fn(async (_path: string, method?: string) => {
      if (method === "GET") return { zones: [] };
      throw error;
    }),
  );
  save(el).click();
  await expect.poll(() => bottom(el)).toBe(message);
  expect(save(el).disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
});
it.each(["management.request_invalid", "department.not_found"])(
  "puts a refused move destination beside its field: %s",
  async (code) => {
    const { el } = await mount(
      dialogs[4]!,
      vi.fn(async () => {
        throw { code, params: { field: "departmentId" } };
      }),
    );
    await chooseOption(field(el, "departmentId"), "d2");
    save(el).click();
    await expect
      .poll(() => field(el, "departmentId").error)
      .toBe("This value was not accepted. Change it and save again.");
    expect(save(el).disabled).toBe(false);
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  },
);
it("refuses an invalid move destination and frees Save once it is corrected", async () => {
  const { el, request } = await mount(dialogs[4]!);
  await change(el, "departmentId", "d3");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "departmentId").error).toBe("This field is required.");
  expect(save(el).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
  await chooseOption(field(el, "departmentId"), "d2");
  expect(save(el).disabled).toBe(false);
});
it("explains a blocked zone Enable beside its reserved name and removes the unusable offer", async () => {
  const request = vi.fn(async (_path: string, method?: string) => {
    if (method === "POST")
      throw { code: "zone.name_disabled", params: { name: "Patio", zoneId: "z1" } };
    throw { code: "zone.department_inactive" };
  });
  const { el } = await mount(dialogs[2]!, request);
  await change(el, "name", "Patio");
  save(el).click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=enable-name-clash]"))
    .not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-name-clash]")!.click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe(
      "A disabled zone already has this name. Enable its department or assign it to an active department first.",
    );
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
  expect(save(el).disabled).toBe(false);
});

it("Cancel closes a clean dialog and emits closed without writing", async () => {
  const { el, request } = await mount(dialogs[0]!);
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});
it.each(["success", "refusal"])(
  "ignores a departed impact %s when another dialog opens",
  async (outcome) => {
    let finish!: () => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve, reject) => {
          finish = () =>
            outcome === "success"
              ? resolve({ zones: [{ id: "z1", name: "Departed", activeTableCount: 9 }] })
              : reject({ code: "connection.failed" });
        }),
    );
    const { el } = await mount(dialogs[6]!, request);
    el.dialog = dialogs[0];
    await el.updateComplete;
    finish();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(await bottom(el)).toBe("");
    expect(el.shadowRoot!.textContent).not.toContain("Departed");
    expect(save(el).disabled).toBe(true);
  },
);
it("ignores a departed refusal after the dialog is replaced", async () => {
  let reject!: (error: unknown) => void;
  const { el } = await mount(
    dialogs[0]!,
    vi.fn(
      () =>
        new Promise<unknown>((_resolve, r) => {
          reject = r;
        }),
    ),
  );
  await change(el, "name", "Old name");
  save(el).click();
  await el.updateComplete;
  el.dialog = dialogs[2];
  await el.updateComplete;
  reject({ code: "management.request_invalid", params: { field: "name" } });
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  expect(field(el, "name").error).toBe("");
  expect(await bottom(el)).toBe("");
  expect(save(el).disabled).toBe(true);
});
it.each([
  { name: "Reserved" },
  { name: "Reserved", departmentId: 1 },
  { name: 1, departmentId: "d2" },
])(
  "a malformed disabled-name refusal does not offer an unidentifiable Enable: %j",
  async (params) => {
    const { el } = await mount(
      dialogs[0]!,
      vi.fn(async () => {
        throw { code: "department.name_disabled", params };
      }),
    );
    await change(el, "name", "Reserved");
    save(el).click();
    await expect
      .poll(() => field(el, "name").error)
      .toBe("A disabled department already has this name. Enable it instead.");
    expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
  },
);
it("a retained close guard refuses a busy or disconnected dialog", async () => {
  let finish!: () => void;
  const { el } = await mount(
    dialogs[1]!,
    vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    ),
  );
  const guard = el.shadowRoot!.querySelector("wt-modal")!.beforeClose!;
  await change(el, "name", "Draft");
  save(el).click();
  await el.updateComplete;
  expect(await guard("cancel")).toBe(false);
  el.remove();
  expect(await guard("cancel")).toBe(false);
  finish();
});

it.each(["rename", "move"])(
  "retained %s controls cannot change or close their replacement",
  async (kind) => {
    const { el, request } = await mount(kind === "rename" ? dialogs[1]! : dialogs[4]!);
    const oldModal = el.shadowRoot!.querySelector("wt-modal")!,
      oldField = field(el, kind === "rename" ? "name" : "departmentId"),
      oldCancel = el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!;
    el.dialog = dialogs[2];
    await el.updateComplete;
    await change(el, "name", "Retained replacement");
    oldField.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: kind === "rename" ? "Old draft" : "d2" },
        bubbles: true,
        composed: true,
      }),
    );
    oldCancel.click();
    oldModal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    oldModal.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(field(el, "name").value).toBe("Retained replacement");
    expect(el.dialog).toEqual(dialogs[2]);
    expect(request).not.toHaveBeenCalled();
  },
);

it.each([
  {
    index: 1,
    path: "/management-api/venue-service/departments/d1",
    method: "PATCH",
    body: { name: "Changed", tradingName: "Casa", defaultServiceMode: "table_tab" },
    detail: { departmentId: "d1" },
  },
  {
    index: 2,
    path: "/management-api/venue-service/zones",
    method: "POST",
    body: { name: "Changed", departmentId: "d1" },
    detail: { zoneId: "new" },
  },
  {
    index: 3,
    path: "/management-api/zones/z1",
    method: "PATCH",
    body: { name: "Changed" },
    detail: { zoneId: "z1" },
  },
  {
    index: 4,
    path: "/management-api/venue-service/zones/z1",
    method: "PUT",
    body: { departmentId: "d2", serviceMode: "ticket_then_pay" },
    detail: { zoneId: "z1" },
  },
  {
    index: 5,
    path: "/management-api/venue-service/zones/z2",
    method: "PUT",
    body: { departmentId: "d2", serviceMode: null },
    detail: { zoneId: "z2" },
  },
  {
    index: 6,
    path: "/management-api/venue-service/departments/d1",
    method: "DELETE",
    detail: { departmentId: "d1" },
  },
  { index: 7, path: "/management-api/zones/z1", method: "DELETE", detail: { zoneId: "z1" } },
])(
  "sends $method $path and identifies the saved row",
  async ({ index, path, method, body, detail }) => {
    const dialog = dialogs[index]!,
      { el, request } = await mount(dialog);
    const saved = vi.fn();
    el.addEventListener("saved", saved);
    if (dialog.kind === "move-zone" || dialog.kind === "add-to-department")
      await chooseOption(field(el, "departmentId"), "d2");
    else if (!dialog.kind.startsWith("disable")) await change(el, "name", "Changed");
    save(el).click();
    await expect.poll(() => saved.mock.calls.length).toBe(1);
    expect(request.mock.calls.at(-1)).toEqual(body ? [path, method, body] : [path, method]);
    const event = saved.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual(detail);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  },
);

it.each([6, 7])(
  "restarts unfinished removal impact after reconnect for Disable kind %s",
  async (index) => {
    const reads: ((value: unknown) => void)[] = [];
    const request = vi.fn<(path: string, method?: string) => Promise<unknown>>(
      async (_path, method) => {
        if (method === "GET")
          return new Promise((resolve) => {
            reads.push(resolve);
          });
        return undefined;
      },
    );
    const { el } = await mount(dialogs[index]!, request);
    expect(reads).toHaveLength(1);
    expect(save(el).disabled).toBe(true);
    const parent = el.parentNode!;
    el.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    parent.append(el);
    await el.updateComplete;
    await expect.poll(() => reads.length).toBe(2);
    reads[0]!({ zones: [{ id: "z1", name: "Old impact", activeTableCount: 9 }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain("Old impact");
    expect(save(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-modal")!.dismissible).toBe(false);
    reads[1]!({ zones: [{ id: "z1", name: "Fresh impact", activeTableCount: 2 }] });
    await expect.poll(() => save(el).disabled).toBe(false);
    expect(el.shadowRoot!.textContent).toContain("Fresh impact");
    expect(el.shadowRoot!.textContent).toContain("2 active tables");
    expect(el.shadowRoot!.querySelector("wt-modal")!.dismissible).toBe(true);
    save(el).click();
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(request.mock.calls.filter((call) => call[1] === "DELETE")).toEqual([
      [
        index === 6 ? "/management-api/venue-service/departments/d1" : "/management-api/zones/z1",
        "DELETE",
      ],
    ]);
  },
);

it("clean native Escape closes, emits closed and performs no write", async () => {
  const { el, request } = await mount(dialogs[0]!);
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  const box = field(el, "name");
  await box.updateComplete;
  box.shadowRoot!.querySelector<HTMLInputElement>("input")!.focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

it.each([6, 7])(
  "clears a recovered impact read error after reconnect for Disable kind %s",
  async (index) => {
    let fresh!: (value: unknown) => void;
    const request = vi
      .fn<(path: string, method?: string) => Promise<unknown>>()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            fresh = resolve;
          }),
      );
    const { el } = await mount(dialogs[index]!, request);
    expect(await bottom(el)).toBe("The change could not be saved.");
    expect(save(el).disabled).toBe(true);
    const parent = el.parentNode!;
    el.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    parent.append(el);
    await el.updateComplete;
    expect(request).toHaveBeenCalledTimes(2);
    expect(save(el).disabled).toBe(true);
    fresh({ zones: [{ id: "z1", name: "Recovered impact", activeTableCount: 3 }] });
    await expect.poll(() => save(el).disabled).toBe(false);
    expect(el.shadowRoot!.textContent).toContain("Recovered impact");
    expect(await bottom(el)).toBe("");
  },
);

it.each([6, 7])(
  "preserves a Disable action refusal across reconnect for kind %s",
  async (index) => {
    const request = vi.fn<(path: string, method?: string) => Promise<unknown>>(
      async (_path, method) => {
        if (method === "GET") return { zones: [] };
        throw { code: "zone.table_in_use", params: { tableName: "4" } };
      },
    );
    const { el } = await mount(dialogs[index]!, request);
    save(el).click();
    await expect
      .poll(() => bottom(el))
      .toBe("Table 4 has an open tab. Close it before disabling this department.");
    const parent = el.parentNode!;
    el.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    parent.append(el);
    await el.updateComplete;
    expect(await bottom(el)).toBe(
      "Table 4 has an open tab. Close it before disabling this department.",
    );
    expect(save(el).disabled).toBe(false);
    expect(request.mock.calls.filter((call) => call[1] === "GET")).toHaveLength(1);
  },
);
