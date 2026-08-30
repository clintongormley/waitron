import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

const q = (el: SetupReviewScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: SetupReviewScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** A fully-populated draft carrying the four secret values the review must NEVER render. */
const SAMPLE_PIN = "9137";
const SAMPLE_PASSWORD = "s3cr3t-operator-pw";
const SAMPLE_PASSPHRASE = "pfx-unlock-2026";
const SAMPLE_PFX = "AAAABBBBCCCCDDDD";

function fullDraft(): DeepPartial<ProvisionBody> {
  return {
    mode: "live",
    venue: {
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli del Sol SL",
      location: {
        name: "Calle Mayor",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        timeZone: "Europe/Madrid",
      },
      seriesCode: "FA",
      rectificativeSeriesCode: "RF",
      admin: {
        displayName: "Alba",
        email: "alba@example.com",
        pin: SAMPLE_PIN,
        password: SAMPLE_PASSWORD,
      },
    },
    aeatCert: { pfxBase64: SAMPLE_PFX, passphrase: SAMPLE_PASSPHRASE, certKind: "sello" },
  };
}

afterEach(cleanupWidgets);

describe("setup-review-screen", () => {
  it("summarises the non-secret draft fields", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "[data-test=summary-mode]")).toBe("live");
    expect(text(el, "[data-test=summary-country]")).toBe("ES");
    expect(text(el, "[data-test=summary-taxId]")).toBe("B12345678");
    expect(text(el, "[data-test=summary-legalName]")).toBe("Deli del Sol SL");
    expect(text(el, "[data-test=summary-location]")).toBe("Calle Mayor");
    expect(text(el, "[data-test=summary-seriesCode]")).toBe("FA");
    expect(text(el, "[data-test=summary-rectificativeSeriesCode]")).toBe("RF");
    expect(text(el, "[data-test=summary-admin]")).toBe("Alba");
    expect(text(el, "[data-test=summary-admin-email]")).toBe("alba@example.com");
  });

  it("shows the certificate as attached, and NEVER renders any secret value", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "[data-test=summary-cert]")).toBe("attached");
    // The whole rendered surface must not leak the PIN, password, passphrase or PFX bytes.
    const rendered = el.shadowRoot!.textContent ?? "";
    expect(rendered).not.toContain(SAMPLE_PIN);
    expect(rendered).not.toContain(SAMPLE_PASSWORD);
    expect(rendered).not.toContain(SAMPLE_PASSPHRASE);
    expect(rendered).not.toContain(SAMPLE_PFX);
  });

  it("shows the certificate as not attached when no aeatCert is present", async () => {
    const draft = fullDraft();
    delete draft.aeatCert;
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
    expect(text(el, "[data-test=summary-cert]")).toBe("not attached");
  });

  it("treats an aeatCert with an empty pfxBase64 as not attached", async () => {
    const draft = fullDraft();
    draft.aeatCert = { pfxBase64: "", passphrase: "", certKind: "sello" };
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
    expect(text(el, "[data-test=summary-cert]")).toBe("not attached");
  });

  it("renders a dash for every field still missing from a bare draft", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft: {} });
    expect(text(el, "[data-test=summary-mode]")).toBe("—");
    expect(text(el, "[data-test=summary-country]")).toBe("—");
    expect(text(el, "[data-test=summary-location]")).toBe("—");
    expect(text(el, "[data-test=summary-admin]")).toBe("—");
    expect(text(el, "[data-test=summary-admin-email]")).toBe("—");
    expect(text(el, "[data-test=summary-cert]")).toBe("not attached");
  });

  it("emits provision-requested (composed) when Provision is clicked", async () => {
    const { el, host } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    const requested = new Promise<boolean>((resolve) =>
      host.addEventListener("provision-requested", () => resolve(true)),
    );
    q(el, "[data-test=provision]")!.click();
    expect(await requested).toBe(true);
  });

  it("shows no error banner by default, and the routed-back server error when errorMessage is set", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(q(el, "[data-test=error]")).toBeNull();

    const withError = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
      errorMessage: "The box rejected the details (field: taxId). Check your entries.",
    });
    const banner = withError.el.shadowRoot!.querySelector<HTMLElement>("[data-test=error]")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("taxId");
  });

  it("steps back via setup-goto", async () => {
    const { el, host } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    const goto = new Promise<unknown>((resolve) =>
      host.addEventListener("setup-goto", (e) => resolve((e as CustomEvent).detail)),
    );
    q(el, "[data-test=back]")!.click();
    expect(await goto).toEqual({ screen: "venue" });
  });
});
