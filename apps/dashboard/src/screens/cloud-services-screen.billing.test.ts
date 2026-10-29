import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { DashboardApi } from "../api/client.js";
import { CloudServicesScreen } from "./cloud-services-screen.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  setLocale(locale);
  cleanupWidgets();
});

const ORIGIN = "https://cloud.example.test";
const connected = (overrides: Record<string, unknown> = {}) => ({
  state: "complete",
  configured: true,
  isPrimary: true,
  code: "",
  legalBusinessName: "Sol SL",
  accountUrl: `${ORIGIN}/account`,
  installation: {
    state: "active",
    revision: 1,
    lastContactAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    services: [],
  },
  ...overrides,
});
const PRICES = {
  status: "published",
  revision: 1,
  effectiveFrom: "2026-11-01",
  currency: "EUR",
  taxExclusive: true,
  vatRateBasisPoints: 2100,
  registeredMonthlyCents: 0,
  connectedMonthlyCents: 3000,
  hostedMonthlyCents: 9000,
  hostedDayDivisor: 30,
};
const TRIAL = {
  status: "ready",
  level: "connected",
  state: "trial",
  period: {
    kind: "trial",
    level: "connected",
    from: "2026-10-31",
    until: "2026-11-30",
    coversAsOf: true,
  },
};
const answer = (billing: unknown = TRIAL, prices: unknown = PRICES) => ({
  asOf: "2026-11-10T12:00:00.000Z",
  calendarTimeZone: "Europe/Madrid",
  billing,
  prices,
  accountUrl: `${ORIGIN}/account`,
});
const isBilling = (url: unknown) => String(url).endsWith("/management-api/cloud/billing");
const isStatus = (url: unknown) => String(url).endsWith("/management-api/cloud/status");

type Reply = Response | (() => Response | Promise<Response>);
function screenApi(status: Reply, billing: Reply) {
  const calls: string[] = [];
  const reply = (r: Reply) => (typeof r === "function" ? r() : r.clone());
  const api = new DashboardApi("", async (url) => {
    calls.push(String(url));
    return reply(isBilling(url) ? billing : status);
  });
  return { api, calls };
}
async function open(api: DashboardApi) {
  return mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", { api });
}
const section = (el: CloudServicesScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cloud-billing]");
const rows = (el: CloudServicesScreen) =>
  [...(section(el)?.querySelectorAll("dt") ?? [])].map((dt) => [
    dt.textContent!.trim(),
    (dt.nextElementSibling as HTMLElement).textContent!.replace(/\s+/g, " ").trim(),
  ]);

for (const [language, expected] of [
  [
    "en",
    {
      heading: "Plan and prices",
      rows: [
        ["Plan", "Connected"],
        ["Status", "Free trial"],
        ["Last trial day", "November 29, 2026"],
        ["Registered", "Free"],
        ["Connected", "€30.00 a month + 21% VAT"],
        ["Hosted", "€90.00 per 30 days, charged by the day + 21% VAT"],
      ],
      link: "Open Cloud account",
    },
  ],
  [
    "es",
    {
      heading: "Plan y precios",
      rows: [
        ["Plan", "Conectado"],
        ["Estado", "Prueba gratuita"],
        ["Último día de prueba", "29 de noviembre de 2026"],
        ["Registrado", "Gratis"],
        ["Conectado", "30,00 € al mes + 21 % de IVA"],
        ["Alojado", "90,00 € cada 30 días, cobrado por día + 21 % de IVA"],
      ],
      link: "Abrir la cuenta de Cloud",
    },
  ],
] as const)
  it(`${language} shows a trial's plan, its last day and the published prices`, async () => {
    setLocale(language);
    const { api } = screenApi(Response.json(connected()), Response.json(answer()));
    const { el, host } = await open(api);
    await expect.poll(() => rows(el).length).toBe(6);
    expect(section(el)!.querySelector("h2")!.textContent!.trim()).toBe(expected.heading);
    expect(rows(el)).toEqual(expected.rows);
    const link = section(el)!.querySelector<HTMLAnchorElement>("a#cloud-account")!;
    expect(link.textContent!.trim()).toBe(expected.link);
    expect(link.getAttribute("href")).toBe(`${ORIGIN}/account`);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    await expectNoA11yViolations(host);
  });

it.each([
  [
    "active with no established period",
    { status: "ready", level: "hosted", state: "active", period: null },
    [
      ["Plan", "Hosted"],
      ["Status", "Active"],
    ],
  ],
  [
    "payment failing in a paid period",
    {
      status: "ready",
      level: "connected",
      state: "payment_failing",
      period: {
        kind: "paid",
        level: "connected",
        from: "2026-11-01",
        until: "2026-12-01",
        coversAsOf: true,
      },
    },
    [
      ["Plan", "Connected"],
      ["Status", "Payment failing"],
      ["Last paid day", "November 30, 2026"],
    ],
  ],
  [
    "lapsed with a historical period of another level",
    {
      status: "ready",
      level: "registered",
      state: "lapsed",
      period: {
        kind: "paid",
        level: "connected",
        from: "2026-10-01",
        until: "2026-11-01",
        coversAsOf: false,
      },
    },
    [
      ["Plan", "Registered"],
      ["Status", "Lapsed"],
      ["Last paid day", "October 31, 2026 (Connected)"],
    ],
  ],
])("shows %s", async (_name, billing, plan) => {
  const { api } = screenApi(Response.json(connected()), Response.json(answer(billing)));
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(plan.length + 3);
  expect(rows(el).slice(0, plan.length)).toEqual(plan);
});

it("says the plan is not available when Cloud has no billing state yet, and still shows the prices", async () => {
  const { api } = screenApi(
    Response.json(connected()),
    Response.json(answer({ status: "unavailable", reason: "state_not_ready" })),
  );
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(3);
  expect(section(el)!.textContent).toContain("Your plan's details are not available right now.");
  expect(rows(el).map(([label]) => label)).toEqual(["Registered", "Connected", "Hosted"]);
});

it("says the prices are not published yet when Cloud has none, and still shows the plan", async () => {
  const { api } = screenApi(
    Response.json(connected()),
    Response.json(answer(TRIAL, { status: "unavailable", reason: "not_published" })),
  );
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(3);
  expect(section(el)!.textContent).toContain("Prices are not published yet.");
  expect(rows(el).map(([label]) => label)).toEqual(["Plan", "Status", "Last trial day"]);
});

it.each([
  ["en", 1050, "€30.00 a month + 10.5% VAT"],
  ["es", 1050, "30,00 € al mes + 10,5 % de IVA"],
  ["en", 1025, "€30.00 a month + 10.25% VAT"],
] as const)(
  "%s writes a VAT rate of %i basis points to two places",
  async (language, vat, text) => {
    setLocale(language);
    const { api } = screenApi(
      Response.json(connected()),
      Response.json(answer(TRIAL, { ...PRICES, vatRateBasisPoints: vat })),
    );
    const { el } = await open(api);
    await expect.poll(() => rows(el).length).toBe(6);
    expect(rows(el)[4]![1]).toBe(text);
  },
);

it("clears every plan value when a later read fails, without the screen's own error", async () => {
  let fail = false;
  const { api } = screenApi(Response.json(connected()), () =>
    fail
      ? Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 })
      : Response.json(answer()),
  );
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(6);
  fail = true;
  api.liveData.refresh();
  await expect
    .poll(() => section(el)!.textContent)
    .toContain("Your plan's details are not available right now.");
  expect(rows(el)).toEqual([]);
  expect(section(el)!.textContent).not.toContain("Free trial");
  expect(section(el)!.textContent).not.toContain("€30.00");
  expect(el.shadowRoot!.querySelector("[data-test=cloud-error]")).toBeNull();
  expect(section(el)!.querySelector("a#cloud-account")!.getAttribute("href")).toBe(
    `${ORIGIN}/account`,
  );
});

it("says the plan is not available when the first read fails, and the status still shows", async () => {
  const { api } = screenApi(
    Response.json(connected()),
    Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 }),
  );
  const { el } = await open(api);
  await expect
    .poll(() => section(el)?.textContent)
    .toContain("Your plan's details are not available right now.");
  expect(el.shadowRoot!.textContent).toContain("Cloud access active");
  expect(el.shadowRoot!.querySelector("[data-test=cloud-error]")).toBeNull();
});

it.each([
  [
    "Cloud access is stopped",
    connected({ installation: { ...connected().installation, state: "revoked" } }),
  ],
  ["the server is not the primary", connected({ isPrimary: false })],
  ["Cloud is not configured", { state: "not_connected", configured: false, isPrimary: true }],
  [
    "the venue is not connected",
    { state: "not_connected", code: "", configured: true, isPrimary: true },
  ],
])("neither shows nor reads the plan when %s", async (_name, status) => {
  const { api, calls } = screenApi(Response.json(status), Response.json(answer()));
  const { el } = await open(api);
  await expect.poll(() => calls.filter(isStatus).length).toBe(1);
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  expect(section(el)).toBeNull();
  expect(calls.filter(isBilling)).toEqual([]);
});

it("offers to create a Cloud account when the venue is not connected", async () => {
  const { api } = screenApi(
    Response.json({
      state: "not_connected",
      code: "",
      configured: true,
      isPrimary: true,
      signupUrl: `${ORIGIN}/signup`,
    }),
    Response.json(answer()),
  );
  const { el } = await open(api);
  await expect.poll(() => el.shadowRoot!.querySelector("a#cloud-signup")).not.toBeNull();
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a#cloud-signup")!;
  expect(link.textContent!.trim()).toBe("Create a Cloud account");
  expect(link.getAttribute("href")).toBe(`${ORIGIN}/signup`);
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
});

it("reads the plan once when the screen opens, not again for a status the person refreshes", async () => {
  const { api, calls } = screenApi(Response.json(connected()), Response.json(answer()));
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(6);
  el.shadowRoot!.querySelector<HTMLElement>("#refresh")!.click();
  await expect.poll(() => calls.filter((url) => url.endsWith("/refresh")).length).toBe(1);
  await new Promise((r) => setTimeout(r, 50));
  expect(calls.filter(isBilling)).toHaveLength(1);
});

it("takes the plan away once Cloud access is stopped", async () => {
  let revoked = false;
  const status = () =>
    Response.json(
      revoked
        ? connected({ installation: { ...connected().installation, state: "revoked" } })
        : connected(),
    );
  const { api } = screenApi(status, Response.json(answer()));
  const { el } = await open(api);
  await expect.poll(() => rows(el).length).toBe(6);
  revoked = true;
  el.shadowRoot!.querySelector<HTMLElement>("#stop-access")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("#confirm-stop")!.click();
  await expect.poll(() => section(el)).toBeNull();
});
