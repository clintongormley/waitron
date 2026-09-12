import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import type { StaffList } from "../widgets/staff-list.js";
import type { PersonForm } from "../widgets/person-form.js";
import type { PersonEdit } from "../widgets/person-edit.js";
import { StaffScreen } from "./staff-screen.js";

afterEach(cleanupWidgets);

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    firstNames: "Ada Augusta",
    lastNames: "Lovelace",
    telephone: "+44 20",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: "ada@x.com",
  },
  {
    personId: "p2",
    displayName: "Bea",
    firstNames: "Beatrice",
    lastNames: "Potter",
    telephone: null,
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    createPerson: vi.fn().mockResolvedValue({ id: "p3", invitationSent: true }),
    updatePerson: vi.fn().mockResolvedValue(undefined),
    savePerson: vi.fn().mockResolvedValue(undefined),
    deactivatePerson: vi.fn().mockResolvedValue(undefined),
    resetPin: vi.fn().mockResolvedValue(undefined),
    resetLogin: vi.fn().mockResolvedValue({ invitationSent: true }),
    reactivatePerson: vi.fn().mockResolvedValue({ invitationSent: true }),
    resendInvitation: vi.fn().mockResolvedValue({ invitationSent: true }),
    passkeyRegisterOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h2", options: { challenge: "def" } }),
    passkeyRegisterVerify: vi.fn().mockResolvedValue({ credentialId: "cred-1" }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight `listStaff` fetch and the follow-up render. */
async function flush(el: StaffScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The composed staff-list widget the screen renders. */
function list(el: StaffScreen): StaffList {
  return el.shadowRoot!.querySelector("dashboard-staff-list")!;
}

/** The create-person form the screen renders. */
function form(el: StaffScreen): PersonForm {
  return el.shadowRoot!.querySelector("dashboard-person-form")!;
}

/** The rendered text inside the create form's shared error summary. */
function formErrorText(el: StaffScreen): string | undefined {
  return (
    form(el)
      .shadowRoot!.querySelector("wt-form-error-summary")
      ?.shadowRoot!.querySelector("[role=alert]")?.textContent ?? undefined
  );
}

/** The edit-person dialog the screen renders. */
function editForm(el: StaffScreen): PersonEdit {
  return el.shadowRoot!.querySelector("dashboard-person-edit")!;
}

/** Open the edit dialog for a person by dispatching the staff-list's composed `edit-person`. */
async function openEdit(el: StaffScreen, personId: string): Promise<void> {
  list(el).dispatchEvent(
    new CustomEvent("edit-person", { detail: { personId }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** The native <dialog> inside the screen's person-form, once wt-modal's first render has settled. */
async function nativeDialog(el: StaffScreen): Promise<HTMLDialogElement> {
  const wtDialog = form(el).shadowRoot!.querySelector("wt-modal")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

describe("staff-screen", () => {
  it.each([
    ["reset-login", "resetLogin"],
    ["reset-pin", "resetPin"],
    ["disable", "deactivatePerson"],
  ] as const)(
    "confirms the row's %s action before changing the selected user",
    async (action, method) => {
      const api = stubApi();
      const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
      await flush(el);
      list(el).dispatchEvent(
        new CustomEvent("person-action", {
          detail: { personId: "p1", action },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api[method]).not.toHaveBeenCalled();
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
      expect(dialog).not.toBeNull();
      expect(dialog.open).toBe(true);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-row-action]")!.click();
      await flush(el);
      expect(api[method]).toHaveBeenCalledWith("p1");
      expect(dialog.open).toBe(false);
      expect(editForm(el).open).toBe(false);
    },
  );

  it.each(["create", "edit"])(
    "clears a row confirmation when the %s editor is requested",
    async (editor) => {
      const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
      await flush(el);
      list(el).dispatchEvent(
        new CustomEvent("person-action", { detail: { personId: "p1", action: "reset-pin" } }),
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
      if (editor === "create")
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
      else await openEdit(el, "p1");
      await flush(el);
      expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
      expect(editor === "create" ? form(el).open : editForm(el).open).toBe(true);
    },
  );

  it("closes the editor after a successful save even when refreshing fails", async () => {
    const api = stubApi({
      listStaff: vi
        .fn()
        .mockResolvedValueOnce(people)
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");
    editForm(el).dispatchEvent(
      new CustomEvent("save-person", { detail: {}, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(api.savePerson).toHaveBeenCalledTimes(1);
    expect(editForm(el).open).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("server.internal"),
    );
  });

  it("loads 1000 users, displays every matching row and filters without another request", async () => {
    const roster = Array.from({ length: 1000 }, (_, i) => ({
      ...people[0]!,
      personId: `p${i}`,
      displayName: `User ${i}`,
    }));
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(roster) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await list(el).updateComplete;
    const table = list(el).shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1000);
    const search = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=search]")!;
    search.value = "User 999";
    search.dispatchEvent(new Event("input"));
    await flush(el);
    expect(list(el).people.map((person) => person.personId)).toEqual(["p999"]);
    const role = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=role-filter]")!;
    role.value = "staff";
    role.dispatchEvent(new Event("change"));
    await flush(el);
    expect(list(el).people).toEqual([]);
    expect(api.listStaff).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed row action open for retry and ignores invalid or self-disable requests", async () => {
    const api = stubApi({
      resetPin: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(undefined),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api,
      currentPersonId: "p1",
    });
    await flush(el);
    for (const detail of [
      { personId: "missing", action: "reset-pin" },
      { personId: "p1", action: "invalid" },
      { personId: "p1", action: "disable" },
    ]) {
      list(el).dispatchEvent(new CustomEvent("person-action", { detail }));
      await flush(el);
      expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    }
    list(el).dispatchEvent(
      new CustomEvent("person-action", { detail: { personId: "p1", action: "reset-pin" } }),
    );
    await flush(el);
    const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-row-action]")!;
    confirm.click();
    confirm.click();
    await flush(el);
    expect(api.resetPin).toHaveBeenCalledTimes(1);
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("server.internal"),
    );
    confirm.click();
    await flush(el);
    expect(api.resetPin).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(false);
  });

  it("loads the staff on connect and hands them to the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect(api.listStaff).toHaveBeenCalledTimes(1);
    expect(list(el).people).toEqual([people[0]]);
  });

  it("opens the create form when the add button is clicked", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect(form(el).open).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
  });

  // Regression: the create form must REOPEN after a dismiss. The screen is the single owner of the
  // open state (`formOpen`); the form's `wt-close` bubbles up to the screen's `@wt-close` so
  // `formOpen` tracks a dismissal. Without that, `formOpen` stays `true` after a dismiss, the second
  // "add" click is a no-op (true→true schedules no render, so nothing re-commits `.open` on the
  // child), and the dialog never reopens — recoverable only by a reload. Prove by deletion: drop the
  // `@wt-close` handler in staff-screen and this fails at the final assertion (form stays closed).
  it("reopens the create form after a dismiss", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    // Open it once.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);

    // Dismiss via the real Escape/backdrop path: the native <dialog> closing makes wt-modal
    // dispatch a bubbling, composed `wt-close`. `dialog.close()` fires `close` as a QUEUED TASK
    // (not a microtask), so await the wt-close reaching the screen host before asserting — the same
    // timing the person-form suite documents.
    const dialog = await nativeDialog(el);
    const dismissed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    dialog.close();
    await dismissed;
    await el.updateComplete;
    expect(form(el).open).toBe(false);

    // Reopen: with `formOpen` back to false, the second click is a real false→true transition.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
  });

  it("creates the person, reloads the list and closes the form on create-person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    expect(api.listStaff).toHaveBeenCalledTimes(1);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);

    const detail = {
      displayName: "Cy",
      role: "staff" as const,
      pin: "1234",
      email: "cy@x.com",
    };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledWith(detail);
    expect(api.listStaff).toHaveBeenCalledTimes(2);
    expect(form(el).open).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")?.textContent).toContain(
      "invitación",
    );
  });

  it("reports when the person was created but email delivery was unavailable", async () => {
    const api = stubApi({
      createPerson: vi.fn().mockResolvedValue({ id: "p3", invitationSent: false }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    form(el).dispatchEvent(
      new CustomEvent("create-person", {
        detail: { displayName: "Cy", role: "staff", pin: "1234", email: "cy@x.com" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")?.textContent).toContain(
      "no se ha podido enviar",
    );
  });

  // The create form carries the dashboard sign-in email on its create-person detail; the screen
  // forwards the whole detail (including email) to createPerson unchanged.
  it("forwards the email into createPerson", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    const detail = { displayName: "Cy", role: "staff" as const, pin: "1234", email: "cy@x.com" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledWith(detail);
  });

  // A create rejected with `person.email_taken` (a duplicate address) surfaces the localised copy in
  // the create dialog's own banner (its top layer), never the raw wire code — the same routing the
  // `pin.too_short` case uses. The page-level banner stays suppressed while the dialog is open.
  it("renders person.email_taken from a rejected create in the dialog banner", async () => {
    const api = stubApi({
      createPerson: vi.fn().mockRejectedValue({ code: "person.email_taken" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    const detail = { displayName: "A", role: "staff" as const, pin: "1234", email: "dupe@x.com" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(form(el).error).toBe("person.email_taken");
    const banner = formErrorText(el);
    expect(banner).toContain(codeMessage("person.email_taken", "es-ES"));
    expect(banner).not.toContain("person.email_taken");
  });

  it("opens the existing inactive user when a create reuses their email", async () => {
    const inactive = { ...people[1]!, email: "dupe@x.com" };
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue([people[0], inactive]),
      createPerson: vi.fn().mockRejectedValue({ code: "person.email_taken" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    form(el).dispatchEvent(
      new CustomEvent("create-person", {
        detail: {
          displayName: "Bea",
          firstNames: "Beatrice",
          lastNames: "Potter",
          telephone: null,
          role: "staff",
          email: " DUPE@x.com ",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect(form(el).open).toBe(false);
    expect(editForm(el).open).toBe(true);
    expect(editForm(el).person).toEqual(inactive);
  });

  // #load's guard: a rejected initial listStaff must become the error banner, never an unhandled
  // promise rejection (the suite runs with pristine output, which pins that). Covers the `.code`
  // arm of the catch and the role="alert" render.
  it("shows an error key when the initial staff load is rejected (and never rejects)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
    // The banner renders LOCALISED copy, never the raw wire code (the state above stays the raw code).
    const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("falls back to server.internal when the rejected staff load carries no code", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  // The create guard: a rejected createPerson sets the error key and does NOT reload the list or
  // close the form, so the operator keeps the entered values and can retry. Covers the `.code` arm.
  it("shows an error key when createPerson is rejected, without reloading or closing the form", async () => {
    const api = stubApi({
      createPerson: vi.fn().mockRejectedValue({ code: "pin.too_short" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    const detail = { displayName: "Cy", role: "staff" as const, pin: "12", email: "cy@x.com" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledTimes(1);
    expect(api.listStaff).toHaveBeenCalledTimes(1); // NOT reloaded
    expect(form(el).open).toBe(true); // still open for a retry
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("pin.too_short");
  });

  // The create error must surface INSIDE the create modal (its own top layer), not in the screen's
  // page-level banner behind the backdrop where a sighted operator could not see it. While the create
  // form is open the screen passes errorKey DOWN as `.error` and suppresses its own banner. Prove by
  // deletion: drop the `!this.formOpen` guard and the occluded page banner reappears.
  it("routes a rejected create's error into the dialog and suppresses the page banner", async () => {
    const api = stubApi({ createPerson: vi.fn().mockRejectedValue({ code: "pin.too_short" }) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    const detail = { displayName: "Cy", role: "staff" as const, pin: "12", email: "cy@x.com" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    // Passed down and rendered inside the create dialog as LOCALISED copy, never the raw wire code.
    expect(form(el).error).toBe("pin.too_short");
    expect(formErrorText(el)).toContain(codeMessage("pin.too_short", "es-ES"));
    expect(formErrorText(el)).not.toContain("pin.too_short");
    // The screen's own page-level banner is suppressed while the create dialog is open.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("falls back to server.internal when a rejected create carries no code", async () => {
    const api = stubApi({ createPerson: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    form(el).dispatchEvent(
      new CustomEvent("create-person", {
        detail: { displayName: "Cy", role: "staff", pin: "12", email: "cy@x.com" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  // Single-flight: a double-clicked "Crear" fires two create-person events; the second lands while the
  // first's createPerson await is still pending, and the guard drops it — so at most one person is
  // filed (createPerson is not server-idempotent). Proven by deletion: remove the `#creating` guard
  // and createPerson is called twice.
  it("files at most one person when create-person fires twice (double-click)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    const detail = {
      displayName: "Ada",
      role: "staff" as const,
      pin: "1234",
      email: "ada@x.com",
    };
    // Dispatched synchronously back-to-back: the first #onCreatePerson sets its in-flight guard before
    // awaiting createPerson, so the second is dropped before it can call the API again.
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledTimes(1);
  });
});

describe("staff-screen — row edit", () => {
  it("opens the edit dialog for the person named by edit-person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect(editForm(el).open).toBe(false);
    await openEdit(el, "p1");
    expect(editForm(el).open).toBe(true);
    expect(editForm(el).person).toEqual(people[0]);
  });

  // #onEditPerson resolves the id against the list it already holds; an id not in that list can only
  // be a stale event, and the comment says it is dropped. Prove it: no dialog opens for an unknown id.
  it("ignores an edit-person for an unknown id (no dialog opens)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    await openEdit(el, "nope-not-a-real-id");
    expect(editForm(el).open).toBe(false);
  });

  it("saves all editable fields atomically and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    const details = {
      displayName: "Ada L",
      firstNames: "Ada Augusta",
      lastNames: "Lovelace",
      telephone: "+44 21",
      email: "ada@example.com",
      role: "admin" as const,
      status: "active" as const,
    };
    editForm(el).dispatchEvent(
      new CustomEvent("save-person", { detail: details, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.savePerson).toHaveBeenCalledWith("p1", details);
    expect(api.listStaff).toHaveBeenCalledTimes(2);
  });

  it("resends an invitation and reports delivery after closing the edit dialog", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("resend-invitation", { bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.resendInvitation).toHaveBeenCalledWith("p1");
    expect(editForm(el).open).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")?.textContent).toContain(
      "invitación",
    );
  });

  // A rejected edit action becomes the error banner (never an unhandled rejection — pristine output
  // pins that) and leaves the dialog OPEN so the operator can retry. Covers the `.code` arm.
  it("shows the thrown code and keeps the dialog open when an edit action is rejected", async () => {
    const api = stubApi({
      savePerson: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("save-person", {
        detail: {
          displayName: "Ada",
          firstNames: "Ada",
          lastNames: "Lovelace",
          telephone: null,
          email: "ada@x.com",
          role: "manager",
          status: "active",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "authorization.not_permitted",
    );
    expect(editForm(el).open).toBe(true); // still open for a retry
  });

  // The error must surface INSIDE the modal (its own top layer), not in the screen's page-level
  // banner, which sits behind the dialog backdrop where a sighted operator could not see it. So while
  // the edit dialog is open the screen passes the errorKey DOWN as `.error` and suppresses its own
  // banner. Prove by deletion: drop the `!this.editOpen` guard and the occluded page banner reappears.
  it("routes a rejected edit action's error into the dialog and suppresses the page banner", async () => {
    const api = stubApi({
      savePerson: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("save-person", {
        detail: {
          displayName: "Ada",
          firstNames: "Ada",
          lastNames: "Lovelace",
          telephone: null,
          email: "ada@x.com",
          role: "manager",
          status: "active",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    // Passed down (the raw code stays in the dialog's `error` state) and rendered inside the edit
    // dialog's shadow as LOCALISED copy, never the raw wire code.
    expect(editForm(el).error).toBe("authorization.not_permitted");
    const summary = editForm(el).shadowRoot!.querySelector("wt-form-error-summary") as unknown as {
      errors: string[];
    };
    expect(summary.errors).toContain(codeMessage("authorization.not_permitted", "es-ES"));
    // The screen's own page-level banner is suppressed while the edit dialog is open.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  const saveDetails = {
    displayName: "Ada",
    firstNames: "Ada",
    lastNames: "Lovelace",
    telephone: null,
    email: "ada@x.com",
    role: "manager" as const,
    status: "active" as const,
  };
  function dispatchSave(el: StaffScreen): void {
    editForm(el).dispatchEvent(
      new CustomEvent("save-person", { detail: saveDetails, bubbles: true, composed: true }),
    );
  }

  // save-person is the one edit action left in the form (reset/deactivate/reactivate moved to the
  // row's kebab menu) — it still exercises #editWith/#runEditAction's shared guards below.
  it("falls back to server.internal when a rejected edit action carries no code", async () => {
    const api = stubApi({ savePerson: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    dispatchSave(el);
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("runs at most one edit action when two fire back-to-back", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    dispatchSave(el);
    dispatchSave(el);
    await flush(el);

    expect(api.savePerson).toHaveBeenCalledTimes(1);
  });

  // A forged action event with no open person must be dropped.
  it("drops an edit action that arrives with no person open", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    // No openEdit(): editingPerson is null.
    dispatchSave(el);
    await flush(el);

    expect(api.savePerson).not.toHaveBeenCalled();
  });

  // The screen owns the edit-open state, so the dialog's `wt-close` must bubble up and clear it —
  // the same reopen contract the create form has. Prove by deletion: drop the `@wt-close` handler on
  // dashboard-person-edit and this fails (editForm stays open after the dismiss).
  it("closes the edit dialog on wt-close and can reopen it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");
    expect(editForm(el).open).toBe(true);

    editForm(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(editForm(el).open).toBe(false);
    // The edit target is dropped on close (the "editingPerson is null when closed" invariant), so no
    // stale person lingers. Prove by deletion: stop clearing editingPerson in #closeEdit and this
    // still shows people[0].
    expect(editForm(el).person).toBeNull();

    await openEdit(el, "p2");
    expect(editForm(el).open).toBe(true);
    expect(editForm(el).person).toEqual(people[1]);
  });
});

it("refreshes displayed people when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>("dashboard-staff-screen", {
    api,
  });
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["people"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listStaff).mockResolvedValue([]);
  liveData.invalidate([{ type: "persons", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listStaff).toHaveBeenCalledTimes(2);
});
