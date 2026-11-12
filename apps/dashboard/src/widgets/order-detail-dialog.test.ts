import { getCountryPack } from "@waitron/country-packs";
import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { allergenLabel } from "../i18n/domain.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { DashboardApi, OrderDetailDto } from "../api/client.js";
import "./order-detail-dialog.js";
import type { OrderDetailDialog } from "./order-detail-dialog.js";

const detail: OrderDetailDto = {
  row: {
    kind: "bill",
    id: "bill-1",
    at: "2026-09-30T12:00:00Z",
    orderNumber: 12,
    label: null,
    partyId: "party-1",
    partyName: "Rosa",
    tables: ["Table 5"],
    counter: false,
    saleId: "sale-1",
    invoiceNumber: "A/12",
    invoiceType: "F2",
    creditNotes: ["R/2"],
    status: "left_without_paying",
    credited: "in_part",
    total: "30.00",
    stillOwed: "15.00",
    staff: [],
    departedAt: "2026-09-30T13:00:00Z",
  },
  lines: [
    {
      lineNo: 1,
      name: "Soup",
      variantName: "Large",
      quantity: "1.000",
      total: "10.00",
      listUnitPrice: "12.00",
      creditedTo: "Ana",
      sentNutrition: null,
      sent: true,
    },
  ],
  invoices: [
    {
      kind: "invoice",
      number: "A/12",
      issuedAt: "2026-09-30T12:30:00Z",
      total: "30.00",
      rungBy: "Luis",
    },
    {
      kind: "credit_note",
      number: "R/2",
      issuedAt: "2026-09-30T13:30:00Z",
      total: "-15.00",
      rungBy: "Luis",
    },
  ],
  tenders: [{ method: "cash", amount: "10.00", tip: "1.00" }],
  payments: [
    {
      method: "card",
      state: "received",
      applied: "5.00",
      tip: "0.00",
      createdAt: "2026-09-30T12:15:00Z",
      refunds: [
        {
          applied: "2.00",
          tip: "0.00",
          state: "received",
          reason: "Wrong card",
          createdAt: "2026-09-30T12:20:00Z",
        },
      ],
    },
  ],
  party: {
    name: "Rosa",
    guestCount: 2,
    openedAt: "2026-09-30T12:00:00Z",
    closedAt: "2026-09-30T14:00:00Z",
    openedBy: "Ana",
    closedBy: "Luis",
    tables: ["Table 5"],
  },
  departure: {
    recordedAt: "2026-09-30T13:00:00Z",
    reason: "Forgot wallet",
    recordedBy: "Ana",
    authorizedBy: "Luis",
    amount: "30.00",
  },
  reprints: [
    {
      requestedAt: "2026-09-30T15:00:00Z",
      personId: "laura",
      personName: "Laura",
      printerName: "Bar printer",
    },
  ],
  deliveries: null,
  invoicePdfDownloads: [],
};

afterEach(() => {
  cleanupWidgets();
  setLocale(receivedLocale);
});

it("shows the bill's items, invoices, payments, party, departure and copies", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockResolvedValue(detail),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  const words = el.shadowRoot!.textContent!;
  for (const value of [
    "Soup (Large)",
    "Ana",
    "A/12",
    "R/2",
    "Cash",
    "Wrong card",
    "Rosa",
    "Table 5",
    "Forgot wallet",
    "Luis",
    "Laura",
    "Bar printer",
  ])
    expect(words).toContain(value);
  expect(api.getOrder).toHaveBeenCalledWith("bill-1");
});

it.each(["en-GB", "es-ES"])(
  "shows saved declarations and their review state in %s",
  async (locale) => {
    setLocale(locale);
    const snapshots = [
      {
        allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
        dietaryDeclarations: ["vegetarian"],
      },
      { allergens: {}, dietaryDeclarations: [] },
      { allergens: null, dietaryDeclarations: ["vegan"] },
      null,
    ];
    const api = {
      getOrder: vi.fn().mockResolvedValue({
        ...detail,
        lines: snapshots.map((sentNutrition, at) => ({
          ...detail.lines[0]!,
          lineNo: at + 1,
          sentNutrition,
        })),
      }),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
      api,
      orderId: "bill-1",
    });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
    const nutrition = [...el.shadowRoot!.querySelectorAll("[data-sent-nutrition]")].map(
      (node) => node.textContent!,
    );
    expect(nutrition).toHaveLength(4);
    expect(nutrition[0]).toContain(t("orders.detail.recorded_when_sent"));
    expect(nutrition[0]).toContain(allergenLabel("gluten", { kinds: ["wheat"] }));
    expect(nutrition[0]).toContain(allergenLabel("milk", {}));
    expect(nutrition[0]).toContain(t("editor.diet.vegetarian"));
    expect(nutrition[1]).toContain(t("editor.nutrition.contains_none"));
    expect(nutrition[2]).toContain(t("editor.allergens_unreviewed"));
    expect(nutrition[2]).toContain(t("editor.diet.vegan"));
    expect(nutrition[3]).toContain(t("orders.detail.sent_not_recorded"));
    expect(nutrition[3]).not.toContain(t("orders.detail.recorded_when_sent"));
    const body = el
      .shadowRoot!.querySelector("wt-dialog")!
      .shadowRoot!.querySelector<HTMLElement>(".body")!;
    await vi.waitFor(() =>
      expect(body.tabIndex).toBe(body.scrollHeight > body.clientHeight ? 0 : -1),
    );
    await expectNoA11yViolations(host);
  },
);

it("keeps the historical declaration block off an unsent line", async () => {
  const api = {
    getOrder: vi
      .fn()
      .mockResolvedValue({ ...detail, lines: [{ ...detail.lines[0]!, sent: false }] }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.querySelector("[data-sent-nutrition]")).toBeNull();
});

it("names a deferred closure as still to be paid, with no card and no tip", async () => {
  setLocale("en-GB");
  const closed = {
    ...detail,
    row: { ...detail.row, status: "deferred_payment" as const, stillOwed: null },
    tenders: [{ method: "deferred", amount: "30.00", tip: "0.00" }],
    payments: [],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(closed),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  const payments = [...el.shadowRoot!.querySelectorAll("section")].find(
    (section) => section.querySelector("h3")?.textContent === "Payments",
  )!;
  const words = payments.textContent!.replace(/\s+/g, " ").trim();
  expect(words).toContain("Deferred payment");
  expect(words).not.toContain("Card");
  expect(words).not.toContain("Tip");
});

it.each([
  ["en-GB", "Full invoice", "Customer"],
  ["es-ES", "Factura completa", "Cliente"],
])("shows a filed F1's saved recipient in %s", async (locale, label, customer) => {
  setLocale(locale);
  const filed = {
    ...detail,
    invoices: [
      {
        ...detail.invoices[0]!,
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Mary Sample",
          countryCode: "ES",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        },
      },
    ],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(filed),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("A/12"));
  const words = el.shadowRoot!.textContent!;
  for (const value of [
    label,
    customer,
    "Mary Sample",
    "12345678Z",
    "Calle Mayor 2, 28013 Madrid, Madrid, España",
  ])
    expect(words).toContain(value);
});

it.each([
  ["en-GB", "Issuer address"],
  ["es-ES", "Domicilio fiscal del emisor"],
])("shows a filed F1's saved taxpayer domicile in %s", async (locale, label) => {
  setLocale(locale);
  const filed = {
    ...detail,
    invoices: [
      {
        ...detail.invoices[0]!,
        invoiceType: "F1" as const,
        taxpayerDomicile: "Calle Fiscal 8, 28014 Madrid, Madrid, España",
      },
    ],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(filed),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("A/12"));
  expect(el.shadowRoot!.textContent).toContain(label);
  expect(el.shadowRoot!.textContent).toContain("Calle Fiscal 8, 28014 Madrid, Madrid, España");
});

it("explains when a bill outside the session's scope cannot be opened", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "old-bill",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("That bill was not found"));
});

it("shows the old unit price only when it differs from the charged price", async () => {
  setLocale("en-GB");
  const same = { ...detail, lines: [{ ...detail.lines[0]!, listUnitPrice: "10.00" }] };
  const api = {
    getOrder: vi.fn().mockResolvedValue(same),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.textContent).not.toContain("was €10.00");
});

it("explains payment states and an unnamed party in Spanish", async () => {
  setLocale("es-ES");
  const translated = {
    ...detail,
    party: { ...detail.party!, name: null },
    payments: [
      {
        ...detail.payments[0]!,
        refunds: [{ ...detail.payments[0]!.refunds[0]!, state: "completed" }],
      },
    ],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(translated),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  const words = el.shadowRoot!.textContent!;
  for (const value of [
    "Tarjeta",
    "Pago recibido",
    "Devolución completada",
    "Grupo sin nombre",
    "Comensales: 2",
    "por Luis",
  ])
    expect(words).toContain(value);
  expect(words).not.toContain(" · received");
});

it("clears a failed load's message once the server answers again", async () => {
  setLocale("en-GB");
  const liveData = new LiveData();
  const getOrder = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const api = { getOrder, liveData } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  getOrder.mockResolvedValue(detail);
  liveData.refresh();
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("uses the localised quantity display in Spanish", async () => {
  setLocale("es-ES");
  const api = {
    getOrder: vi
      .fn()
      .mockResolvedValue({ ...detail, lines: [{ ...detail.lines[0]!, quantity: "0.500" }] }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("section:first-of-type li")?.textContent).toContain(
      "× 0,5 —",
    ),
  );
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`identifies each recorded Single variant in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        try {
          setLocale(locale);
          const saved = {
            ...detail,
            lines: ["Seagrams Gin", "London Gin"].map((name, index) => ({
              ...detail.lines[0]!,
              lineNo: index + 1,
              name,
              variantName: "Single",
            })),
          };
          const api = {
            getOrder: async () => saved,
            liveData: new LiveData(),
          } as unknown as DashboardApi;
          const { el, host } = await mountWidget<OrderDetailDialog>(
            "dashboard-order-detail-dialog",
            { api, orderId: "bill-1", mayReprint: () => true },
            theme,
          );
          await vi.waitFor(() =>
            expect(el.shadowRoot!.textContent).toContain("Seagrams Gin (Single)"),
          );
          expect(el.shadowRoot!.textContent).toContain("London Gin (Single)");
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a357/order-detail-${locale}-${theme}-${width}.png`,
          });
        } finally {
          await page.viewport(1280, 768);
        }
      });
    }
  }
}

it("shows a name holding another placeholder or a replacement pattern as it is", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockResolvedValue({
      ...detail,
      party: { ...detail.party!, openedBy: "{closed} $& $1" },
    }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.textContent).toMatch(/by \{closed\} \$& \$1; closed \S/);
});

it("shows a departure reason holding a later placeholder or a replacement pattern as it is", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockResolvedValue({
      ...detail,
      departure: { ...detail.departure!, reason: "{recorder} $& $1" },
    }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.textContent).toContain(
    ": {recorder} $& $1. Recorded by Ana, authorised by Luis.",
  );
});

it("shows a reprinting person's name holding a later placeholder as it is", async () => {
  setLocale("en-GB");
  const api = {
    getOrder: vi.fn().mockResolvedValue({
      ...detail,
      reprints: [{ ...detail.reprints[0]!, personName: "Person {printer}" }],
    }),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
    mayReprint: () => true,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Soup"));
  expect(el.shadowRoot!.textContent).toContain("copy printed by Person {printer} on Bar printer");
});

it.each(["en-GB", "es-ES"])(
  "shows the separate recipient country on the %s detail screen",
  async (locale) => {
    setLocale(locale);
    const filed = {
      ...detail,
      invoices: [
        {
          ...detail.invoices[0]!,
          invoiceType: "F1",
          recipient: {
            taxId: "B12345674",
            legalName: "Customer Ltd",
            countryCode: "ES",
            address: "2 Main Street, 28013 Madrid, Madrid",
          },
        },
      ],
    };
    const api = {
      getOrder: vi.fn().mockResolvedValue(filed),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
      api,
      orderId: "bill-1",
    });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Customer Ltd"));
    expect(el.shadowRoot!.textContent).toContain(getCountryPack("ES")!.countryNames![locale]!);
    expect(el.shadowRoot!.textContent).toContain("2 Main Street, 28013 Madrid, Madrid");
  },
);

it.each(["en-GB", "es-ES"])(
  "shows a French snapshot country in the %s screen language",
  async (locale) => {
    setLocale(locale);
    const filed = {
      ...detail,
      invoices: [
        {
          ...detail.invoices[0]!,
          invoiceType: "F1",
          recipient: {
            taxId: "Passport 123",
            legalName: "Alex Guest",
            countryCode: "FR",
            address: "2 Main Street, Paris",
          },
        },
      ],
    };
    const api = {
      getOrder: vi.fn().mockResolvedValue(filed),
      liveData: new LiveData(),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
      api,
      orderId: "bill-1",
    });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Alex Guest"));
    expect(el.shadowRoot!.textContent).toContain(
      new Intl.DisplayNames([locale], { type: "region" }).of("FR")!,
    );
    expect(el.shadowRoot!.textContent).toContain("2 Main Street, Paris");
  },
);

it.each([
  ["en-GB", "Passport"],
  ["es-ES", "Pasaporte"],
])("labels a foreign identifier using screen language %s", async (locale, label) => {
  setLocale(locale);
  const filed = {
    ...detail,
    invoices: [
      {
        ...detail.invoices[0]!,
        invoiceType: "F1",
        recipient: {
          taxId: " Ab-09 /xy ",
          identifierType: "passport",
          identifierCountryCode: "FR",
          legalName: "Guest",
          countryCode: "ES",
          address: "2 Main Street, Madrid",
        },
      },
    ],
  };
  const api = {
    getOrder: vi.fn().mockResolvedValue(filed),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<OrderDetailDialog>("dashboard-order-detail-dialog", {
    api,
    orderId: "bill-1",
  });
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(`${label}:  Ab-09 /xy `));
});

const receivedLocale = currentLocale();
