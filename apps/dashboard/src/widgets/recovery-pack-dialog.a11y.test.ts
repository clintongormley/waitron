import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtDialog } from "@waitron/ui";
import type { DashboardApi, RecoveryPackStatus } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { RecoveryPackDialog } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: { number: 3, madeAt: "2026-10-12T12:00:00.000Z", holdsCurrentServerKey: true },
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  masterKey: null,
  keepOldPackUntil: "2026-11-11T12:00:00.000Z",
  serverKey: "set",
  timeZone: "Europe/Madrid",
};

type State =
  "empty" | "master key" | "busy" | "refused" | "lost" | "key failed" | "key shown" | "key copied";

function makeFor(state: State) {
  if (state === "busy") return vi.fn(() => new Promise(() => undefined));
  if (state === "refused")
    return vi.fn().mockRejectedValue({ code: "password.throttled", status: 429 });
  if (state === "lost") return vi.fn().mockRejectedValue({ code: "connection.failed" });
  if (state === "key shown" || state === "key copied")
    return vi.fn().mockResolvedValue({
      pdf: new Blob(["%PDF"], { type: "application/pdf" }),
      number: 4,
      key: "replaced",
      madeAt: "2026-11-23T09:00:00.000Z",
      masterKey: { key: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5", name: "2026-11-23 · QZJV" },
    });
  return vi.fn().mockResolvedValue({
    pdf: new Blob(["%PDF"], { type: "application/pdf" }),
    number: 4,
    key: "failed",
    madeAt: "2026-10-30T09:00:00.000Z",
  });
}

const STATES: State[] = [
  "empty",
  "master key",
  "busy",
  "refused",
  "lost",
  "key failed",
  "key shown",
  "key copied",
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
      markRecoveryPackReceived: vi.fn().mockResolvedValue(undefined),
      getRecoveryPackStatus: vi.fn().mockResolvedValue(STATUS),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<RecoveryPackDialog>(
      "dashboard-recovery-pack-dialog",
      { api },
      theme,
    );
    el.show(STATUS, state === "empty" ? "pack" : "master-key");
    await el.updateComplete;
    const root = el.shadowRoot!;
    const dialog = root.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const make = () => root.querySelector<HTMLElement>("wt-button[data-test=make-pack]")!.click();
    if (state !== "empty" && state !== "master key") make();
    if (state === "busy") await expect.poll(() => api.makeRecoveryPack).toHaveBeenCalled();
    if (state === "refused")
      await expect.poll(() => root.querySelector("wt-form-actions")!.error).not.toBe("");
    if (state === "lost")
      await expect.poll(() => root.querySelector("[data-test=lost]")).toBeTruthy();
    if (state === "key failed")
      await expect.poll(() => root.querySelector("[data-test=key-failed]")).toBeTruthy();
    if (state === "key shown" || state === "key copied")
      await expect.poll(() => root.querySelector("[data-test=master-key]")).toBeTruthy();
    if (state === "key copied") {
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      root.querySelector<HTMLElement>("wt-button[data-test=key-copy]")!.click();
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
