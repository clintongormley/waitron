import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { RecoveryPackReading, WtMasterKeyInput } from "./wt-master-key-input.js";
import "./wt-master-key-input.js";
import "./wt-help-tooltip.js";
import { setHelpMode } from "../help-mode.js";
import { cameraFilming } from "../../test/qr-camera.js";

let filming: { stop: () => void } | undefined;

afterEach(() => {
  cleanup();
  setHelpMode(false);
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const KEY_NAME = "2026-11-23 · QZJV";
const COPY = {
  label: "Master key",
  button: "Choose the recovery pack PDF",
  visibility: {
    show: "Show key",
    hide: "Hide key",
    shown: "Key shown",
    hidden: "Key hidden",
  },
  loaded: "Key loaded",
  notPack: "This PDF is not a recovery pack.",
  damaged: "This recovery pack PDF is damaged. Type the key or scan it.",
  damagedNoScan: "This recovery pack PDF is damaged. Type the key.",
  notWhole: "Not a whole master key. Check it against the recovery pack.",
  wrongKey: (name: string) => `Wrong master key. Use the one dated ${name}.`,
  elsewhere: () => "This recovery pack does not hold the master key.",
  scan: "Scan the recovery pack",
  scanning: "Hold the master key's QR code up to the camera.",
  notKeyCode: "That is not the master key's QR code.",
  cameraFailed: "The camera did not start. Type the key or choose the PDF.",
  camera: "Camera",
  stopScan: "Stop scanning",
};

const BADGE =
  '<wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Master key">On the recovery pack.</wt-help-tooltip>';

async function field(
  theme: "light" | "dark",
  read: () => Promise<RecoveryPackReading> = async () => ({
    masterKey: KEY,
    masterKeyName: KEY_NAME,
    masterKeyHeldBy: null,
  }),
  badge = "",
): Promise<WtMasterKeyInput> {
  const el = (await mountThemed(
    `<wt-master-key-input required>${badge}</wt-master-key-input>`,
    theme,
  )) as WtMasterKeyInput;
  el.copy = COPY;
  el.keyName = KEY_NAME;
  el.readPack = async () => read;
  el.maxPdfBytes = 1024;
  await el.updateComplete;
  return el;
}

const inner = (el: WtMasterKeyInput) => el.shadowRoot!.querySelector("wt-input")!;

async function type(el: WtMasterKeyInput, text: string): Promise<void> {
  const input = inner(el).shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await inner(el).updateComplete;
}

async function toggle(name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

async function choose(el: WtMasterKeyInput, line: string): Promise<void> {
  const control = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer();
  transfer.items.add(new File(["%PDF-1.7"], "pack.pdf"));
  control.files = transfer.files;
  control.dispatchEvent(new Event("change"));
  await el.pdfRead;
  await el.updateComplete;
  await inner(el).updateComplete;
  expect(inner(el).error).toBe(line);
}

async function scan(el: WtMasterKeyInput): Promise<void> {
  await page.getByRole("button", { name: COPY.scan, exact: true }).click();
  await el.updateComplete;
}

const refusal = (reason: string) =>
  Object.assign(Object.assign(new Error(reason), { name: "RecoveryPackFileError" }), { reason });

describe.each(["light", "dark"] as const)("wt-master-key-input a11y (%s theme)", (theme) => {
  test("empty", async () => {
    await field(theme);
    await expectNoA11yViolations(host);
  });

  test("filled", async () => {
    const el = await field(theme);
    await type(el, KEY);
    await expectNoA11yViolations(host);
  });

  test("shown", async () => {
    const el = await field(theme);
    await type(el, KEY);
    await toggle(COPY.visibility.show);
    expect(inner(el).shadowRoot!.querySelector("input")!.type).toBe("text");
    await expectNoA11yViolations(host);
  });

  test("hidden again after it was shown", async () => {
    const el = await field(theme);
    await type(el, KEY);
    await toggle(COPY.visibility.show);
    await toggle(COPY.visibility.hide);
    expect(inner(el).shadowRoot!.querySelector("input")!.type).toBe("password");
    await expectNoA11yViolations(host);
  });

  test("not whole", async () => {
    const el = await field(theme);
    await type(el, `${KEY.slice(0, -1)}2`);
    expect(inner(el).error).toBe(COPY.notWhole);
    await expectNoA11yViolations(host);
  });

  test("loaded from a PDF", async () => {
    const el = await field(theme);
    await choose(el, "");
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe(COPY.loaded);
    await expectNoA11yViolations(host);
  });

  test("not a pack", async () => {
    const el = await field(theme, () => Promise.reject(refusal("not_a_pack")));
    await choose(el, COPY.notPack);
    await expectNoA11yViolations(host);
  });

  test("damaged", async () => {
    const el = await field(theme, () => Promise.reject(refusal("digest")));
    await choose(el, COPY.damaged);
    await expectNoA11yViolations(host);
  });

  test("wrong key", async () => {
    const el = await field(theme, async () => ({
      masterKey: KEY,
      masterKeyName: "2026-01-02 · AAAA",
      masterKeyHeldBy: null,
    }));
    await choose(el, COPY.wrongKey(KEY_NAME));
    await expectNoA11yViolations(host);
  });

  test("without the master key", async () => {
    const el = await field(theme, async () => ({
      masterKey: null,
      masterKeyName: null,
      masterKeyHeldBy: 2,
    }));
    await choose(el, COPY.elsewhere());
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help off", async () => {
    await field(theme, undefined, BADGE);
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    const el = await field(theme, undefined, BADGE);
    const badge = el.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });

  test("scanning", async () => {
    const camera = cameraFilming("https://cloud.waitron.example/start/abc");
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
    const el = await field(theme);
    await scan(el);
    const scanner = el.shadowRoot!.querySelector("wt-qr-scanner")!;
    await expect.poll(() => scanner.shadowRoot!.querySelector("video")).not.toBeNull();
    await expect
      .poll(
        () => scanner.shadowRoot!.querySelector("[data-scanner-message]")!.textContent!.trim(),
        {
          timeout: 10_000,
        },
      )
      .toBe(COPY.notKeyCode);
    await expectNoA11yViolations(host);
  });

  test("camera failed", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const el = await field(theme);
    await scan(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-camera-failed]")?.textContent?.trim())
      .toBe(COPY.cameraFailed);
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    const el = await field(theme);
    el.disabled = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
