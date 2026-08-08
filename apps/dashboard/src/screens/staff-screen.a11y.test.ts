import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./staff-screen.js";
import type { StaffScreen } from "./staff-screen.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";

/**
 * Mounts the screen with an `api` STUB assigned as a property, exactly as
 * `login-screen.a11y.test.ts` does: the screen's `connectedCallback` fires
 * `void this.#load()` → `api.listStaff()`; with no `api` that is an unhandled rejection, which
 * pollutes the run (a stray rejection is a finding). So the stub's `listStaff` resolves a small
 * list. The create form is left CLOSED (its default), so its `wt-dialog` renders nothing to the
 * a11y tree — the snapshot covers the composed staff-list and the add button.
 */
const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: true,
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

function stubApi(): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    createPerson: vi.fn().mockResolvedValue({ id: "p3" }),
  } as unknown as DashboardApi;
}

/** Settles the in-flight staff fetch and the follow-up render. */
async function flush(el: StaffScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("staff-screen a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { el, host } = await mountWidget<StaffScreen>(
      "dashboard-staff-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
