import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, PersonEditDetails, PersonSummary } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./staff-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada",
  lastNames: "Lovelace",
  telephone: null,
  email: "ada@example.com",
  role: "manager",
  status: "pending",
  hasPassword: false,
  hasTotp: false,
};
class StaffEditApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-staff-screen .api=${this.api}></dashboard-staff-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("staff-edit-leave-test-app", StaffEditApp);
async function mount(api: Partial<DashboardApi>) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<StaffEditApp>("staff-edit-leave-test-app", {
    api: { listStaff: async () => [person], ...api } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-staff-screen")!;
  await expect
    .poll(() => screen.shadowRoot!.querySelector("dashboard-staff-list")!.people.length)
    .toBeGreaterThan(0);
  screen.shadowRoot!.querySelector("dashboard-staff-list")!.dispatchEvent(
    new CustomEvent("edit-person", {
      detail: { personId: "p1" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-person-edit")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, screen, form };
}
function change(form: HTMLElement, name: string, value: string) {
  form
    .shadowRoot!.querySelector(`[data-test=edit-${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function save(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
}
it("staff edit commits the submitted details before a failed list refresh", async () => {
  let reads = 0;
  let dirtyAtRefresh: boolean | undefined;
  let received: { id: string; details: PersonEditDetails } | undefined;
  const mounted = await mount({
    listStaff: async () => {
      if (++reads === 1) return [person];
      dirtyAtRefresh = mounted.app.leave.coordinator.isDirty();
      throw { code: "connection.failed" };
    },
    savePerson: async (id, details) => {
      received = { id, details };
    },
  });
  change(mounted.form, "email", " new@example.com ");
  expect(mounted.app.leave.coordinator.isDirty()).toBe(true);
  save(mounted.form);
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  expect(received).toEqual({
    id: "p1",
    details: {
      firstNames: "Ada",
      lastNames: "Lovelace",
      displayName: "Ada",
      telephone: null,
      email: "new@example.com",
      role: "manager",
      status: "pending",
    },
  });
  await expect.poll(() => mounted.form.open).toBe(false);
});
it("a pending staff edit blocks dismissal, then a refused write keeps the draft", async () => {
  let refuse!: (reason: unknown) => void;
  const { app, screen, form } = await mount({
    savePerson: () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  });
  change(form, "email", "new@example.com");
  save(form);
  await screen.updateComplete;
  await form.updateComplete;
  expect(form.busy).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(form.open).toBe(true);
  refuse({ code: "connection.failed" });
  await expect.poll(() => form.busy).toBe(false);
  expect(form.error).toBe("connection.failed");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
      .value,
  ).toBe("new@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
});
it("a delivered newer staff edit survives a completed save against its submitted baseline", async () => {
  let finish!: () => void;
  const { app, screen, form } = await mount({
    savePerson: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  change(form, "email", "saved@example.com");
  save(form);
  await screen.updateComplete;
  await form.updateComplete;
  change(form, "email", "newer@example.com");
  finish();
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
      .value,
  ).toBe("newer@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  change(form, "email", "saved@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("resending an invitation does not discard unsaved staff details", async () => {
  const { app, screen, form } = await mount({
    resendInvitation: async () => ({ invitationSent: true }),
  });
  change(form, "email", "new@example.com");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-invitation]")!.click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=invitation-status]")?.textContent)
    .toContain(t("staff.invitation_sent"));
  expect(form.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
      .value,
  ).toBe("new@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
for (const action of ["save", "resend"] as const) {
  it(`an old staff ${action} result cannot close or commit another person's editor`, async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const bea: PersonSummary = { ...person, personId: "p2", email: "bea@example.com" };
    const { app, screen, form } = await mount({
      listStaff: async () => [person, bea],
      savePerson: () => pending,
      resendInvitation: async () => {
        await pending;
        return { invitationSent: true };
      },
    });
    if (action === "save") {
      change(form, "email", "saved@example.com");
      save(form);
    } else form.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-invitation]")!.click();
    await screen.updateComplete;
    await form.updateComplete;
    screen.shadowRoot!.querySelector("dashboard-staff-list")!.dispatchEvent(
      new CustomEvent("edit-person", {
        detail: { personId: "p2" },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    await form.updateComplete;
    change(form, "email", "bea-new@example.com");
    finish();
    await expect.poll(() => form.busy).toBe(false);
    expect(form.open).toBe(true);
    expect(form.person?.personId).toBe("p2");
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
        .value,
    ).toBe("bea-new@example.com");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    change(form, "email", "bea@example.com");
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(form.error).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-test=invitation-status]")).toBeNull();
  });
  it(`an old staff ${action} refusal leaves another person's editor unchanged`, async () => {
    let refuse!: (reason: unknown) => void;
    const pending = new Promise<void>((_, reject) => {
      refuse = reject;
    });
    const bea: PersonSummary = { ...person, personId: "p2", email: "bea@example.com" };
    const { app, screen, form } = await mount({
      listStaff: async () => [person, bea],
      savePerson: () => pending,
      resendInvitation: async () => {
        await pending;
        return { invitationSent: true };
      },
    });
    if (action === "save") {
      change(form, "email", "saved@example.com");
      save(form);
    } else form.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-invitation]")!.click();
    await screen.updateComplete;
    await form.updateComplete;
    screen.shadowRoot!.querySelector("dashboard-staff-list")!.dispatchEvent(
      new CustomEvent("edit-person", {
        detail: { personId: "p2" },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    await form.updateComplete;
    change(form, "email", "bea-new@example.com");
    refuse({ code: "connection.failed" });
    await expect.poll(() => form.busy).toBe(false);
    expect(form.error).toBeNull();
    expect(form.open).toBe(true);
    expect(form.person?.personId).toBe("p2");
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
        .value,
    ).toBe("bea-new@example.com");
    expect(app.leave.coordinator.isDirty()).toBe(true);
  });
}
for (const action of ["reset-login", "reset-pin", "disable"] as const) {
  it(`staff ${action} confirmation stays exempt from a discard warning`, async () => {
    const { app, screen, form } = await mount({});
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await expect.poll(() => form.open).toBe(false);
    screen.shadowRoot!.querySelector("dashboard-staff-list")!.dispatchEvent(
      new CustomEvent("person-action", {
        detail: { personId: "p1", action },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    const dialog = screen.shadowRoot!.querySelector("wt-dialog")!;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(dialog.querySelector("wt-input")).toBeNull();
    expect(app.leave.coordinator.isDirty()).toBe(false);
    dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    await screen.updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
}
