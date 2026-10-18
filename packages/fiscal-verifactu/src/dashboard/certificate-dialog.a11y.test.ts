import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "lit";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { CertificateCardView, InstallAnswerView } from "./client.js";
import type { AeatCertificateCard } from "./certificate-card.js";
import type { AeatCertificateDialog } from "./certificate-dialog.js";

const card: CertificateCardView = {
  filing: true,
  revision: "rev-1",
  timeZone: "Europe/Madrid",
  installed: {
    kind: "representante",
    organisation: "BAR LUCÍA S.L.",
    taxId: "B12345678",
    taxIdMatches: true,
    issuer: "AC Representación (FNMT-RCM)",
    validFrom: "2025-10-03T08:00:00.000Z",
    validUntil: "2027-10-03T08:00:00.000Z",
    daysLeft: 350,
    stage: null,
    installedAt: "2025-11-14T09:12:00.000Z",
    source: "setup",
    installedByName: null,
    lastAcceptedAt: null,
  },
};

let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  render(null, host);
  cleanup();
  setLocale(locale);
});

async function open(
  theme: "light" | "dark",
  install: () => Promise<InstallAnswerView> = () => new Promise(() => {}),
) {
  await mountThemed("<div></div>", theme);
  const request = vi.fn((_path: string, method: string) =>
    method === "GET" ? Promise.resolve(card) : install(),
  );
  const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: request as unknown as DashboardRequest,
  });
  render(handle.render(false), host);
  const el = host.querySelector("dashboard-aeat-certificate-card") as AeatCertificateCard;
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("[data-test=certificate-action]")).not.toBeNull(),
  );
  await userEvent.click(el.shadowRoot!.querySelector("[data-test=certificate-action]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).not.toBeNull(),
  );
  const dialog = el.shadowRoot!.querySelector(
    "dashboard-aeat-certificate-dialog",
  ) as AeatCertificateDialog;
  await dialog.updateComplete;
  return dialog;
}

const q = <T extends Element = HTMLElement>(dialog: AeatCertificateDialog, selector: string) =>
  dialog.shadowRoot!.querySelector<T>(selector)!;

async function fill(dialog: AeatCertificateDialog) {
  const input = q(dialog, "wt-file-input").shadowRoot!.querySelector<HTMLInputElement>("input")!;
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array([0x30, 0x82, 0x0d])], "bar-lucia-2026.p12"));
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await dialog.updateComplete;
  q(dialog, "wt-input").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "secret" }, bubbles: true, composed: true }),
  );
  await dialog.updateComplete;
}

async function save(dialog: AeatCertificateDialog) {
  await userEvent.click(q(dialog, "[data-test=certificate-save]"));
  await dialog.updateComplete;
}

describe.each(["light", "dark"] as const)("AEAT certificate dialog accessibility (%s)", (theme) => {
  test("empty", async () => {
    const dialog = await open(theme);
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(dialog, "[data-test=certificate-save]").disabled,
    ).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("filled", async () => {
    const dialog = await open(theme);
    await fill(dialog);
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(dialog, "[data-test=certificate-save]").variant,
    ).toBe("primary");
    await expectNoA11yViolations(host);
  });

  test("checking with AEAT", async () => {
    const dialog = await open(theme);
    await fill(dialog);
    await save(dialog);
    await vi.waitFor(() =>
      expect(q(dialog, "[data-test=certificate-save]").textContent?.trim()).toBe(
        "Checking with AEAT…",
      ),
    );
    await expectNoA11yViolations(host);
  });

  test("a refusal under a field", async () => {
    const dialog = await open(theme, async () => ({
      outcome: "refused",
      reason: "passphrase_wrong",
      field: "passphrase",
    }));
    await fill(dialog);
    await save(dialog);
    await vi.waitFor(() =>
      expect(q<HTMLElementTagNameMap["wt-input"]>(dialog, "wt-input").error).toBe(
        "This passphrase does not open the file.",
      ),
    );
    await dialog.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("a refusal at the bottom", async () => {
    const dialog = await open(theme, async () => ({ outcome: "refused", reason: "check_failed" }));
    await fill(dialog);
    await save(dialog);
    await vi.waitFor(() =>
      expect(
        q<HTMLElementTagNameMap["wt-form-actions"]>(dialog, "wt-form-actions").error,
      ).toContain("The check with AEAT failed"),
    );
    await dialog.updateComplete;
    await expectNoA11yViolations(host);
  });
});
