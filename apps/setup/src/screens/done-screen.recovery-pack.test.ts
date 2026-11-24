import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { finishEs } from "../i18n/strings/finish.js";
import "./done-screen.js";
import type { SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const KEY_NAME = "2026-11-23 · QZJV";

/** Finds `sel` on the step, or inside its master key box. */
const q = (el: SetupDoneScreen, sel: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(sel) ??
  el.shadowRoot!.querySelector("wt-master-key-box")?.shadowRoot!.querySelector<HTMLElement>(sel) ??
  null;
const text = (el: SetupDoneScreen, sel: string) => q(el, sel)?.textContent?.trim();

function api(): SetupApi {
  return {
    getStatus: () => new Promise(() => {}),
    getRecoveryStatus: () => Promise.reject({ code: "server.internal", status: 404 }),
  } as unknown as SetupApi;
}

async function mountStep(extra: Partial<SetupDoneScreen> = {}): Promise<SetupDoneScreen> {
  const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
    api: api(),
    startDelayMs: 100000,
    masterKey: KEY,
    masterKeyName: KEY_NAME,
    recoveryPackPdf: btoa("%PDF-pack"),
    ...extra,
  });
  return el;
}

/** Spies the browser's download and new-tab opening, so a test reads what each button hands over. */
function captureHandovers() {
  const downloads: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download });
  });
  const opened = vi.spyOn(window, "open").mockImplementation(() => ({}) as Window);
  const copied: string[] = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (value: string) => {
    copied.push(value);
  });
  return { downloads, opened, copied };
}

afterEach(() => {
  vi.restoreAllMocks();
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup's Recovery pack step", () => {
  it.each(["prepare", "demo", "live"] as const)(
    "a %s setup that made a master key opens on the Recovery pack step, ahead of the links",
    async (onboardingIntent) => {
      const el = await mountStep({ onboardingIntent });
      expect(text(el, "h1")).toBe("Recovery pack");
      expect(text(el, "[data-test=pack-lead]")).toBe(
        "Download, print or copy the master key, then keep it somewhere safe, away from this box.",
      );
      expect(text(el, "[data-test=pack-warning]")).toBe(
        "This is the only time the master key is shown.",
      );
      expect(text(el, "[data-test=master-key-name]")).toBe("Master key · 2026-11-23 · QZJV");
      expect(text(el, "[data-test=master-key]")).toBe(KEY);
      expect(text(el, "[data-test=download]")).toBe("Download");
      expect(text(el, "[data-test=print]")).toBe("Print");
      expect(text(el, "[data-test=copy]")).toBe("Copy");
      expect(q(el, "[data-test=pack-continue]")).toBeNull();
      expect(q(el, "[data-test=links]")).toBeNull();
      expect(q(el, "[data-test=pack-kept]")).toBeNull();
      expect(el.shadowRoot!.querySelector("input")).toBeNull();
      expect(el.shadowRoot!.textContent).not.toMatch(/new master key/i);
    },
  );

  it.each(["download", "print"])(
    "Continue is not shown until Download or Print has been used: %s",
    async (control) => {
      captureHandovers();
      const el = await mountStep({ onboardingIntent: "prepare" });
      expect(q(el, "[data-test=pack-continue]")).toBeNull();
      await userEvent.click(q(el, `[data-test=${control}]`)!);
      await vi.waitFor(() => expect(q(el, "[data-test=pack-continue]")).not.toBeNull());
      expect(text(el, "[data-test=pack-continue]")).toBe("Continue");
      expect(q(el, "[data-test=links]")).toBeNull();
      await userEvent.click(q(el, "[data-test=pack-continue]")!);
      await el.updateComplete;
      expect(q(el, "[data-test=master-key]")).toBeNull();
      expect(text(el, "h1")).toBe("Setup complete");
      expect(q(el, "[data-test=links]")).not.toBeNull();
    },
  );

  it("Copy alone leaves Continue hidden while there is a pack, which holds more than the key", async () => {
    captureHandovers();
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(text(el, "[data-test=copied]")).toBe("Copied."));
    expect(q(el, "[data-test=pack-continue]")).toBeNull();
    await userEvent.click(q(el, "[data-test=download]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=pack-continue]")).not.toBeNull());
  });

  it("a Print the browser blocks does not count: it says so where a refused Copy does, and Continue stays hidden", async () => {
    captureHandovers();
    vi.spyOn(window, "open").mockReturnValue(null);
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=print]")!);
    await vi.waitFor(() =>
      expect(text(el, "[data-test=print-failed]")).toBe(
        "Print did not open. Use Download, or allow pop-ups and try again.",
      ),
    );
    expect(q(el, "[data-test=print-failed]")!.getAttribute("role")).toBe("alert");
    expect(q(el, "[data-test=pack-continue]")).toBeNull();
  });

  it("says in Spanish when a Print is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    setLocale("es-ES");
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=print]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=print-failed]")).not.toBeNull());
    expect(text(el, "[data-test=print-failed]")).toBe(finishEs["done.pack.print_failed"]);
    expect(finishEs["done.pack.print_failed"]).not.toBe(
      "Print did not open. Use Download, or allow pop-ups and try again.",
    );
  });

  it("Copy puts the key on the clipboard exactly as printed", async () => {
    const { copied } = captureHandovers();
    const el = await mountStep();
    expect(q(el, "[data-test=copied]")).toBeNull();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(text(el, "[data-test=copied]")).toBe("Copied."));
    expect(copied).toEqual(["88DP 74BA YPVB RRM5 XFV2 WPQY B5M5"]);
  });

  it("a Copy the browser refuses says so under the key box, never Copied., and leaves Continue hidden", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() =>
      expect(text(el, "[data-test=copy-failed]")).toBe(
        "Copy did not work. Use Download or Print, or write the key down.",
      ),
    );
    expect(q(el, "[data-test=copy-failed]")!.previousElementSibling?.className).toBe("master-key");
    expect(q(el, "[data-test=copied]")).toBeNull();
    expect(q(el, "[data-test=pack-continue]")).toBeNull();
  });

  it("a Copy that works after a refused one takes the refusal away", async () => {
    const writes = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=copy-failed]")).not.toBeNull());
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(text(el, "[data-test=copied]")).toBe("Copied."));
    expect(writes).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=copy-failed]")).toBeNull();
    expect(q(el, "[data-test=pack-continue]")).toBeNull();
  });

  it("says in Spanish when a Copy is refused", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    setLocale("es-ES");
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=copy-failed]")).not.toBeNull());
    expect(text(el, "[data-test=copy-failed]")).toBe(finishEs["done.pack.copy_failed"]);
    expect(finishEs["done.pack.copy_failed"]).not.toBe(
      "Copy did not work. Use Download or Print, or write the key down.",
    );
  });

  it("Download saves the pack PDF and Print opens it in a new tab", async () => {
    const { downloads, opened } = captureHandovers();
    const el = await mountStep();
    await userEvent.click(q(el, "[data-test=download]")!);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("waitron-recovery-pack.pdf");
    const response = await fetch(downloads[0]!.href);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await response.text()).toBe("%PDF-pack");
    await userEvent.click(q(el, "[data-test=print]")!);
    expect(opened).toHaveBeenCalledWith(downloads[0]!.href, "_blank");
  });

  it("offers only Copy when the box could not draw the pack, and then Copy alone reveals Continue", async () => {
    captureHandovers();
    const el = await mountStep({ recoveryPackPdf: undefined });
    expect(q(el, "[data-test=download]")).toBeNull();
    expect(q(el, "[data-test=print]")).toBeNull();
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=pack-continue]")).not.toBeNull());
  });

  it("is not shown when setup made no master key", async () => {
    const el = await mountStep({ masterKey: undefined, masterKeyName: undefined });
    expect(q(el, "[data-test=master-key]")).toBeNull();
    expect(text(el, "h1")).toBe("Setup complete");
    expect(q(el, "[data-test=links]")).not.toBeNull();
  });

  it("shows the step in Spanish", async () => {
    captureHandovers();
    setLocale("es-ES");
    const el = await mountStep();
    expect(text(el, "h1")).toBe(finishEs["done.pack.heading"]);
    expect(text(el, "[data-test=pack-lead]")).toBe(finishEs["done.pack.lead"]);
    expect(text(el, "[data-test=pack-warning]")).toBe(finishEs["done.pack.warning"]);
    expect(text(el, "[data-test=master-key-name]")).toBe("Clave maestra · 2026-11-23 · QZJV");
    expect(text(el, "[data-test=download]")).toBe("Descargar");
    expect(text(el, "[data-test=print]")).toBe("Imprimir");
    expect(text(el, "[data-test=copy]")).toBe("Copiar");
    await userEvent.click(q(el, "[data-test=copy]")!);
    await vi.waitFor(() => expect(text(el, "[data-test=copied]")).toBe("Copiada."));
    await userEvent.click(q(el, "[data-test=download]")!);
    await vi.waitFor(() => expect(text(el, "[data-test=pack-continue]")).toBe("Continuar"));
  });
});
