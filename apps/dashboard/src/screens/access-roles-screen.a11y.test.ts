import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { PERMISSION_TEXT } from "../i18n/permissions.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { AccessRolesScreen } from "./access-roles-screen.js";
import "./access-roles-screen.js";

registerIcons(DASHBOARD_ICONS);
const previous = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previous);
});
const permissions = Object.keys(PERMISSION_TEXT);
const roles = [
  { id: "staff", builtInKey: "staff", name: null, permissions: ["payment.take"], holderCount: 3 },
  { id: "admin", builtInKey: "admin", name: null, permissions, holderCount: 1 },
  {
    id: "accounts",
    builtInKey: null,
    name: "Accountant",
    permissions: ["report.view"],
    holderCount: 2,
  },
] as const;
describe.each(["light", "dark"] as const)("Access roles accessibility (%s)", (theme) => {
  it("keeps the list, editor, locked Admin and both confirmations accessible", async () => {
    setLocale("en-GB");
    const { el, host } = await mountWidget<AccessRolesScreen>(
      "dashboard-access-roles-screen",
      {
        api: { listAccessRoles: async () => structuredClone(roles) } as unknown as DashboardApi,
        viewerPermissions: permissions,
      },
      theme,
    );
    const q = (id: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${id}]`)!;
    await expect.poll(() => el.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(3);
    await expectNoA11yViolations(host);
    const open = async (id: string) => {
      el.shadowRoot!.querySelector("wt-data-table")!.rowClick!(roles.find((r) => r.id === id)!);
      await el.updateComplete;
    };
    await open("accounts");
    await expectNoA11yViolations(host);
    q("copy").click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
    const copy = el.shadowRoot!.querySelector("wt-dialog")!;
    const closed = new Promise<void>((resolve) =>
      copy.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await copy.requestClose("cancel");
    await closed;
    await el.updateComplete;
    q("delete").click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
    const remove = el.shadowRoot!.querySelector("wt-dialog")!;
    const deleted = new Promise<void>((resolve) =>
      remove.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await remove.requestClose("cancel");
    await deleted;
    await el.updateComplete;
    q("back").click();
    await el.updateComplete;
    await open("admin");
    await expectNoA11yViolations(host);
  });
});
it.each(["en-GB", "es-ES"] as const)(
  "fits a complete permission list on a phone (%s)",
  async (locale) => {
    setLocale(locale);
    await page.viewport(390, 844);
    try {
      const { el } = await mountWidget<AccessRolesScreen>("dashboard-access-roles-screen", {
        api: { listAccessRoles: async () => structuredClone(roles) } as unknown as DashboardApi,
        viewerPermissions: permissions,
      });
      await expect.poll(() => el.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(3);
      el.shadowRoot!.querySelector("wt-data-table")!.rowClick!(roles[2]);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("wt-switch")).toHaveLength(permissions.length);
      expect(el.scrollWidth).toBeLessThanOrEqual(390);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(1280, 768);
    }
  },
);
