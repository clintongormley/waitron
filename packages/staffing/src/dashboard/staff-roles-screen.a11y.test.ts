import { afterEach, describe, expect, test, vi } from "vitest";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { StaffingApi, type StaffRole } from "./client.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import "./staff-roles-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const staffRoles: StaffRole[] = (["red", "amber", "grey", "blue", "green", "purple"] as const).map(
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
type Write = (path: string, method: string) => Promise<unknown>;

async function screen(
  list: ListAnswer,
  options: { write?: Write; liveData?: LiveData; readOnly?: boolean } = {},
) {
  const el = document.createElement("dashboard-staff-roles-screen") as StaffRolesScreen;
  const request = vi.fn((path: string, method: string = "GET") =>
    method === "GET" ? list() : (options.write?.(path, method) ?? Promise.resolve(undefined)),
  );
  el.api = new StaffingApi(request as unknown as DashboardRequest, options.liveData);
  el.readOnly = options.readOnly ?? false;
  host.append(el);
  await settled(el);
  return el;
}
async function settled(el: StaffRolesScreen) {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const table = (el: StaffRolesScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
const press = async (el: StaffRolesScreen, test: string) => {
  table(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!.click();
  await settled(el);
};
const deleteModal = (el: StaffRolesScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-modal[data-test=delete-staff-role]",
  )!;
const refuse = (code: string) => () => Promise.reject({ code });

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
    const el = await screen(async () => ({ staffRoles }));
    expect(table(el).shadowRoot!.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(6);
  },
  "a load failure": async () => {
    const el = await screen(() => Promise.reject({ code: "connection.failed" }));
    expect(table(el).errorMessage).toContain("Could not load the staff roles");
  },
  "a later read's failure above the list": async () => {
    let fail = false;
    const liveData = new LiveData();
    const el = await screen(
      async () => {
        if (fail) throw { code: "connection.failed" };
        return { staffRoles };
      },
      { liveData },
    );
    fail = true;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-alert]")).not.toBeNull(),
    );
    liveData.clear();
  },
  "a refused move": async () => {
    const el = await screen(async () => ({ staffRoles }), {
      write: refuse("staffing.invalid"),
    });
    await press(el, "move-down-role-red");
    expect(el.shadowRoot!.querySelector("[data-test=action-alert]")).not.toBeNull();
  },
  "the delete question": async () => {
    const el = await screen(async () => ({ staffRoles }));
    await press(el, "delete-role-grey");
    await deleteModal(el).updateComplete;
    expect(deleteModal(el).textContent).toContain("Delete Role 3?");
  },
  "a staff role that shifts use": async () => {
    const el = await screen(async () => ({ staffRoles }));
    await press(el, "delete-role-amber");
    await deleteModal(el).updateComplete;
    expect(deleteModal(el).textContent).toContain("Role 2 can't be deleted while 2 shifts use it.");
  },
  "a refused delete inside the question": async () => {
    const el = await screen(async () => ({ staffRoles }), {
      write: refuse("staff_role.in_use"),
    });
    await press(el, "delete-role-grey");
    deleteModal(el).querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await settled(el);
    expect(deleteModal(el).querySelector("wt-form-actions")!.error).toContain(
      "Could not delete the staff role",
    );
  },
  "the read-only page": async () => {
    const el = await screen(async () => ({ staffRoles }), { readOnly: true });
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")).toBeNull();
  },
};

describe.each(["light", "dark"] as const)("Staff roles page accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});
