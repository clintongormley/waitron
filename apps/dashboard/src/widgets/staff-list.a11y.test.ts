import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./staff-list.js";
import type { StaffList } from "./staff-list.js";
import type { PersonSummary } from "../api/client.js";

/**
 * The staff list is a PURE DISPLAY widget — no `api`, so no in-flight fetch to settle and no
 * rejection to guard (unlike `login-screen.a11y.test.ts`). It is mounted with `people` assigned as a
 * property (widgets take their data as `@property({ attribute: false })`), in both themes, and axe is
 * run against the themed host so a color-contrast check means what it means in the app.
 *
 * The fixture covers both an ACTIVE person carrying both credentials (so every credential badge and
 * the active status render) and a SUSPENDED person with none (so the suspended status renders and the
 * no-badge arm is exercised) — the axe snapshot then sees the whole rendered surface.
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

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("staff-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<StaffList>("dashboard-staff-list", { people }, theme);
    await expectNoA11yViolations(host);
  });
});
