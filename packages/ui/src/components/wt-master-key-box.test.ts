import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { MasterKeyBoxCopy, MasterKeyUsedDetail, WtMasterKeyBox } from "./wt-master-key-box.js";
import "./wt-master-key-box.js";

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const COPY: MasterKeyBoxCopy = {
  name: (name) => `Master key · ${name}`,
  download: "Download",
  print: "Print",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Copy did not work.",
  printFailed: "Print did not open.",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const part = (el: WtMasterKeyBox, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);
const words = (el: WtMasterKeyBox, name: string) => part(el, name)?.textContent?.trim();

async function box(
  extra: Partial<WtMasterKeyBox> = {},
  place: (markup: string) => Promise<HTMLElement> = mount,
): Promise<{ el: WtMasterKeyBox; used: MasterKeyUsedDetail["action"][] }> {
  const el = (await place("<wt-master-key-box></wt-master-key-box>")) as WtMasterKeyBox;
  Object.assign(el, {
    masterKey: KEY,
    keyName: "2026-11-23 · QZJV",
    pdfUrl: "blob:pack",
    copy: COPY,
    ...extra,
  });
  await el.updateComplete;
  const used: MasterKeyUsedDetail["action"][] = [];
  el.addEventListener("wt-master-key-used", (event) =>
    used.push((event as CustomEvent<MasterKeyUsedDetail>).detail.action),
  );
  return { el, used };
}

function captureDownloads() {
  const downloads: { href: string; name: string; onPage: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      href: this.getAttribute("href")!,
      name: this.download,
      onPage: this.isConnected,
    });
  });
  return downloads;
}

test("draws the key's name above the key as printed, and Download, Print and Copy", async () => {
  const { el } = await box();
  expect(words(el, "master-key-name")).toBe("Master key · 2026-11-23 · QZJV");
  expect(part(el, "master-key")!.textContent).toBe(KEY);
  expect(part(el, "master-key")!.tagName).toBe("CODE");
  expect(words(el, "download")).toBe("Download");
  expect(words(el, "print")).toBe("Print");
  expect(words(el, "copy")).toBe("Copy");
  expect(part(el, "copied")).toBeNull();
  expect(part(el, "copy-failed")).toBeNull();
  expect(part(el, "print-failed")).toBeNull();
});

test("draws nothing until it has both a key and its words", async () => {
  const { el: noWords } = await box({ copy: undefined });
  expect(noWords.shadowRoot!.childElementCount).toBe(0);
  const { el: noKey } = await box({ masterKey: undefined });
  expect(noKey.shadowRoot!.childElementCount).toBe(0);
});

test("draws no name line for a key with no name", async () => {
  const { el } = await box({ keyName: undefined });
  expect(part(el, "master-key-name")).toBeNull();
  expect(part(el, "master-key")!.textContent).toBe(KEY);
});

test("without a pack PDF it offers only Copy", async () => {
  const { el } = await box({ pdfUrl: undefined });
  expect(part(el, "download")).toBeNull();
  expect(part(el, "print")).toBeNull();
  expect(words(el, "copy")).toBe("Copy");
});

test("Download saves the PDF under its file name and says so", async () => {
  const downloads = captureDownloads();
  const { el, used } = await box({ fileName: "waitron-recovery-pack-3.pdf" });
  await userEvent.click(part(el, "download")!);
  expect(downloads).toEqual([
    { href: "blob:pack", name: "waitron-recovery-pack-3.pdf", onPage: true },
  ]);
  expect(used).toEqual(["download"]);
  expect(document.querySelectorAll("a[download]")).toHaveLength(0);
});

test("Download's file name defaults to the recovery pack's", async () => {
  const downloads = captureDownloads();
  const { el } = await box();
  await userEvent.click(part(el, "download")!);
  expect(downloads[0]!.name).toBe("waitron-recovery-pack.pdf");
});

test("Print opens the PDF in a new tab and says so once the tab opened", async () => {
  const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
  const { el, used } = await box();
  await userEvent.click(part(el, "print")!);
  expect(opened).toHaveBeenCalledWith("blob:pack", "_blank");
  expect(used).toEqual(["print"]);
  expect(part(el, "print-failed")).toBeNull();
});

test("a Print the browser blocks says so in an alert under the key, and is not reported", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const { el, used } = await box();
  await userEvent.click(part(el, "print")!);
  await el.updateComplete;
  expect(used).toEqual([]);
  const alert = part(el, "print-failed")!;
  expect(alert.textContent!.trim()).toBe("Print did not open.");
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.previousElementSibling?.className).toBe("master-key");
  expect(part(el, "copy-failed")).toBeNull();
});

test("a Print that opens after a blocked one takes the alert away", async () => {
  vi.spyOn(window, "open")
    .mockReturnValueOnce(null)
    .mockReturnValueOnce({} as Window);
  const { el, used } = await box();
  await userEvent.click(part(el, "print")!);
  await el.updateComplete;
  expect(part(el, "print-failed")).not.toBeNull();
  await userEvent.click(part(el, "print")!);
  await el.updateComplete;
  expect(part(el, "print-failed")).toBeNull();
  expect(used).toEqual(["print"]);
});

test("Copy puts the key on the clipboard exactly as printed, says Copied. and reports it", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const { el, used } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(words(el, "copied")).toBe("Copied."));
  expect(write).toHaveBeenCalledWith(KEY);
  expect(part(el, "copied")!.getAttribute("role")).toBe("status");
  expect(used).toEqual(["copy"]);
});

test("a Copy the browser refuses says so in an alert under the key, never Copied., and is not reported", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  const { el, used } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(words(el, "copy-failed")).toBe("Copy did not work."));
  const alert = part(el, "copy-failed")!;
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.previousElementSibling?.className).toBe("master-key");
  expect(part(el, "copied")).toBeNull();
  expect(used).toEqual([]);
});

test("a Copy that works after a refused one takes the alert away", async () => {
  vi.spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce(undefined);
  const { el, used } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copy-failed")).not.toBeNull());
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(words(el, "copied")).toBe("Copied."));
  expect(part(el, "copy-failed")).toBeNull();
  expect(used).toEqual(["copy"]);
});

test("a refused Copy after a good one takes Copied. away", async () => {
  vi.spyOn(navigator.clipboard, "writeText")
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  const { el } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copied")).not.toBeNull());
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copy-failed")).not.toBeNull());
  expect(part(el, "copied")).toBeNull();
});

test("shows one alert at a time: the latest failure, and a Download takes it away", async () => {
  captureDownloads();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  vi.spyOn(window, "open").mockReturnValue(null);
  const { el } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copy-failed")).not.toBeNull());
  await userEvent.click(part(el, "print")!);
  await el.updateComplete;
  expect(part(el, "print-failed")).not.toBeNull();
  expect(part(el, "copy-failed")).toBeNull();
  await userEvent.click(part(el, "download")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("a new key takes away what was said about the old one", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  vi.spyOn(window, "open").mockReturnValue(null);
  const { el } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copied")).not.toBeNull());
  await userEvent.click(part(el, "print")!);
  await el.updateComplete;
  expect(part(el, "print-failed")).not.toBeNull();
  el.masterKey = "2SZ5 ZYJ9 UN95 RXKV NF7B N8VU GYU4";
  await el.updateComplete;
  expect(part(el, "copied")).toBeNull();
  expect(part(el, "print-failed")).toBeNull();
});

test("new words for the same key keep what was said", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const { el } = await box();
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copied")).not.toBeNull());
  el.copy = { ...COPY, copied: "Copiada." };
  await el.updateComplete;
  expect(words(el, "copied")).toBe("Copiada.");
});

test("a Copy still out when the key changes neither reports nor says Copied. for the new key", async () => {
  let finish!: () => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const { el, used } = await box();
  await userEvent.click(part(el, "copy")!);
  el.masterKey = "2SZ5 ZYJ9 UN95 RXKV NF7B N8VU GYU4";
  await el.updateComplete;
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(part(el, "copied")).toBeNull();
  expect(used).toEqual([]);
});

test("a refused Copy still out when the key changes says nothing for the new key", async () => {
  let refuse!: (error: Error) => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () => new Promise<void>((_, reject) => (refuse = reject)),
  );
  const { el } = await box();
  await userEvent.click(part(el, "copy")!);
  el.masterKey = "2SZ5 ZYJ9 UN95 RXKV NF7B N8VU GYU4";
  await el.updateComplete;
  refuse(new Error("denied"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(part(el, "copy-failed")).toBeNull();
});

test("its event bubbles out of a shadow root with its detail, and the press that caused it does not", async () => {
  captureDownloads();
  const { el } = await box({}, mountInShadowRoot);
  const seen: CustomEvent<MasterKeyUsedDetail>[] = [];
  const clicks = vi.fn();
  document.addEventListener("wt-master-key-used", (event) =>
    seen.push(event as CustomEvent<MasterKeyUsedDetail>),
  );
  document.addEventListener("click", clicks);
  try {
    await userEvent.click(part(el, "download")!);
  } finally {
    document.removeEventListener("click", clicks);
  }
  expect(seen).toHaveLength(1);
  expect(seen[0]!.detail).toEqual({ action: "download" });
  expect(seen[0]!.bubbles).toBe(true);
  expect(seen[0]!.composed).toBe(true);
  expect(clicks).not.toHaveBeenCalled();
});

test.each(["print", "copy"])("a press on %s does not travel past the box", async (name) => {
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const { el } = await box();
  const clicks = vi.fn();
  host.addEventListener("click", clicks);
  await userEvent.click(part(el, name)!);
  expect(clicks).not.toHaveBeenCalled();
});

test("paints the box, the key and what it says from tokens", async () => {
  vi.spyOn(navigator.clipboard, "writeText")
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  const { el } = await box();
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-success", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-color-danger", "rgb(16, 17, 18)");
  host.style.setProperty("--wt-font-family-mono", "monospace");
  host.style.setProperty("--wt-font-size-lg", "23px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-space-3", "13px");
  host.style.setProperty("--wt-space-4", "17px");
  host.style.setProperty("--wt-space-2", "7px");
  host.style.setProperty("--wt-radius-md", "5px");
  const frame = getComputedStyle(el.shadowRoot!.querySelector(".master-key")!);
  expect(frame.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(frame.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(frame.paddingTop).toBe("13px");
  expect(frame.paddingLeft).toBe("17px");
  expect(frame.marginTop).toBe("13px");
  expect(frame.borderTopLeftRadius).toBe("5px");
  const name = getComputedStyle(part(el, "master-key-name")!);
  expect(name.color).toBe("rgb(7, 8, 9)");
  expect(name.fontSize).toBe("11px");
  const key = getComputedStyle(part(el, "master-key")!);
  expect(key.color).toBe("rgb(10, 11, 12)");
  expect(key.fontFamily).toBe("monospace");
  expect(key.fontSize).toBe("23px");
  expect(key.display).toBe("block");
  const actions = getComputedStyle(el.shadowRoot!.querySelector(".actions")!);
  expect(actions.columnGap).toBe("7px");
  expect(actions.marginTop).toBe("13px");
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copied")).not.toBeNull());
  expect(getComputedStyle(part(el, "copied")!).color).toBe("rgb(13, 14, 15)");
  await userEvent.click(part(el, "copy")!);
  await vi.waitFor(() => expect(part(el, "copy-failed")).not.toBeNull());
  expect(getComputedStyle(part(el, "copy-failed")!).color).toBe("rgb(16, 17, 18)");
});
