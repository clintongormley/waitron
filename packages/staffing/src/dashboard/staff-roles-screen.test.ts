import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  LiveData,
  codeMessage,
  currentLocale,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { applyTokens, type DataTableColumn } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { StaffingApi, type StaffPerson, type StaffRole } from "./client.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import "./staff-roles-screen.js";

const BASE = "/management-api/staffing/staff-roles";

const waiter: StaffRole = {
  id: "role-w",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-ana", "p-marc"],
  blockCount: 0,
  shiftCount: 0,
};
const cook: StaffRole = {
  id: "role-c",
  name: "Cook",
  colour: "red",
  position: 1,
  holderIds: ["p-ana"],
  blockCount: 1,
  shiftCount: 2,
};
const runner: StaffRole = {
  id: "role-r",
  name: "Runner",
  colour: "purple",
  position: 2,
  holderIds: [],
  blockCount: 3,
  shiftCount: 0,
};
const people: StaffPerson[] = [{ personId: "p-ana", displayName: "Ana", status: "active" }];

type Answer = (body: unknown) => unknown;
type Routes = Record<string, Answer>;

/** A request that answers `"<METHOD> <path>"` from `routes`, and lists `roles` for the page's read. */
function fakeRequest(roles: () => StaffRole[], routes: Routes = {}) {
  return vi.fn(async (path: string, method: string = "GET", body?: unknown) => {
    const route = routes[`${method} ${path}`];
    if (route) return route(body);
    if (method === "GET" && path === BASE) return { staffRoles: roles() };
    if (method === "GET" && path === "/management-api/staff") return people;
    if (method === "PUT" && path === `${BASE}/order`) return undefined;
    if (method === "DELETE") return undefined;
    throw new Error(`unexpected ${method} ${path}`);
  });
}

let el: StaffRolesScreen;
let host: HTMLElement;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  host?.remove();
  setLocale(locale);
  sessionStorage.clear();
  localStorage.clear();
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await table()?.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(
  request: ReturnType<typeof fakeRequest>,
  options: { liveData?: LiveData; readOnly?: boolean } = {},
) {
  host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  el = document.createElement("dashboard-staff-roles-screen");
  el.api = new StaffingApi(request as unknown as DashboardRequest, options.liveData);
  el.readOnly = options.readOnly ?? false;
  host.append(el);
  await settle();
  return request;
}

const table = () =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    "wt-data-table[data-test=staff-roles]",
  );
const rows = () => [
  ...table()!.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr[data-row-key]"),
];
const rowKeys = () => rows().map((row) => row.dataset.rowKey);
const row = (id: string) => rows().find((found) => found.dataset.rowKey === id)!;
const cells = (id: string) =>
  [...row(id).querySelectorAll("td")].map((cell) => cell.textContent!.trim());
const menuItem = (test: string) =>
  table()!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test="${test}"]`);
const dialog = () => el.shadowRoot!.querySelector("staff-role-dialog")!;
const deleteModal = () =>
  el.shadowRoot!.querySelector<HTMLElement>("wt-modal[data-test=delete-staff-role]");
const alertText = (test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)?.textContent?.trim() ?? "";

async function choose(test: string) {
  const item = menuItem(test);
  expect(item, test).not.toBeNull();
  const menu = item!.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(item!);
  await settle();
}

async function deleteMessage() {
  const actions = deleteModal()!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

describe("the staff roles page", () => {
  it("lists each staff role's colour, name and holder count in position order", async () => {
    await mount(fakeRequest(() => [runner, waiter, cook]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Staff roles");
    expect(rowKeys()).toEqual(["role-w", "role-c", "role-r"]);
    expect(cells("role-w").slice(0, 3)).toEqual(["Green", "Waiter", "2 people"]);
    expect(cells("role-c").slice(0, 3)).toEqual(["Red", "Cook", "1 person"]);
    expect(cells("role-r").slice(0, 3)).toEqual(["Purple", "Runner", "No people"]);
    const swatch = row("role-c").querySelector<HTMLElement>("[part~=swatch]")!;
    expect(swatch.getAttribute("part")).toBe("swatch swatch-red");
    const painted = getComputedStyle(swatch).backgroundColor;
    const probe = document.createElement("span");
    probe.style.background = "var(--wt-color-palette-red)";
    host.append(probe);
    expect(painted).toBe(getComputedStyle(probe).backgroundColor);
    expect(painted).not.toBe(
      getComputedStyle(row("role-w").querySelector("[part~=swatch]")!).backgroundColor,
    );
  });

  it("pins the actions column to the end", async () => {
    await mount(fakeRequest(() => [waiter]));
    const columns = table()!.columns as readonly DataTableColumn<StaffRole>[];
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(row("role-w").querySelector("wt-row-actions")!.getAttribute("label")).toBe(
      "Actions for Waiter",
    );
  });

  it("shows the table's loading message until the first read answers", async () => {
    let answer!: (value: unknown) => void;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => new Promise((resolve) => (answer = resolve)),
    });
    await mount(request);
    expect(table()!.loading).toBe(true);
    expect(table()!.loadingMessage).toBe("Loading staff roles…");
    answer({ staffRoles: [waiter] });
    await settle();
    expect(table()!.loading).toBe(false);
    expect(rowKeys()).toEqual(["role-w"]);
  });

  it("says when there are no staff roles yet", async () => {
    await mount(fakeRequest(() => []));
    expect(table()!.emptyMessage).toBe("No staff roles yet.");
    expect(table()!.shadowRoot!.textContent).toContain("No staff roles yet.");
  });

  it("says why the staff roles could not be loaded, and clears it once a read answers", async () => {
    let fail = true;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => {
        if (fail) throw { code: "connection.failed" };
        return { staffRoles: [waiter] };
      },
    });
    const liveData = new LiveData();
    await mount(request, { liveData });
    const message = `Could not load the staff roles: ${codeMessage("connection.failed")}`;
    expect(table()!.errorMessage).toBe(message);
    fail = false;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() => expect(rowKeys()).toEqual(["role-w"]));
    expect(table()!.errorMessage).toBe("");
    expect(alertText("load-alert")).toBe("");
    liveData.clear();
  });

  it("keeps the list and says so above it when a later read fails", async () => {
    let fail = false;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => {
        if (fail) throw { code: "connection.failed" };
        return { staffRoles: [waiter] };
      },
    });
    const liveData = new LiveData();
    await mount(request, { liveData });
    fail = true;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() =>
      expect(alertText("load-alert")).toBe(
        `Could not load the staff roles: ${codeMessage("connection.failed")}`,
      ),
    );
    expect(rowKeys()).toEqual(["role-w"]);
    expect(table()!.errorMessage).toBe("");
    liveData.clear();
  });

  it("refreshes from the live query when a staff role changes elsewhere", async () => {
    let roles = [waiter];
    const liveData = new LiveData();
    await mount(
      fakeRequest(() => roles),
      { liveData },
    );
    roles = [waiter, { ...cook, position: 1 }];
    liveData.invalidate([{ type: "person_staff_roles" }]);
    await vi.waitFor(() => expect(rowKeys()).toEqual(["role-w", "role-c"]));
    liveData.clear();
  });

  it("opens the dialog for a new staff role from + New staff role", async () => {
    await mount(fakeRequest(() => [waiter]));
    const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!;
    expect(add.textContent!.trim()).toBe("+ New staff role");
    expect(dialog().open).toBe(false);
    await userEvent.click(add);
    await settle();
    expect(dialog().open).toBe(true);
    expect(dialog().staffRole).toBeUndefined();
  });

  it("opens the dialog on a staff role from its Edit action", async () => {
    await mount(fakeRequest(() => [waiter, cook]));
    await choose("edit-role-c");
    expect(dialog().open).toBe(true);
    expect(dialog().staffRole).toEqual(cook);
  });

  it("reads the list again when the dialog closes, without waiting for a saved event", async () => {
    const request = await mount(fakeRequest(() => [waiter]));
    await choose("edit-role-w");
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    const closed = new Promise((resolve) =>
      dialog()
        .shadowRoot!.querySelector("wt-modal")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    dialog().shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-staff-role]")!.click();
    await closed;
    await settle();
    expect(dialog().open).toBe(false);
    expect(reads()).toBe(before + 1);
  });

  it("moves a staff role up or down with reorder, offering only the moves it can make", async () => {
    const request = await mount(fakeRequest(() => [waiter, cook, runner]));
    expect(menuItem("move-up-role-w")).toBeNull();
    expect(menuItem("move-down-role-r")).toBeNull();
    expect(menuItem("move-down-role-w")!.textContent!.trim()).toBe("Move down");
    await choose("move-down-role-w");
    expect(request).toHaveBeenCalledWith(`${BASE}/order`, "PUT", {
      staffRoleIds: ["role-c", "role-w", "role-r"],
    });
    await choose("move-up-role-r");
    expect(request).toHaveBeenLastCalledWith(BASE, "GET", undefined, { passive: true });
    expect(request).toHaveBeenCalledWith(`${BASE}/order`, "PUT", {
      staffRoleIds: ["role-w", "role-r", "role-c"],
    });
  });

  it("says when a move is refused, and a read's recovery does not clear it", async () => {
    const liveData = new LiveData();
    await mount(
      fakeRequest(() => [waiter, cook], {
        [`PUT ${BASE}/order`]: () => {
          throw { code: "staffing.invalid" };
        },
      }),
      { liveData },
    );
    await choose("move-down-role-w");
    const message = `Could not move the staff role: ${codeMessage("staffing.invalid")}`;
    expect(alertText("action-alert")).toBe(message);
    liveData.invalidate([{ type: "staff_roles" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    expect(alertText("action-alert")).toBe(message);
    liveData.clear();
  });

  it("asks before deleting, naming the painted blocks that go with it", async () => {
    const request = await mount(fakeRequest(() => [waiter, runner]));
    await choose("delete-role-r");
    const modal = deleteModal()!;
    expect(modal.getAttribute("heading")).toBe("Delete staff role");
    expect(modal.textContent).toContain("Delete Runner?");
    expect(modal.textContent).toContain("Its 3 painted staffing blocks go too.");
    expect(modal.textContent).not.toContain("shift");
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    modal.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await closed;
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-r`, "DELETE");
    expect(deleteModal()).toBeNull();
  });

  it("offers Delete on a staff role with shifts, names them, and shows the in-use refusal", async () => {
    const request = await mount(
      fakeRequest(() => [cook], {
        [`DELETE ${BASE}/role-c`]: () => {
          throw { code: "staff_role.in_use", params: { staffRoleId: "role-c" } };
        },
      }),
    );
    await choose("delete-role-c");
    const modal = deleteModal()!;
    expect(modal.textContent).toContain("Delete Cook?");
    expect(modal.textContent).toContain("2 shifts are assigned to it.");
    expect(modal.textContent).toContain("Its 1 painted staffing block goes too.");
    const confirm = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=confirm-delete]",
    )!;
    confirm.click();
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-c`, "DELETE");
    expect(await deleteMessage()).toBe(
      `Could not delete the staff role: ${codeMessage("staff_role.in_use")}`,
    );
    expect(deleteModal()).not.toBeNull();
    expect(confirm.disabled).toBe(false);
  });

  it("names a single shift in the singular, and closes the question on Cancel", async () => {
    await mount(fakeRequest(() => [{ ...cook, shiftCount: 1, blockCount: 0 }]));
    await choose("delete-role-c");
    const modal = deleteModal()!;
    expect(modal.textContent).toContain("1 shift is assigned to it.");
    expect(modal.textContent).not.toContain("painted");
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    modal.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
    await closed;
    await settle();
    expect(deleteModal()).toBeNull();
  });

  it("sends one reorder for a move pressed twice before it answers", async () => {
    let answer!: () => void;
    const request = await mount(
      fakeRequest(() => [waiter, cook], {
        [`PUT ${BASE}/order`]: () => new Promise<void>((resolve) => (answer = resolve)),
      }),
    );
    menuItem("move-down-role-w")!.click();
    await settle();
    menuItem("move-down-role-w")!.click();
    answer();
    await settle();
    expect(request.mock.calls.filter(([path]) => path === `${BASE}/order`)).toHaveLength(1);
  });

  it("sends one delete for a confirmation pressed again before it answers", async () => {
    let answer!: () => void;
    const request = await mount(
      fakeRequest(() => [waiter], {
        [`DELETE ${BASE}/role-w`]: () => new Promise<void>((resolve) => (answer = resolve)),
      }),
    );
    await choose("delete-role-w");
    const confirm = () => deleteModal()!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
    confirm().click();
    confirm().click();
    await settle();
    confirm().click();
    answer();
    await settle();
    expect(request.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(1);
  });

  it.each(["answers", "is refused"] as const)(
    "drops a delete that %s after the page was taken out",
    async (outcome) => {
      let settleDelete!: { resolve: () => void; reject: (error: unknown) => void };
      await mount(
        fakeRequest(() => [waiter], {
          [`DELETE ${BASE}/role-w`]: () =>
            new Promise<void>((resolve, reject) => (settleDelete = { resolve, reject })),
        }),
      );
      await choose("delete-role-w");
      deleteModal()!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await settle();
      el.remove();
      if (outcome === "answers") settleDelete.resolve();
      else settleDelete.reject({ code: "staff_role.in_use" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      host.append(el);
      await settle();
      expect(deleteModal()).toBeNull();
    },
  );

  it("offers no changes to a reader", async () => {
    await mount(
      fakeRequest(() => [waiter]),
      { readOnly: true },
    );
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")).toBeNull();
    expect((table()!.columns as readonly DataTableColumn<StaffRole>[]).map((c) => c.key)).toEqual([
      "colour",
      "name",
      "people",
    ]);
    expect(row("role-w").querySelector("wt-row-actions")).toBeNull();
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    await mount(fakeRequest(() => [waiter]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Roles de personal");
    expect(cells("role-w").slice(0, 3)).toEqual(["Verde", "Waiter", "2 personas"]);
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")!.textContent!.trim()).toBe(
      "+ Nuevo rol de personal",
    );
  });

  it("stops watching when taken out of the page, and reads again when put back", async () => {
    const request = await mount(fakeRequest(() => [waiter]));
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    el.remove();
    host.append(el);
    await settle();
    expect(reads()).toBe(before + 1);
    expect(rowKeys()).toEqual(["role-w"]);
  });
});
