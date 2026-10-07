import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, applyTokens, type WtCombobox } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import "./service-settings-panel.js";

const initial: VenueServiceSettingsView = {
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};

class ImmediateSettingsApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: VenueServiceApi;
  subject: "kitchen" | "tables" = "kitchen";
  override render() {
    return html`<dashboard-venue-service-settings
        .api=${this.api}
        .subject=${this.subject}
      ></dashboard-venue-service-settings>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Discard unsaved changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("immediate-service-settings-test-app", ImmediateSettingsApp);
let app: ImmediateSettingsApp;
afterEach(() => {
  app?.remove();
  setLocale("en");
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function mount(subject: "kitchen" | "tables") {
  setLocale("en");
  let stored = structuredClone(initial);
  const writes: unknown[] = [];
  const pending = deferred();
  async function write(body: object, patch: Partial<VenueServiceSettingsView>) {
    writes.push(body);
    await pending.promise;
    stored = { ...stored, ...patch };
  }
  app = document.createElement("immediate-service-settings-test-app") as ImmediateSettingsApp;
  app.subject = subject;
  app.api = {
    loadSettings: async () => structuredClone(stored),
    saveSettings: async (settings) => write({ settings }, { settings }),
    saveKitchenTicketGrouping: async (kitchenTicketGrouping) =>
      write({ kitchenTicketGrouping }, { kitchenTicketGrouping }),
    savePrintHeldWork: async (printHeldWork) => write({ printHeldWork }, { printHeldWork }),
    saveReleaseReminderMinutes: async (releaseReminderMinutes) =>
      write({ releaseReminderMinutes }, { releaseReminderMinutes }),
    saveClearingWorkflow: async (clearingWorkflow) =>
      write({ clearingWorkflow }, { clearingWorkflow }),
  } as VenueServiceApi;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const panel = app.shadowRoot!.querySelector("dashboard-venue-service-settings")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("wt-switch")).toBeTruthy();
  return { panel, writes, pending };
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function leaveWithoutWarning() {
  let departures = 0;
  expect(unload()).toBe(false);
  expect(
    await app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {
        departures++;
      },
    }),
  ).toBe("proceeded");
  expect(departures).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
}

const choices = [
  {
    name: "editSentLines",
    subject: "kitchen",
    value: false,
    original: true,
    body: { settings: { editSentLines: false } },
  },
  {
    name: "kitchenTicketGrouping",
    subject: "kitchen",
    value: "separate",
    original: "combined",
    body: { kitchenTicketGrouping: "separate" },
  },
  {
    name: "printHeldWork",
    subject: "kitchen",
    value: true,
    original: false,
    body: { printHeldWork: true },
  },
  {
    name: "releaseReminderMinutes",
    subject: "kitchen",
    value: "15",
    original: "10",
    body: { releaseReminderMinutes: 15 },
  },
  {
    name: "clearingWorkflow",
    subject: "tables",
    value: true,
    original: false,
    body: { clearingWorkflow: true },
  },
] as const;

async function change(
  panel: HTMLElementTagNameMap["dashboard-venue-service-settings"],
  choice: (typeof choices)[number],
) {
  const control = panel.shadowRoot!.querySelector<HTMLElement>(`[name=${choice.name}]`)!;
  await (control as WtCombobox).updateComplete;
  if (typeof choice.value === "boolean") {
    const input = control.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.focus();
    await userEvent.keyboard(" ");
  } else {
    const box = control as WtCombobox;
    await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const index = box.options.findIndex((option) => option.value === choice.value);
    await userEvent.click(box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[index]!);
  }
  await panel.updateComplete;
}

for (const choice of choices) {
  for (const outcome of ["stored", "refused"] as const) {
    it(`${choice.name} stays exempt during its immediate write and after ${outcome}`, async () => {
      const { panel, writes, pending } = await mount(choice.subject);
      await leaveWithoutWarning();
      await change(panel, choice);
      expect(writes).toEqual([choice.body]);
      await leaveWithoutWarning();
      if (outcome === "stored") pending.resolve();
      else pending.reject(new Error("refused"));
      const control = panel.shadowRoot!.querySelector<WtCombobox>(`[name=${choice.name}]`)!;
      await expect.poll(() => control.disabled).toBe(false);
      if (outcome === "refused") {
        expect(
          panel.shadowRoot!.querySelector('[data-test="page-alert"]')!.textContent!.trim(),
        ).not.toBe("");
      }
      await control.updateComplete;
      const expected = outcome === "stored" ? choice.value : choice.original;
      if (typeof expected === "boolean") {
        expect(control.shadowRoot!.querySelector<HTMLInputElement>("input")!.checked).toBe(
          expected,
        );
      } else {
        expect(control.value).toBe(expected);
      }
      await leaveWithoutWarning();
      expect(writes).toEqual([choice.body]);
    });
  }
}

it("an immediate setting write cannot clear a different owner's pending draft decision", async () => {
  const { panel, pending } = await mount("kitchen");
  const input = document.createElement("wt-input");
  input.name = "separateDraft";
  input.value = "saved";
  app.shadowRoot!.append(input);
  const scope = app.leave.coordinator.register({
    id: input,
    current: () => input.value,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      input.value = value;
    },
  });
  input.value = "edited";
  scope.changed();
  await change(panel, choices[0]);
  let departures = 0;
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed: () => {
      departures++;
    },
  });
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  pending.resolve();
  await expect
    .poll(() => panel.shadowRoot!.querySelector<WtCombobox>("[name=editSentLines]")!.disabled)
    .toBe(false);
  expect(warning.open).toBe(true);
  expect(input.value).toBe("edited");
  expect(unload()).toBe(true);
  expect(departures).toBe(0);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await request).toBe("kept");
  expect(input.value).toBe("edited");
  scope.dispose();
  await leaveWithoutWarning();
});
