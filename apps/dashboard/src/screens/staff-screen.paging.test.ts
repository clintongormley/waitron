import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { useLocale } from "../testing/locale-setup.js";
import { accessRoleChoices } from "../testing/access-role-fixture.js";
import type { DashboardApi, PersonPage, PersonSummary } from "../api/client.js";
import type { StaffList } from "../widgets/staff-list.js";
import { StaffScreen } from "./staff-screen.js";
useLocale("en-GB");
afterEach(cleanupWidgets);
const person = (name: string): PersonSummary => ({
  personId: name,
  displayName: name,
  email: null,
  roleIds: [],
  status: "active",
  hasPassword: false,
  hasTotp: false,
});
const result = (names = ["Zed", "Ada"], number = 0): PersonPage => ({
  rows: names.map(person),
  total: 101,
  page: number,
  pageSize: 50,
  anyPeople: true,
});
const tableOf = (el: StaffScreen) =>
  el
    .shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!
    .shadowRoot!.querySelector("wt-data-table")!;
async function drawn(el: StaffScreen) {
  await el.updateComplete;
  await el.shadowRoot!.querySelector<StaffList>("dashboard-staff-list")!.updateComplete;
  const table = tableOf(el);
  await table.updateComplete;
  return [...table.shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key"),
  );
}
async function mount() {
  const api = {
    listAccessRoles: vi.fn().mockResolvedValue(accessRoleChoices),
    listStaffPage: vi.fn().mockResolvedValue(result()),
    listStaff: vi.fn().mockResolvedValue([]),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<StaffScreen>("dashboard-staff-screen", {
    api,
    canAdminister: true,
  });
  await vi.waitFor(() => expect(api.listStaffPage).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () => expect(await drawn(el)).toEqual(["Zed", "Ada"]));
  return { el, api };
}
function search(el: StaffScreen, value: string) {
  el.shadowRoot!.querySelector("[data-test=search]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
it("uses supplied row order and sends page/filter changes exactly once", async () => {
  const { el, api } = await mount();
  expect(api.listStaff).not.toHaveBeenCalled();
  expect(api.listStaffPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 0, status: "current", search: "", locale: "en-GB" }),
  );
  vi.mocked(api.listStaffPage).mockResolvedValue(result(["Next"], 1));
  await userEvent.click(
    page.elementLocator(
      tableOf(el).shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!,
    ),
  );
  await vi.waitFor(() => expect(api.listStaffPage).toHaveBeenCalledTimes(2));
  expect(api.listStaffPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  await chooseOption(el.shadowRoot!.querySelector("[data-test=status-filter]")!, "all");
  await vi.waitFor(() => expect(api.listStaffPage).toHaveBeenCalledTimes(3));
  expect(api.listStaffPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 0, status: "all" }),
  );
});
it("ignores a replaced search reply and recovers a read failure after typing", async () => {
  const { el, api } = await mount();
  let oldReply!: (page: PersonPage) => void;
  const old = new Promise<PersonPage>((resolve) => {
    oldReply = resolve;
  });
  vi.mocked(api.listStaffPage)
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(result(["Bea"]));
  search(el, "Ada");
  await vi.waitFor(() => expect(api.listStaffPage).toHaveBeenCalledTimes(2));
  search(el, "Bea ");
  await vi.waitFor(() => expect(api.listStaffPage).toHaveBeenCalledTimes(3));
  expect(api.listStaffPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: "Bea ", page: 0 }),
  );
  await vi.waitFor(async () => expect(await drawn(el)).toEqual(["Bea"]));
  oldReply(result(["Old"]));
  await old;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await drawn(el)).toEqual(["Bea"]);
  vi.mocked(api.listStaffPage).mockRejectedValueOnce({ code: "server.internal" });
  search(el, "broken");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".error[role=alert]")).not.toBeNull());
  vi.mocked(api.listStaffPage).mockResolvedValue(result(["Recovered"]));
  search(el, "recover");
  await vi.waitFor(async () => expect(await drawn(el)).toEqual(["Recovered"]));
  expect(el.shadowRoot!.querySelector(".error[role=alert]")).toBeNull();
});

it("retries the same next page after a refused read", async () => {
  const { el, api } = await mount();
  vi.mocked(api.listStaffPage)
    .mockRejectedValueOnce({ code: "server.internal" })
    .mockResolvedValueOnce(result(["Next"], 1));
  const next = () =>
    page.elementLocator(
      tableOf(el).shadowRoot!.querySelector<HTMLButtonElement>("[data-next-page]")!,
    );
  await userEvent.click(next());
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".error[role=alert]")).not.toBeNull());
  expect(await drawn(el)).toEqual(["Zed", "Ada"]);
  await userEvent.click(next());
  await vi.waitFor(async () => expect(await drawn(el)).toEqual(["Next"]));
  expect(api.listStaffPage).toHaveBeenCalledTimes(3);
  expect(api.listStaffPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  expect(el.shadowRoot!.querySelector(".error[role=alert]")).toBeNull();
});
