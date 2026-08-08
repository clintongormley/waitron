import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import type { StaffList } from "../widgets/staff-list.js";
import type { PersonForm } from "../widgets/person-form.js";
import { StaffScreen } from "./staff-screen.js";

afterEach(cleanupWidgets);

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
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain("server.internal");
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
      createPerson: vi.fn().mockRejectedValue({ code: "person.pin_invalid" }),
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
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("person.pin_invalid");
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
});
