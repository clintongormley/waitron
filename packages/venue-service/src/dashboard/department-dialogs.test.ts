import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import {
  clockChangeConflict,
  clockChangeConflictSentence,
} from "../testing/clock-change-conflict.js";
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
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
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
      active: true,
    },
  ],
  floorZones: [{ id: "z1", name: "Patio", active: true }],
  salePolicies: { departments: [], zones: [] },
  readiness: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  printMovedSlips: true,
  releaseReminderMinutes: null,
  needsClearingDepartmentIds: [],
};
export const dialogs: DepartmentDialog[] = [
  { kind: "add-department" },
  { kind: "add-zone", departmentId: "d1" },
  { kind: "add-to-department", row: { id: "z2", name: "Garden" } },
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

it.each(dialogs)("$kind starts quiet and saves only a changed draft", async (dialog) => {
  const { el, request } = await mount(dialog);
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  save(el).click();
  await el.updateComplete;
  expect(request).not.toHaveBeenCalled();
  if (dialog.kind === "add-to-department") await chooseOption(field(el, "departmentId"), "d2");
  else await change(el, "name", "New name");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await expect.poll(() => el.dialog).toBeUndefined();
});
it.each(dialogs)("$kind orders Cancel before its action", async (dialog) => {
  const { el } = await mount(dialog);
  const footer = el.shadowRoot!.querySelector("wt-form-actions")!;
  expect([...footer.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test"))).toEqual(
    ["cancel-editor", "save-editor"],
  );
});
it.each(dialogs)("$kind opens a standard-width modal at the medium height", async (dialog) => {
  const { el } = await mount(dialog);
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(modal.getAttribute("size")).toBe("standard");
  expect(modal.getAttribute("height")).toBe("medium");
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
  const { el, request } = await mount({ kind: "add-to-department", row: view.floorZones[0]! });
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
  expect(el.dialog?.kind).toBe("add-to-department");
});
it("move lists only other active departments and preserves the override", async () => {
  const { el, request } = await mount(
    ({ kind: "add-to-department", row: view.floorZones[0]! } as const)!,
  );
  const box = field(el, "departmentId") as unknown as HTMLElementTagNameMap["wt-combobox"];
  expect(box.options).toEqual([{ value: "d2", label: "Deli" }]);
  await chooseOption(box, "d2");
  save(el).click();
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/zones/z1", "PUT", {
    departmentId: "d2",
  });
});
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
  if (dialog.kind === "add-to-department") await chooseOption(field(el, "departmentId"), "d2");
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

it("a department add refused by a waiting business-day start names the clashing range at the bottom", async () => {
  const request = vi.fn().mockRejectedValueOnce(clockChangeConflict);
  const { el } = await mount(dialogs[0]!, request);
  await change(el, "name", "Brunch");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe(clockChangeConflictSentence);
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
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

it.each(dialogs)("$kind puts Cancel before the action in native keyboard order", async (dialog) => {
  const { el } = await mount(dialog);
  if (dialog.kind === "add-to-department") await chooseOption(field(el, "departmentId"), "d2");
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

it.each(["department", "zone"] as const)(
  "explains an active %s name refusal without offering Enable",
  async (kind) => {
    const { el } = await mount(
      kind === "department" ? dialogs[0]! : dialogs[1]!,
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

it.each(["management.request_invalid", "department.not_found"])(
  "puts a refused move destination beside its field: %s",
  async (code) => {
    const { el } = await mount(
      ({ kind: "add-to-department", row: view.floorZones[0]! } as const)!,
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
  const { el, request } = await mount(
    ({ kind: "add-to-department", row: view.floorZones[0]! } as const)!,
  );
  await change(el, "departmentId", "d3");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "departmentId").error).toBe("This field is required.");
  expect(save(el).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
  await chooseOption(field(el, "departmentId"), "d2");
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
  el.dialog = dialogs[1];
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
])("a malformed name refusal marks its field without offering Enable: %j", async (params) => {
  const { el } = await mount(
    dialogs[0]!,
    vi.fn(async () => {
      throw { code: "department.name_taken", params };
    }),
  );
  await change(el, "name", "Reserved");
  save(el).click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe("A department with this name already exists.");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
});
it("a retained close guard refuses a busy or disconnected dialog", async () => {
  let finish!: () => void;
  const { el } = await mount(
    dialogs[0]!,
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

it.each(["add", "assignment"])(
  "retained %s controls cannot change or close their replacement",
  async (kind) => {
    const { el, request } = await mount(
      kind === "add"
        ? dialogs[0]!
        : ({ kind: "add-to-department", row: view.floorZones[0]! } as const)!,
    );
    const oldModal = el.shadowRoot!.querySelector("wt-modal")!,
      oldField = field(el, kind === "add" ? "name" : "departmentId"),
      oldCancel = el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!;
    el.dialog = dialogs[1];
    await el.updateComplete;
    await change(el, "name", "Retained replacement");
    oldField.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: kind === "add" ? "Old draft" : "d2" },
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
    expect(el.dialog).toEqual(dialogs[1]);
    expect(request).not.toHaveBeenCalled();
  },
);

it.each([
  {
    index: 1,
    path: "/management-api/venue-service/zones",
    method: "POST",
    body: { name: "Changed", departmentId: "d1" },
    detail: { zoneId: "new" },
  },
  {
    index: 2,
    path: "/management-api/venue-service/zones/z2",
    method: "PUT",
    body: { departmentId: "d2" },
    detail: { zoneId: "z2" },
  },
])(
  "sends $method $path and identifies the saved row",
  async ({ index, path, method, body, detail }) => {
    const dialog = dialogs[index]!,
      { el, request } = await mount(dialog);
    const saved = vi.fn();
    el.addEventListener("saved", saved);
    if (dialog.kind === "add-to-department") await chooseOption(field(el, "departmentId"), "d2");
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

it("clean native Escape closes, emits closed and performs no write", async () => {
  const { el, request } = await mount(dialogs[0]!);
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  const box = field(el, "name");
  await box.updateComplete;
  box.shadowRoot!.querySelector<HTMLInputElement>("input")!.focus();
  const closedEvent = new Promise<void>((resolve) => {
    el.shadowRoot!.querySelector("wt-modal")!.addEventListener("wt-close", () => resolve(), {
      once: true,
    });
  });
  await userEvent.keyboard("{Escape}");
  await closedEvent;
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

it.each(dialogs.slice(0, 2))(
  "$kind leaves newer native text free of an earlier name refusal",
  async (dialog) => {
    let refuse!: (error: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const { el } = await mount(dialog, request);
    await change(el, "name", "Reserved");
    save(el).click();
    await expect.poll(() => request.mock.calls.length).toBe(1);
    await field(el, "name").updateComplete;
    const native = field(el, "name").shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(native), "New available name");
    await el.updateComplete;
    const kind = dialog.kind.endsWith("department") ? "department" : "zone";
    refuse({
      code: `${kind}.name_taken`,
      params: { name: "Reserved", [`${kind}Id`]: "disabled" },
    });
    await expect.poll(() => save(el).disabled).toBe(false);
    expect(field(el, "name").error).toBe("");
    expect(native.value).toBe("New available name");
    expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
    expect(await bottom(el)).toBe("");
    expect(el.dialog).toEqual(dialog);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it.each(dialogs.slice(0, 2))(
  "$kind paints the native Save state for clean, changed, reverted and refused names",
  async (dialog) => {
    const request = vi.fn().mockRejectedValue({ code: "connection.failed" });
    const { el } = await mount(dialog, request);
    const state = async () => {
      const button = save(el);
      await button.updateComplete;
      return {
        variant: button.variant,
        disabled: button.disabled,
        innerDisabled: button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled,
      };
    };
    const cancel = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=cancel-editor]",
    )!;
    expect(cancel.variant).toBe("secondary");
    expect(await state()).toEqual({ variant: "secondary", disabled: true, innerDisabled: true });
    save(el).dispatchEvent(new MouseEvent("click"));
    await el.updateComplete;
    expect(request).not.toHaveBeenCalled();
    expect(field(el, "name").error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(el.dialog).toEqual(dialog);
    await field(el, "name").updateComplete;
    const native = field(el, "name").shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(native), "Revised name");
    await el.updateComplete;
    expect(await state()).toEqual({ variant: "primary", disabled: false, innerDisabled: false });
    await userEvent.fill(
      page.elementLocator(native),
      "row" in dialog ? ` ${dialog.row.name} ` : " ",
    );
    await el.updateComplete;
    expect(await state()).toEqual({ variant: "secondary", disabled: true, innerDisabled: true });
    await userEvent.fill(page.elementLocator(native), "Revised name");
    await el.updateComplete;
    await save(el).updateComplete;
    await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!));
    await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
    expect(await state()).toEqual({ variant: "primary", disabled: false, innerDisabled: false });
    expect(field(el, "name").error).toBe("");
    expect(el.dialog).toEqual(dialog);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { kind: "add-to-department" as const, row: view.floorZones[0]! },
  { kind: "add-to-department" as const, row: { id: "z2", name: "Garden" } },
])("$kind places a code-only missing department refusal beside its destination", async (dialog) => {
  const { el, request } = await mount(
    dialog,
    vi.fn(async () => {
      throw { code: "department.not_found", params: {}, status: 404 };
    }),
  );
  const destination = field(el, "departmentId") as unknown as HTMLElementTagNameMap["wt-combobox"];
  await chooseOption(destination, "d2");
  save(el).click();
  await expect
    .poll(() => destination.error)
    .toBe("This value was not accepted. Change it and save again.");
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toEqual([
    `/management-api/venue-service/zones/${dialog.row.id}`,
    "PUT",
    { departmentId: "d2" },
  ]);
});

it.each(
  dialogs.slice(0, 2).flatMap((dialog) => ["en", "es"].map((locale) => ({ dialog, locale }))),
)(
  "$dialog.kind validates native input only after Save and rechecks every correction in $locale",
  async ({ dialog, locale }) => {
    setLocale(locale);
    const { el, request } = await mount(dialog);
    const control = field(el, "name");
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    const type = async (value: string) => {
      await userEvent.fill(page.elementLocator(native), value);
      await el.updateComplete;
      await control.updateComplete;
    };
    const required = locale === "es" ? "Este campo es obligatorio." : "This field is required.";
    const fix =
      locale === "es"
        ? "Corrige los campos marcados para continuar."
        : "Correct the highlighted fields to continue.";
    const adding = dialog.kind === "add-department" || dialog.kind === "add-zone";
    const refusal = adding
      ? locale === "es"
        ? "No se pudo guardar el cambio."
        : "The change could not be saved."
      : "";
    const invalidBottom = refusal ? `${refusal} ${fix}` : fix;
    expect(control.name).toBe("name");
    expect(control.required).toBe(true);
    expect(native.type).toBe("text");
    await type("Changed");
    await type("");
    expect(control.error).toBe("");
    expect(native.getAttribute("aria-invalid")).toBe("false");
    expect(await bottom(el)).toBe("");
    if (dialog.kind === "add-department" || dialog.kind === "add-zone") {
      expect(save(el).disabled).toBe(true);
      save(el).click();
      await el.updateComplete;
      expect(control.error).toBe("");
      expect(request).not.toHaveBeenCalled();
      await type("Attempted");
      request.mockRejectedValue(new Error("offline"));
      save(el).click();
      await expect
        .poll(() => bottom(el))
        .toBe(locale === "es" ? "No se pudo guardar el cambio." : "The change could not be saved.");
      await type("");
    } else save(el).click();
    await expect.poll(() => control.error).toBe(required);
    await control.updateComplete;
    expect(native.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => control.shadowRoot!.activeElement).toBe(native);
    expect(await bottom(el)).toBe(invalidBottom);
    expect(save(el).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(dialog.kind.startsWith("add-") ? 1 : 0);
    await type("Corrected");
    expect(control.error).toBe("");
    expect(native.getAttribute("aria-invalid")).toBe("false");
    expect(await bottom(el)).toBe(refusal);
    expect(save(el).disabled).toBe(false);
    await type("");
    expect(control.error).toBe(required);
    expect(native.getAttribute("aria-invalid")).toBe("true");
    expect(await bottom(el)).toBe(invalidBottom);
    expect(save(el).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(adding ? 1 : 0);
    if (adding) {
      await type("Corrected");
      let finish!: (value: unknown) => void;
      request.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      save(el).click();
      await el.updateComplete;
      expect(await bottom(el)).toBe("");
      expect(control.error).toBe("");
      expect(save(el).disabled).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      finish({ id: "created", name: "Corrected" });
      await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
    }
  },
);

it.each(
  dialogs
    .slice(0, 2)
    .flatMap((dialog) => ["validation", "refusal"].map((outcome) => ({ dialog, outcome }))),
)("$dialog.kind reopens clean after a recorded $outcome", async ({ dialog, outcome }) => {
  const { el, request } = await mount(
    dialog,
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  await change(el, "name", "Rejected");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  if (outcome === "validation") {
    await field(el, "name").updateComplete;
    const native = field(el, "name").shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await userEvent.fill(page.elementLocator(native), "");
    await el.updateComplete;
    expect(field(el, "name").error).toBe("This field is required.");
    expect(await bottom(el)).toBe(
      "The change could not be saved. Correct the highlighted fields to continue.",
    );
  }
  el.dialog = undefined;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  el.dialog = structuredClone(dialog);
  await el.updateComplete;
  const control = field(el, "name");
  await control.updateComplete;
  expect(control.value).toBe("row" in dialog ? dialog.row.name : "");
  expect(control.error).toBe("");
  expect(
    control.shadowRoot!.querySelector<HTMLInputElement>("input")!.getAttribute("aria-invalid"),
  ).toBe("false");
  expect(await bottom(el)).toBe("");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it("the Move department picker's search and empty result are Spanish", async () => {
  setLocale("es");
  const { el } = await mount(({ kind: "add-to-department", row: view.floorZones[0]! } as const)!);
  const box = field(el, "departmentId") as unknown as HTMLElementTagNameMap["wt-combobox"];
  expect([box.searchPlaceholder, box.noResultsLabel]).toEqual(["Buscar", "Sin resultados"]);
});

it("a refused Add zone keeps its exact submitted department and name", async () => {
  const { el, request } = await mount(
    dialogs[1]!,
    vi.fn(async () => {
      throw { code: "zone.name_taken" };
    }),
  );
  await change(el, "name", "Patio");
  save(el).click();
  await expect.poll(() => field(el, "name").error).toBe("A zone with this name already exists.");
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/zones", "POST", { name: "Patio", departmentId: "d1" }],
  ]);
  expect(field(el, "name").value).toBe("Patio");
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  expect(save(el).disabled).toBe(false);
});
