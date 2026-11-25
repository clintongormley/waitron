import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtRowActions } from "@waitron/ui";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { SERIF_BOLD_SHEET, TEXT_130_SHEET } from "@waitron/ui/test/venue-theme-fixture.js";
import { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { printEquipmentLabel } from "@waitron/ui/src/print-label.js";
import "./equipment-qr-label.js";
import type { EquipmentQrLabel } from "./equipment-qr-label.js";
const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
const OTHER = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
const q = <T extends Element = Element>(el: EquipmentQrLabel, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test=${test}]`)!;
const active = [
  { id: OTHER, name: "Counter", active: true },
  { id: ID, name: "Portable", active: true },
  { id: "disabled", name: "Off", active: false },
];
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
  vi.restoreAllMocks();
});
async function mount(
  kind: "printer" | "reader" = "printer",
  printers: typeof active | Error | (() => Promise<typeof active>) = active,
) {
  const api = {
    listPrinters: vi.fn(async () => {
      if (printers instanceof Error) throw printers;
      return typeof printers === "function" ? printers() : printers;
    }),
    printEquipmentLabel: vi.fn().mockResolvedValue({ jobId: "job" }),
  };
  const { el, host } = await mountWidget<EquipmentQrLabel>("dashboard-equipment-qr-label", {
    kind,
    itemId: ID,
    name: "Portable",
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(q(el, "equipment-label-qr")).not.toBeNull());
  return { el, host, api };
}
const trigger = (el: EquipmentQrLabel) => q<WtRowActions>(el, "print-equipment-label");
const items = (el: EquipmentQrLabel) => [...trigger(el).querySelectorAll<WtButton>("wt-button")];
const popup = (el: EquipmentQrLabel) =>
  trigger(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const error = (el: EquipmentQrLabel) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "equipment-label-actions").error;
const choose = (el: EquipmentQrLabel, id: string) =>
  q<WtButton>(el, `print-label-on-${id}`).click();
const listed = (el: EquipmentQrLabel) => vi.waitFor(() => expect(items(el)).not.toEqual([]));
async function mountListed(kind: "printer" | "reader" = "printer") {
  const mounted = await mount(kind);
  await listed(mounted.el);
  return mounted;
}

it("Print opens a list of the active printers, a printer's own label first, then this computer's", async () => {
  const { el, api } = await mountListed();
  expect(items(el).map((each) => each.textContent!.trim())).toEqual([
    "Portable",
    "Counter",
    "This computer’s printer",
  ]);
  expect(popup(el).matches(":popover-open")).toBe(false);
  await userEvent.click(page.elementLocator(trigger(el).shadowRoot!.querySelector("button")!));
  expect(popup(el).matches(":popover-open")).toBe(true);
  const print = vi.fn();
  el.print = print;
  choose(el, OTHER);
  await vi.waitFor(() =>
    expect(api.printEquipmentLabel).toHaveBeenCalledExactlyOnceWith(OTHER, {
      kind: "printer",
      id: ID,
    }),
  );
  await vi.waitFor(() =>
    expect(q(el, "equipment-label-printer-status")?.textContent).toContain("queued"),
  );
  expect(popup(el).matches(":popover-open")).toBe(false);
  expect(print).not.toHaveBeenCalled();
});
it("a card reader's label keeps the printers in the order they were read", async () => {
  const { el } = await mountListed("reader");
  expect(items(el).map((each) => each.textContent!.trim())).toEqual([
    "Counter",
    "Portable",
    "This computer’s printer",
  ]);
});
it("This computer's printer prints the label from this page", async () => {
  const { el, api } = await mountListed();
  const print = vi.fn();
  el.print = print;
  choose(el, "this-computer");
  expect(print).toHaveBeenCalledExactlyOnceWith({
    qr: q<HTMLImageElement>(el, "equipment-label-qr").src,
    code: `waitron-equipment:printer:${ID}`,
    name: "Portable",
  });
  expect(api.printEquipmentLabel).not.toHaveBeenCalled();
});
it("works from the keyboard, and keeps focus on Print while it prints and after", async () => {
  const { el, api } = await mountListed();
  let complete!: () => void;
  api.printEquipmentLabel.mockImplementationOnce(
    () => new Promise((resolve) => (complete = () => resolve({ jobId: "job" }))),
  );
  trigger(el).focus();
  await userEvent.keyboard("{Enter}");
  expect(popup(el).matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(popup(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Tab}{Tab}{Enter}");
  expect(api.printEquipmentLabel).toHaveBeenCalledExactlyOnceWith(OTHER, {
    kind: "printer",
    id: ID,
  });
  await el.updateComplete;
  const waiting = q<WtButton>(el, "print-equipment-label");
  expect(waiting.loading).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(waiting);
  complete();
  await listed(el);
  expect(el.shadowRoot!.activeElement).toBe(trigger(el));
});
it("prints straight from this computer when Waitron has no printer to print on", async () => {
  const { el, api } = await mount("printer", [active[2]!]);
  await vi.waitFor(() => expect(q<WtButton>(el, "print-equipment-label").variant).toBe("primary"));
  const print = vi.fn();
  el.print = print;
  q<WtButton>(el, "print-equipment-label").click();
  expect(print).toHaveBeenCalledTimes(1);
  expect(api.printEquipmentLabel).not.toHaveBeenCalled();
});
it("a refused print says so and leaves the list to choose from again", async () => {
  const { el, api } = await mountListed("reader");
  api.printEquipmentLabel.mockRejectedValueOnce(new Error("offline"));
  choose(el, OTHER);
  await vi.waitFor(() => expect(error(el)).toBeTruthy());
  expect(q(el, "retry-equipment-printers")).toBeNull();
  choose(el, OTHER);
  await vi.waitFor(() => expect(api.printEquipmentLabel).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(q(el, "equipment-label-printer-status")?.textContent).toContain("queued"),
  );
  expect(error(el)).toBe("");
});
it("the real client sends the label request as an authenticated POST", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: "j1" })));
  const api = new DashboardApi("", fetcher);
  expect(await api.printEquipmentLabel(OTHER, { kind: "reader", id: ID })).toEqual({ jobId: "j1" });
  expect(fetcher.mock.calls[0]![0]).toBe(`/management-api/printers/${OTHER}/equipment-label`);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ kind: "reader", id: ID }),
  });
});
it("prints the browser name larger and bolder than the code", async () => {
  const qr =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const printed = vi.fn<(view: Window) => void>();
  printEquipmentLabel({ qr, name: "<b>Portable</b>", code: "CODE" }, printed);
  await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
  const view = printed.mock.calls[0]![0];
  const [name, code] = [...view.document.querySelectorAll("p")];
  expect(name!.textContent).toBe("<b>Portable</b>");
  expect(parseFloat(view.getComputedStyle(name!).fontSize)).toBeGreaterThan(
    parseFloat(view.getComputedStyle(code!).fontSize),
  );
  expect(Number(view.getComputedStyle(name!).fontWeight)).toBeGreaterThan(
    Number(view.getComputedStyle(code!).fontWeight),
  );
  view.dispatchEvent(new Event("afterprint"));
});
it.each(["16px", "32px"])(
  "the label prints Waitron's type under a theme at 130% with its own document at %s root text",
  async (rootSize) => {
    const qr =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, TEXT_130_SHEET];
    try {
      const printed = vi.fn<(view: Window) => void>();
      printEquipmentLabel({ qr, name: "Portable", code: "CODE" }, printed);
      await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
      const view = printed.mock.calls[0]![0];
      expect(getComputedStyle(view.frameElement!).getPropertyValue("--wt-font-size-md")).toBe(
        "1.125rem",
      );
      const root = view.document.documentElement.style;
      root.fontSize = rootSize;
      expect(view.getComputedStyle(view.document.body).fontSize).toBe("14px");
      expect(view.getComputedStyle(view.document.querySelector("p")!).fontSize).toBe("22px");
      expect(root.getPropertyValue("--wt-font-size-md")).toBe("14px");
      expect(root.getPropertyValue("--wt-font-size-xl")).toBe("22px");
      expect(root.getPropertyValue("--wt-font-weight-bold")).toBe("600");
      expect(root.getPropertyValue("--wt-font-family")).toBe(
        WAITRON_DEFAULTS.structure["--wt-font-family"],
      );
      view.dispatchEvent(new Event("afterprint"));
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== TEXT_130_SHEET,
      );
    }
  },
);
it("the label prints Waitron's typeface and Bold under a theme in Serif with Bold 800", async () => {
  const qr =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, SERIF_BOLD_SHEET];
  try {
    const printed = vi.fn<(view: Window) => void>();
    printEquipmentLabel({ qr, name: "Portable", code: "CODE" }, printed);
    await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const view = printed.mock.calls[0]![0];
    expect(getComputedStyle(view.frameElement!).getPropertyValue("--wt-font-weight-bold")).toBe(
      "800",
    );
    const root = view.document.documentElement.style;
    expect(root.getPropertyValue("--wt-font-family")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family"],
    );
    expect(root.getPropertyValue("--wt-font-weight-bold")).toBe("600");
    view.dispatchEvent(new Event("afterprint"));
  } finally {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== SERIF_BOLD_SHEET,
    );
  }
});
it("a failed read of the printers says so, still offers this computer, and tries again", async () => {
  const { el, api } = await mount("printer", new Error("offline"));
  await listed(el);
  expect(error(el)).toBeTruthy();
  expect(items(el).map((each) => each.textContent!.trim())).toEqual(["This computer’s printer"]);
  api.listPrinters.mockResolvedValue(active);
  q<WtButton>(el, "retry-equipment-printers").click();
  await vi.waitFor(() => expect(items(el)).toHaveLength(3));
  expect(error(el)).toBe("");
  expect(q(el, "retry-equipment-printers")).toBeNull();
});
it("Print is quiet while the printers are read", async () => {
  let complete!: (printers: typeof active) => void;
  const { el } = await mount(
    "printer",
    () => new Promise<typeof active>((resolve) => (complete = resolve)),
  );
  const print = vi.fn();
  el.print = print;
  const waiting = q<WtButton>(el, "print-equipment-label");
  expect(waiting.variant).toBe("secondary");
  expect(waiting.loading).toBe(true);
  expect(waiting.disabled).toBe(false);
  waiting.shadowRoot!.querySelector("button")!.click();
  expect(print).not.toHaveBeenCalled();
  complete(active);
  await listed(el);
});
it("ignores a late list after the label changes", async () => {
  let complete!: (printers: typeof active) => void;
  const { el, api } = await mount(
    "printer",
    () => new Promise<typeof active>((resolve) => (complete = resolve)),
  );
  api.listPrinters.mockResolvedValue(active);
  el.itemId = OTHER;
  await vi.waitFor(() => expect(items(el)[0]?.textContent!.trim()).toBe("Counter"));
  complete([]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(items(el)).toHaveLength(3);
});
it("sends once while pending and ignores its late result after switching equipment", async () => {
  const { el, api } = await mountListed();
  let complete!: (result: { jobId: string }) => void;
  api.printEquipmentLabel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const item = q<WtButton>(el, `print-label-on-${ID}`);
  item.click();
  item.click();
  await el.updateComplete;
  expect(api.printEquipmentLabel).toHaveBeenCalledTimes(1);
  const waiting = q<WtButton>(el, "print-equipment-label");
  expect(waiting.loading).toBe(true);
  expect(waiting.variant).toBe("primary");
  el.itemId = OTHER;
  await vi.waitFor(() => expect(items(el)).toHaveLength(3));
  complete({ jobId: "old-job" });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(q(el, "equipment-label-printer-status")).toBeNull();
  expect(items(el)).toHaveLength(3);
});

it("keeps a late refusal from appearing on the replacement label", async () => {
  const { el, api } = await mountListed();
  let reject!: (error: Error) => void;
  api.printEquipmentLabel.mockImplementationOnce(
    () =>
      new Promise((_resolve, refuse) => {
        reject = refuse;
      }),
  );
  choose(el, ID);
  await el.updateComplete;
  el.itemId = OTHER;
  await vi.waitFor(() => expect(items(el)).toHaveLength(3));
  reject(new Error("old refusal"));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(error(el)).toBe("");
});

describe("Copy code", () => {
  const message = (el: EquipmentQrLabel) => q(el, "equipment-code-message")?.textContent?.trim();
  async function shown() {
    const mounted = await mountListed("reader");
    q<WtButton>(mounted.el, "show-equipment-code").click();
    await mounted.el.updateComplete;
    return mounted.el;
  }

  it("copies the visible code and explains a refused clipboard", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const el = await shown();
    q<WtButton>(el, "copy-equipment-code").click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(`waitron-equipment:reader:${ID}`));
    await vi.waitFor(() => expect(message(el)).toBe("Code copied"));
    expect(q(el, "equipment-label-code").textContent).toBe(`waitron-equipment:reader:${ID}`);
    copy.mockRejectedValue(new DOMException("refused", "NotAllowedError"));
    q<WtButton>(el, "copy-equipment-code").click();
    await vi.waitFor(() => expect(message(el)).toContain("Select and copy"));
    expect(q<WtButton>(el, "copy-equipment-code").disabled).toBe(false);
  });

  it.each(["success", "refusal"] as const)(
    "a late clipboard %s cannot describe another label",
    async (result) => {
      let finish!: () => void;
      vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = result === "success" ? resolve : () => reject(new Error("refused"));
          }),
      );
      const el = await shown();
      q<WtButton>(el, "copy-equipment-code").click();
      el.itemId = OTHER;
      await el.updateComplete;
      q<WtButton>(el, "show-equipment-code").click();
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(message(el)).toBeUndefined();
      expect(el.shadowRoot!.querySelector("code")!.textContent).toContain(OTHER);
    },
  );

  it("a clipboard completion after closing cannot restore a message", async () => {
    let finish!: () => void;
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const el = await shown();
    q<WtButton>(el, "copy-equipment-code").click();
    const reported = dialogClosed(el.shadowRoot!.querySelector("wt-modal")!);
    q<WtButton>(el, "close-equipment-label").click();
    await reported;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(message(el)).toBeUndefined();
  });
});
