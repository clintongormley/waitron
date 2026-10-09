import { LiveData, tableNoMatches } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { roleName, rolesByName, statusName } from "../i18n/domain.js";
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

async function flush(el: StaffScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function list(el: StaffScreen): StaffList {
  return el.shadowRoot!.querySelector("dashboard-staff-list")!;
}

/** The people the staff table draws, in the order it draws them. */
async function drawn(el: StaffScreen): Promise<string[]> {
  await list(el).updateComplete;
  const table = list(el).shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return [...table.shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}

async function typeSearch(el: StaffScreen, value: string): Promise<void> {
  el.shadowRoot!.querySelector("[data-test=search]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await flush(el);
}

function form(el: StaffScreen): PersonForm {
  return el.shadowRoot!.querySelector("dashboard-person-form")!;
}

async function bottomOf(dialog: HTMLElement): Promise<string | undefined> {
  return (
    (await formMessageOf(dialog.shadowRoot!.querySelector("wt-form-actions")!))?.textContent ??
    undefined
  );
}

function formErrorText(el: StaffScreen): Promise<string | undefined> {
  return bottomOf(form(el));
}

async function nativeDisabled(dialog: HTMLElement, testId: string): Promise<boolean> {
  const button = dialog.shadowRoot!.querySelector(`[data-test=${testId}]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await button.updateComplete;
  return button.shadowRoot!.querySelector("button")!.disabled;
}

function editForm(el: StaffScreen): PersonEdit {
  return el.shadowRoot!.querySelector("dashboard-person-edit")!;
}

async function openEdit(el: StaffScreen, personId: string): Promise<void> {
  list(el).dispatchEvent(
    new CustomEvent("edit-person", { detail: { personId }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

function typeInto(dialog: HTMLElement, testId: string, value: string): void {
  dialog
    .shadowRoot!.querySelector(`[data-test=${testId}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}

/** Fills the open add form and presses Create, so create-person carries what the form holds. */
async function createThroughForm(el: StaffScreen, email = "cy@x.com"): Promise<void> {
  const add = form(el);
  typeInto(add, "first-names", "Cy");
  typeInto(add, "last-names", "Young");
  typeInto(add, "email", email);
  await add.updateComplete;
  add.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}
const createdThroughForm = {
  firstNames: "Cy",
  lastNames: "Young",
  displayName: "Cy Young",
  email: "cy@x.com",
  telephone: null,
  role: "staff",
};

/** Edits one field of the open edit form and presses Save, so save-person carries what it holds. */
async function saveThroughEdit(
  el: StaffScreen,
  testId = "edit-telephone",
  value = "+44 20 7946 0000",
): Promise<void> {
  const edit = editForm(el);
  await edit.updateComplete;
  typeInto(edit, testId, value);
  await edit.updateComplete;
  edit.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
}

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
    await saveThroughEdit(el);
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
    const search = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=search]",
    )!;
    search.value = "User 999";
    search.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "User 999" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(await drawn(el)).toEqual(["p999"]);
    const role = el.shadowRoot!.querySelector<HTMLElement>("[data-test=role-filter]")!;
    await chooseOption(role, "staff");
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
    const actions = dialog.querySelector("wt-form-actions")!;
    const message = await formMessageOf(actions);
    expect(message?.textContent).toBe(codeMessage("server.internal"));
    expect(dialog.shadowRoot!.querySelector(".body")!.contains(message)).toBe(true);
    expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
    expect(dialog.textContent).not.toContain(codeMessage("server.internal"));
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

  it("says the dashboard's one no-matches sentence when the search hides every person, and its own sentence when there are none", async () => {
    const sentence = async (el: StaffScreen) => {
      await list(el).updateComplete;
      const table = list(el).shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      return table.shadowRoot!.querySelector(".empty .message")!.textContent;
    };
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
    await flush(el);
    el.shadowRoot!.querySelector("[data-test=search]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "zzz" }, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(await drawn(el)).toEqual([]);
    expect(await sentence(el)).toBe(tableNoMatches());

    const none = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(none.el);
    expect(await sentence(none.el)).toBe(t("staff.empty"));
  });

  it("puts the add button under the empty staff table's sentence, opening the same form", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await list(el).updateComplete;

    const button = list(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    expect(button.assignedSlot).not.toBeNull();
    expect(button.checkVisibility()).toBe(true);
    expect(button.textContent!.trim()).toBe(t("staff.add_user"));
    button.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
  });

  /** Focuses and presses the empty table's add button, as a person's click leaves it. */
  async function pressEmptyAdd(el: StaffScreen): Promise<HTMLElement> {
    await list(el).updateComplete;
    const button = list(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    button.focus();
    button.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
    return button;
  }

  /** Lets a closing native dialog hand focus back, which it does a task after it closes. */
  async function afterDialogCloses(el: StaffScreen): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await el.updateComplete;
  }

  it("returns focus to the header's add button after the first person is made from the empty table", async () => {
    let rows: PersonSummary[] = [];
    const api = stubApi({
      listStaff: vi.fn(() => Promise.resolve(rows)),
      createPerson: vi.fn(() => {
        rows = people;
        return Promise.resolve({ id: "p1", invitationSent: true });
      }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    const button = await pressEmptyAdd(el);
    await createThroughForm(el);
    await vi.waitFor(() => expect(form(el).open).toBe(false));
    await vi.waitFor(() => expect(button.isConnected).toBe(false));
    await afterDialogCloses(el);
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector(".header [data-test=add]"),
    );
  });

  it("returns focus to the empty table's add button after Cancel", async () => {
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    const button = await pressEmptyAdd(el);
    form(el).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await vi.waitFor(() => expect(form(el).open).toBe(false));
    await afterDialogCloses(el);
    expect(el.shadowRoot!.activeElement).toBe(button);
  });

  it("draws no add button in the staff table once people exist", async () => {
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
    await flush(el);
    expect(list(el).querySelector("[slot=empty-action]")).toBeNull();
  });

  // If a dismiss left `formOpen` true, the next add click would be true→true and render nothing.
  it("reopens the create form after a dismiss", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);

    // `dialog.close()` fires `close` as a queued task, not a microtask, so wait for `wt-close` to
    // reach the screen.
    const dialog = await nativeDialog(el);
    const dismissed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    dialog.close();
    await dismissed;
    await el.updateComplete;
    expect(form(el).open).toBe(false);

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

    await createThroughForm(el);
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledWith(createdThroughForm);
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

  it("renders person.email_taken from a rejected create under the add form's email field", async () => {
    const api = stubApi({
      createPerson: vi.fn().mockRejectedValue({ code: "person.email_taken" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    await createThroughForm(el, "dupe@x.com");
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledTimes(1);
    expect(form(el).error).toBe("person.email_taken");
    await form(el).updateComplete;
    const email = form(el).shadowRoot!.querySelector("[data-test=email]")!;
    expect(email.getAttribute("error")).toBe(codeMessage("person.email_taken", "es-ES"));
    const banner = await formErrorText(el);
    expect(banner).toBe(t("form.fix_fields"));
    expect(banner).not.toContain("person.email_taken");
    expect(await nativeDisabled(form(el), "confirm")).toBe(false);
  });

  it("places a rejected create's params field under that field of the add form", async () => {
    const api = stubApi({
      createPerson: vi
        .fn()
        .mockRejectedValue({ code: "profile.invalid", params: { field: "lastNames" } }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await el.updateComplete;

    await createThroughForm(el, "a@x.com");
    await flush(el);
    await form(el).updateComplete;

    expect(api.createPerson).toHaveBeenCalledTimes(1);
    const lastNames = form(el).shadowRoot!.querySelector("[data-test=last-names]")!;
    expect(lastNames.getAttribute("error")).toBe(codeMessage("profile.invalid", "es-ES"));
    expect(await nativeDisabled(form(el), "confirm")).toBe(false);
  });

  it("places a rejected edit's refusal under the field it names, leaving Save working", async () => {
    const api = stubApi({
      savePerson: vi
        .fn()
        .mockRejectedValue({ code: "person.email_taken", params: { email: "bea@x.com" } }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    // The fixture's stored telephone is too short for the form's own check.
    typeInto(editForm(el), "edit-telephone", "+44 20 7946 0000");
    await saveThroughEdit(el, "edit-email", "bea@x.com");
    await flush(el);
    await editForm(el).updateComplete;

    expect(api.savePerson).toHaveBeenCalledTimes(1);

    const email = editForm(el).shadowRoot!.querySelector("[data-test=edit-email]")!;
    expect(email.getAttribute("error")).toBe(codeMessage("person.email_taken", "es-ES"));
    expect(await nativeDisabled(editForm(el), "save")).toBe(false);
  });

  it("does not carry a refusal's params field over to a later refusal without one", async () => {
    const savePerson = vi
      .fn()
      .mockRejectedValueOnce({ code: "management.request_invalid", params: { field: "email" } })
      .mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api: stubApi({ savePerson }),
    });
    await flush(el);
    await openEdit(el, "p1");
    const save = () =>
      editForm(el).dispatchEvent(
        new CustomEvent("save-person", {
          detail: { ...people[0]!, telephone: null },
          bubbles: true,
          composed: true,
        }),
      );

    save();
    await flush(el);
    await editForm(el).updateComplete;
    const email = editForm(el).shadowRoot!.querySelector("[data-test=edit-email]")!;
    expect(email.getAttribute("error")).toBe(codeMessage("management.request_invalid", "es-ES"));

    save();
    await flush(el);
    await editForm(el).updateComplete;
    expect(email.getAttribute("error")).toBe("");
    await editForm(el).shadowRoot!.querySelector("wt-form-actions")!.updateComplete;
    expect(await bottomOf(editForm(el))).toBe(codeMessage("connection.failed", "es-ES"));
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

  it("shows an error key when the initial staff load is rejected (and never rejects)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
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
    expect(api.listStaff).toHaveBeenCalledTimes(1);
    expect(form(el).open).toBe(true);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("pin.too_short");
  });

  // The page-level banner sits behind the modal's backdrop, so while the form is open the error is
  // shown inside it instead.
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

    expect(form(el).error).toBe("pin.too_short");
    expect(await formErrorText(el)).toContain(codeMessage("pin.too_short", "es-ES"));
    expect(await formErrorText(el)).not.toContain("pin.too_short");
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
    expect(editForm(el).open).toBe(true);
  });

  // The page-level banner sits behind the modal's backdrop, so while the dialog is open the error is
  // shown inside it instead.
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

    expect(editForm(el).error).toBe("authorization.not_permitted");
    await editForm(el).shadowRoot!.querySelector("wt-form-actions")!.updateComplete;
    expect(await bottomOf(editForm(el))).toBe(codeMessage("authorization.not_permitted", "es-ES"));
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

  it("drops an edit action that arrives with no person open", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    // No openEdit(): editingPerson is null.
    dispatchSave(el);
    await flush(el);

    expect(api.savePerson).not.toHaveBeenCalled();
  });

  it("closes the edit dialog on wt-close and can reopen it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");
    expect(editForm(el).open).toBe(true);

    editForm(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(editForm(el).open).toBe(false);
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

describe("staff-screen after the server comes back", () => {
  const down = { code: "connection.failed" };
  const alert = (el: StaffScreen) =>
    el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim() ?? null;
  const shownPeople = (el: StaffScreen) =>
    (el as unknown as { people: PersonSummary[] }).people.map(({ personId }) => personId);
  const rowError = (el: StaffScreen) =>
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-dialog wt-form-actions")!
      .error;

  it("clears a failed first load's message once the server answers again", async () => {
    const api = Object.assign(stubApi({ listStaff: vi.fn().mockRejectedValue(down) }), {
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await vi.waitFor(() => expect(alert(el)).toBe(codeMessage("connection.failed")));
    vi.mocked(api.listStaff).mockResolvedValue(people);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert(el)).toBeNull());
    expect(shownPeople(el)).toEqual(["p1", "p2"]);
  });

  it("clears a failed refresh's message once the server answers again", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await vi.waitFor(() => expect(shownPeople(el)).toEqual(["p1", "p2"]));
    vi.mocked(api.listStaff).mockRejectedValue(down);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert(el)).toBe(codeMessage("connection.failed")));
    vi.mocked(api.listStaff).mockResolvedValue([people[0]!]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert(el)).toBeNull());
    expect(shownPeople(el)).toEqual(["p1"]);
  });

  it("keeps a later refusal's message when an earlier failed refresh recovers", async () => {
    const api = Object.assign(
      stubApi({ resetPin: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await vi.waitFor(() => expect(shownPeople(el)).toEqual(["p1", "p2"]));
    vi.mocked(api.listStaff).mockRejectedValue(down);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert(el)).toBe(codeMessage("connection.failed")));
    list(el).dispatchEvent(
      new CustomEvent("person-action", {
        detail: { personId: "p1", action: "reset-pin" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-row-action]")!.click();
    await vi.waitFor(() => expect(rowError(el)).toBe(codeMessage("server.internal")));
    vi.mocked(api.listStaff).mockResolvedValue(people);
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listStaff).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(rowError(el)).toBe(codeMessage("server.internal"));
  });

  it("keeps a row action's connection failure through a failed re-read and the reads' recovery", async () => {
    const api = Object.assign(stubApi({ resetPin: vi.fn().mockRejectedValue(down) }), {
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await vi.waitFor(() => expect(shownPeople(el)).toEqual(["p1", "p2"]));
    vi.mocked(api.listStaff).mockRejectedValue(down);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert(el)).toBe(codeMessage("connection.failed")));
    list(el).dispatchEvent(
      new CustomEvent("person-action", {
        detail: { personId: "p1", action: "reset-pin" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-row-action]")!.click();
    await vi.waitFor(() => expect(rowError(el)).toBe(codeMessage("connection.failed")));
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listStaff).toHaveBeenCalledTimes(3));
    await flush(el);

    vi.mocked(api.listStaff).mockResolvedValue([people[0]!]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(shownPeople(el)).toEqual(["p1"]));
    await flush(el);
    expect(rowError(el)).toBe(codeMessage("connection.failed"));
  });
});

describe("staff-screen — row actions, filters and edit races", () => {
  function rowAction(el: StaffScreen, personId: string, action: string): void {
    list(el).dispatchEvent(
      new CustomEvent("person-action", {
        detail: { personId, action },
        bubbles: true,
        composed: true,
      }),
    );
  }
  const rowDialog = (el: StaffScreen) => el.shadowRoot!.querySelector("wt-dialog")!;
  const confirmRow = (el: StaffScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-row-action]")!.click();

  it("ignores another row's action while a confirmed one is still in flight", async () => {
    let finish!: () => void;
    const api = stubApi({
      resetPin: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    rowAction(el, "p1", "reset-pin");
    await flush(el);
    confirmRow(el);
    rowAction(el, "p2", "reset-login");
    await flush(el);
    expect(rowDialog(el).heading).toBe("Ada");
    finish();
    await flush(el);
    expect(api.resetLogin).not.toHaveBeenCalled();
    expect(rowDialog(el).open).toBe(false);
  });

  it("refuses to disable a person who has become the signed-in one after the dialog opened", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api,
      currentPersonId: "p1",
    });
    await flush(el);
    rowAction(el, "p2", "disable");
    await flush(el);
    expect(rowDialog(el).open).toBe(true);
    el.currentPersonId = "p2";
    await flush(el);
    confirmRow(el);
    await flush(el);
    expect(api.deactivatePerson).not.toHaveBeenCalled();
    expect(rowDialog(el).open).toBe(true);
  });

  it("confirms enabling, then reports that the invitation email could not be sent", async () => {
    const api = stubApi({
      reactivatePerson: vi.fn().mockResolvedValue({ invitationSent: false }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    rowAction(el, "p2", "reactivate");
    await flush(el);
    expect(rowDialog(el).querySelector("p")!.textContent!.trim()).toBe(t("person.confirm_enable"));
    confirmRow(el);
    await flush(el);
    expect(api.reactivatePerson).toHaveBeenCalledExactlyOnceWith("p2");
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")!.textContent!.trim()).toBe(
      t("staff.invitation_not_sent"),
    );
  });

  it("confirms a row's resend-invitation and reports delivery", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    rowAction(el, "p1", "resend-invitation");
    await flush(el);
    expect(rowDialog(el).querySelector("p")!.textContent!.trim()).toBe(
      t("person.resend_invitation"),
    );
    confirmRow(el);
    await flush(el);
    expect(api.resendInvitation).toHaveBeenCalledExactlyOnceWith("p1");
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")!.textContent!.trim()).toBe(
      t("staff.invitation_sent"),
    );
  });

  it("cancels a row confirmation without calling the API", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    rowAction(el, "p1", "reset-login");
    await flush(el);
    rowDialog(el).querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
    await flush(el);
    expect(rowDialog(el).open).toBe(false);
    expect(api.resetLogin).not.toHaveBeenCalled();
  });

  it("filters by each status, and hides disabled people until asked", async () => {
    const pending: PersonSummary = {
      ...people[0]!,
      personId: "p3",
      displayName: "Cruz",
      status: "pending",
    };
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([...people, pending]) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    const shown = () => list(el).people.map((person) => person.personId);
    expect(shown()).toEqual(["p1", "p3"]);
    const status = el.shadowRoot!.querySelector<HTMLElement>("[data-test=status-filter]")!;
    for (const [value, expected] of [
      ["active", ["p1"]],
      ["pending", ["p3"]],
      ["suspended", ["p2"]],
      ["all", ["p1", "p2", "p3"]],
      ["current", ["p1", "p3"]],
    ] as const) {
      await chooseOption(status, value);
      await flush(el);
      expect(shown()).toEqual(expected);
    }
  });

  it("drops a resend-invitation from a closed edit dialog and a second one while the first runs", async () => {
    let finish!: (value: { invitationSent: boolean }) => void;
    const api = stubApi({
      resendInvitation: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      ),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    const resend = () =>
      editForm(el).dispatchEvent(
        new CustomEvent("resend-invitation", { bubbles: true, composed: true }),
      );
    resend();
    await flush(el);
    expect(api.resendInvitation).not.toHaveBeenCalled();
    await openEdit(el, "p1");
    resend();
    resend();
    finish({ invitationSent: false });
    await flush(el);
    expect(api.resendInvitation).toHaveBeenCalledExactlyOnceWith("p1");
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")!.textContent!.trim()).toBe(
      t("staff.invitation_not_sent"),
    );
  });

  it("keeps the edit dialog open with the refusal when a resend-invitation is rejected", async () => {
    const api = stubApi({
      resendInvitation: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");
    editForm(el).dispatchEvent(
      new CustomEvent("resend-invitation", { bubbles: true, composed: true }),
    );
    await flush(el);
    expect(editForm(el).open).toBe(true);
    expect(editForm(el).error).toBe("authorization.not_permitted");
    expect(el.shadowRoot!.querySelector("[data-test=invitation-status]")).toBeNull();
  });

  describe("an edit dialog opened while the post-save reload is in flight", () => {
    async function openDuringReload(reloaded: PersonSummary[]): Promise<StaffScreen> {
      let finishReload!: (value: PersonSummary[]) => void;
      const api = stubApi({
        listStaff: vi
          .fn()
          .mockResolvedValueOnce(people)
          .mockReturnValueOnce(
            new Promise((resolve) => {
              finishReload = resolve;
            }),
          ),
      });
      const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
      await flush(el);
      await openEdit(el, "p1");
      // The saved dialog's native close lands a task later; waiting for it keeps this test about
      // the next open alone.
      const closed = new Promise((resolve) =>
        editForm(el).addEventListener("wt-close", resolve, { once: true }),
      );
      await saveThroughEdit(el);
      await flush(el);
      await closed;
      expect(api.listStaff).toHaveBeenCalledTimes(2);
      expect(editForm(el).open).toBe(false);
      await openEdit(el, "p2");
      finishReload(reloaded);
      await flush(el);
      return el;
    }

    it("shows the reloaded copy of its person", async () => {
      const renamed = { ...people[1]!, displayName: "Beatriz" };
      const el = await openDuringReload([people[0]!, renamed]);
      expect(editForm(el).open).toBe(true);
      expect(editForm(el).person).toEqual(renamed);
    });

    it("keeps the person it opened with when the reload no longer lists them", async () => {
      const el = await openDuringReload([people[0]!]);
      expect(editForm(el).open).toBe(true);
      expect(editForm(el).person).toEqual(people[1]);
    });
  });

  it("keeps a failed edit's message and field when an earlier row action completes after it", async () => {
    let finish!: () => void;
    const api = stubApi({
      resetPin: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
      savePerson: vi
        .fn()
        .mockRejectedValue({ code: "person.email_taken", params: { field: "email" } }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    rowAction(el, "p1", "reset-pin");
    await flush(el);
    confirmRow(el);
    await vi.waitFor(() => expect(api.resetPin).toHaveBeenCalledTimes(1));
    await openEdit(el, "p1");
    editForm(el).dispatchEvent(
      new CustomEvent("save-person", {
        detail: {
          displayName: "Ada",
          firstNames: "Ada",
          lastNames: "Lovelace",
          telephone: null,
          email: "bea@x.com",
          role: "manager",
          status: "active",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(editForm(el).error).toBe("person.email_taken"));

    const reads = vi.mocked(api.listStaff).mock.calls.length;
    finish();
    await vi.waitFor(() => expect(api.listStaff).toHaveBeenCalledTimes(reads + 1));
    await flush(el);
    expect(editForm(el).open).toBe(true);
    expect(editForm(el).error).toBe("person.email_taken");
    expect(editForm(el).errorField).toBe("email");
  });
});

describe("staff-screen filter fields", () => {
  type Field = HTMLElement & {
    type: string;
    name: string;
    label: string;
    hideLabel: boolean;
    search: string;
    value: string;
    options: { value: string; label: string }[];
  };
  const field = (el: StaffScreen, selector: string) =>
    el.shadowRoot!.querySelector(selector) as Field | null;
  const shown = (el: StaffScreen) => list(el).people.map((person) => person.personId);

  it("searches from a labelled search field", async () => {
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
    await flush(el);
    const search = field(el, "wt-input[data-test=search]")!;
    expect(search.type).toBe("search");
    expect(search.name).toBe("search");
    expect(search.label).toBe(t("staff.search"));
    expect(search.hideLabel).toBe(false);
    expect(search.value).toBe("");
    search.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "ada" }, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(await drawn(el)).toEqual(["p1"]);
  });

  it("finds a person by every word typed across names, email and telephone, closest first", async () => {
    const person = (overrides: Partial<PersonSummary>): PersonSummary => ({
      ...people[0]!,
      firstNames: null,
      lastNames: null,
      email: null,
      telephone: null,
      ...overrides,
    });
    const roster = [
      person({ personId: "edgar", displayName: "Ed", email: "edgar@x.com" }),
      person({
        personId: "jose",
        displayName: "Pepe",
        firstNames: "José",
        lastNames: "García",
        email: "jose@example.com",
      }),
      person({ personId: "phone", displayName: "Lu", telephone: "+34 600 111 222" }),
      person({ personId: "legal", displayName: "Max", lastNames: "Garcia" }),
    ];
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
      api: stubApi({ listStaff: vi.fn().mockResolvedValue(roster) }),
    });
    await flush(el);
    await typeSearch(el, "garcia jose");
    expect(await drawn(el)).toEqual(["jose"]);
    await typeSearch(el, "GARCÍA pepe");
    expect(await drawn(el)).toEqual(["jose"]);
    await typeSearch(el, "jose example");
    expect(await drawn(el)).toEqual(["jose"]);
    await typeSearch(el, "600 111");
    expect(await drawn(el)).toEqual(["phone"]);
    await typeSearch(el, "&");
    expect(await drawn(el)).toEqual([]);
    await typeSearch(el, "pepe ");
    expect(await drawn(el)).toEqual(["jose"]);
    await typeSearch(el, "pep ");
    expect(await drawn(el)).toEqual([]);
    await typeSearch(el, "gar");
    expect(await drawn(el)).toEqual(["legal", "jose", "edgar"]);

    const table = list(el).shadowRoot!.querySelector("wt-data-table")!;
    table
      .shadowRoot!.querySelector<HTMLElement>('thead th button[data-sort="displayName"]')!
      .click();
    expect(await drawn(el)).toEqual(["legal", "jose", "edgar"]);
    await typeSearch(el, "");
    expect(await drawn(el)).toEqual(["edgar", "phone", "legal", "jose"]);
  });

  it("filters by role from a labelled dropdown starting on every role", async () => {
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
    await flush(el);
    const role = field(el, "wt-combobox[data-test=role-filter]")!;
    expect(role.name).toBe("role-filter");
    expect(role.label).toBe(t("staff.filter_role"));
    expect(role.search).toBe("auto");
    expect(role.options).toEqual([
      { value: "all", label: t("staff.filter_all_roles") },
      ...rolesByName().map((value) => ({ value, label: roleName(value) })),
    ]);
    expect(role.value).toBe("all");
    await chooseOption(role, "staff");
    await flush(el);
    expect(shown(el)).toEqual([]);
    await chooseOption(role, "manager");
    await flush(el);
    expect(shown(el)).toEqual(["p1"]);
  });

  it("filters by status from a labelled dropdown starting on current users, its help beside it", async () => {
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api: stubApi() });
    await flush(el);
    const status = field(el, "wt-combobox[data-test=status-filter]")!;
    expect(status.name).toBe("status-filter");
    expect(status.label).toBe(t("staff.filter_status"));
    expect(status.search).toBe("auto");
    expect(status.options).toEqual([
      { value: "current", label: t("staff.filter_current") },
      { value: "active", label: statusName("active") },
      { value: "pending", label: statusName("pending") },
      { value: "suspended", label: statusName("suspended") },
      { value: "all", label: t("staff.filter_all_statuses") },
    ]);
    expect(status.value).toBe("current");
    const help = el.shadowRoot!.querySelector("[data-test=status-filter-help]")!;
    expect(help.parentElement).toBe(status);
    expect(help.getAttribute("slot")).toBe("help");
    expect(help.getAttribute("aria-label")).toBe(t("staff.filter_current_help_label"));
    // es-ES is the suite's language.
    expect(help.textContent!.trim()).toBe(
      "Los usuarios actuales son todos los que no están deshabilitados: los activos y los pendientes (invitados que aún no han terminado de configurar su cuenta).",
    );
    await chooseOption(status, "suspended");
    await flush(el);
    expect(shown(el)).toEqual(["p2"]);
  });
});
