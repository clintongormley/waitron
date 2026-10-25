import type { DownloadedFile } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, PersonSummary } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";
import type { StaffList } from "../widgets/staff-list.js";
import type { PersonEdit } from "../widgets/person-edit.js";
import type { StaffScreen } from "./staff-screen.js";
import "./staff-screen.js";

function forgetStaffView() {
  localStorage.removeItem("waitron.staff.table:columns");
  sessionStorage.removeItem("waitron.staff.table");
}
let startLocale = "";
beforeEach(() => {
  forgetStaffView();
  startLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  forgetStaffView();
  setLocale(startLocale);
});

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    firstNames: "Ada Augusta",
    lastNames: "Lovelace",
    telephone: null,
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: "ada@x.com",
  },
  {
    personId: "p2",
    displayName: "Mar$&ta",
    firstNames: "Marta",
    lastNames: "López",
    telephone: null,
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

const FILE: DownloadedFile = { blob: new Blob(["zip"]), fileName: "ada-lovelace-2026-10-25.zip" };

function stubApi(download?: () => Promise<DownloadedFile>): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(people),
    downloadPersonalData: vi.fn(download ?? (() => Promise.resolve(FILE))),
  } as unknown as DashboardApi;
}

function held(): {
  promise: Promise<DownloadedFile>;
  resolve: (file: DownloadedFile) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (file: DownloadedFile) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DownloadedFile>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(el: StaffScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await list(el).updateComplete;
}

async function mount(
  api: DashboardApi,
  theme?: "light" | "dark",
  canExportPersonalData = true,
): Promise<{ el: StaffScreen; host: HTMLElement }> {
  const mounted = await mountWidget<StaffScreen>(
    "dashboard-staff-screen",
    { api, canAdminister: true, canExportPersonalData },
    theme,
  );
  await settle(mounted.el);
  return mounted;
}

function list(el: StaffScreen): StaffList {
  return el.shadowRoot!.querySelector("dashboard-staff-list")!;
}

async function item(el: StaffScreen, personId: string): Promise<HTMLElement> {
  await list(el).updateComplete;
  const table = list(el).shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table.shadowRoot!.querySelector<HTMLElement>(`[data-test=download-data-${personId}]`)!;
}

/** Presses the row's item, as a person does. */
async function press(el: StaffScreen, personId: string): Promise<void> {
  (await item(el, personId)).click();
  await settle(el);
}

/** Sends the item's event straight from the list, past the item's own `disabled`. */
async function sendEvent(el: StaffScreen, personId: string): Promise<void> {
  list(el).dispatchEvent(
    new CustomEvent("download-person-data", {
      detail: { personId },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(el);
}

const statusLine = (el: StaffScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=download-data-status]");
const alertLine = (el: StaffScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=download-data-error]");
const signIn = (el: StaffScreen) =>
  alertLine(el)?.querySelector<HTMLElement>("[data-test=admin-sign-in]") ?? null;
const alertText = (el: StaffScreen) =>
  alertLine(el)!.querySelector("[data-test=download-data-error-text]")!.textContent!.trim();

/** Fills `{name}` without reading `$` patterns, so the expectation cannot share the screen's slip. */
const named = (key: StringKey, name: string) => t(key).split("{name}").join(name);

function spyOnSaving() {
  const blobs: Blob[] = [];
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:personal-data";
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const links: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this);
  });
  return { blobs, create, revoke, links };
}

async function inLocale(locale: string, body: () => Promise<void>): Promise<void> {
  const previous = currentLocale();
  setLocale(locale);
  try {
    await body();
  } finally {
    setLocale(previous);
  }
}

describe("staff-screen: download their data", () => {
  it("hands the permission to the list", async () => {
    const { el } = await mount(stubApi());
    expect(list(el).canExportPersonalData).toBe(true);
    expect(list(el).downloadingPersonId).toBe(null);
  });

  it("saves the file the server sent under the server's name", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const saving = spyOnSaving();
    await press(el, "p1");
    expect(api.downloadPersonalData).toHaveBeenCalledExactlyOnceWith("p1");
    expect(saving.blobs).toHaveLength(1);
    expect(saving.blobs[0]).toBe(FILE.blob);
    expect(saving.links.map((link) => [link.getAttribute("href"), link.download])).toEqual([
      ["blob:personal-data", "ada-lovelace-2026-10-25.zip"],
    ]);
    expect(saving.revoke).toHaveBeenCalledExactlyOnceWith("blob:personal-data");
    expect(statusLine(el)).toBe(null);
    expect(alertLine(el)).toBe(null);
  });

  it("names the file personal-data.zip when the server sent no name", async () => {
    const { el } = await mount(stubApi(() => Promise.resolve({ blob: FILE.blob, fileName: null })));
    const saving = spyOnSaving();
    await press(el, "p1");
    expect(saving.links.map((link) => link.download)).toEqual(["personal-data.zip"]);
  });

  it("asks for nothing without the permission", async () => {
    const api = stubApi();
    const { el } = await mount(api, undefined, false);
    await sendEvent(el, "p1");
    expect(api.downloadPersonalData).not.toHaveBeenCalled();
    expect(statusLine(el)).toBe(null);
  });

  it("says it is preparing the copy while it is sent, and sends no second request", async () => {
    const request = held();
    const api = stubApi(() => request.promise);
    const { el, host } = await mount(api);
    const saving = spyOnSaving();
    await press(el, "p1");

    const line = statusLine(el)!;
    expect(line.textContent!.trim()).toBe("Preparing a copy of Ada's data…");
    expect(line.getAttribute("role")).toBe("status");
    expect(list(el).downloadingPersonId).toBe("p1");
    await expectNoA11yViolations(host);

    await press(el, "p1");
    await sendEvent(el, "p2");
    expect(api.downloadPersonalData).toHaveBeenCalledTimes(1);
    expect(statusLine(el)!.textContent!.trim()).toBe(named("staff.data_copy_busy", "Ada"));

    request.resolve(FILE);
    await settle(el);
    expect(statusLine(el)).toBe(null);
    expect(list(el).downloadingPersonId).toBe(null);
    expect(saving.links).toHaveLength(1);
  });

  it("prints a name holding $& as typed", async () => {
    const request = held();
    const { el } = await mount(stubApi(() => request.promise));
    await press(el, "p2");
    expect(statusLine(el)!.textContent!.trim()).toBe("Preparing a copy of Mar$&ta's data…");
    spyOnSaving();
    request.resolve(FILE);
    await settle(el);
  });

  it("offers an administrator's sign-in on a permission refusal", async () => {
    const { el, host } = await mount(
      stubApi(() => Promise.reject({ code: "authorization.not_permitted" })),
    );
    await press(el, "p1");

    expect(alertLine(el)!.getAttribute("role")).toBe("alert");
    expect(alertText(el)).toBe(
      "Only an administrator can download another person's data, and this account can no longer do it. Sign in as an administrator to download Ada's data: this signs you out here first.",
    );
    const button = signIn(el)!;
    expect(button.tagName).toBe("WT-BUTTON");
    expect(button.textContent!.trim()).toBe("Sign in as an administrator");

    const events: Event[] = [];
    host.addEventListener("admin-sign-in", (event) => events.push(event));
    button.click();
    expect(events.length).toBe(1);
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
    expect(list(el).downloadingPersonId).toBe(null);
  });

  it("names an unknown person as a fault in Waitron and reloads the list", async () => {
    const api = stubApi(() => Promise.reject({ code: "person.not_found" }));
    const { el } = await mount(api);
    expect(api.listStaff).toHaveBeenCalledTimes(1);
    await press(el, "p2");

    expect(alertText(el)).toBe(
      "Mar$&ta is on this list, but the box has no record of them. That is a fault in Waitron. The list has been reloaded.",
    );
    expect(signIn(el)).toBe(null);
    expect(api.listStaff).toHaveBeenCalledTimes(2);
  });

  it("does not say the list was reloaded when the reload failed", async () => {
    const api = stubApi(() => Promise.reject({ code: "person.not_found" }));
    const { el } = await mount(api);
    vi.mocked(api.listStaff).mockRejectedValueOnce({ code: "connection.failed" });
    await press(el, "p2");

    expect(api.listStaff).toHaveBeenCalledTimes(2);
    expect(alertText(el)).toBe(
      "Mar$&ta is on this list, but the box has no record of them. That is a fault in Waitron.",
    );
    const readFailure = [...el.shadowRoot!.querySelectorAll<HTMLElement>("p.error[role=alert]")];
    expect(readFailure.map((line) => line.textContent!.trim())).toEqual([
      codeMessage("connection.failed"),
    ]);
  });

  it("does not say the list was reloaded when the reload failed, in Spanish", async () => {
    const english = t("staff.data_copy_not_found_unreloaded");
    await inLocale("es-ES", async () => {
      const api = stubApi(() => Promise.reject({ code: "person.not_found" }));
      const { el } = await mount(api);
      vi.mocked(api.listStaff).mockRejectedValueOnce({ code: "connection.failed" });
      await press(el, "p2");
      expect(alertText(el)).toBe(named("staff.data_copy_not_found_unreloaded", "Mar$&ta"));
      expect(t("staff.data_copy_not_found_unreloaded")).not.toBe(english);
    });
  });

  it("keeps the list's download event from reaching anything above the screen", async () => {
    const api = stubApi();
    const { el, host } = await mount(api);
    spyOnSaving();
    const reached: Event[] = [];
    host.addEventListener("download-person-data", (event) => reached.push(event));
    await press(el, "p1");
    expect(api.downloadPersonalData).toHaveBeenCalledTimes(1);
    expect(reached).toEqual([]);
  });

  it("shows any other refusal in its shared words, and the next press clears it", async () => {
    const api = stubApi(() => Promise.reject({ code: "connection.failed" }));
    const { el } = await mount(api);
    await press(el, "p1");

    expect(alertText(el)).toBe(codeMessage("connection.failed"));
    expect(signIn(el)).toBe(null);
    expect((await item(el, "p1")).hasAttribute("disabled")).toBe(false);
    expect(api.listStaff).toHaveBeenCalledTimes(1);

    const request = held();
    vi.mocked(api.downloadPersonalData).mockReturnValue(request.promise);
    await press(el, "p1");
    expect(alertLine(el)).toBe(null);
    spyOnSaving();
    request.resolve(FILE);
    await settle(el);
    expect(alertLine(el)).toBe(null);
  });

  it("never puts a failed download at the foot of the edit dialog", async () => {
    const refused = held();
    const { el } = await mount(stubApi(() => refused.promise));
    await press(el, "p1");
    list(el).dispatchEvent(
      new CustomEvent("edit-person", { detail: { personId: "p1" }, bubbles: true, composed: true }),
    );
    await settle(el);
    refused.reject({ code: "connection.failed" });
    await settle(el);

    const edit = el.shadowRoot!.querySelector<PersonEdit>("dashboard-person-edit")!;
    expect(edit.open).toBe(true);
    expect(edit.error).toBe(null);
    await edit.updateComplete;
    const actions = edit.shadowRoot!.querySelector("wt-form-actions")!;
    expect((await formMessageOf(actions))?.textContent?.trim() ?? "").toBe("");
  });

  it("drops the file when the screen was left while it was sent", async () => {
    const request = held();
    const { el, host } = await mount(stubApi(() => request.promise));
    const saving = spyOnSaving();
    await press(el, "p1");
    el.remove();
    request.resolve(FILE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saving.create).not.toHaveBeenCalled();
    expect(saving.links).toHaveLength(0);
    host.append(el);
    await settle(el);
    expect(statusLine(el)).toBe(null);
    expect(alertLine(el)).toBe(null);
    expect(list(el).downloadingPersonId).toBe(null);
  });

  it("drops a refusal when the screen was left while it was sent", async () => {
    const request = held();
    const { el, host } = await mount(stubApi(() => request.promise));
    await press(el, "p1");
    el.remove();
    request.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.append(el);
    await settle(el);
    expect(alertLine(el)).toBe(null);
    expect(statusLine(el)).toBe(null);
  });

  it("speaks Spanish", async () => {
    await inLocale("es-ES", async () => {
      const request = held();
      const api = stubApi(() => request.promise);
      const { el } = await mount(api);
      await press(el, "p2");
      expect(statusLine(el)!.textContent!.trim()).toBe(named("staff.data_copy_busy", "Mar$&ta"));
      request.reject({ code: "authorization.not_permitted" });
      await settle(el);
      expect(alertText(el)).toBe(named("staff.data_copy_not_permitted", "Mar$&ta"));
      expect(signIn(el)!.textContent!.trim()).toBe(t("staff.sign_in_as_admin"));

      vi.mocked(api.downloadPersonalData).mockRejectedValue({ code: "person.not_found" });
      await press(el, "p2");
      expect(alertText(el)).toBe(named("staff.data_copy_not_found", "Mar$&ta"));
    });
    const spanish: Partial<Record<StringKey, string>> = {};
    await inLocale("es-ES", async () => {
      for (const key of [
        "staff.data_copy_busy",
        "staff.data_copy_not_permitted",
        "staff.data_copy_not_found",
        "staff.sign_in_as_admin",
      ] as const)
        spanish[key] = t(key);
    });
    for (const [key, words] of Object.entries(spanish) as [StringKey, string][]) {
      expect(words).not.toBe(t(key));
      expect(words).not.toBe(key);
    }
  });
});

describe.each(["light", "dark"] as const)("staff-screen download a11y (%s)", (theme) => {
  it("is accessible while sent", async () => {
    const request = held();
    const { el, host } = await mount(
      stubApi(() => request.promise),
      theme,
    );
    await press(el, "p1");
    expect(statusLine(el)).not.toBe(null);
    await expectNoA11yViolations(host);
    spyOnSaving();
    request.resolve(FILE);
    await settle(el);
  });

  it.each(["authorization.not_permitted", "person.not_found", "connection.failed"])(
    "is accessible with the %s line shown",
    async (code) => {
      const { el, host } = await mount(
        stubApi(() => Promise.reject({ code })),
        theme,
      );
      await press(el, "p1");
      expect(alertLine(el)).not.toBe(null);
      await expectNoA11yViolations(host);
    },
  );

  it("is accessible in Spanish with the sign-in shown", async () => {
    await inLocale("es-ES", async () => {
      const { el, host } = await mount(
        stubApi(() => Promise.reject({ code: "authorization.not_permitted" })),
        theme,
      );
      await press(el, "p1");
      expect(signIn(el)).not.toBe(null);
      await expectNoA11yViolations(host);
    });
  });
});
