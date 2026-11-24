import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { RecoveryPackReading, WtMasterKeyInput } from "./wt-master-key-input.js";
import "./wt-master-key-input.js";

afterEach(cleanup);

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const KEY_NAME = "2026-11-23 · QZJV";
const COPY = {
  label: "Master key",
  button: "Choose the recovery pack PDF",
  notPack: "This PDF is not a recovery pack.",
  damaged: "This recovery pack PDF is damaged. Type the key or scan it.",
  notWhole: "Not a whole master key. Check it against the recovery pack.",
  wrongKey: (name: string) => `Wrong master key. Use the one dated ${name}.`,
  elsewhere: () => "This recovery pack does not hold the master key.",
};

async function field(
  theme: "light" | "dark",
  read: () => Promise<RecoveryPackReading> = async () => ({
    masterKey: KEY,
    masterKeyName: KEY_NAME,
    masterKeyHeldBy: null,
  }),
): Promise<WtMasterKeyInput> {
  const el = (await mountThemed(
    "<wt-master-key-input required></wt-master-key-input>",
    theme,
  )) as WtMasterKeyInput;
  el.copy = COPY;
  el.keyName = KEY_NAME;
  el.readPack = async () => read;
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

async function choose(el: WtMasterKeyInput, line: string): Promise<void> {
  const control = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer();
  transfer.items.add(new File(["%PDF-1.7"], "pack.pdf"));
  control.files = transfer.files;
  control.dispatchEvent(new Event("change"));
  await vi.waitFor(async () => {
    await el.updateComplete;
    await inner(el).updateComplete;
    expect(inner(el).error).toBe(line);
  });
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

  test("not whole", async () => {
    const el = await field(theme);
    await type(el, `${KEY.slice(0, -1)}2`);
    expect(inner(el).error).toBe(COPY.notWhole);
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

  test("disabled", async () => {
    const el = await field(theme);
    el.disabled = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
