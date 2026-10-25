import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { PersonSummary } from "../api/client.js";
import { StaffList } from "./staff-list.js";

afterEach(cleanupWidgets);
function forgetStaffView() {
  localStorage.removeItem("waitron.staff.table:columns");
  sessionStorage.removeItem("waitron.staff.table");
}
beforeEach(forgetStaffView);
afterEach(forgetStaffView);

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: "ada@x.com",
  },
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "pending",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

async function menuOf(el: StaffList, personId: string): Promise<HTMLElement> {
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const menus = [...table.shadowRoot!.querySelectorAll("wt-row-actions")];
  return menus.find((menu) => menu.querySelector(`[data-test=edit-${personId}]`))!;
}

function buttonIds(menu: HTMLElement): (string | null)[] {
  return [...menu.querySelectorAll("wt-button")].map((button) => button.getAttribute("data-test"));
}

function downloadButton(menu: HTMLElement, personId: string): HTMLElement | null {
  return menu.querySelector<HTMLElement>(`[data-test=download-data-${personId}]`);
}

describe("staff-list: download their data", () => {
  it("ends each row's menu with the download item, after the existing ones in their order", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
      canAdminister: true,
      canExportPersonalData: true,
      people,
    });

    expect(buttonIds(await menuOf(el, "p1"))).toEqual([
      "edit-p1",
      "reset-login-p1",
      "reset-pin-p1",
      "disable-p1",
      "download-data-p1",
    ]);
    expect(buttonIds(await menuOf(el, "p2"))).toEqual([
      "edit-p2",
      "reset-login-p2",
      "reset-pin-p2",
      "disable-p2",
      "resend-invitation-p2",
      "download-data-p2",
    ]);
  });

  it.each([true, false])(
    "offers no download item without the permission, with canAdminister %s",
    async (canAdminister) => {
      const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
        canAdminister,
        people,
      });

      const menu = await menuOf(el, "p1");
      expect(downloadButton(menu, "p1")).toBe(null);
      expect(buttonIds(menu)).toEqual(
        canAdminister ? ["edit-p1", "reset-login-p1", "reset-pin-p1", "disable-p1"] : ["edit-p1"],
      );
    },
  );

  it("offers the download item without canAdminister when the permission is held", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
      canExportPersonalData: true,
      people,
    });

    expect(buttonIds(await menuOf(el, "p1"))).toEqual(["edit-p1", "download-data-p1"]);
  });

  it("a press dispatches one download-person-data event and no person-action", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
      canAdminister: true,
      canExportPersonalData: true,
      people,
    });
    const downloads: CustomEvent[] = [];
    const actions: Event[] = [];
    el.addEventListener("download-person-data", (event) => downloads.push(event as CustomEvent));
    el.addEventListener("person-action", (event) => actions.push(event));

    downloadButton(await menuOf(el, "p1"), "p1")!.click();

    expect(downloads.length).toBe(1);
    expect(downloads[0]!.detail).toEqual({ personId: "p1" });
    expect(downloads[0]!.bubbles).toBe(true);
    expect(downloads[0]!.composed).toBe(true);
    expect(actions.length).toBe(0);
  });

  it("disables every row's item while a download is out", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
      canAdminister: true,
      canExportPersonalData: true,
      downloadingPersonId: "p1",
      people,
    });

    expect(downloadButton(await menuOf(el, "p1"), "p1")!.hasAttribute("disabled")).toBe(true);
    expect(downloadButton(await menuOf(el, "p2"), "p2")!.hasAttribute("disabled")).toBe(true);
  });

  it("redraws the menu when either property changes after the first render", async () => {
    const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
      canAdminister: true,
      people,
    });
    expect(downloadButton(await menuOf(el, "p1"), "p1")).toBe(null);

    el.canExportPersonalData = true;
    expect(downloadButton(await menuOf(el, "p1"), "p1")!.hasAttribute("disabled")).toBe(false);

    el.downloadingPersonId = "p2";
    expect(downloadButton(await menuOf(el, "p1"), "p1")!.hasAttribute("disabled")).toBe(true);

    el.downloadingPersonId = null;
    expect(downloadButton(await menuOf(el, "p1"), "p1")!.hasAttribute("disabled")).toBe(false);
  });

  it("reads the item's words from the strings, in English and in Spanish", async () => {
    const before = currentLocale();
    const shown: Record<string, string> = {};
    const expected: Record<string, string> = {};
    try {
      for (const locale of ["en-GB", "es-ES"]) {
        setLocale(locale);
        const { el } = await mountWidget<StaffList>("dashboard-staff-list", {
          canExportPersonalData: true,
          people,
        });
        shown[locale] = downloadButton(await menuOf(el, "p1"), "p1")!.textContent!.trim();
        expected[locale] = t("person.download_data");
        cleanupWidgets();
      }
    } finally {
      setLocale(before);
    }

    expect(shown).toEqual(expected);
    expect(expected["es-ES"]).not.toBe(expected["en-GB"]);
  });
});
