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
  it("sends every sections-library request to its route and returns the answers", async () => {
    const section = {
      id: "s1",
      internalName: "Drinks",
      names: { es: "Bebidas" },
      image: null,
      color: null,
      members: [],
    };
    const member = { id: "m1", position: 0, ref: { kind: "product", productId: "p1" } };
    const usages = { menus: [{ id: "c1", name: "Lunch" }], sections: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([section]))
      .mockResolvedValueOnce(jsonResponse({ s1: usages }))
      .mockResolvedValueOnce(jsonResponse(section))
      .mockResolvedValueOnce(jsonResponse(section))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([member]))
      .mockResolvedValueOnce(jsonResponse(member))
      .mockResolvedValueOnce(jsonResponse({ added: 2 }))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([member]))
      .mockResolvedValueOnce(jsonResponse(section))
      .mockResolvedValueOnce(jsonResponse(usages));
    const api = new DashboardApi("", fetchImpl);
    const ref = { kind: "section" as const, sectionId: "s2" };

    await expect(api.listSections()).resolves.toEqual([section]);
    await expect(api.listSectionUsages()).resolves.toEqual({ s1: usages });
    await expect(api.createSection({ internalName: "Drinks", names: {} })).resolves.toEqual(
      section,
    );
    await expect(api.updateSection("s1", { color: "#aabbcc" })).resolves.toEqual(section);
    await expect(api.deleteSection("s1")).resolves.toBeUndefined();
    await expect(api.listSectionMembers("s1")).resolves.toEqual([member]);
    await expect(api.addSectionMember("s1", ref)).resolves.toEqual(member);
    await expect(api.addSectionProducts("s1", ["p1", "p2"])).resolves.toEqual({ added: 2 });
    await expect(api.removeSectionMember("s1", "m1")).resolves.toBeUndefined();
    await expect(api.moveSectionMember("s1", "m1", 2)).resolves.toEqual([member]);
    await expect(
      api.duplicateSection("s1", { internalName: "Drinks (copy)", memberIds: ["m1"] }),
    ).resolves.toEqual(section);
    await expect(api.getSectionUsages("s1")).resolves.toEqual(usages);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/sections", "GET", undefined],
      ["/management-api/sections/usages", "GET", undefined],
      ["/management-api/sections", "POST", { internalName: "Drinks", names: {} }],
      ["/management-api/sections/s1", "PATCH", { color: "#aabbcc" }],
      ["/management-api/sections/s1", "DELETE", undefined],
      ["/management-api/sections/s1/members", "GET", undefined],
      ["/management-api/sections/s1/members", "POST", { ref }],
      ["/management-api/sections/s1/members/products", "POST", { productIds: ["p1", "p2"] }],
      ["/management-api/sections/s1/members/m1", "DELETE", undefined],
      ["/management-api/sections/s1/members/m1/position", "PUT", { to: 2 }],
      [
        "/management-api/sections/s1/duplicate",
        "POST",
        { internalName: "Drinks (copy)", memberIds: ["m1"] },
      ],
      ["/management-api/sections/s1/usages", "GET", undefined],
    ]);
  });

  it("reads a menu's prices and saves one product's settings on it", async () => {
    const row = {
      menuItemId: "mi1",
      productId: "p1",
      name: "Lemonade",
      categoryId: null,
      placements: [[]],
      productPrice: "3.00",
      override: null,
      effectivePrice: "3.00",
      active: true,
      variants: [],
    };
    const variants = [{ variantId: "v1", price: "3.50", offered: false }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([row]))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse(variants));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getMenuPrices("c1")).resolves.toEqual([row]);
    await expect(
      api.updateMenuItem("c1", "mi1", { grossPrice: null, active: false }),
    ).resolves.toBeUndefined();
    await expect(api.setMenuVariants("c1", "mi1", variants)).resolves.toEqual(variants);

    expect(callsOf(fetchImpl)).toEqual([
      ["/management-api/catalogues/c1/prices", "GET", undefined],
      ["/management-api/catalogues/c1/items/mi1", "PATCH", { grossPrice: null, active: false }],
      ["/management-api/catalogues/c1/items/mi1/variants", "PUT", { variants }],
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
      warnings: [{ kind: "shortcut_omitted" as const, layoutName: "Home", name: "Burger" }],
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
});
