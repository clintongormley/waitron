import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { navigationGuardFor, type WtInput } from "@waitron/ui";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  mountPrinterApp,
  officePrinter,
  printerScreen,
  receiptPrinter,
} from "../testing/printer-settings-fixture.js";
import { printerSettingFields } from "./printers-screen.js";
const viewport: [number, number] = [window.innerWidth, window.innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  await page.viewport(...viewport);
});
const path = (id: string, editor = "edit", step?: string) =>
  `/printers/view/printers/printer/${id}/editor/${editor}${step ? `/step/${step}` : ""}`;
it.each(["en-GB", "es-ES"])(
  "declarations equal mounted controls and labels in %s",
  async (locale) => {
    for (const transport of ["network_tcp", "usb", "a4"] as const) {
      const id = transport === "a4" ? "pp1" : "p1";
      const { app } = await mountPrinterApp({
        locale,
        path: path(id),
        printers: [
          {
            ...receiptPrinter,
            hasCashDrawer: true,
            transport: transport === "a4" ? "network_tcp" : transport,
          },
        ],
        pagePrinters: [officePrinter],
        respond: (url) =>
          url.endsWith("/test-drawer")
            ? Promise.resolve(new Response(JSON.stringify({ jobId: "drawer-test" })))
            : undefined,
      });
      const screen = printerScreen(app);
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[name=printer-detail-name]"))
        .toBeTruthy();
      const actual = new Set<string>();
      const collect = (editor: string) => {
        for (const field of screen.shadowRoot!.querySelectorAll<HTMLElement & { label: string }>(
          "[name]",
        )) {
          const name = field.getAttribute("name")!;
          if (!name.startsWith("printer-") || name === "printer-drawer-result") continue;
          const step = field
            .closest("[data-test^=calibration-step-]")
            ?.getAttribute("data-test")
            ?.slice(-1);
          actual.add(JSON.stringify([name, field.label, editor, step ? Number(step) : undefined]));
        }
      };
      collect("edit");
      if (transport !== "a4") {
        await navigationGuardFor(window)!.write(path(id, "calibrate", "1"));
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[name=printer-ruler-number]"))
          .toBeTruthy();
        await navigationGuardFor(window)!.write(path(id, "calibrate", "3"));
        await userEvent.click(
          screen.shadowRoot!.querySelector<HTMLElement>("[data-test=test-printer-drawer]")!,
        );
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[name=printer-drawer-result]"))
          .toBeTruthy();
        collect("calibrate");
        for (const [answer, name] of [
          ["paper", "printer-ruler-number"],
          ["resolution", "printer-qr-square"],
        ]) {
          const label = screen
            .shadowRoot!.querySelector(`[data-test=calibration-result-${answer}]`)!
            .previousElementSibling!.textContent!.trim();
          actual.add(JSON.stringify([name, label, "calibrate", 1]));
        }
      }
      const fields = printerSettingFields;
      const declared = fields
        .filter((f: { rows: string }) =>
          transport === "a4"
            ? f.rows === "all"
            : transport === "network_tcp" || f.rows !== "network",
        )
        .map(
          (f: { name: string; labelKey: Parameters<typeof t>[0]; editor: string; step?: number }) =>
            JSON.stringify([f.name, t(f.labelKey), f.editor, f.step]),
        );
      expect(new Set(declared)).toEqual(actual);
      expect(declared).toHaveLength(new Set(declared).size);
      cleanupWidgets();
    }
  },
);
it("restores targets after delayed lists, Back/Forward and remount; closes and saves clean their addresses", async () => {
  let release!: (response: Response) => void;
  const { app } = await mountPrinterApp({
    path: path("p1") + "?keep=yes",
    respond: (url) =>
      url === "/management-api/printers"
        ? new Promise<Response>((r) => {
            release = r;
          })
        : undefined,
  });
  const screen = printerScreen(app);
  expect(screen.shadowRoot!.querySelector("[name=printer-detail-name]")).toBeNull();
  await expect.poll(() => release).toBeTypeOf("function");
  release(new Response(JSON.stringify([receiptPrinter])));
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[name=printer-detail-name]"))
    .toBeTruthy();
  await navigationGuardFor(window)!.write(path("p1", "calibrate", "3") + "?keep=yes");
  await expect
    .poll(() =>
      screen.shadowRoot!.querySelector("[data-test=calibration-step-3]")?.hasAttribute("hidden"),
    )
    .toBe(false);
  expect(screen.shadowRoot!.querySelector("[name=printer-detail-name]")).toBeNull();
  history.back();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[name=printer-detail-name]"))
    .toBeTruthy();
  expect(screen.shadowRoot!.querySelector("[data-test=edit-printer-modal]")).toBeNull();
  history.forward();
  await expect
    .poll(() =>
      screen.shadowRoot!.querySelector("[data-test=calibration-step-3]")?.hasAttribute("hidden"),
    )
    .toBe(false);
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-edit-printer]")!,
  );
  await expect.poll(() => location.pathname).toBe("/printers/view/printers/printer/p1");
  expect(location.search).toBe("?keep=yes");
  cleanupWidgets();
  const fresh = await mountPrinterApp({ path: path("pp1"), pagePrinters: [officePrinter] });
  const name = () =>
    printerScreen(fresh.app).shadowRoot!.querySelector<WtInput>("[name=printer-detail-name]");
  await expect.poll(name).toBeTruthy();
  name()!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Front office" } }));
  await userEvent.click(
    printerScreen(fresh.app).shadowRoot!.querySelector<HTMLElement>(
      "[data-test=save-printer-details]",
    )!,
  );
  await expect.poll(() => location.pathname).toBe("/printers/view/printers/printer/pp1");
  expect(name()).toBeNull();
});
it.each([
  ["pp1", "calibrate", "1"],
  ["p1", "edit", "3"],
  ["p1", "calibrate", "9"],
  ["p1", "unknown", undefined],
])("refuses unavailable target %s/%s/%s with Close", async (id, editor, step) => {
  const { app } = await mountPrinterApp({
    path: path(id!, editor!, step),
    pagePrinters: [officePrinter],
  });
  const screen = printerScreen(app);
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector("[data-test=printer-setting-unavailable]")?.textContent,
    )
    .toContain(t("printers.setting_unavailable"));
  expect(
    screen.shadowRoot!.querySelector("[name=printer-detail-name], [name=printer-ruler-number]"),
  ).toBeNull();
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=printer-details-close]")!,
  );
  await expect.poll(() => location.pathname).toBe("/printers/view/printers");
});
it("step changes and live reads retain calibration edits; a guarded target change asks Keep/Discard", async () => {
  const { app, api } = await mountPrinterApp({ path: path("p1", "calibrate", "1") });
  const screen = printerScreen(app);
  const qr = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=printer-qr-square]",
    );
  await expect.poll(qr).toBeTruthy();
  qr()!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "203dpi" } }));
  const replaced = vi.spyOn(history, "replaceState");
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=calibration-next]")!,
  );
  await expect.poll(() => location.pathname).toBe(path("p1", "calibrate", "2"));
  expect(replaced).toHaveBeenCalled();
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=calibration-back]")!,
  );
  expect(location.pathname).toBe(path("p1", "calibrate", "1"));
  expect(qr()!.value).toBe("203dpi");
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=calibration-next]")!,
  );
  api.liveData.invalidate([{ type: "printers", id: "p1" }]);
  await api.liveData.refresh();
  expect(qr()!.value).toBe("203dpi");
  const navigate = () => navigationGuardFor(window)!.write(path("p1", "calibrate", "3"));
  let pending = navigate();
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await pending;
  expect(location.pathname).toBe(path("p1", "calibrate", "2"));
  expect(qr()!.value).toBe("203dpi");
  pending = navigate();
  await expect.poll(() => question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await pending;
  await expect
    .poll(() =>
      screen.shadowRoot!.querySelector("[data-test=calibration-step-3]")?.hasAttribute("hidden"),
    )
    .toBe(false);
  expect(qr()!.value).toBe("180dpi");
});

it.each(["edit-cancel", "calibration-save", "calibration-escape"] as const)(
  "%s clears only editor words on completion",
  async (completion) => {
    const edit = completion === "edit-cancel";
    const { app } = await mountPrinterApp({
      path: path("p1", edit ? "edit" : "calibrate", edit ? undefined : "3") + "?keep=yes",
    });
    const screen = printerScreen(app);
    await expect
      .poll(() =>
        screen.shadowRoot!.querySelector(
          edit ? "[name=printer-detail-name]" : "[name=printer-portable]",
        ),
      )
      .toBeTruthy();
    if (completion === "calibration-save") {
      screen
        .shadowRoot!.querySelector("[name=printer-portable]")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
      await userEvent.click(
        screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save-printer-p1]")!,
      );
    } else if (completion === "calibration-escape") await userEvent.keyboard("{Escape}");
    else
      await userEvent.click(
        screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-printer-details]")!,
      );
    await expect.poll(() => location.pathname).toBe("/printers/view/printers/printer/p1");
    expect(location.search).toBe("?keep=yes");
    expect(
      screen.shadowRoot!.querySelector("[name=printer-detail-name], [name=printer-ruler-number]"),
    ).toBeNull();
  },
);

it("a missing saved printer keeps the not-found refusal", async () => {
  const { app } = await mountPrinterApp({ path: path("missing") });
  const root = printerScreen(app).shadowRoot!;
  await expect
    .poll(() => root.querySelector("[data-test=printer-details-body]")?.textContent)
    .toContain(codeMessage("printer.not_found"));
  expect(root.querySelector("[data-test=printer-setting-unavailable]")).toBeNull();
});
