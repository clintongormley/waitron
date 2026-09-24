import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./staff-list.js";
import type { StaffList } from "./staff-list.js";
import type { PersonSummary } from "../api/client.js";

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: true,
    email: null,
  },
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("staff-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<StaffList>("dashboard-staff-list", { people }, theme);
    await expectNoA11yViolations(host);
  });
});
