import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { navigationGuardFor } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed } from "../widgets/test-helpers.js";
import {
  reader,
  mountReaderApp,
  readerScreen,
  readyReaderEditor,
} from "../testing/reader-settings-fixture.js";
import { deep } from "../testing/department-receipt-app-fixture.js";
import * as editor from "./payments-screen.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
it.each(["en-GB", "es-ES"])(
  "declarations equal independently mounted Edit controls and labels in %s",
  async (locale) => {
    expect(editor).toHaveProperty("readerSettingFields");
    const { app } = await mountReaderApp({ locale });
    const screen = readerScreen(app);
    await expect.poll(() => deep(screen.shadowRoot!, "[data-test=edit-r1]")).toBeTruthy();
    (deep(screen.shadowRoot!, "[data-test=edit-r1]") as HTMLElement).click();
    const modal = await readyReaderEditor(app);
    const actual = [...modal.querySelectorAll<HTMLElement & { label: string }>("[name]")].map(
      (field) => [field.getAttribute("name"), field.label] as const,
    );
    const declared = editor.readerSettingFields.map(
      (field) => [field.name, t(field.labelKey)] as const,
    );
    expect(new Map(declared)).toEqual(new Map(actual));
    expect(declared).toHaveLength(new Map(declared).size);
    expect(location.pathname).toBe("/payments");
  },
);
it("linked reader follows history/remount and close/unknown cleanup", async () => {
  const { app } = await mountReaderApp();
  const push = vi.spyOn(history, "pushState");
  await navigationGuardFor(window)!.write(
    new URL("/payments/reader/r1", location.origin).href,
    false,
  );
  await readyReaderEditor(app);
  expect(push).toHaveBeenCalled();
  history.back();
  await expect
    .poll(() => readerScreen(app).shadowRoot!.querySelector("[data-test=reader-editor]"))
    .toBeNull();
  history.forward();
  await readyReaderEditor(app);
  const screen = readerScreen(app);
  const parent = screen.parentElement!;
  screen.remove();
  parent.append(screen);
  const modal = await readyReaderEditor(app);
  const closed = dialogClosed(modal);
  await userEvent.click(modal.querySelector<HTMLElement>("[data-test=close-reader-editor]")!);
  await closed;
  await expect.poll(() => location.pathname).toBe("/payments");
  expect(screen.shadowRoot!.activeElement).toBe(screen.shadowRoot!.querySelector("h1"));
  await navigationGuardFor(window)!.write(
    new URL("/payments/reader/missing", location.origin).href,
    false,
  );
  await expect.poll(() => location.pathname).toBe("/payments");
  expect(screen.shadowRoot!.querySelector("[data-test=reader-editor]")).toBeNull();
});
it("live reads retain the linked draft and disappearance clears its address", async () => {
  let rows = [reader];
  const { app, api } = await mountReaderApp({
    path: "/payments/reader/r1",
    respond: (path) =>
      path === "/management-api/payments/readers"
        ? Promise.resolve(new Response(JSON.stringify(rows)))
        : undefined,
  });
  const modal = await readyReaderEditor(app);
  modal
    .querySelector("[name=reader-name]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  rows = [{ ...reader, name: "Saved" }];
  api.liveData.invalidate([{ type: "card_readers", id: "r1" }]);
  await expect
    .poll(() => deep(readerScreen(app).shadowRoot!, "wt-data-table")?.shadowRoot?.textContent)
    .toContain("Saved");
  expect(modal.querySelector("[name=reader-name]")).toHaveProperty("value", "Draft");
  rows = [];
  api.liveData.invalidate([{ type: "card_readers", id: "r1" }]);
  await expect
    .poll(() => readerScreen(app).shadowRoot!.querySelector("[data-test=reader-editor]"))
    .toBeNull();
  expect(location.pathname).toBe("/payments");
  expect(readerScreen(app).shadowRoot!.textContent).toContain(codeMessage("reader.not_found"));
});
