import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { applyTokens, LeaveController } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { setLocale } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import type { DepartmentDialogs, DepartmentDialog } from "./department-dialogs.js";
import "./department-dialogs.js";
function testApi(request: unknown) {
  return new VenueServiceApi(request as DashboardRequest);
}
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", active: true },
  ],
  zones: [],
  floorZones: [],
  salePolicies: { departments: [], zones: [] },
  readiness: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};
class DialogLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-dialogs></department-dialogs
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("department-dialog-leave-test-app", DialogLeaveApp);
let app: DialogLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(dialog: DepartmentDialog) {
  app = document.createElement("department-dialog-leave-test-app") as DialogLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-dialogs")!;
  el.api = testApi(vi.fn(async () => ({ id: "new" })));
  el.model = model;
  el.dialog = dialog;
  await el.updateComplete;
  return el;
}
function field(el: DepartmentDialogs) {
  const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]");
  expect(box).not.toBeNull();
  return box!;
}
async function change(el: DepartmentDialogs, value: string) {
  field(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
const cases: DepartmentDialog[] = [
  { kind: "add-department" },
  { kind: "rename-department", row: model.departments[0]! },
  { kind: "add-zone", departmentId: "d1" },
  { kind: "rename-zone", row: { id: "z1", name: "Patio" } },
];
it.each(cases)("$kind asks before closing, Keep preserves and Discard closes", async (dialog) => {
  const el = await mount(dialog);
  expect(unload()).toBe(false);
  await change(el, "Draft");
  expect(unload()).toBe(true);
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const close = modal.requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(field(el).value).toBe("Draft");
  const discard = modal.requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await expect.poll(() => el.dialog).toBeUndefined();
  expect(unload()).toBe(false);
});
it.each(cases)(
  "$kind reconnect retains its draft against the original baseline",
  async (dialog) => {
    const el = await mount(dialog);
    await change(el, "Retained draft");
    el.remove();
    expect(unload()).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    app.shadowRoot!.append(el);
    await el.updateComplete;
    expect(field(el).value).toBe("Retained draft");
    expect(unload()).toBe(true);
    const close = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await choose("keep");
    expect(await close).toBe(false);
    await change(el, "row" in dialog ? dialog.row.name : "");
    expect(unload()).toBe(false);
  },
);
it("an old save cannot commit a draft reconnected while its request was pending", async () => {
  const el = await mount(cases[1]!);
  let finish!: () => void;
  el.api = testApi(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await change(el, "Draft");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await el.updateComplete;
  el.remove();
  app.shadowRoot!.append(el);
  await el.updateComplete;
  finish();
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  expect(field(el).value).toBe("Draft");
  expect(unload()).toBe(true);
  expect(el.dialog).toEqual(cases[1]);
});
it("replacing a dialog cancels its leave question and ignores retained old buttons", async () => {
  const el = await mount(cases[1]!);
  await change(el, "Draft");
  const old = el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!;
  const close = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
  await app.updateComplete;
  el.dialog = cases[2];
  await el.updateComplete;
  expect(await close).toBe(false);
  old.click();
  await el.updateComplete;
  expect(field(el).value).toBe("");
  expect(unload()).toBe(false);
});

it.each(["move-zone", "add-to-department"] as const)(
  "%s keeps its destination through the leave question and reconnect",
  async (kind) => {
    const el = await mount({ kind, row: { id: "z1", name: "Patio" } });
    const box =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
    await chooseOption(box, "d2");
    expect(unload()).toBe(true);
    const close = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await choose("keep");
    expect(await close).toBe(false);
    expect(box.value).toBe("d2");
    el.remove();
    expect(unload()).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    app.shadowRoot!.append(el);
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
        .value,
    ).toBe("d2");
    expect(unload()).toBe(true);
    const discard = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await choose("discard");
    expect(await discard).toBe(true);
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(unload()).toBe(false);
  },
);

it.each(cases)(
  "$kind keeps input arriving during its save dirty against the submitted name",
  async (dialog) => {
    const el = await mount(dialog);
    let finish!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    el.api = testApi(request);
    const written: unknown[] = [];
    el.addEventListener("written", (event) => written.push((event as CustomEvent).detail));
    const closed = vi.fn();
    el.addEventListener("saved", closed);
    await change(el, "Submitted name");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await expect.poll(() => request.mock.calls.length).toBe(1);
    await field(el).updateComplete;
    expect(field(el).shadowRoot!.querySelector("input")!.disabled).toBe(false);
    await userEvent.fill(
      page.elementLocator(field(el).shadowRoot!.querySelector("input")!),
      "Newer name",
    );
    await el.updateComplete;
    expect(field(el).value).toBe("Newer name");
    finish({ id: "new" });
    await expect.poll(() => written.length).toBe(1);
    expect(el.dialog).toEqual(dialog);
    expect(closed).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!
        .disabled,
    ).toBe(false);
    const close = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await choose("keep");
    expect(await close).toBe(false);
    expect(field(el).value).toBe("Newer name");
    await change(el, " Submitted name ");
    expect(unload()).toBe(false);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!
        .disabled,
    ).toBe(true);
    expect(request.mock.calls).toEqual([
      dialog.kind === "add-department"
        ? ["/management-api/venue-service/departments", "POST", { name: "Submitted name" }]
        : dialog.kind === "rename-department"
          ? ["/management-api/venue-service/departments/d1", "PATCH", { name: "Submitted name" }]
          : dialog.kind === "add-zone"
            ? [
                "/management-api/venue-service/zones",
                "POST",
                { name: "Submitted name", departmentId: "d1" },
              ]
            : ["/management-api/zones/z1", "PATCH", { name: "Submitted name" }],
    ]);
  },
);

it.each(
  cases.flatMap((dialog) => (["cancel", "escape"] as const).map((method) => ({ dialog, method }))),
)(
  "$dialog.kind native $method preserves Keep and discards without a write",
  async ({ dialog, method }) => {
    const el = await mount(dialog);
    const request = vi.fn(async () => ({ id: "new" }));
    el.api = testApi(request);
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const nativeDialog = modal.shadowRoot!.querySelector("dialog")!;
    await field(el).updateComplete;
    const nativeName = field(el).shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(nativeName), "Protected draft");
    await el.updateComplete;
    const dismiss = async () => {
      if (method === "cancel") {
        const cancel = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=cancel-editor]",
        )!;
        await cancel.updateComplete;
        await userEvent.click(page.elementLocator(cancel.shadowRoot!.querySelector("button")!));
      } else {
        await userEvent.click(page.elementLocator(nativeName));
        await userEvent.keyboard("{Escape}");
      }
      await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    };
    await dismiss();
    await choose("keep");
    expect(nativeDialog.open).toBe(true);
    expect(nativeName.value).toBe("Protected draft");
    expect(unload()).toBe(true);
    expect(request).not.toHaveBeenCalled();
    await dismiss();
    await choose("discard");
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(nativeDialog.open).toBe(false);
    expect(unload()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  },
);

it("disconnecting a dialog with a pending leave question closes the question and releases its draft", async () => {
  const el = await mount(cases[1]!);
  await change(el, "Unsaved rename");
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const closing = modal.requestClose("cancel");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  el.remove();
  expect(await closing).toBe(false);
  await expect.poll(() => question.open).toBe(false);
  expect(unload()).toBe(false);
});

it.each(cases)("$kind ignores a stale discard after a replacement dialog opens", async (dialog) => {
  const el = await mount(dialog);
  const request = vi.fn(async () => ({ id: "new" }));
  el.api = testApi(request);
  await change(el, "Departed draft");
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const closing = modal.requestClose("cancel");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  const oldCancel = el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!;
  const oldSave = el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!;
  el.dialog = { kind: "rename-department", row: model.departments[1]! };
  await el.updateComplete;
  expect(await closing).toBe(false);
  await expect.poll(() => question.open).toBe(false);
  await change(el, "Replacement draft");
  question.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  oldCancel.click();
  oldSave.click();
  await el.updateComplete;
  const replacementModal = el.shadowRoot!.querySelector("wt-modal")!;
  await replacementModal.updateComplete;
  expect(replacementModal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(field(el).value).toBe("Replacement draft");
  expect(unload()).toBe(true);
  expect(request).not.toHaveBeenCalled();
  const freshClose = replacementModal.requestClose("cancel");
  await choose("keep");
  expect(await freshClose).toBe(false);
  expect(field(el).value).toBe("Replacement draft");
});

const acceptedNames = [
  {
    dialog: cases[0]!,
    request: ["/management-api/venue-service/departments", "POST", { name: "Accepted name" }],
  },
  {
    dialog: cases[1]!,
    request: ["/management-api/venue-service/departments/d1", "PATCH", { name: "Accepted name" }],
  },
  {
    dialog: cases[2]!,
    request: [
      "/management-api/venue-service/zones",
      "POST",
      { name: "Accepted name", departmentId: "d1" },
    ],
  },
  { dialog: cases[3]!, request: ["/management-api/zones/z1", "PATCH", { name: "Accepted name" }] },
];
it.each(acceptedNames)(
  "$dialog.kind commits a save while a discard question is pending",
  async ({ dialog, request: accepted }) => {
    const el = await mount(dialog);
    const request = vi.fn(async () => ({ id: "new" }));
    el.api = testApi(request);
    await change(el, " Accepted name ");
    const closing = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await expect.poll(() => el.dialog).toBeUndefined();
    expect(await closing).toBe(false);
    await expect.poll(() => question.open).toBe(false);
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(request.mock.calls).toEqual([accepted]);
    expect(unload()).toBe(false);
    el.dialog = { kind: "rename-department", row: model.departments[1]! };
    await el.updateComplete;
    await change(el, "Later draft");
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(field(el).value).toBe("Later draft");
    expect(unload()).toBe(true);
    expect(request.mock.calls).toEqual([accepted]);
  },
);

it.each(acceptedNames)(
  "$dialog.kind protects newer input when saving cancels a pending discard",
  async ({ dialog, request: accepted }) => {
    const el = await mount(dialog);
    let finish!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    el.api = testApi(request);
    await change(el, " Accepted name ");
    const closing = el.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
    await expect.poll(() => request.mock.calls.length).toBe(1);
    await change(el, "Newer protected name");
    finish({ id: "new" });
    expect(await closing).toBe(false);
    await expect.poll(() => question.open).toBe(false);
    await el.updateComplete;
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(field(el).value).toBe("Newer protected name");
    expect(unload()).toBe(true);
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
    await save.updateComplete;
    expect({
      variant: save.variant,
      disabled: save.disabled,
      nativeDisabled: save.shadowRoot!.querySelector("button")!.disabled,
    }).toEqual({ variant: "primary", disabled: false, nativeDisabled: false });
    expect(request.mock.calls).toEqual([accepted]);
    const close = modal.requestClose("cancel");
    await choose("keep");
    expect(await close).toBe(false);
    expect(field(el).value).toBe("Newer protected name");
    await change(el, "Accepted name");
    await save.updateComplete;
    expect({
      variant: save.variant,
      disabled: save.disabled,
      nativeDisabled: save.shadowRoot!.querySelector("button")!.disabled,
    }).toEqual({ variant: "secondary", disabled: true, nativeDisabled: true });
    expect(unload()).toBe(false);
  },
);

it.each(cases)("$kind paints native Save states after a pending name save", async (dialog) => {
  const el = await mount(dialog);
  let finish!: (value: unknown) => void;
  const writes: unknown[] = [];
  el.api = testApi(async (...args: unknown[]) => {
    writes.push(args);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
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
  await field(el).updateComplete;
  const input = field(el).shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), "Submitted name");
  save.click();
  try {
    await expect.poll(() => writes.length).toBe(1);
    await el.updateComplete;
    expect((await state()).innerDisabled).toBe(true);
    save.dispatchEvent(new MouseEvent("click"));
    await userEvent.fill(page.elementLocator(input), "Newer name");
    finish({ id: "new" });
    await expect.poll(() => save.disabled).toBe(false);
    expect(await state()).toEqual({ variant: "primary", disabled: false, innerDisabled: false });
    expect(input.value).toBe("Newer name");
    expect(el.dialog).toEqual(dialog);
    expect(unload()).toBe(true);
    await userEvent.fill(page.elementLocator(input), " Submitted name ");
    await el.updateComplete;
    expect(await state()).toEqual({ variant: "secondary", disabled: true, innerDisabled: true });
    expect(unload()).toBe(false);
    expect(writes).toHaveLength(1);
  } finally {
    finish?.({ id: "new" });
  }
});
