import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseTheme, type WtButton, type WtTextarea } from "@waitron/ui";
import { clockApp, signIn, working } from "../test/clock-app.js";
import { cleanupWidgets, resetPage } from "./widgets/test-helpers.js";
import { dialogOpenUnder } from "./widgets/track-dialog.js";
import { currentLocale, setLocale } from "./i18n/t.js";

const locale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale(locale);
  chooseTheme("device");
  await resetPage();
});

import {
  reportOf,
  dialogOf,
  preview,
  data,
  openStrip,
  editReport,
  closed,
} from "../test/problem-report.js";

it.each([
  ["lock", {}],
  ["enrolment", { frontDoor: "enrol" }],
  ["chooser", { frontDoor: "chooser", devDevices: { devices: [], devMode: true } }],
  ["clock", { clockPage: true }],
  ["attendance", { attendancePage: true }],
] as const)("opens from the persistent strip beside %s", async (_name, state) => {
  const { el } = await clockApp();
  Object.assign(el, state);
  await el.updateComplete;
  const dialog = await openStrip(el);
  expect(data(preview(dialog)).app).toBe("till");
  expect(dialogOpenUnder(el)).toBe(true);
});

it.each(["till", "phone-portrait"] as const)(
  "opens from the %s More menu without leaving the working screen",
  async (formFactor) => {
    const { el } = await clockApp({ enabled: false });
    await signIn(el);
    await working(el);
    Object.assign(el, { formFactor });
    await el.updateComplete;
    const shell = el.shadowRoot!.querySelector("till-shell")!;
    await shell.updateComplete;
    const menu = shell.shadowRoot!.querySelector("[data-test=more-menu]")!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    const entry = menu.querySelector<WtButton>("[data-report-problem]");
    expect(entry).not.toBeNull();
    await userEvent.click(entry!);
    await expect.poll(() => dialogOf(el).open).toBe(true);
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
    expect(el.shadowRoot!.querySelector("till-shell")).toBe(shell);
    const dialog = dialogOf(el);
    expect(data(preview(dialog)).app).toBe("till");
    const didClose = closed(dialog);
    await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>('[slot="cancel"]')!);
    await didClose;
    expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector("button"));
  },
);

it("downloads the visible edited preview, without a request or storage write, and reopens fresh", async () => {
  const { el } = await clockApp();
  const dialog = await openStrip(el);
  const first = data(preview(dialog));
  const field = dialog.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(
    field.shadowRoot!.querySelector("textarea")!,
    "The screen stopped responding.",
  );
  await expect.poll(() => dialog.description).toBe("The screen stopped responding.");
  const shown = preview(dialog);
  expect(data(shown).id).toBe(first.id);
  const blobs: Blob[] = [];
  const create = URL.createObjectURL.bind(URL);
  const urls: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    const url = create(blob);
    urls.push(url);
    return url;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const filenames: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filenames.push(this.download);
  });
  const fetch = vi.fn(() => {
    throw new Error("Reporting must stay in this browser");
  });
  vi.stubGlobal("fetch", fetch);
  const storage = vi.spyOn(Storage.prototype, "setItem");
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!);
  await expect.poll(() => dialog.open).toBe(false);
  expect(await blobs[0]!.text()).toBe(shown);
  expect(filenames).toEqual([`problem-report-${first.id}.md`]);
  expect(revoke).toHaveBeenCalledWith(urls[0]);
  expect(document.querySelector(`a[href="${urls[0]}"]`)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  expect(dialogOpenUnder(el)).toBe(false);
  const reopened = await openStrip(el);
  expect(reopened.description).toBe("");
  expect(data(preview(reopened)).id).not.toBe(first.id);
});

it("hides both entry points without a secure context", async () => {
  vi.stubGlobal("isSecureContext", false);
  const { el } = await clockApp({ enabled: false });
  expect(reportOf(el)?.shadowRoot?.querySelector("[data-report-problem]") ?? null).toBeNull();
  await signIn(el);
  await working(el);
  const shell = el.shadowRoot!.querySelector("till-shell")!;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("[data-report-problem]")).toBeNull();
});

it("retains the same report after download failure, then clears the error on edit and retries", async () => {
  const { el } = await clockApp();
  const dialog = await openStrip(el);
  await editReport(dialog, "The screen stopped responding.");
  const opening = data(preview(dialog));
  const create = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL")
    .mockImplementationOnce(() => {
      throw new Error("Download refused");
    })
    .mockImplementation(create);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!);
  await expect.poll(() => dialog.downloadError).toBe("Could not create the download. Try again.");
  expect(dialog.open).toBe(true);
  expect(dialog.description).toBe("The screen stopped responding.");
  await editReport(dialog, "The screen was slow.");
  expect(dialog.downloadError).toBe("");
  expect(data(preview(dialog)).id).toBe(opening.id);
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!);
  await expect.poll(() => dialog.open).toBe(false);
});

it("keeps the opening locale and theme in the file while the open dialog follows the chosen language", async () => {
  const { el } = await clockApp();
  chooseTheme("dark");
  const dialog = await openStrip(el);
  const opening = data(preview(dialog));
  expect(opening.client.locale).toBe("en");
  expect(opening.client.theme).toBe("dark");
  chooseTheme("light");
  setLocale("es-ES");
  await expect.poll(() => dialog.copy?.heading).toBe("Informar de un problema");
  await editReport(dialog, "The screen was slow.");
  expect(data(preview(dialog)).client).toEqual(opening.client);
});
