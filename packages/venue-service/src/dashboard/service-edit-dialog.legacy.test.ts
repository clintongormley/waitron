import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  editDepartmentField,
  departmentSave,
} from "../testing/department-edit-fixture.js";
import {
  cleanupZoneEditors,
  mountZoneEditor,
  editZoneName,
  zoneSave,
} from "../testing/zone-edit-fixture.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupDepartmentEditors();
  cleanupZoneEditors();
  setLocale("en");
});
async function mount(kind: "department" | "zone", request?: DashboardRequest) {
  if (kind === "department") {
    const fixture = await mountDepartmentEditor(request);
    return {
      ...fixture,
      owner: fixture.form,
      change: (value: string) => editDepartmentField(fixture.form, "name", value),
      save: () => departmentSave(fixture.form),
    };
  }
  const fixture = await mountZoneEditor(request);
  return {
    ...fixture,
    owner: fixture.el,
    change: (value: string) => editZoneName(fixture.el, value),
    save: () => zoneSave(fixture.el),
  };
}
function read(path: string) {
  if (path.endsWith("/profiles")) return [];
  if (path.endsWith("/transfers"))
    return { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
  return { tables: [] };
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it.each(["department", "zone"] as const)(
  "%s retains newer input when a save cancels its pending discard question",
  async (kind) => {
    let finish!: () => void;
    const writes: unknown[][] = [];
    const { el, owner, app, modal, change, save } = await mount(kind, (async (
      path,
      method = "GET",
      body,
    ) => {
      if (method === "GET") return read(path);
      writes.push([path, method, body]);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }) as DashboardRequest);
    const saved = vi.fn();
    el.addEventListener("saved", saved);
    const written: unknown[] = [];
    el.addEventListener("written", (event) => written.push((event as CustomEvent).detail));
    await change(" Accepted name ");
    const closing = modal.requestClose("cancel");
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    save().click();
    await expect.poll(() => writes.length).toBe(1);
    owner.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Newer protected name" },
        bubbles: true,
        composed: true,
      }),
    );
    await owner.updateComplete;
    finish();
    expect(await closing).toBe(false);
    await expect.poll(() => question.open).toBe(false);
    await expect.poll(() => save().disabled).toBe(false);
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await owner.updateComplete;
    const name = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(name.value).toBe("Newer protected name");
    expect(unload()).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(written).toEqual([kind === "department" ? { departmentId: "d1" } : { zoneId: "z1" }]);
    expect((writes[0]![2] as { name: string }).name).toBe("Accepted name");
    expect(writes).toHaveLength(1);
    await change("Accepted name");
    await save().updateComplete;
    expect({
      variant: save().variant,
      disabled: save().disabled,
      nativeDisabled: save().shadowRoot!.querySelector("button")!.disabled,
    }).toEqual({ variant: "secondary", disabled: true, nativeDisabled: true });
    expect(unload()).toBe(false);
  },
);

it.each(["department", "zone"] as const)(
  "%s ignores a save completed after disconnect and reconnect",
  async (kind) => {
    let finish!: () => void;
    const writes: unknown[][] = [];
    const { el, owner, app, change, save } = await mount(kind, (async (
      path,
      method = "GET",
      body,
    ) => {
      if (method === "GET") return read(path);
      writes.push([path, method, body]);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }) as DashboardRequest);
    const saved = vi.fn();
    el.addEventListener("saved", saved);
    await change("Retained draft");
    save().click();
    await expect.poll(() => writes.length).toBe(1);
    el.remove();
    expect(unload()).toBe(false);
    app.shadowRoot!.append(el);
    await el.updateComplete;
    await owner.updateComplete;
    finish();
    await expect.poll(() => save().disabled).toBe(false);
    await owner.updateComplete;
    expect(
      owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
    ).toBe("Retained draft");
    expect(unload()).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    expect(writes).toHaveLength(1);
  },
);

it.each(
  (["department", "zone"] as const).flatMap((kind) =>
    (["cancel", "escape"] as const).map((method) => ({ kind, method })),
  ),
)("$kind native $method keeps or discards without writing", async ({ kind, method }) => {
  const { owner, app, modal, change, writes } = await mount(kind);
  await change("Protected draft");
  const name = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await name.updateComplete;
  const input = name.shadowRoot!.querySelector("input")!;
  const dismiss = async () => {
    if (method === "cancel") {
      const cancel = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "wt-form-actions [slot=cancel]",
      )!;
      await cancel.updateComplete;
      const native = cancel.shadowRoot!.querySelector("button")!;
      const clicked = vi.fn();
      native.addEventListener("click", clicked, { once: true });
      expect(app.leave.coordinator.isDirty()).toBe(true);
      await userEvent.click(page.elementLocator(native));
      expect(clicked, "the real pointer click reaches Cancel").toHaveBeenCalledTimes(1);
    } else {
      await userEvent.click(page.elementLocator(input));
      await userEvent.keyboard("{Escape}");
    }
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  };
  const choose = async (decision: "keep" | "discard") => {
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
    await expect.poll(() => question.open).toBe(false);
  };
  await dismiss();
  await choose("keep");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(input.value).toBe("Protected draft");
  expect(unload()).toBe(true);
  expect(writes).toEqual([]);
  await dismiss();
  await choose("discard");
  await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});

it.each(
  (["department", "zone"] as const).flatMap((kind) =>
    (["en", "es"] as const).map((locale) => ({ kind, locale })),
  ),
)(
  "$kind native validation remains strict after correction in $locale",
  async ({ kind, locale }) => {
    setLocale(locale);
    const { owner, modal, change, save, writes } = await mount(kind);
    const field =
      owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    await change("");
    expect(field.error).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    save().click();
    await expect
      .poll(() => field.error)
      .toBe(locale === "es" ? "Este campo es obligatorio." : "This field is required.");
    await field.updateComplete;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => field.shadowRoot!.activeElement).toBe(input);
    expect(owner.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      locale === "es"
        ? "Corrige los campos marcados para continuar."
        : "Correct the highlighted fields to continue.",
    );
    expect(save().disabled).toBe(true);
    await change("Corrected");
    await field.updateComplete;
    expect(field.error).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(owner.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(save().disabled).toBe(false);
    await change("");
    await field.updateComplete;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(save().disabled).toBe(true);
    expect(modal.open).toBe(true);
    expect(writes).toEqual([]);
  },
);

it("retained zone fields and action controls cannot change or save a replacement zone", async () => {
  const { el, writes } = await mountZoneEditor();
  const oldName = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  const oldFields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  const oldSave = zoneSave(el);
  const oldCancel =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[slot=cancel]")!;
  el.zoneId = "z2";
  await el.updateComplete;
  await editZoneName(el, "Replacement draft");
  oldName.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Departed name" },
      bubbles: true,
      composed: true,
    }),
  );
  oldFields.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "counter",
          paidWhen: "ticket_then_pay",
          collectionNumber: "numbered",
          receiptPrintMode: "on_request",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  oldSave.click();
  oldCancel.click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Replacement draft");
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value).toEqual({
    name: "Replacement draft",
    orderStart: null,
    paidWhen: null,
    collectionNumber: null,
    receiptPrintMode: "on_request",
  });
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(writes).toEqual([]);
});

it.each(
  (["department", "zone"] as const).flatMap((kind) =>
    (["en", "es"] as const).map((locale) => ({ kind, locale })),
  ),
)(
  "$kind keeps a matching name refusal, then clears it on native input in $locale",
  async ({ kind, locale }) => {
    setLocale(locale);
    const writes: unknown[][] = [];
    const { owner, modal, change, save } = await mount(kind, (async (
      path,
      method = "GET",
      body,
    ) => {
      if (method === "GET") return read(path);
      writes.push([path, method, body]);
      throw { code: `${kind}.name_taken`, params: { name: 1 } };
    }) as DashboardRequest);
    await change("Reserved");
    save().click();
    const name = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await expect
      .poll(() => name.error)
      .toBe(
        kind === "department"
          ? locale === "es"
            ? "Ya existe un departamento con este nombre."
            : "A department with this name already exists."
          : locale === "es"
            ? "Ya existe una zona con este nombre."
            : "A zone with this name already exists.",
      );
    await name.updateComplete;
    expect(name.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
    expect(owner.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      locale === "es"
        ? "Corrige los campos marcados para continuar."
        : "Correct the highlighted fields to continue.",
    );
    expect(save().disabled).toBe(false);
    expect(modal.open).toBe(true);
    expect(owner.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
    await change("Available");
    await name.updateComplete;
    expect(name.error).toBe("");
    expect(name.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("false");
    expect(owner.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(writes).toHaveLength(1);
  },
);

it.each(["department", "zone"] as const)(
  "%s Enter submits a trimmed name exactly once and commits before saved observers",
  async (kind) => {
    const { el, owner, app, modal, change, writes } = await mount(kind);
    const observed: unknown[] = [];
    el.addEventListener("saved", (event) =>
      observed.push({
        detail: (event as CustomEvent).detail,
        open: modal.open,
        dirty: app.leave.coordinator.isDirty(),
      }),
    );
    await change("  Renamed  ");
    const name = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await name.updateComplete;
    await userEvent.click(page.elementLocator(name.shadowRoot!.querySelector("input")!));
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => observed)
      .toEqual([
        {
          detail: kind === "department" ? { departmentId: "d1" } : { zoneId: "z1" },
          open: false,
          dirty: false,
        },
      ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.slice(0, 2)).toEqual([
      kind === "department"
        ? "/management-api/venue-service/departments/d1/settings"
        : "/management-api/venue-service/zones/z1/settings",
      "PUT",
    ]);
    expect((writes[0]![2] as { name: string }).name).toBe("Renamed");
  },
);

it.each(["department", "zone"] as const)(
  "%s cancels its leave question when its subject is replaced and ignores old controls",
  async (kind) => {
    const { el, owner, app, modal, change, save, writes } = await mount(kind);
    await change("Departed draft");
    const closing = modal.requestClose("cancel");
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    const oldName = owner.shadowRoot!.querySelector("[name=name]")!;
    const oldSave = save();
    if ("departmentId" in el) el.departmentId = "d2";
    else el.zoneId = "z2";
    await el.updateComplete;
    const replacement =
      "departmentId" in el ? el.shadowRoot!.querySelector("department-settings")! : el;
    await replacement.updateComplete;
    expect(await closing).toBe(false);
    await expect.poll(() => question.open).toBe(false);
    replacement.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Replacement draft" },
        bubbles: true,
        composed: true,
      }),
    );
    await replacement.updateComplete;
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    oldName.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Old input" },
        bubbles: true,
        composed: true,
      }),
    );
    oldSave.click();
    modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await replacement.updateComplete;
    expect(
      replacement.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!
        .value,
    ).toBe("Replacement draft");
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
    expect(unload()).toBe(true);
    expect(writes).toEqual([]);
  },
);

it.each(["department", "zone"] as const)(
  "%s ignores a departed refusal and keeps the replacement action quiet",
  async (kind) => {
    let reject!: (error: unknown) => void;
    const writes: unknown[][] = [];
    const { el, change, save } = await mount(kind, (async (path, method = "GET", body) => {
      if (method === "GET") return read(path);
      writes.push([path, method, body]);
      await new Promise<void>((_resolve, refuse) => {
        reject = refuse;
      });
    }) as DashboardRequest);
    await change("Departed draft");
    save().click();
    await expect.poll(() => writes.length).toBe(1);
    if ("departmentId" in el) el.departmentId = "d2";
    else el.zoneId = "z2";
    await el.updateComplete;
    reject({ code: "management.request_invalid", params: { field: "name" } });
    await Promise.resolve();
    const owner = "departmentId" in el ? el.shadowRoot!.querySelector("department-settings")! : el;
    await owner.updateComplete;
    const name = owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    expect(name.value).toBe(kind === "department" ? "Deli" : "Bar");
    expect(name.error).toBe("");
    expect(owner.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    const button =
      owner.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=save-editor]",
      )!;
    expect({ variant: button.variant, disabled: button.disabled }).toEqual({
      variant: "secondary",
      disabled: true,
    });
    expect(writes).toHaveLength(1);
  },
);

it.each(["department", "zone"] as const)(
  "%s retains a close guard that refuses its pending and disconnected form",
  async (kind) => {
    let finish!: () => void;
    const { el, modal, change, save } = await mount(kind, (async (path, method = "GET") => {
      if (method === "GET") return read(path);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }) as DashboardRequest);
    const guard = modal.beforeClose!;
    await change("Submitted");
    save().click();
    await expect.poll(() => !!finish).toBe(true);
    expect(await guard("cancel")).toBe(false);
    el.remove();
    expect(await guard("cancel")).toBe(false);
    finish();
  },
);

it("a missing zone retains its Spanish edited name and exact attempted request", async () => {
  setLocale("es");
  const writes: unknown[][] = [];
  const { el, modal } = await mountZoneEditor((async (path, method = "GET", body) => {
    if (method === "GET") return read(path);
    writes.push([path, method, body]);
    throw { code: "zone.not_found" };
  }) as DashboardRequest);
  await editZoneName(el, "Jardín");
  zoneSave(el).click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("No se pudo guardar el cambio.");
  expect(writes).toEqual([
    [
      "/management-api/venue-service/zones/z1/settings",
      "PUT",
      {
        name: "Jardín",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      },
    ],
  ]);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Jardín");
  expect(modal.open).toBe(true);
  expect(zoneSave(el).disabled).toBe(false);
});
