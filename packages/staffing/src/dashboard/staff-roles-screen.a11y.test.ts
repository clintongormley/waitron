import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { StaffingApi, type StaffRole } from "./client.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import "./staff-roles-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const roles: StaffRole[] = (["red", "amber", "grey", "blue", "green", "purple"] as const).map(
  (colour, position) => ({
    id: `role-${colour}`,
    name: `Role ${position + 1}`,
    colour,
    position,
    holderIds: position === 0 ? [] : ["p-ana"],
    blockCount: position,
    shiftCount: position === 1 ? 2 : 0,
  }),
);

type ListAnswer = () => Promise<unknown>;

async function screen(list: ListAnswer) {
  const el = document.createElement("dashboard-staff-roles-screen") as StaffRolesScreen;
  const request = vi.fn((_path: string, method: string = "GET") =>
    method === "GET" ? list() : Promise.resolve(undefined),
  );
  el.api = new StaffingApi(request as unknown as DashboardRequest);
  host.append(el);
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
  return el;
}
const table = (el: StaffRolesScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;

const states: Record<string, () => Promise<void>> = {
  loading: async () => {
    const el = await screen(() => new Promise(() => undefined));
    expect(table(el).loading).toBe(true);
  },
  empty: async () => {
    const el = await screen(async () => ({ staffRoles: [] }));
    expect(table(el).shadowRoot!.textContent).toContain("No staff roles yet.");
  },
  "a list of every colour": async () => {
    const el = await screen(async () => ({ staffRoles: roles }));
    expect(table(el).shadowRoot!.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(6);
  },
  "a load failure": async () => {
    const el = await screen(() => Promise.reject({ code: "connection.failed" }));
    expect(table(el).errorMessage).toContain("Could not load the staff roles");
  },
  "the delete confirmation": async () => {
    const el = await screen(async () => ({ staffRoles: roles }));
    table(el).shadowRoot!.querySelector<HTMLElement>('[data-test="delete-role-amber"]')!.click();
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal[data-test=delete-staff-role]")!;
    await (modal as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(modal.textContent).toContain("2 shifts are assigned to it.");
  },
};

describe.each(["light", "dark"] as const)("Staff roles page accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});
