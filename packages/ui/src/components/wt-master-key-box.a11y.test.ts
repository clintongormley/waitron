import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtMasterKeyBox } from "./wt-master-key-box.js";
import "./wt-master-key-box.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const COPY = {
  name: (name: string) => `Master key · ${name}`,
  download: "Download",
  print: "Print",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Copy did not work. Use Download or Print, or write the key down.",
  printFailed: "Print did not open. Use Download, or allow pop-ups and try again.",
};

async function box(theme: "light" | "dark", pdf: boolean): Promise<WtMasterKeyBox> {
  const el = (await mountThemed(
    "<wt-master-key-box></wt-master-key-box>",
    theme,
  )) as WtMasterKeyBox;
  el.masterKey = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
  el.keyName = "2026-11-23 · QZJV";
  el.pdfUrl = pdf ? "blob:pack" : undefined;
  el.copy = COPY;
  await el.updateComplete;
  return el;
}

const press = (el: WtMasterKeyBox, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!.click();

describe.each(["light", "dark"] as const)("wt-master-key-box a11y (%s theme)", (theme) => {
  test("with the pack's PDF", async () => {
    await box(theme, true);
    await expectNoA11yViolations(host);
  });

  test("without a PDF, Copy alone", async () => {
    await box(theme, false);
    await expectNoA11yViolations(host);
  });

  test("copied", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const el = await box(theme, true);
    press(el, "copy");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=copied]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  test("copy refused", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const el = await box(theme, true);
    press(el, "copy");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=copy-failed]")).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  test("print blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const el = await box(theme, true);
    press(el, "print");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=print-failed]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
