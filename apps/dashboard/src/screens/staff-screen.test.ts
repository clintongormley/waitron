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
