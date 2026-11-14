import { accessRoleChoices } from "../testing/access-role-fixture.js";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import {
  DashboardApi,
  type AccessRole,
  type PersonEditDetails,
  type PersonSummary,
} from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./person-edit.js";

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
  roleIds: ["manager"],
  status: "active",
  hasPassword: true,
  hasTotp: false,
};
class PersonEditApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  person = person;
  canManageSchedule = false;
  api = new DashboardApi(
    "",
    async (path) =>
      new Response(
        JSON.stringify(
          String(path).endsWith("/access-roles")
            ? accessRoleChoices
            : {
                staffRoles: [
                  {
                    id: "waiter",
                    name: "Waiter",
                    colour: "blue",
                    position: 0,
                    holderIds: ["p1"],
                    holderNames: ["Ada"],
                  },
                  {
                    id: "chef",
                    name: "Chef",
                    colour: "red",
                    position: 1,
                    holderIds: [],
                    holderNames: [],
                  },
                ],
              },
        ),
        { headers: { "content-type": "application/json" } },
      ),
  );
  override render() {
    return html`<dashboard-person-edit
        .canAdminister=${true}
        .canChangeEmail=${true}
        .canManageSchedule=${this.canManageSchedule}
        .api=${this.api}
        .person=${this.person}
        .open=${true}
        @wt-close=${() => this.closes++}
      ></dashboard-person-edit
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("person-edit-leave-test-app", PersonEditApp);
async function mount() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PersonEditApp>("person-edit-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-person-edit")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function edit(form: HTMLElement, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test="edit-${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await (form as HTMLElementTagNameMap["dashboard-person-edit"]).updateComplete;
}
async function question(app: PersonEditApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}

for (const route of ["escape"] as const) {
  it(`Edit staff ${route} retains the details and focus on Keep, then discards once`, async () => {
    const { app, form } = await mount();
    await edit(form, "email", "new@example.com");
    const field = form
      .shadowRoot!.querySelector("[data-test=edit-email]")!
      .shadowRoot!.querySelector("input")!;
    await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(
      form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(field.value).toBe("new@example.com");
    expect(
      field.getRootNode() instanceof ShadowRoot &&
        (field.getRootNode() as ShadowRoot).activeElement,
    ).toBe(field);
    await userEvent.keyboard("{Escape}");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.closes).toBe(1);
    await closeReportsDelivered();
    expect(app.closes).toBe(1);
    expect(form.open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("Edit staff normalizes reverted values and leaves clean forms without a question", async () => {
  const { app, form } = await mount();
  await edit(form, "telephone", "+44 20");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await edit(form, "telephone", " ");
  await edit(form, "email", " ada@example.com ");
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
for (const [name, changed, original] of [["status", "suspended", "active"]] as const) {
  it(`Edit staff protects the ${name} selection and its revert`, async () => {
    const { app, form } = await mount();
    const box = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `[data-test=edit-${name}]`,
    )!;
    await chooseOption(box, changed);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await chooseOption(box, original);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("a refreshed staff summary preserves the draft, and a different identity cancels its pending question", async () => {
  const { app, form } = await mount();
  await edit(form, "email", "new@example.com");
  app.person = { ...person, displayName: "Server rename" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
      .value,
  ).toBe("new@example.com");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  app.person = { ...person, personId: "p2", email: "bea@example.com" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  expect(form.open).toBe(true);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=edit-email]")!
      .value,
  ).toBe("bea@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.closes).toBe(0);
});
it("Edit staff blocks dismissal and resubmission during an outstanding write", async () => {
  const { app, form } = await mount();
  await edit(form, "email", "new@example.com");
  Object.assign(form, { busy: true });
  await form.updateComplete;
  let submits = 0;
  form.addEventListener("save-person", () => submits++);
  cancel(form);
  await userEvent.keyboard("{Escape}");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await closeReportsDelivered();
  expect(
    form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
  ).toBe(true);
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
  expect(submits).toBe(0);
});
it("a completed staff save invalidates a pending discard question and closes once", async () => {
  const { app, form } = await mount();
  await edit(form, "email", "new@example.com");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  const submitted = {
    displayName: "Ada",
    firstNames: "Ada",
    lastNames: "Lovelace",
    telephone: null,
    email: "new@example.com",
    status: "active" as const,
  };
  expect(form.closeSaved(submitted)).toBe(true);
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(app.closes).toBe(1);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("standalone Edit staff Cancel reports once after its native delayed close", async () => {
  const { el: form } = await mountWidget<HTMLElementTagNameMap["dashboard-person-edit"]>(
    "dashboard-person-edit",
    { canAdminister: true, canChangeEmail: true, person, open: true },
  );
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  let closes = 0;
  form.addEventListener("wt-close", () => closes++);
  cancel(form);
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();
  expect(closes).toBe(1);
  expect(form.open).toBe(false);
});
function emailField(form: HTMLElement) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=edit-email]",
  )!;
}
async function saveButton(form: HTMLElementTagNameMap["dashboard-person-edit"]) {
  await form.updateComplete;
  const save = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=save]",
  )!;
  await save.updateComplete;
  return { variant: save.variant, disabled: save.disabled };
}
it("Edit staff put back after a detached update still asks before Escape discards an edit", async () => {
  const { app, form } = await mount();
  await reattachAfterDetachedUpdate(form);
  await edit(form, "email", "new@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
});
it("Edit staff keeps an edit made before it was taken out and put back, and still asks", async () => {
  const { app, form } = await mount();
  await edit(form, "email", "new@example.com");
  await reattachAfterDetachedUpdate(form);
  expect(emailField(form).value).toBe("new@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await saveButton(form)).toEqual({ variant: "primary", disabled: false });
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
});
it("Edit staff reopened after a put-back edit was discarded opens quiet with the person's values", async () => {
  const { app, form } = await mount();
  await edit(form, "email", "new@example.com");
  await reattachAfterDetachedUpdate(form);
  cancel(form);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => app.closes).toBe(1);
  await closeReportsDelivered();
  app.person = { ...person, personId: "p2", email: "bea@example.com" };
  app.requestUpdate();
  await app.updateComplete;
  form.open = true;
  await form.updateComplete;
  expect(emailField(form).value).toBe("bea@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await saveButton(form)).disabled).toBe(true);
  await edit(form, "telephone", "+44 20");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "telephone", "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("Edit staff put back keeps its last saved values as the ones an edit is compared with", async () => {
  const { app, form } = await mount();
  const submitted: PersonEditDetails[] = [];
  form.addEventListener("save-person", (e) => submitted.push((e as CustomEvent).detail));
  await edit(form, "email", "submitted@example.com");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(submitted).toHaveLength(1);
  await edit(form, "email", "newer@example.com");
  expect(form.closeSaved(submitted[0]!)).toBe(false);
  await reattachAfterDetachedUpdate(form);
  await edit(form, "email", "submitted@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("warns about job-role edits even after the person's details were saved", async () => {
  const { app, form } = await mount();
  app.canManageSchedule = true;
  app.requestUpdate();
  await app.updateComplete;
  const roles = () =>
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="jobRoles"]')!;
  await expect.poll(() => roles()?.values).toEqual(["waiter"]);
  await chooseOptions(roles(), ["chef"]);
  await form.updateComplete;
  app.person = { ...person, displayName: "Saved name" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => roles().disabled).toBe(false);
  expect(roles().values).toEqual(["chef"]);
  expect(
    form.closeSaved({
      displayName: "Ada",
      firstNames: "Ada",
      lastNames: "Lovelace",
      telephone: null,
      email: "ada@example.com",
      status: "active",
    }),
  ).toBe(false);
  const email = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    '[data-test="edit-email"]',
  )!;
  await email.updateComplete;
  email.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await expect.poll(() => q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await app.updateComplete;
  expect(roles().values).toEqual(["chef"]);
  expect(form.open).toBe(true);
});

it("protects access-role changes independently of a saved details draft", async () => {
  const { app, form } = await mount();
  form.viewerAdmin = true;
  app.api = Object.assign(new DashboardApi(""), {
    listAccessRoles: async (): Promise<AccessRole[]> => [
      { id: "manager", builtInKey: "manager", name: null, permissions: [], holderCount: 1 },
      { id: "waiter", builtInKey: "staff", name: null, permissions: [], holderCount: 0 },
    ],
  });
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  const roles = () =>
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="accessRoles"]')!;
  await expect.poll(() => roles()?.disabled).toBe(false);
  await chooseOptions(roles(), ["waiter"]);
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(
    form.closeSaved({
      displayName: "Ada",
      firstNames: "Ada",
      lastNames: "Lovelace",
      telephone: null,
      email: "ada@example.com",
      status: "active",
    }),
  ).toBe(false);
  const email = emailField(form);
  email.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await expect.poll(() => q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await q.updateComplete;
  expect(form.open).toBe(true);
  expect(roles().values).toEqual(["waiter"]);
  await chooseOptions(roles(), ["manager"]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
