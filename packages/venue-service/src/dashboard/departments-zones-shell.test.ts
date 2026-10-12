import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { html } from "lit";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./venue-departments-shell.js";
const initial = location.href;
const shells: HTMLElementTagNameMap["venue-departments-shell"][] = [];
afterEach(() => {
  for (const shell of shells.splice(0)) shell.remove();
  history.replaceState(null, "", initial);
  setLocale("en");
});
async function mount(path = "/manage/venue-operations", request?: DashboardRequest) {
  setLocale("en");
  history.replaceState(null, "", `${path}?source=saved`);
  const shell = document.createElement("venue-departments-shell");
  applyTokens(shell);
  shell.model = structuredClone(zonesModel);
  shell.api = new VenueServiceApi(
    request ??
      ((async (path) =>
        path.includes("profiles")
          ? []
          : path.includes("transfers")
            ? { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] }
            : { tables: [] }) as DashboardRequest),
  );
  shell.renderPanel = (_panel, subject) => html`<p data-test="receipt-panel">${subject?.id}</p>`;
  shells.push(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}
function emit(shell: HTMLElement, type: string, detail: object) {
  shell
    .shadowRoot!.querySelector("departments-list")!
    .dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
it.each([
  "",
  "/department/d1",
  "/department/d1/view/zones/zone/z1",
  "/department/d1/view/receipt",
  "/department/gone",
])("list remains visible under the deep link %s without department pages", async (suffix) => {
  const shell = await mount(`/manage/venue-operations${suffix}`);
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  expect(shell.shadowRoot!.querySelector("department-zones")).toBeNull();
  if (suffix.endsWith("receipt"))
    expect(shell.shadowRoot!.querySelector("[data-test=receipt-panel]")!.textContent).toBe("d1");
  else if (suffix.includes("/zone/"))
    expect(shell.shadowRoot!.querySelector("zone-edit-dialog")!.zoneId).toBe("z1");
  else if (suffix === "/department/d1")
    expect(shell.shadowRoot!.querySelector("department-edit-dialog")!.departmentId).toBe("d1");
  expect(location.search).toBe("?source=saved");
});
it("row actions open protected editors and receipt content while preserving the list", async () => {
  const shell = await mount();
  emit(shell, "open-department", { departmentId: "d2" });
  await expect
    .poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")?.departmentId)
    .toBe("d2");
  history.replaceState(null, "", "/manage/venue-operations?source=saved");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await shell.updateComplete;
  emit(shell, "edit-zone", { zoneId: "z1" });
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")?.zoneId).toBe("z1");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z1");
});
it("Add zone takes the row's department rather than the address", async () => {
  const shell = await mount();
  emit(shell, "add-zone", { departmentId: "d2" });
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-dialogs")!.dialog).toEqual({
    kind: "add-zone",
    departmentId: "d2",
  });
});
it("a deleted editor identity closes while its list remains visible", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/zones/zone/z1");
  shell.model = { ...shell.model, zones: shell.model.zones.filter((row) => row.id !== "z1") };
  await shell.updateComplete;
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).toBeNull();
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
});
it("a successful editor write followed by a failed refresh closes and reports only a load failure", async () => {
  const shell = await mount("/manage/venue-operations/department/d1", (async (path) => {
    if (path === "/management-api/venue-service") throw { code: "server.internal" };
    return path.includes("profiles")
      ? []
      : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
  }) as DashboardRequest);
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  expect(editor, "the row editor is open").not.toBeNull();
  editor.dispatchEvent(
    new CustomEvent("saved", { detail: { departmentId: "d1" }, bubbles: true, composed: true }),
  );
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  await expect
    .poll(() => shell.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toBe("The venue configuration could not be loaded.");
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
});
it("a keyboard move refreshes the assignment and returns focus to the moved zone grip", async () => {
  const next = structuredClone(zonesModel);
  next.zones[0]!.departmentId = "d2";
  let finish!: () => void;
  const shell = await mount(undefined, (async (path, method = "GET") => {
    if (method !== "GET") return undefined;
    if (path === "/management-api/zones") return next.floorZones;
    if (path === "/management-api/venue-service") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return next;
    }
    return { tables: [] };
  }) as DashboardRequest);
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="zone-grip-z1"]')!.focus();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("true");
  finish();
  await expect.poll(() => shell.model.zones[0]!.departmentId).toBe("d2");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  await expect
    .poll(() => table.shadowRoot!.activeElement)
    .toBe(table.shadowRoot!.querySelector('[data-test="zone-grip-z1"]'));
});
it("a second completed move queues another refresh while the first read is pending", async () => {
  let reads = 0;
  let finish!: () => void;
  const shell = await mount(undefined, (async (path) => {
    if (path === "/management-api/zones") return [];
    if (path !== "/management-api/venue-service") return { tables: [] };
    reads++;
    if (reads === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return structuredClone(zonesModel);
  }) as DashboardRequest);
  emit(shell, "zone-moved", { zoneId: "z1" });
  await expect.poll(() => reads).toBe(1);
  emit(shell, "zone-moved", { zoneId: "z2" });
  finish();
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
});
