import { afterEach, describe, expect, it, vi } from "vitest";
import { startRegistration } from "@simplewebauthn/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import type { StaffList } from "../widgets/staff-list.js";
import type { PersonForm } from "../widgets/person-form.js";
import type { PersonEdit } from "../widgets/person-edit.js";
import { StaffScreen } from "./staff-screen.js";

// The real `startRegistration` drives `navigator.credentials.create`, which needs a physical
// authenticator and cannot run headless. Mock the whole module: `startRegistration` resolves the
// attestation the verify step echoes back, so the screen's chain runs end to end under test.
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: "cred-abc" }),
  startRegistration: vi.fn().mockResolvedValue({ id: "cred-abc" }),
}));

afterEach(cleanupWidgets);
// Shared across tests (the module mock is file-scoped), so clear its call log between them.
afterEach(() => vi.mocked(startRegistration).mockClear());

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: false,
  },
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    createPerson: vi.fn().mockResolvedValue({ id: "p3" }),
    updatePerson: vi.fn().mockResolvedValue(undefined),
    resetPin: vi.fn().mockResolvedValue(undefined),
    setPassword: vi.fn().mockResolvedValue(undefined),
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

/** The native <dialog> inside the screen's person-form, once wt-dialog's first render has settled. */
async function nativeDialog(el: StaffScreen): Promise<HTMLDialogElement> {
  const wtDialog = form(el).shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

describe("staff-screen", () => {
  it("loads the staff on connect and hands them to the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    expect(api.listStaff).toHaveBeenCalledTimes(1);
    expect(list(el).people).toEqual(people);
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

    // Dismiss via the real Escape/backdrop path: the native <dialog> closing makes wt-dialog
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

    const detail = { displayName: "Cy", role: "staff" as const, pin: "1234" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.createPerson).toHaveBeenCalledWith(detail);
    expect(api.listStaff).toHaveBeenCalledTimes(2);
    expect(form(el).open).toBe(false);
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

    const detail = { displayName: "Cy", role: "staff" as const, pin: "12" };
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

    const detail = { displayName: "Cy", role: "staff" as const, pin: "12" };
    form(el).dispatchEvent(
      new CustomEvent("create-person", { detail, bubbles: true, composed: true }),
    );
    await flush(el);

    // Passed down and rendered inside the create dialog as LOCALISED copy, never the raw wire code.
    expect(form(el).error).toBe("pin.too_short");
    expect(form(el).shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      codeMessage("pin.too_short", "es-ES"),
    );
    expect(form(el).shadowRoot!.querySelector("[role=alert]")?.textContent).not.toContain(
      "pin.too_short",
    );
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
        detail: { displayName: "Cy", role: "staff", pin: "12" },
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

    const detail = { displayName: "Ada", role: "staff" as const, pin: "1234" };
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

  // Add-passkey: options → startRegistration (the browser ceremony, mocked) → verify → success
  // status. The symmetric parallel of the login screen's passkey flow, for the signed-in manager.
  it("runs the registration ceremony and shows a success status", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-passkey]")!.click();
    await flush(el);

    // v13 wraps the server's options blob under `optionsJSON` — NOT the bare options object.
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "def" } });
    expect(api.passkeyRegisterVerify).toHaveBeenCalledWith({
      challengeHandle: "h2",
      response: { id: "cred-abc" },
    });
    expect((el as unknown as { passkeyStatus: string | null }).passkeyStatus).toBe(
      "passkey.registered",
    );
    // The status banner renders LOCALISED copy ("Passkey añadida"), never the raw wire code (the
    // state above stays the raw success code).
    const status = el.shadowRoot!.querySelector("[role=status]")?.textContent;
    expect(status).toContain(codeMessage("passkey.registered", "es-ES"));
    expect(status).not.toContain("passkey.registered");
  });

  // A rejected registration step becomes the error banner (never an unhandled rejection — pristine
  // output pins that), leaves no success status, and covers the `.code` arm with a distinct code.
  it("shows the thrown code as errorKey when a registration step is rejected (and never rejects)", async () => {
    const api = stubApi({
      passkeyRegisterVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-passkey]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "passkey.challenge_expired",
    );
    expect((el as unknown as { passkeyStatus: string | null }).passkeyStatus).toBeNull();
  });

  // Covers the `?? "passkey.verification_failed"` fallback arm: a rejection carrying no code.
  it("falls back to passkey.verification_failed when a rejected registration step carries no code", async () => {
    const api = stubApi({ passkeyRegisterOptions: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-passkey]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "passkey.verification_failed",
    );
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

  it("update-role calls updatePerson with the role and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "admin" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.updatePerson).toHaveBeenCalledWith("p1", { role: "admin" });
    expect(api.listStaff).toHaveBeenCalledTimes(2); // reloaded
  });

  it("set-status calls updatePerson with the status and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("set-status", {
        detail: { status: "suspended" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect(api.updatePerson).toHaveBeenCalledWith("p1", { status: "suspended" });
    expect(api.listStaff).toHaveBeenCalledTimes(2);
  });

  it("reset-pin calls resetPin with the pin and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("reset-pin", { detail: { pin: "4321" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.resetPin).toHaveBeenCalledWith("p1", "4321");
    expect(api.listStaff).toHaveBeenCalledTimes(2);
  });

  it("set-password calls setPassword with the password and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("set-password", {
        detail: { password: "hunter2 correct horse" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect(api.setPassword).toHaveBeenCalledWith("p1", "hunter2 correct horse");
    expect(api.listStaff).toHaveBeenCalledTimes(2);
  });

  // After a successful action the screen reloads, and the OPEN dialog's `person` is re-resolved from
  // the reloaded list so its derived controls (the Suspender/Reactivar toggle) reflect the new state.
  // Here the second listStaff returns p1 as suspended, so the dialog's person must flip to suspended.
  it("refreshes the open dialog's person from the reloaded list after an action", async () => {
    const suspendedP1 = { ...people[0], status: "suspended" as const };
    const listStaff = vi
      .fn()
      .mockResolvedValueOnce(people)
      .mockResolvedValue([suspendedP1, people[1]]);
    const api = stubApi({ listStaff });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");
    expect(editForm(el).person!.status).toBe("active");

    editForm(el).dispatchEvent(
      new CustomEvent("set-status", {
        detail: { status: "suspended" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect(editForm(el).person!.status).toBe("suspended");
  });

  // A rejected edit action becomes the error banner (never an unhandled rejection — pristine output
  // pins that) and leaves the dialog OPEN so the operator can retry. Covers the `.code` arm.
  it("shows the thrown code and keeps the dialog open when an edit action is rejected", async () => {
    const api = stubApi({
      updatePerson: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "admin" }, bubbles: true, composed: true }),
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
      updatePerson: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "admin" }, bubbles: true, composed: true }),
    );
    await flush(el);

    // Passed down (the raw code stays in the dialog's `error` state) and rendered inside the edit
    // dialog's shadow as LOCALISED copy, never the raw wire code.
    expect(editForm(el).error).toBe("authorization.not_permitted");
    expect(editForm(el).shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      codeMessage("authorization.not_permitted", "es-ES"),
    );
    expect(editForm(el).shadowRoot!.querySelector("[role=alert]")?.textContent).not.toContain(
      "authorization.not_permitted",
    );
    // The screen's own page-level banner is suppressed while the edit dialog is open.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("falls back to server.internal when a rejected edit action carries no code", async () => {
    const api = stubApi({ resetPin: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("reset-pin", { detail: { pin: "4321" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  // Single-flight across edit actions: two update-role events fired back-to-back call updatePerson
  // once (the mutations are not server-idempotent). Proven by deletion: drop the `#editing` guard and
  // updatePerson is called twice.
  it("runs at most one edit action when two fire back-to-back", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    await openEdit(el, "p1");

    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "admin" }, bubbles: true, composed: true }),
    );
    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "staff" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.updatePerson).toHaveBeenCalledTimes(1);
  });

  // The type-narrowing guard in `#editWith`: an action event that arrives with no person open (not a
  // reachable UI path — the dialog only emits while open — but the handler is null-safe) is dropped,
  // firing no mutation. Covers the `editingPerson === null` arm.
  it("drops an edit action that arrives with no person open", async () => {
    const api = stubApi();
    const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", { api });
    await flush(el);
    // No openEdit(): editingPerson is null.
    editForm(el).dispatchEvent(
      new CustomEvent("update-role", { detail: { role: "admin" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(api.updatePerson).not.toHaveBeenCalled();
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
