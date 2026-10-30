import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtDialog } from "@waitron/ui";
import type { DashboardApi, OwnProfile, RecoveryPackStatus } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import type { RecoveryPackDialog } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const PROFILE: OwnProfile = {
  displayName: "Marta",
  firstNames: "Marta",
  lastNames: "López",
  telephone: null,
  email: "marta@example.test",
  pendingEmail: null,
  locale: null,
  hasPassword: true,
  hasTotp: true,
  hasGoogle: false,
  passkeys: [],
};

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: { number: 3, madeAt: "2026-10-12T12:00:00.000Z", holdsCurrentServerKey: true },
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
};

type State = "empty" | "invalid" | "busy" | "refused" | "lost" | "key failed";

function makeFor(state: State) {
  if (state === "busy") return vi.fn(() => new Promise(() => undefined));
  if (state === "refused")
    return vi.fn().mockRejectedValue({ code: "password.throttled", status: 429 });
  if (state === "lost") return vi.fn().mockRejectedValue({ code: "connection.failed" });
  return vi.fn().mockResolvedValue({
    pdf: new Blob(["%PDF"], { type: "application/pdf" }),
    number: 4,
    key: "failed",
  });
}

const STATES: State[] = ["empty", "invalid", "busy", "refused", "lost", "key failed"];

describe.each(["light", "dark"] as const)("recovery pack dialog accessibility (%s)", (theme) => {
  it.each(
    STATES.flatMap((state) => [
      { state, locale: "en-GB" },
      { state, locale: "es-ES" },
    ]),
  )("draws $state in $locale", async ({ state, locale }) => {
    setLocale(locale);
    const api = {
      getProfile: vi.fn().mockResolvedValue(PROFILE),
      recoveryPackPasskeyOptions: vi.fn(),
      makeRecoveryPack: makeFor(state),
      markRecoveryPackReceived: vi.fn().mockResolvedValue(undefined),
      getRecoveryPackStatus: vi.fn().mockResolvedValue(STATUS),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<RecoveryPackDialog>(
      "dashboard-recovery-pack-dialog",
      { api },
      theme,
    );
    el.show(STATUS);
    await el.updateComplete;
    const root = el.shadowRoot!;
    const dialog = root.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    await expect
      .poll(() => root.querySelector<FreshSignIn>("dashboard-fresh-sign-in")?.ways)
      .not.toBeNull();
    const signIn = root.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
    const make = () => root.querySelector<HTMLElement>("wt-button[data-test=make-pack]")!.click();
    if (state !== "empty") {
      if (state !== "invalid") {
        for (const [name, value] of [
          ["current-password", "hunter2-hunter2"],
          ["totp", "123456"],
        ])
          signIn
            .shadowRoot!.querySelector(`wt-input[name=${name}]`)!
            .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
        root.querySelector<HTMLInputElement>("input[name=new-server-key]")!.click();
      }
      await el.updateComplete;
      make();
    }
    if (state === "invalid") await expect.poll(() => signIn.invalid).toBe(true);
    if (state === "busy") await expect.poll(() => api.makeRecoveryPack).toHaveBeenCalled();
    if (state === "refused")
      await expect.poll(() => root.querySelector("wt-form-actions")!.error).not.toBe("");
    if (state === "lost")
      await expect.poll(() => root.querySelector("[data-test=lost]")).toBeTruthy();
    if (state === "key failed")
      await expect.poll(() => root.querySelector("[data-test=key-failed]")).toBeTruthy();
    await el.updateComplete;
    await signIn.updateComplete;
    for (const input of signIn.shadowRoot!.querySelectorAll("wt-input")) await input.updateComplete;
    await root.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  });
});
