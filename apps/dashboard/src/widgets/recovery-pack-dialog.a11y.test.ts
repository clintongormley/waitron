import { afterEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { encodeMasterKeyCode } from "@waitron/shared";
import type { WtDialog, WtMasterKeyInput } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import type { RecoveryPackStatus } from "../api/backup-api.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { RecoveryPackDialog } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: { number: 3, madeAt: "2026-10-12T12:00:00.000Z", holdsCurrentMasterKey: true },
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  masterKey: { name: "2026-10-12 · QZJV", pack: 3 },
  keepOldPackUntil: "2026-11-11T12:00:00.000Z",
  timeZone: "Europe/Madrid",
  backupKey: null,
};

type State =
  | "empty"
  | "typed"
  | "wrong key"
  | "rate limited"
  | "master key"
  | "busy"
  | "refused"
  | "lost"
  | "not kept"
  | "not known"
  | "key shown"
  | "key copied"
  | "key downloaded";

/** The states that draw Print the recovery pack; the rest draw Make a new master key. */
const PRINT: readonly State[] = ["empty", "typed", "wrong key", "rate limited"];

function makeFor(state: State) {
  if (state === "wrong key")
    return vi.fn().mockRejectedValue({
      code: "master_key.wrong",
      params: { keyName: "2026-10-12 · QZJV" },
      status: 403,
    });
  if (state === "rate limited")
    return vi.fn().mockRejectedValue({ code: "recovery.rate_limited", status: 429 });
  if (state === "busy") return vi.fn(() => new Promise(() => undefined));
  if (state === "refused")
    return vi.fn().mockRejectedValue({ code: "password.throttled", status: 429 });
  if (state === "lost") return vi.fn().mockRejectedValue({ code: "connection.failed" });
  return vi.fn().mockResolvedValue({
    pdf: new Blob(["%PDF"], { type: "application/pdf" }),
    number: 4,
    madeAt: "2026-11-23T09:00:00.000Z",
    masterKey: { key: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5", name: "2026-11-23 · QZJV" },
  });
}

const STATES: State[] = [
  "empty",
  "typed",
  "wrong key",
  "rate limited",
  "master key",
  "busy",
  "refused",
  "lost",
  "not kept",
  "not known",
  "key shown",
  "key copied",
  "key downloaded",
];

describe.each(["light", "dark"] as const)("recovery pack dialog accessibility (%s)", (theme) => {
  it.each(
    STATES.flatMap((state) => [
      { state, locale: "en-GB" },
      { state, locale: "es-ES" },
    ]),
  )("draws $state in $locale", async ({ state, locale }) => {
    setLocale(locale);
    const api = {
      makeRecoveryPack: makeFor(state),
      markRecoveryPackReceived: state.startsWith("not ")
        ? vi.fn().mockRejectedValue({ code: "connection.failed" })
        : vi.fn().mockResolvedValue(undefined),
      getRecoveryPackStatus: vi
        .fn()
        .mockResolvedValue(state === "not known" ? { ...STATUS, newKeyWaiting: true } : STATUS),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<RecoveryPackDialog>(
      "dashboard-recovery-pack-dialog",
      { api },
      theme,
    );
    el.show(STATUS, PRINT.includes(state) ? "pack" : "master-key");
    await el.updateComplete;
    const root = el.shadowRoot!;
    const dialog = root.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const keyField = () => root.querySelector<WtMasterKeyInput>("wt-master-key-input")!;
    if (PRINT.includes(state) && state !== "empty") {
      const input = keyField().shadowRoot!.querySelector<LitElement>("wt-input")!;
      await input.updateComplete;
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: encodeMasterKeyCode(new Uint8Array(16).fill(7)) },
          bubbles: true,
          composed: true,
        }),
      );
      await keyField().updateComplete;
      await el.updateComplete;
    }
    const button = () =>
      root.querySelector<HTMLElement & { disabled: boolean }>("wt-button[data-test=make-pack]")!;
    if (state === "typed") expect(button().disabled).toBe(false);
    const make = () => button().click();
    if (!["empty", "typed", "master key"].includes(state)) make();
    if (state === "wrong key") await expect.poll(() => keyField().error).not.toBe("");
    if (state === "busy") await expect.poll(() => api.makeRecoveryPack).toHaveBeenCalled();
    if (state === "refused" || state === "rate limited")
      await expect.poll(() => root.querySelector("wt-form-actions")!.error).not.toBe("");
    if (state === "lost")
      await expect.poll(() => root.querySelector("[data-test=lost]")).toBeTruthy();
    if (state === "not kept")
      await expect.poll(() => root.querySelector("[data-test=not-kept]")).toBeTruthy();
    if (state === "not known")
      await expect.poll(() => root.querySelector("[data-test=not-known]")).toBeTruthy();
    const box = () => root.querySelector("wt-master-key-box")?.shadowRoot ?? null;
    if (state.startsWith("key "))
      await expect.poll(() => box()?.querySelector("[data-test=master-key]")).toBeTruthy();
    if (state === "key copied") {
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      box()!.querySelector<HTMLElement>("wt-button[data-test=copy]")!.click();
      await expect.poll(() => box()!.querySelector("[data-test=copied]")).toBeTruthy();
    }
    if (state === "key downloaded") {
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      box()!.querySelector<HTMLElement>("wt-button[data-test=download]")!.click();
      await expect.poll(() => root.querySelector("wt-button[data-test=key-continue]")).toBeTruthy();
    }
    await el.updateComplete;
    await root.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")
      ?.updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  });
});
