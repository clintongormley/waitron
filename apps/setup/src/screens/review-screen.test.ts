import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { VENUE_SETUP_COUNTRY_PACKS } from "@waitron/country-packs";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

const q = (el: SetupReviewScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: SetupReviewScreen, sel: string) => q(el, sel)?.textContent?.trim();

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
        firstNames: "Alba",
        lastNames: "Ramos",
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

/** `fullDraft` with every row's value filled in, so no row shows a dash in place of a value. */
function everyRowDraft(mode: "demo" | "live"): DeepPartial<ProvisionBody> {
  const draft = fullDraft();
  draft.mode = mode;
  Object.assign(draft.venue!.location!, {
    operationDescription: "Venta en establecimiento",
    dayCutover: "04:00",
    addressLine1: "Calle Mayor 1",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
  });
  return draft;
}

const GROUP_EXPLANATIONS = {
  "en-GB": [
    "These details identify the legal business on invoices and tax records.",
    "These details describe the place where sales are made and receipts are issued.",
    "These settings control invoice numbering and the details printed on invoices.",
    "This account signs in to manage the venue after setup.",
  ],
  "es-ES": [
    "Estos datos identifican al negocio en las facturas y los registros fiscales.",
    "Estos datos describen el lugar donde se hacen las ventas y se emiten los recibos.",
    "Estos ajustes controlan la numeración y los datos que aparecen en las facturas.",
    "Con esta cuenta iniciarás sesión para gestionar el local después de configurarlo.",
  ],
} as const;

describe("setup-review-screen's explanations", () => {
  afterEach(() => setLocale("en-GB"));

  it.each(["demo", "live"] as const)("puts no help button anywhere (%s)", async (mode) => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: everyRowDraft(mode),
    });
    if (mode === "live") expect(q(el, "[data-test=summary-cert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("wt-help-tooltip")).toHaveLength(0);
  });

  it.each(["en-GB", "es-ES"] as const)(
    "shows each section's explanation as a muted line directly under its heading (%s)",
    async (locale) => {
      setLocale(locale);
      const { el, host } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
        draft: everyRowDraft("live"),
      });
      host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
      const groups = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group]")];
      expect(groups).toHaveLength(4);
      groups.forEach((group, index) => {
        const heading = group.querySelector("h2")!;
        expect(group.getAttribute("aria-labelledby")).toBe(heading.id);
        const header = heading.parentElement!;
        const line = header.nextElementSibling as HTMLElement;
        expect(line.tagName).toBe("P");
        expect(line.textContent?.trim()).toBe(GROUP_EXPLANATIONS[locale][index]);
        expect(line.checkVisibility()).toBe(true);
        expect(getComputedStyle(line).color).toBe("rgb(7, 8, 9)");
        const lineBox = line.getBoundingClientRect();
        expect(lineBox.top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom - 1);
        expect(lineBox.bottom).toBeLessThanOrEqual(
          group.querySelector("dl")!.getBoundingClientRect().top,
        );
      });
    },
  );

  it.each(["demo", "live"] as const)(
    "gives every row of a section the same height at 1280 px (%s)",
    async (mode) => {
      const original = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(1280, 800);
        const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
          draft: everyRowDraft(mode),
        });
        const heights: { label: string; height: number }[] = [];
        for (const dt of el.shadowRoot!.querySelectorAll<HTMLElement>("dt")) {
          const dd = dt.nextElementSibling as HTMLElement;
          // The certificate's value carries its own Edit button, which is taller than a line of text.
          if (dd.querySelector("[data-test=edit-cert]")) continue;
          const top = Math.min(dt.getBoundingClientRect().top, dd.getBoundingClientRect().top);
          const bottom = Math.max(
            dt.getBoundingClientRect().bottom,
            dd.getBoundingClientRect().bottom,
          );
          heights.push({ label: dt.textContent!.trim(), height: Math.round(bottom - top) });
        }
        expect(heights.length).toBeGreaterThanOrEqual(11);
        const shortest = Math.min(...heights.map(({ height }) => height));
        expect(heights.filter(({ height }) => height > shortest + 1)).toEqual([]);
      } finally {
        await page.viewport(original.width, original.height);
      }
    },
  );

  it("centres the certificate label beside its value and Edit button", async () => {
    const original = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(1280, 800);
      const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
        draft: everyRowDraft("live"),
      });
      const value = q(el, "[data-test=summary-cert]")!.closest("dd")!;
      const label = document.createRange();
      label.selectNodeContents(value.previousElementSibling!);
      const labelBox = label.getBoundingClientRect();
      const valueBox = value.getBoundingClientRect();
      expect(
        Math.abs((labelBox.top + labelBox.bottom) / 2 - (valueBox.top + valueBox.bottom) / 2),
      ).toBeLessThan(2);
    } finally {
      await page.viewport(original.width, original.height);
    }
  });
});

describe("setup-review-screen", () => {
  it("groups the summary by setup step and edits the collected details", async () => {
    const { el, host } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    const groups = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group]")];
    expect(groups.map((group) => group.getAttribute("data-group"))).toEqual([
      "business",
      "location",
      "invoicing",
      "account",
    ]);
    expect(groups.map((group) => group.querySelector("h2")?.textContent?.trim())).toEqual([
      "Business",
      "Location",
      "Invoicing",
      "Your account",
    ]);
    expect(q(el, "[data-test=summary-legalName]")!.closest("[data-group]")).toBe(groups[0]);
    expect(q(el, "[data-test=summary-invoiceLocales]")!.closest("[data-group]")).toBe(groups[1]);
    expect(q(el, "[data-test=summary-seriesCode]")!.closest("[data-group]")).toBe(groups[2]);
    expect(q(el, "[data-test=summary-admin-email]")!.closest("[data-group]")).toBe(groups[3]);
    const destinations: string[] = [];
    host.addEventListener("setup-goto", (event) =>
      destinations.push((event as CustomEvent<{ screen: string }>).detail.screen),
    );
    for (const group of groups) group.querySelector<HTMLElement>("[data-test=edit]")!.click();
    expect(destinations).toEqual(["venue", "venue", "venue", "admin"]);
    expect(groups[2].querySelector<HTMLElement>("[data-test=edit-cert]")).not.toBeNull();
    groups[2].querySelector<HTMLElement>("[data-test=edit-cert]")!.click();
    expect(destinations.at(-1)).toBe("cert");
  });

  it("shows a single mode badge with demo context and uses form actions", async () => {
    const draft = fullDraft();
    draft.mode = "demo";
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
    expect(text(el, "[data-test=mode-badge]")).toBe("Demo");
    expect(el.shadowRoot!.querySelectorAll("[data-test=demo-defaults]")).toHaveLength(1);
    expect(q(el, "[data-test=summary-mode]")).toBeNull();
    expect(q(el, "[data-test=summary-cert]")).toBeNull();
    const actions = q(el, "wt-form-actions")!;
    expect(actions.querySelector("[data-test=back]")!.getAttribute("slot")).toBe("cancel");
    expect(actions.querySelector("[data-test=provision]")).not.toBeNull();
  });

  it("names receipt languages and hides a display name identical to the account name", async () => {
    const draft = fullDraft();
    draft.venue!.location!.invoiceLocales = ["ca-ES", "es-ES"];
    draft.venue!.admin!.displayName = "Alba Ramos";
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
    expect(text(el, "[data-test=summary-invoiceLocales]")).toContain("Català");
    expect(text(el, "[data-test=summary-invoiceLocales]")).not.toContain("ca-ES");
    expect(q(el, "[data-test=summary-admin]")).toBeNull();
  });

  it("names every receipt language offered by the setup country packs", async () => {
    for (const pack of VENUE_SETUP_COUNTRY_PACKS) {
      const draft = fullDraft();
      draft.venue!.location!.invoiceLocales = [...pack.invoiceLocales];
      const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
      const shown = text(el, "[data-test=summary-invoiceLocales]")!;
      for (const locale of pack.invoiceLocales) expect(shown).not.toContain(locale);
    }
  });

  it("explains every group under its heading, and no row", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    const groupHelp = [
      "These details identify the legal business on invoices and tax records.",
      "These details describe the place where sales are made and receipts are issued.",
      "These settings control invoice numbering and the details printed on invoices.",
      "This account signs in to manage the venue after setup.",
    ];
    const groups = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group]");
    expect(
      [...groups].map((group) => group.querySelector(".group-header + p")?.textContent?.trim()),
    ).toEqual(groupHelp);
    const rowHelp = [
      ["summary-invoiceLocales", "Receipts use this language for their fixed words."],
      ["summary-dayCutover", "Sales after this time belong to the next business day."],
      ["summary-seriesCode", "Every invoice number starts with this: FS-000001, FS-000002…"],
      ["summary-rectificativeSeriesCode", "Credit notes use this separate numbering series."],
      [
        "summary-operationDescription",
        "This description appears on invoices for sales at this location.",
      ],
      [
        "summary-cert",
        "The certificate lets Waitron submit live invoice records to the tax agency.",
      ],
    ];
    for (const [field, explanation] of rowHelp) {
      const value = q(el, `[data-test=${field}]`)!;
      const label = value.closest("dd")?.previousElementSibling;
      expect(label?.querySelector("wt-help-tooltip")).toBeNull();
      expect(label?.textContent).not.toContain(explanation);
    }
  });

  it("names the country in the wizard's language", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
        draft: fullDraft(),
      });
      expect(text(el, "[data-test=summary-country]")).toBe("España");
    } finally {
      setLocale("en-GB");
    }
  });

  it("summarises the non-secret draft fields", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "[data-test=mode-badge]")).toBe("Live");
    expect(text(el, "[data-test=summary-country]")).toBe("Spain");
    expect(text(el, "[data-test=summary-taxId]")).toBe("B12345678");
    expect(text(el, "[data-test=summary-legalName]")).toBe("Deli del Sol SL");
    expect(text(el, "[data-test=summary-location]")).toBe("Calle Mayor");
    expect(text(el, "[data-test=summary-seriesCode]")).toBe("FA");
    expect(text(el, "[data-test=summary-rectificativeSeriesCode]")).toBe("RF");
    expect(text(el, "[data-test=summary-admin-name]")).toBe("Alba Ramos");
    expect(text(el, "[data-test=summary-admin]")).toBe("Alba");
    expect(text(el, "[data-test=summary-admin-email]")).toBe("alba@example.com");
  });

  it("shows the certificate as attached, and NEVER renders any secret value", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "[data-test=summary-cert]")).toBe("attached");
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

  it("renders missing fields as dashes and omits an unset display name", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft: {} });
    expect(text(el, "[data-test=mode-badge]")).toBe("—");
    expect(text(el, "[data-test=summary-country]")).toBe("—");
    expect(text(el, "[data-test=summary-location]")).toBe("—");
    expect(text(el, "[data-test=summary-admin-name]")).toBe("—");
    expect(q(el, "[data-test=summary-admin]")).toBeNull();
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
      errorMessage: "The server rejected the details (field: taxId). Check your entries.",
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

it("shows the generated demo choices and full location details for review", async () => {
  const draft = fullDraft();
  draft.mode = "demo";
  Object.assign(draft.venue!.location!, {
    operationDescription: "Venta en establecimiento",
    dayCutover: "04:00",
    addressLine1: "Calle Mayor 1",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
  });
  const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft });
  expect(text(el, "[data-test=demo-defaults]")).toContain("generated");
  expect(text(el, "[data-test=summary-operationDescription]")).toBe("Venta en establecimiento");
  expect(q(el, "[data-test=summary-tillName]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toMatch(/\btill\b/i);
  expect(text(el, "[data-test=summary-address]")).toContain("Calle Mayor 1");
  expect(text(el, "[data-test=summary-dayCutover]")).toBe("04:00");
});

describe("setup-review-screen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("shows its heading, labels, certificate state and buttons in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "h1")).toBe("Revisar y configurar");
    const labels = [...el.shadowRoot!.querySelectorAll("dt")].map((dt) =>
      dt.textContent?.replace(dt.querySelector("wt-help-tooltip")?.textContent ?? "", "").trim(),
    );
    expect(labels).toContain("Razón social");
    expect(labels).toContain("Serie de correcciones");
    expect(text(el, "[data-test=summary-cert]")).toBe("adjunto");
    expect(text(el, "[data-test=provision]")).toBe("Configurar este servidor");
    expect(text(el, "[data-test=back]")).toBe("Volver");
  });

  it("names each mode in Spanish, and shows an unknown mode as it came", async () => {
    setLocale("es-ES");
    const expected: Record<string, string> = {
      demo: "Demostración",
      prepare: "Preparación",
      live: "En vivo",
      someday: "someday",
    };
    for (const [mode, shown] of Object.entries(expected)) {
      const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
        draft: { ...fullDraft(), mode } as DeepPartial<ProvisionBody>,
      });
      expect(text(el, "[data-test=mode-badge]")).toBe(shown);
    }
  });

  it("redraws in Spanish when the language is switched while it is open", async () => {
    const { el } = await mountWidget<SetupReviewScreen>("setup-review-screen", {
      draft: fullDraft(),
    });
    expect(text(el, "h1")).toBe("Review and provision");
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(el, "h1")).toBe("Revisar y configurar");
    expect(text(el, "[data-test=summary-cert]")).toBe("adjunto");
  });
});
