import { describe, expect, it, vi } from "vitest";
import { DashboardApi, type BackupApplyBody, type ProductEditorInput } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function emptyResponse(): Response {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" } as Response;
}

function refusal(code: string, status: number): Response {
  return jsonResponse({ error: { code } }, false, status);
}

const BACKUP_BODY: BackupApplyBody = {
  destinationDir: "/mnt/usb",
  recoveryKey: "correct horse battery staple",
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
  retention: { count: 7, days: 30 },
};

type Call = [url: string, method: string, body: unknown];

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
  return (fetchImpl.mock.calls as [string, RequestInit][]).map(([url, init]) => [
    url,
    init.method as string,
    init.body === undefined ? undefined : JSON.parse(init.body as string),
  ]);
}

describe("DashboardApi routes", () => {
  it("reads venue departments for the receipt preview without changing their active state", async () => {
    const departments = [
      { id: "deli", name: "Deli", active: true },
      { id: "closed", name: "Closed", active: false },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ departments, zones: [] }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getVenueDepartments()).toEqual(departments);
    expect(callsOf(fetchImpl)).toEqual([["/management-api/venue-service", "GET", undefined]]);
  });

  it("reads pending pretend reader payments and sends a decision", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ payments: [{ id: "payment-1", amount: "12.34" }] }))
      .mockResolvedValueOnce(jsonResponse({ decided: true }));
    const api = new DashboardApi("", fetchImpl);

    expect(await api.listDemoReaderPayments()).toEqual({
      payments: [{ id: "payment-1", amount: "12.34" }],
    });
    await api.decideDemoReaderPayment("payment-1", "declined");
    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/demo-reader/payments", "GET", undefined],
      ["/management-api/demo-reader/payments/payment-1/decision", "POST", { outcome: "declined" }],
    ]);
  });

  it("offers no route that names tills", () => {
    const methods = Object.getOwnPropertyNames(DashboardApi.prototype);
    expect(methods.filter((name) => /tills/i.test(name))).toEqual([]);
  });

  it("reads the bump mode from its own route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ mode: "ticket" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getBumpMode()).toEqual({ mode: "ticket" });
    expect(callsOf(fetchImpl)).toEqual([["/management-api/bump-mode", "GET", undefined]]);
  });

  it("passes Orders filters and the chosen printer to the management routes", async () => {
    const page = { rows: [], next: null, from: null, to: null };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page));
    const api = new DashboardApi("", fetchImpl);

    await api.listOrders(
      {
        status: "unpaid",
        from: "2026-09-01",
        to: "2026-09-02",
        anyDate: false,
        credited: true,
        staff: "person-1",
        table: "Mesa 5",
        q: "A/12",
      },
      { after: "cursor" },
    );
    await api.reprintOrder("bill-1", "printer-2");

    expect(callsOf(fetchImpl)).toEqual([
      [
        "/management-api/orders?status=unpaid&from=2026-09-01&to=2026-09-02&credited=true&staff=person-1&table=Mesa+5&q=A%2F12&after=cursor",
        "GET",
        undefined,
      ],
      ["/management-api/orders/bill-1/reprint", "POST", { printerId: "printer-2" }],
    ]);
  });

  it("sends the session-scoped account and second-factor requests and returns their answers", async () => {
    const enrolment = {
      enrollmentId: "enr-1",
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/Waitron:alex",
      expiresAt: "2026-09-23T12:10:00Z",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse({ email: "new@example.com" }))
      .mockResolvedValueOnce(jsonResponse(enrolment))
      .mockResolvedValueOnce(jsonResponse({ codes: ["aaaa-bbbb"] }))
      .mockResolvedValueOnce(jsonResponse({ codes: ["cccc-dddd"] }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse({ personId: "p1", authenticated: true }));
    const api = new DashboardApi("", fetchImpl);
    const credentials = { currentPassword: "current", totp: "123456" };

    await expect(api.passkeyOfferSeen()).resolves.toBeUndefined();
    await expect(api.confirmProfileEmail("842913")).resolves.toEqual({
      email: "new@example.com",
    });
    await expect(api.beginTotp(credentials)).resolves.toEqual(enrolment);
    await expect(api.finishTotp("enr-1", "654321")).resolves.toEqual({ codes: ["aaaa-bbbb"] });
    await expect(api.regenerateRecoveryCodes(credentials)).resolves.toEqual({
      codes: ["cccc-dddd"],
    });
    await expect(api.disableTotp(credentials)).resolves.toBeUndefined();
    await expect(api.unlinkGoogle({ currentPassword: "current" })).resolves.toBeUndefined();
    await expect(
      api.completeAccountAction("token-1", "invitation", "a new password", "4321"),
    ).resolves.toEqual({ personId: "p1", authenticated: true });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/session/me/passkey-offer", "POST", undefined],
      ["/management-api/session/me/profile/email/confirm", "POST", { code: "842913" }],
      ["/management-api/session/me/totp/begin", "POST", credentials],
      ["/management-api/session/me/totp/finish", "POST", { enrollmentId: "enr-1", code: "654321" }],
      ["/management-api/session/me/recovery-codes", "POST", credentials],
      ["/management-api/session/me/totp", "DELETE", credentials],
      ["/management-api/session/me/google", "DELETE", { currentPassword: "current" }],
      [
        "/management-api/account-actions/complete",
        "POST",
        { token: "token-1", purpose: "invitation", password: "a new password", pin: "4321" },
      ],
    ]);
  });

  it("drives a staff member's invitation and active state by id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ invitationSent: true }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse({ invitationSent: false }));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.resendInvitation("p-7")).resolves.toEqual({ invitationSent: true });
    await expect(api.deactivatePerson("p-7")).resolves.toBeUndefined();
    await expect(api.reactivatePerson("p-7")).resolves.toEqual({ invitationSent: false });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/staff/p-7/invitation", "POST", undefined],
      ["/management-api/staff/p-7/deactivate", "POST", undefined],
      ["/management-api/staff/p-7/reactivate", "POST", undefined],
    ]);
  });

  it("reads content languages from the public route and saves them on the management one", async () => {
    const config = { defaultLanguage: "es", languages: ["es", "en"] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(config))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getContentLanguages()).resolves.toEqual(config);
    await expect(api.updateContentLanguages(config)).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/api/content-languages", "GET", undefined],
      ["/management-api/content-languages", "PUT", config],
    ]);
  });

  it("reads the venue's content-language rules from the management route", async () => {
    const rules = {
      required: ["ca", "es"],
      official: ["es", "ca", "gl", "eu"],
      foreignLanguageNotice: { minimumForeign: 1, text: { en: "One foreign language." } },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(rules));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getContentLanguageRules()).resolves.toEqual(rules);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/content-language-rules", "GET", undefined],
    ]);
  });

  it("reads the missing-translations report from the management route", async () => {
    const report = [
      { language: "es", gaps: [] },
      {
        language: "ca",
        gaps: [{ kind: "product", id: "prod-1", name: "STAFF Pan", reason: "partial" }],
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(report));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getContentTranslationGaps()).resolves.toEqual(report);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/content-translation-gaps", "GET", undefined],
    ]);
  });

  it("lists a unit's products and reassigns them, sending a null target for Each", async () => {
    const using = [{ id: "prod-1", name: "Olives" }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(using))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(using));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listUnitProducts("u-kg")).resolves.toEqual(using);
    await expect(api.reassignProductsUnit("u-kg", ["prod-1"], null)).resolves.toEqual([]);
    await expect(api.reassignProductsUnit("u-kg", ["prod-2"], "u-g")).resolves.toEqual(using);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/units/u-kg/products", "GET", undefined],
      [
        "/management-api/units/u-kg/products/reassign",
        "POST",
        { productIds: ["prod-1"], unitId: null },
      ],
      [
        "/management-api/units/u-kg/products/reassign",
        "POST",
        { productIds: ["prod-2"], unitId: "u-g" },
      ],
    ]);
  });

  it("reads, creates and replaces a product through its editor routes", async () => {
    const input = { name: "Patatas bravas" } as unknown as ProductEditorInput;
    const stored = { id: "prod-9", name: "Patatas bravas" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(stored));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getProductEditor("prod-9")).resolves.toEqual(stored);
    await expect(api.createProductEditor("cat-1", input)).resolves.toEqual(stored);
    await expect(api.updateProductEditor("prod-9", input)).resolves.toEqual(stored);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/products/prod-9/editor", "GET", undefined],
      ["/management-api/catalogues/cat-1/product-editor", "POST", input],
      ["/management-api/products/prod-9/editor", "PUT", input],
    ]);
  });

  it("sets a product's own colour, and clears it with null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.setProductColor("p1", "#b12525")).resolves.toBeUndefined();
    await expect(api.setProductColor("p1", null)).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/products/p1", "PATCH", { color: "#b12525" }],
      ["/management-api/products/p1", "PATCH", { color: null }],
    ]);
  });

  it("reads a product's extra-list and menu usage", async () => {
    const usage = [
      {
        productId: "prod-9",
        productName: "Jamón",
        lists: [{ id: "list-1", name: "Toppings", menus: [{ id: "menu-1", name: "Lunch" }] }],
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(usage));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getProductExtraUsage("prod-9")).resolves.toEqual(usage);
    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/products/prod-9/extra-usage", "GET", undefined],
    ]);
  });

  it("reads and saves the location's operation description", async () => {
    const settings = { name: "Bar Pepe", operationDescription: "Restaurant service" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(settings))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getLocationSettings()).resolves.toEqual(settings);
    await expect(api.putLocationSettings("Takeaway")).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/location-settings", "GET", undefined],
      ["/management-api/location-settings", "PUT", { operationDescription: "Takeaway" }],
    ]);
  });

  it("asks for a preview of the receipt text and returns the drawn receipt", async () => {
    const answer = {
      preview: {
        widthDots: 512,
        columns: 42,
        text: "Bar Pepe\n",
        blocks: [{ kind: "text", text: "Bar Pepe\n" }],
        qrData: [],
        omittedGraphics: false,
        truncated: false,
        unsupported: false,
      },
      marks: { headerSubtitle: { start: 1, end: 2 }, footerMessage: null },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(answer));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.previewReceipt({ headerSubtitle: "Calle Mayor 1" })).resolves.toEqual(answer);

    expect(callsOf(fetchImpl)).toEqual([
      [
        `/management-api/receipt-preview?receipt=${encodeURIComponent(
          JSON.stringify({ headerSubtitle: "Calle Mayor 1" }),
        )}`,
        "GET",
        undefined,
      ],
    ]);
  });

  it("asks for a preview at a chosen paper width", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ preview: {}, marks: { headerSubtitle: null, footerMessage: null } }),
    );
    const api = new DashboardApi("", fetchImpl);

    await api.previewReceipt({ footerMessage: "Gracias" }, "58mm");

    expect(callsOf(fetchImpl)).toEqual([
      [
        `/management-api/receipt-preview?receipt=${encodeURIComponent(
          JSON.stringify({ footerMessage: "Gracias" }),
        )}&paperWidth=58mm`,
        "GET",
        undefined,
      ],
    ]);
  });

  it("asks for a preview in another receipt language, with no paper width unless one is given", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ preview: {}, marks: { headerSubtitle: null, footerMessage: null } }),
    );
    const api = new DashboardApi("", fetchImpl);

    await api.previewReceipt({}, undefined, "gl-ES");
    await api.previewReceipt({}, "58mm", "eu-ES");

    const receipt = encodeURIComponent(JSON.stringify({}));
    expect(callsOf(fetchImpl)).toEqual([
      [`/management-api/receipt-preview?receipt=${receipt}&language=gl-ES`, "GET", undefined],
      [
        `/management-api/receipt-preview?receipt=${receipt}&paperWidth=58mm&language=eu-ES`,
        "GET",
        undefined,
      ],
    ]);
  });

  it("asks for the selected department's receipt preview without saving that choice", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ preview: {} }));
    const api = new DashboardApi("", fetchImpl);
    await api.previewReceipt({}, undefined, undefined, "aa000000-0000-4000-8000-000000000001");
    expect(callsOf(fetchImpl)).toEqual([
      [
        "/management-api/receipt-preview?receipt=%7B%7D&departmentId=aa000000-0000-4000-8000-000000000001",
        "GET",
        undefined,
      ],
    ]);
  });

  it("reads and saves the location's receipt language", async () => {
    const answer = {
      language: "ca-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: { locale: "ca-ES", reason: { en: "Because.", es: "Porque." } },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(answer))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getReceiptLanguage()).resolves.toEqual(answer);
    await expect(api.putReceiptLanguage("gl-ES")).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/receipt-language", "GET", undefined],
      ["/management-api/receipt-language", "PUT", { language: "gl-ES" }],
    ]);
  });

  it("marks a preview passive only when it goes through the background client", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ preview: {}, marks: { headerSubtitle: null, footerMessage: null } }),
    );
    const api = new DashboardApi("", fetchImpl);

    await api.previewReceipt({ footerMessage: "Gracias" });
    await api.background.previewReceipt({ footerMessage: "Gracias" });

    const headers = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
      new Headers(init.headers).get("x-waitron-live"),
    );
    expect(headers).toEqual([null, "1"]);
  });

  it("unwraps the canvas and device-profile list envelopes, and addresses one profile by id", async () => {
    const canvases = [{ id: "cv-1", name: "Bar grid", definition: {} }];
    const profile = { id: "dp-1", name: "Bar till" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ canvases }))
      .mockResolvedValueOnce(jsonResponse({ deviceProfiles: [profile] }))
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listCanvases()).resolves.toEqual(canvases);
    await expect(api.listDeviceProfiles()).resolves.toEqual([profile]);
    await expect(api.getDeviceProfile("dp-1")).resolves.toEqual(profile);
    await expect(api.deleteDeviceProfile("dp-1")).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/canvases", "GET", undefined],
      ["/management-api/device-profiles", "GET", undefined],
      ["/management-api/device-profiles/dp-1", "GET", undefined],
      ["/management-api/device-profiles/dp-1", "DELETE", undefined],
    ]);
  });

  it("re-allows a revoked print agent by id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.allowAgent("ag-3")).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/print-agents/ag-3/allow", "POST", undefined],
    ]);
  });

  it("drives the backup wizard's status, key and apply routes", async () => {
    const status = { enabled: true, destinations: [] };
    const body = BACKUP_BODY;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse({ key: "minted-key" }))
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse({ key: null }))
      .mockResolvedValueOnce(jsonResponse(status));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getBackupStatus()).resolves.toEqual(status);
    await expect(api.mintBackupKey()).resolves.toEqual({ key: "minted-key" });
    await expect(api.applyBackup(body)).resolves.toEqual(status);
    await expect(api.getBackupRecoveryKey()).resolves.toEqual({ key: null });
    await expect(api.rotateBackupKey({ recoveryKey: "a fresh key" })).resolves.toEqual(status);

    expect(callsOf(fetchImpl)).toEqual([
      ["/api/backup/status", "GET", undefined],
      ["/api/backup/mint-key", "POST", undefined],
      ["/api/backup/apply", "POST", body],
      ["/api/backup/recovery-key", "GET", undefined],
      ["/api/backup/rotate", "POST", { recoveryKey: "a fresh key" }],
    ]);
  });

  it("drives the bucket copy's settings, test, switch-off and recovery kit routes", async () => {
    const view = { isPrimary: true, configured: false, bucket: null, status: { state: "off" } };
    const bucket = {
      endpoint: "",
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "not-a-real-secret",
    };
    const kit = { kit: "WAITRON-RECOVERY-KIT-1:abc", keyFingerprint: "ab12cd34" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse(kit));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getStreamSettings()).resolves.toEqual(view);
    await expect(api.testStreamBucket(bucket)).resolves.toEqual({ ok: true });
    await expect(api.saveStreamSettings(bucket)).resolves.toEqual(view);
    await expect(api.turnOffStream()).resolves.toEqual(view);
    await expect(api.getRecoveryKit()).resolves.toEqual(kit);

    expect(callsOf(fetchImpl)).toEqual([
      ["/api/backup/stream", "GET", undefined],
      ["/api/backup/stream/test", "POST", bucket],
      ["/api/backup/stream", "PUT", bucket],
      ["/api/backup/stream", "DELETE", undefined],
      ["/api/backup/stream/kit", "GET", undefined],
    ]);
  });

  it("lists card providers and readers, disconnects a provider, and reads and sets a device's reader", async () => {
    const providers = [{ id: "sumup", name: "SumUp", state: "connected" }];
    const readers = [{ id: "r-1", name: "Bar", providerId: "sumup", active: true, devices: 1 }];
    const status = { status: "online" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(providers))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse(readers))
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse({ readerId: null }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listPaymentProviders()).resolves.toEqual(providers);
    await expect(api.disconnectPaymentProvider("sumup")).resolves.toBeUndefined();
    await expect(api.listReaders()).resolves.toEqual(readers);
    await expect(api.readerStatus("r-1")).resolves.toEqual(status);
    await expect(api.getDeviceReader("dev-2")).resolves.toEqual({ readerId: null });
    await expect(api.setDeviceReader("dev-2", "r-1")).resolves.toBeUndefined();
    await expect(api.setDeviceReader("dev-2", null)).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/payments/providers", "GET", undefined],
      ["/management-api/payments/providers/sumup/disconnect", "POST", undefined],
      ["/management-api/payments/readers", "GET", undefined],
      ["/management-api/payments/readers/r-1/status", "GET", undefined],
      ["/management-api/payments/devices/dev-2/reader", "GET", undefined],
      ["/management-api/payments/devices/dev-2/reader", "PUT", { readerId: "r-1" }],
      ["/management-api/payments/devices/dev-2/reader", "PUT", { readerId: null }],
    ]);
  });

  it("lists the stuck card payments and asks the provider to resolve one", async () => {
    const stuck = [
      {
        paymentId: "pay-1",
        workingOrderId: "wo-1",
        orderNumber: 12,
        label: null,
        source: "device",
        deviceId: "device-1",
        deviceName: "Bar",
        provider: "stripe-terminal",
        amount: "12.50",
        startedAt: "2026-09-26T10:00:00.000Z",
      },
    ];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stuck))
      .mockResolvedValueOnce(jsonResponse({ outcome: "not_charged", orderUnlocked: true }));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listStuckPayments()).resolves.toEqual(stuck);
    await expect(api.resolveStuckPayment("pay-1")).resolves.toEqual({
      outcome: "not_charged",
      orderUnlocked: true,
    });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/payments/stuck", "GET", undefined],
      ["/management-api/payments/stuck/pay-1/resolve", "POST", undefined],
    ]);
  });

  it("lists unresolved bill payments and refunds and sends confirmed outcomes with the manager PIN", async () => {
    const payment = [{ billPaymentId: "bp-1", orderNumber: 12 }];
    const refund = [{ refundId: "br-1", orderNumber: 12 }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(payment))
      .mockResolvedValueOnce(jsonResponse(refund))
      .mockResolvedValueOnce(jsonResponse({ outcome: "not_charged" }))
      .mockResolvedValueOnce(jsonResponse({ outcome: "failed" }))
      .mockResolvedValueOnce(jsonResponse({ outcome: "completed" }))
      .mockResolvedValueOnce(jsonResponse({ outcome: "completed" }));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listStuckBillPayments()).resolves.toEqual(payment);
    await expect(api.listStuckBillRefunds()).resolves.toEqual(refund);
    await expect(api.resolveStuckBillPayment("bp-1")).resolves.toEqual({ outcome: "not_charged" });
    await expect(
      api.attestStuckBillPayment("bp-1", {
        outcome: "failed",
        note: "Provider confirmed no charge",
        pin: "1234",
      }),
    ).resolves.toEqual({ outcome: "failed" });
    await expect(api.resolveStuckBillRefund("br-1")).resolves.toEqual({ outcome: "completed" });
    await expect(
      api.attestStuckBillRefund("br-1", {
        outcome: "completed",
        note: "Provider confirmed refund",
        pin: "1234",
      }),
    ).resolves.toEqual({ outcome: "completed" });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/payments/bill-payments", "GET", undefined],
      ["/management-api/payments/bill-refunds", "GET", undefined],
      ["/management-api/payments/bill-payments/bp-1/resolve", "POST", undefined],
      [
        "/management-api/payments/bill-payments/bp-1/attest",
        "POST",
        { outcome: "failed", note: "Provider confirmed no charge", pin: "1234" },
      ],
      ["/management-api/payments/bill-refunds/br-1/resolve", "POST", undefined],
      [
        "/management-api/payments/bill-refunds/br-1/attest",
        "POST",
        { outcome: "completed", note: "Provider confirmed refund", pin: "1234" },
      ],
    ]);
  });

  it.each([
    ["finishTotp", "totp.invalid", 400, (api: DashboardApi) => api.finishTotp("enr-1", "000000")],
    [
      "deactivatePerson",
      "person.last_admin",
      409,
      (api: DashboardApi) => api.deactivatePerson("p-1"),
    ],
    [
      "updateContentLanguages",
      "content.languages_invalid",
      400,
      (api: DashboardApi) => api.updateContentLanguages({ defaultLanguage: "xx", languages: [] }),
    ],
    [
      "reassignProductsUnit",
      "unit.in_use",
      409,
      (api: DashboardApi) => api.reassignProductsUnit("u-kg", ["prod-1"], "u-g"),
    ],
    [
      "getProductEditor",
      "product.not_found",
      404,
      (api: DashboardApi) => api.getProductEditor("gone"),
    ],
    [
      "getDeviceProfile",
      "device_profile.not_found",
      404,
      (api: DashboardApi) => api.getDeviceProfile("gone"),
    ],
    ["allowAgent", "agent.not_found", 404, (api: DashboardApi) => api.allowAgent("gone")],
    ["applyBackup", "backup.not_primary", 409, (api: DashboardApi) => api.applyBackup(BACKUP_BODY)],
    [
      "disconnectPaymentProvider",
      "payment.provider_in_use",
      409,
      (api: DashboardApi) => api.disconnectPaymentProvider("sumup"),
    ],
    [
      "setDeviceReader",
      "reader.not_found",
      404,
      (api: DashboardApi) => api.setDeviceReader("d", "x"),
    ],
  ] as const)(
    "%s rejects with the refusal's code and status",
    async (_name, code, status, call) => {
      const onError = vi.fn();
      const api = new DashboardApi("", vi.fn().mockResolvedValue(refusal(code, status)), onError);
      await expect(call(api)).rejects.toEqual({ code, status });
      expect(onError).toHaveBeenCalledWith(code);
    },
  );

  it("retries the locale list after a failed read, and shares it once one succeeds", async () => {
    const locales = {
      locales: [{ code: "es", label: "Español" }],
      venueDefault: "es",
      loginDefault: "es",
      venueName: "Bar Pepe SL",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(refusal("server.internal", 503))
      .mockResolvedValueOnce(jsonResponse(locales));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getLocales()).rejects.toEqual({ code: "server.internal", status: 503 });
    await expect(api.getLocales()).resolves.toEqual(locales);
    await expect(api.getLocales()).resolves.toEqual(locales);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marks a background read passive but never a background write", async () => {
    const onSuccess = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ enabled: false, destinations: [] }))
      .mockResolvedValueOnce(jsonResponse({ key: "minted-key" }));
    const api = new DashboardApi("", fetchImpl, undefined, onSuccess);

    await api.background.getBackupStatus();
    await api.background.mintBackupKey();

    const headers = (fetchImpl.mock.calls as [string, RequestInit][]).map(([, init]) =>
      new Headers(init.headers).get("x-waitron-live"),
    );
    expect(headers).toEqual(["1", null]);
  });
  it("maps the menu's internal name to the catalogue wire name and sends its presentation fields", async () => {
    const saved = { id: "c1", name: "Lunch", active: true, version: 1 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const details = {
      names: { en: "Lunch", es: "Almuerzo" },
      image: "lunch.png",
      color: "#aa3300",
    };
    await expect(api.createCatalogue("Lunch", details)).resolves.toEqual(saved);
    await expect(
      api.updateMenuDetails("c1", { internalName: "Weekday lunch", ...details }),
    ).resolves.toBeUndefined();
    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/catalogues", "POST", { name: "Lunch", ...details }],
      ["/management-api/catalogues/c1", "PATCH", { name: "Weekday lunch", ...details }],
    ]);
  });

  it("sends every section-editor request to its route and returns the answers", async () => {
    const section = {
      id: "s1",
      internalName: "Drinks",
      names: { es: "Bebidas" },
      image: null,
      color: null,
      members: [],
    };
    const member = { id: "m1", position: 0, ref: { kind: "product", productId: "p1" } };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(section))
      .mockResolvedValueOnce(jsonResponse(section))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([member]))
      .mockResolvedValueOnce(jsonResponse(member))
      .mockResolvedValueOnce(jsonResponse({ added: 2 }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([member]));
    const api = new DashboardApi("", fetchImpl);
    const ref = { kind: "section" as const, sectionId: "s2" };

    await expect(
      api.createSectionIn("root", { internalName: "Drinks", names: {} }),
    ).resolves.toEqual(section);
    await expect(api.updateSection("s1", { color: "#aabbcc" })).resolves.toEqual(section);
    await expect(api.deleteSection("s1")).resolves.toBeUndefined();
    await expect(api.listSectionMembers("s1")).resolves.toEqual([member]);
    await expect(api.addSectionMember("s1", ref)).resolves.toEqual(member);
    await expect(api.addSectionProducts("s1", ["p1", "p2"])).resolves.toEqual({ added: 2 });
    await expect(api.removeSectionMember("s1", "m1")).resolves.toBeUndefined();
    await expect(api.moveSectionMember("s1", "m1", 2)).resolves.toEqual([member]);
    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/sections/root/sections", "POST", { internalName: "Drinks", names: {} }],
      ["/management-api/sections/s1", "PATCH", { color: "#aabbcc" }],
      ["/management-api/sections/s1", "DELETE", undefined],
      ["/management-api/sections/s1/members", "GET", undefined],
      ["/management-api/sections/s1/members", "POST", { ref }],
      ["/management-api/sections/s1/members/products", "POST", { productIds: ["p1", "p2"] }],
      ["/management-api/sections/s1/members/m1", "DELETE", undefined],
      ["/management-api/sections/s1/members/m1/position", "PUT", { to: 2 }],
    ]);
  });

  it("reads a menu's prices and saves one product's settings on it", async () => {
    const row = {
      menuItemId: "mi1",
      productId: "p1",
      name: "Lemonade",
      categoryId: null,
      placements: [[]],
      override: null,
      effectivePrice: "3.00",
      active: true,
      variants: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([row]))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getMenuPrices("c1")).resolves.toEqual([row]);
    await expect(api.updateMenuItem("c1", "mi1", { grossPrice: null })).resolves.toBeUndefined();
    await expect(api.setMenuVariantPrice("c1", "mi1", "v1", "2.20")).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/catalogues/c1/prices", "GET", undefined],
      ["/management-api/catalogues/c1/items/mi1", "PATCH", { grossPrice: null }],
      ["/management-api/catalogues/c1/items/mi1/variants/v1", "PATCH", { price: "2.20" }],
    ]);
  });

  it("reads and edits a menu's home page layouts and their tiles", async () => {
    const layout = {
      id: "l1",
      name: "Home",
      isDefault: true,
      tiles: [
        {
          memberId: "t1",
          position: 0,
          ref: { kind: "product" as const, productId: "p1" },
          name: "Burger",
          reachable: true,
        },
      ],
    };
    const ref = { kind: "section" as const, sectionId: "s1" };
    const tile = { id: "t2", position: 1, ref };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([layout]))
      .mockResolvedValueOnce(jsonResponse({ id: "l2" }, true, 201))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse({ id: "l3" }, true, 201))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse(tile, true, 201))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([tile]))
      .mockResolvedValueOnce(refusal("menu.default_layout_required", 409));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listHomeLayouts("c1")).resolves.toEqual([layout]);
    await expect(api.createHomeLayout("c1", "Counter")).resolves.toEqual({ id: "l2" });
    await expect(api.setDefaultHomeLayout("c1", "l2")).resolves.toBeUndefined();
    await expect(api.duplicateHomeLayout("l1", "Home (copy)")).resolves.toEqual({ id: "l3" });
    await expect(api.renameHomeLayout("l3", "Terrace")).resolves.toBeUndefined();
    await expect(api.deleteHomeLayout("l3")).resolves.toBeUndefined();
    await expect(api.addHomeTile("l1", ref)).resolves.toEqual(tile);
    await expect(api.removeHomeTile("l1", "t1")).resolves.toBeUndefined();
    await expect(api.moveHomeTile("l1", "t2", 0)).resolves.toEqual([tile]);
    await expect(api.deleteHomeLayout("l1")).rejects.toMatchObject({
      code: "menu.default_layout_required",
      status: 409,
    });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/catalogues/c1/home-layouts", "GET", undefined],
      ["/management-api/catalogues/c1/home-layouts", "POST", { name: "Counter" }],
      ["/management-api/catalogues/c1/default-home-layout", "PUT", { layoutId: "l2" }],
      ["/management-api/home-layouts/l1/duplicate", "POST", { name: "Home (copy)" }],
      ["/management-api/home-layouts/l3", "PATCH", { name: "Terrace" }],
      ["/management-api/home-layouts/l3", "DELETE", undefined],
      ["/management-api/home-layouts/l1/tiles", "POST", { ref }],
      ["/management-api/home-layouts/l1/tiles/t1", "DELETE", undefined],
      ["/management-api/home-layouts/l1/tiles/t2/position", "PUT", { to: 0 }],
      ["/management-api/home-layouts/l1", "DELETE", undefined],
    ]);
  });

  it("reads a device profile's home page layout choices and saves one, null meaning the default", async () => {
    const menus = [
      {
        menuId: "c1",
        menuName: "Lunch",
        layouts: [{ id: "l1", name: "Home", isDefault: true }],
        selectedLayoutId: null,
        selectedRemoved: false,
      },
    ];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(menus))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getDeviceHomeLayouts("dp-1")).resolves.toEqual(menus);
    await expect(api.setDeviceHomeLayout("dp-1", "c1", "l2")).resolves.toBeUndefined();
    await expect(api.setDeviceHomeLayout("dp-1", "c1", null)).resolves.toBeUndefined();

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/device-profiles/dp-1/home-layouts", "GET", undefined],
      ["/management-api/device-profiles/dp-1/home-layouts/c1", "PUT", { layoutId: "l2" }],
      ["/management-api/device-profiles/dp-1/home-layouts/c1", "PUT", { layoutId: null }],
    ]);
  });

  it("reads menus' publication status and preview, and publishes the previewed hash", async () => {
    const current = {
      state: "current" as const,
      version: 2,
      publishedAt: "2026-09-26T10:00:00.000Z",
      hash: "a".repeat(64),
    };
    const statuses = { c1: current, c2: { state: "unpublished" as const } };
    const preview = {
      hash: "b".repeat(64),
      changes: [
        {
          kind: "price_changed" as const,
          productId: "p1",
          name: "Lemonade",
          from: "3.00",
          to: "2.50",
          source: "this_menu" as const,
        },
      ],
      warnings: [{ kind: "shortcut_missing" as const, layoutName: "Home", name: "Burger" }],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(statuses))
      .mockResolvedValueOnce(jsonResponse(current))
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse({ versionId: "v3", number: 3 }))
      .mockResolvedValueOnce(refusal("menu.changed_since_preview", 409));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getMenuStatuses()).resolves.toEqual(statuses);
    await expect(api.getMenuStatus("c1")).resolves.toEqual(current);
    await expect(api.getMenuPreview("c1")).resolves.toEqual(preview);
    await expect(api.publishMenu("c1", preview.hash)).resolves.toEqual({
      versionId: "v3",
      number: 3,
    });
    await expect(api.publishMenu("c1", "stale")).rejects.toMatchObject({
      code: "menu.changed_since_preview",
      status: 409,
    });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/catalogues/status", "GET", undefined],
      ["/management-api/catalogues/c1/status", "GET", undefined],
      ["/management-api/catalogues/c1/preview", "GET", undefined],
      ["/management-api/catalogues/c1/publish", "POST", { expectedHash: preview.hash }],
      ["/management-api/catalogues/c1/publish", "POST", { expectedHash: "stale" }],
    ]);
  });

  it("reads the venue's servers and removes one by its id, passing a refusal's code through", async () => {
    const listing = {
      term: 2,
      nodes: [
        {
          nodeId: "22222222-2222-4222-8222-222222222222",
          contactUrl: "https://standby.venue.example",
          standing: "serving-secondary",
          isSelf: false,
          removable: true,
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse({ removed: true, term: 3 }))
      .mockResolvedValueOnce(refusal("membership.standby_joined", 409));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.listServers()).resolves.toEqual(listing);
    await expect(api.removeServer("22222222-2222-4222-8222-222222222222")).resolves.toEqual({
      removed: true,
      term: 3,
    });
    await expect(api.removeServer("a/b")).rejects.toMatchObject({
      code: "membership.standby_joined",
      status: 409,
    });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/servers", "GET", undefined],
      ["/management-api/servers/22222222-2222-4222-8222-222222222222/remove", "POST", undefined],
      // An id is a path segment, so a slash in one cannot reach a different route.
      ["/management-api/servers/a%2Fb/remove", "POST", undefined],
    ]);
  });

  it("clears a removed server by its id, passing a refusal's code through", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ cleared: true, term: 5 }))
      .mockResolvedValueOnce(refusal("membership.node_not_removed", 409));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.clearServer("44444444-4444-4444-8444-444444444444")).resolves.toEqual({
      cleared: true,
      term: 5,
    });
    await expect(api.clearServer("a/b")).rejects.toMatchObject({
      code: "membership.node_not_removed",
      status: 409,
    });

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/servers/44444444-4444-4444-8444-444444444444/clear", "POST", undefined],
      ["/management-api/servers/a%2Fb/clear", "POST", undefined],
    ]);
  });
});

it("replaces a missing home tile through its own route with a structural reference", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      jsonResponse({ id: "t1", position: 1, ref: { kind: "section", sectionId: "s-wines" } }),
    );
  const api = new DashboardApi("", fetchImpl);
  await api.replaceHomeTile("l-counter", "t1", { kind: "section", sectionId: "s-wines" });
  expect(callsOf(fetchImpl)).toEqual([
    [
      "/management-api/home-layouts/l-counter/tiles/t1/replace",
      "POST",
      { ref: { kind: "section", sectionId: "s-wines" } },
    ],
  ]);
});

it("downloads the modelo 303 file for the chosen period as an ordinary GET, bytes untouched", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([0x4e, 0xd1, 0x0a]), { status: 200 }));
  const api = new DashboardApi("", fetchImpl);

  const file = await api.downloadVatReturnFile({
    year: 2026,
    period: "3T",
    declarationType: "I",
  });

  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/management-api/reports/modelo-303?year=2026&period=3T&declarationType=I");
  expect(init.method).toBe("GET");
  expect(init.credentials).toBe("include");
  expect(new Headers(init.headers).has("x-waitron-live")).toBe(false);
  expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0x4e, 0xd1, 0x0a]);
});
