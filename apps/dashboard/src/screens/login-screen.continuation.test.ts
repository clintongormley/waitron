import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import { LoginScreen } from "./login-screen.js";

const originalLocale = currentLocale();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en-GB");
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale(originalLocale);
});

it.each(["password", "totp", "recovery"] as const)(
  "tracks submitted %s authentication before settlement and suppresses only the passkey offer",
  async (factor) => {
    const submitted: Promise<unknown>[] = [];
    const logins: unknown[] = [];
    const api = {
      getGoogleConfig: async () => ({ configured: false }),
      login: vi.fn(async (body: unknown) => {
        logins.push(body);
        if (factor !== "password" && logins.length === 1) throw { code: "totp.required" };
        return { personId: "p2", offerPasskey: true };
      }),
      passkeyOfferSeen: vi.fn(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api,
      continuation: true,
      authenticationSubmitted: (promise) => submitted.push(promise),
    });
    const logged = vi.fn();
    el.addEventListener("logged-in", logged);
    async function enter(name: string, value: string) {
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[name=${name}]`,
      )!;
      await field.updateComplete;
      await userEvent.fill(field.shadowRoot!.querySelector("input")!, value);
      await el.updateComplete;
    }
    await enter("email", "manager@example.test");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await el.updateComplete;
    await enter("password", "synthetic-secret-839");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect(submitted).toHaveLength(1);
    if (factor !== "password") {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[name=one-time-code]")).not.toBeNull(),
      );
      if (factor === "recovery") {
        const link = [...el.shadowRoot!.querySelectorAll("a")].find((a) =>
          a.textContent?.includes("recovery code"),
        )!;
        link.click();
        await el.updateComplete;
      }
      await enter("one-time-code", factor === "totp" ? "123456" : "synthetic-recovery");
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]")!.click();
      expect(submitted).toHaveLength(2);
    }
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
    expect(api.passkeyOfferSeen).not.toHaveBeenCalled();
    expect(logins.at(-1)).toEqual({
      email: "manager@example.test",
      password: "synthetic-secret-839",
      ...(factor === "password"
        ? {}
        : factor === "totp"
          ? { totp: "123456" }
          : { recoveryCode: "synthetic-recovery" }),
    });
  },
);
