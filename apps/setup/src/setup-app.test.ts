import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { SetupApp, assembleBody } from "./setup-app.js";
import type { DeepPartial, Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi, SetupStatus } from "./api/client.js";
import type { SetupCloudRestoreScreen } from "./screens/cloud-restore-screen.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

function stubApi(overrides: Partial<Record<keyof SetupApi, unknown>> = {}): SetupApi {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    } satisfies SetupStatus),
    getVenueDefaults: vi
      .fn()
      .mockResolvedValue({ verifactu: { operationDescription: "Venta en establecimiento" } }),
    provision: vi.fn().mockResolvedValue({ provisioned: true, restarting: true }),
    adopt: vi.fn().mockResolvedValue({
      adopted: true,
      breakGlassSecret: "bg-default",
      restarting: true,
    }),
    restore: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
    startCloudRecovery: vi.fn(),
    cloudRecoveryStatus: vi.fn(),
    startCloudRecoveryAgain: vi.fn(),
    restoreFromCloud: vi.fn(),
    stageConfiguration: vi.fn(),
    runFiscalTest: vi.fn().mockResolvedValue({ status: "accepted" }),
    ...overrides,
  } as unknown as SetupApi;
}

const adoptBody = {
  primaryUrl: "https://waitron.local",
  credential: { personId: "op-1", password: "correct horse" },
};

async function mountSetupApp(api: SetupApi = stubApi()): Promise<SetupApp> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);

  const el = document.createElement("setup-app") as SetupApp;
  el.api = api;
  host.appendChild(el);
  await flush(el);
  return el;
}

/** Drains the microtask queue (settling the awaited boot promise) then Lit's render. */
async function flush(el: SetupApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const wizard = (el: SetupApp) => el.shadowRoot!.querySelector<HTMLElement>("wt-modal")!;

/** Awaits the screen's own render, which the shell awaiting its render does not. */
async function screenHost(el: SetupApp, screen: Screen): Promise<HTMLElement> {
  const host = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${screen}]`,
  )!;
  await host.updateComplete;
  return host;
}

/** TS-private is erased at runtime. */
const readDraft = (el: SetupApp) => (el as unknown as { draft: DeepPartial<ProvisionBody> }).draft;

function goto(el: SetupApp, screen: Screen): void {
  wizard(el).dispatchEvent(
    new CustomEvent("setup-goto", { detail: { screen }, bubbles: true, composed: true }),
  );
}

function patch(el: SetupApp, p: DeepPartial<ProvisionBody>): void {
  wizard(el).dispatchEvent(
    new CustomEvent("setup-patch", { detail: { patch: p }, bubbles: true, composed: true }),
  );
}

function advance(el: SetupApp): void {
  wizard(el).dispatchEvent(new CustomEvent("setup-advance", { bubbles: true, composed: true }));
}

function provisionRequest(el: SetupApp): void {
  wizard(el).dispatchEvent(
    new CustomEvent("provision-requested", { bubbles: true, composed: true }),
  );
}

function adoptRequest(el: SetupApp, body: unknown = adoptBody): void {
  wizard(el).dispatchEvent(
    new CustomEvent("adopt-requested", { detail: { body }, bubbles: true, composed: true }),
  );
}

function restoreRequest(
  el: SetupApp,
  request: { artifact: File; recoveryKey: string; environment: "production" | "preproduction" },
): void {
  wizard(el).dispatchEvent(
    new CustomEvent("restore-requested", { detail: { request }, bubbles: true, composed: true }),
  );
}

function cloudRecoveryAction(
  el: SetupApp,
  action: "start" | "status" | "start-again" | "restore",
  pointId?: string,
): void {
  wizard(el).dispatchEvent(
    new CustomEvent("cloud-restore-action", {
      detail: { action, pointId },
      bubbles: true,
      composed: true,
    }),
  );
}

function configurationRequest(el: SetupApp, artifact: File, passphrase: string): void {
  wizard(el).dispatchEvent(
    new CustomEvent("configuration-requested", {
      detail: { request: { artifact, passphrase } },
      bubbles: true,
      composed: true,
    }),
  );
}

function fiscalTestRequest(el: SetupApp): void {
  wizard(el).dispatchEvent(
    new CustomEvent("fiscal-test-requested", { bubbles: true, composed: true }),
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Reads named private shell fields; used where the element is detached and renders nothing. */
function readState(el: SetupApp, keys: string[]): Record<string, unknown> {
  const state = el as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

async function screenText(el: SetupApp, screen: Screen, sel: string): Promise<string | null> {
  const host = await screenHost(el, screen);
  return host.shadowRoot!.querySelector<HTMLElement>(sel)?.textContent?.trim() ?? null;
}

describe("setup-app", () => {
  it("ignores an old failed boot read after a newer connection check succeeds", async () => {
    let rejectOld!: (error: Error) => void;
    const getStatus = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValue({ environment: "production", needs: ["venue"] });
    const el = await mountSetupApp(stubApi({ getStatus }));
    const host = await screenHost(el, "connection");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await flush(el);
    rejectOld(new TypeError("old network failure"));
    await flush(el);
    goto(el, "connection");
    await flush(el);
    expect(
      (await screenHost(el, "connection")).shadowRoot!.querySelector("[role=alert]"),
    ).toBeNull();
  });

  it.each([true, false])(
    "releases a pending connection check when reattached before settlement: %s",
    async (reattachFirst) => {
      let settle!: (status: SetupStatus) => void;
      const status: SetupStatus = {
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      };
      const getStatus = vi
        .fn()
        .mockResolvedValueOnce(status)
        .mockImplementationOnce(
          () =>
            new Promise<SetupStatus>((resolve) => {
              settle = resolve;
            }),
        )
        .mockResolvedValue(status);
      const getDiscovery = vi.fn().mockResolvedValue({ caDownloadAvailable: true });
      const el = await mountSetupApp(stubApi({ getStatus, getDiscovery }));
      const parent = el.parentElement!;
      (await screenHost(el, "connection"))
        .shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!
        .click();
      await flush(el);
      el.remove();
      if (reattachFirst) parent.appendChild(el);
      settle(status);
      await flush(el);
      if (!reattachFirst) {
        parent.appendChild(el);
        await flush(el);
      }
      expect(getDiscovery).toHaveBeenCalledOnce();
      expect(getStatus).toHaveBeenCalledTimes(2);
      if (!reattachFirst) {
        const control = (
          await screenHost(el, "connection")
        ).shadowRoot!.querySelector<HTMLButtonElement>("[data-test=continue]")!;
        expect(control.disabled).toBe(false);
        control.click();
        await flush(el);
      }
      expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
    },
  );

  it("preserves the draft and opens connection help separately after a failed provision", async () => {
    const el = await mountSetupApp(
      stubApi({ provision: vi.fn().mockRejectedValue(new TypeError("network")) }),
    );
    patch(el, { venue: { legalName: "La Mesa" } });
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    const link = host.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=trust-help]")!;
    expect(link.getAttribute("href")).toBe("/setup/trust");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(readDraft(el).venue?.legalName).toBe("La Mesa");
  });

  it("starts certificate setup before collecting details on a box with its own CA", async () => {
    const getDiscovery = vi.fn().mockResolvedValue({ caDownloadAvailable: true });
    const el = await mountSetupApp(stubApi({ getDiscovery }));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).toBeNull();
    const host = await screenHost(el, "connection");
    expect(
      host
        .shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=trust-help]")
        ?.getAttribute("href"),
    ).toBe("/setup/trust");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
  });

  it("keeps the connection step open when the check fails and allows a fresh check", async () => {
    const getStatus = vi.fn().mockRejectedValue(new TypeError("network"));
    const el = await mountSetupApp(
      stubApi({
        getStatus,
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    await flush(el);
    const host = await screenHost(el, "connection");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).toBeNull();
    expect((await screenHost(el, "connection")).shadowRoot!.textContent).toContain(
      "could not reach",
    );
    getStatus.mockResolvedValue({ environment: "preproduction", needs: ["venue"] });
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
  });

  it("says the server is already set up when it answers 404, not that it is unreachable", async () => {
    const el = await mountSetupApp(
      stubApi({
        getStatus: vi.fn().mockRejectedValue({ code: "server.internal", status: 404 }),
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    await flush(el);
    const host = await screenHost(el, "connection");
    const body = host.shadowRoot!.textContent!;
    expect(body).toContain("already set up");
    expect(body).not.toContain("could not reach");
    expect(body).not.toContain("power");
    expect(host.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();
  });

  it("says it could not reach the server when nothing answers at all", async () => {
    const el = await mountSetupApp(
      stubApi({
        getStatus: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    await flush(el);
    const host = await screenHost(el, "connection");
    const body = host.shadowRoot!.textContent!;
    expect(body).toContain("could not reach");
    expect(body).not.toContain("already set up");
    expect(host.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
  });

  /**
   * The connection screen hides its own Continue after the 404, so the shell is driven through the
   * `connection-continue` event it listens for rather than through a click.
   */
  it("never leaves the connection screen with neither a message nor an action", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal", status: 404 });
    const el = await mountSetupApp(
      stubApi({
        getStatus,
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    await flush(el);
    const host = await screenHost(el, "connection");
    expect(host.shadowRoot!.textContent).toContain("already set up");
    expect(host.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();

    // A check that has not answered yet: the previous outcome no longer applies, and the new one is
    // not known.
    getStatus.mockReturnValue(new Promise(() => {}));
    host.dispatchEvent(new CustomEvent("connection-continue"));
    await flush(el);

    const during = await screenHost(el, "connection");
    expect(during.shadowRoot!.textContent).not.toContain("already set up");
    expect(during.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
  });

  it("does not call a server error 'already set up'", async () => {
    const el = await mountSetupApp(
      stubApi({
        getStatus: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    await flush(el);
    const body = (await screenHost(el, "connection")).shadowRoot!.textContent!;
    expect(body).not.toContain("already set up");
    // It answered, so telling the operator to go and check the power is wrong too.
    expect(body).not.toContain("could not reach");
  });

  it("renders the four-choice onboarding screen on boot", async () => {
    const el = await mountSetupApp();
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("h1")?.textContent).toContain(
      "Set up this Waitron server",
    );
  });

  it("routes Join or recover through its subchooser to the mirror connection form", async () => {
    const el = await mountSetupApp();
    const mode = await screenHost(el, "mode");
    mode.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-existing]")!.click();
    await el.updateComplete;
    const subchooser = await screenHost(el, "role");
    subchooser.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-mirror]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).toBeNull();
  });

  it("boot reads the box environment via getStatus and surfaces it on the mode screen", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "production",
      needs: ["venue"],
    } satisfies SetupStatus);
    const el = await mountSetupApp(stubApi({ getStatus }));
    await flush(el);
    expect(getStatus).toHaveBeenCalledOnce();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=environment]")?.textContent).toBe(
      "production",
    );
  });

  it("still renders when boot's getStatus rejects (the try/catch is proven)", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountSetupApp(stubApi({ getStatus }));
    await flush(el);
    const connection = await screenHost(el, "connection");
    expect(connection.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
    expect(connection.shadowRoot!.querySelector("[data-test=environment]")).toBeNull();
  });

  it("#goto flips the visible screen", async () => {
    const el = await mountSetupApp();
    goto(el, "review");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).toBeNull();
  });

  it("renders a screen for every state the machine can reach", async () => {
    const el = await mountSetupApp();
    const screens: Screen[] = [
      "connect",
      "restore",
      "live-source",
      "configuration-preview",
      "fiscal-test",
      "admin",
      "venue",
      "cert",
      "review",
      "provisioning",
      "done",
      "mode",
      "role",
    ];
    for (const screen of screens) {
      goto(el, screen);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)).not.toBeNull();
    }
  });

  it("stages a preparation export and prefills the live venue draft", async () => {
    const preview = {
      venue: {
        country: "ES",
        taxId: "B12345678",
        legalName: "Prepared SL",
        location: {
          id: "source-location",
          name: "Prepared",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurant",
          fiscalTerritory: "ES-common",
          addressLine1: "Calle 1",
          addressLine2: null,
          postalCode: "28001",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
        },
        tillName: "Till",
        seriesCode: "F",
        rectificativeSeriesCode: "R",
      },
      counts: { products: 4 },
      reconnect: ["printers"],
    };
    const stageConfiguration = vi.fn().mockResolvedValue(preview);
    const el = await mountSetupApp(stubApi({ stageConfiguration }));
    const artifact = new File(["encrypted"], "prepared.waitron-config");
    configurationRequest(el, artifact, "a strong passphrase");
    await flush(el);
    expect(stageConfiguration).toHaveBeenCalledWith(artifact, "a strong passphrase");
    expect(el.shadowRoot!.querySelector("[data-test=screen-configuration-preview]")).not.toBeNull();
    expect(readDraft(el)).toMatchObject({
      configurationImport: true,
      venue: { taxId: "B12345678", location: { name: "Prepared" } },
    });
    expect((readDraft(el).venue?.location as Record<string, unknown>).id).toBeUndefined();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=screen-configuration-preview]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!
      .click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-admin]")).not.toBeNull();
  });

  it("stages the selected backup and advances to done", async () => {
    const restore = vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true });
    const el = await mountSetupApp(stubApi({ restore }));
    const request = {
      artifact: new File(["encrypted"], "waitron.backup"),
      recoveryKey: "recovery-key",
      environment: "production" as const,
    };
    restoreRequest(el, request);
    await flush(el);
    expect(restore).toHaveBeenCalledWith(
      request.artifact,
      request.recoveryKey,
      request.environment,
    );
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("routes a failed restore back to the restore form", async () => {
    const restore = vi.fn().mockRejectedValue({ code: "server.internal", params: {} });
    const el = await mountSetupApp(stubApi({ restore }));
    restoreRequest(el, {
      artifact: new File(["encrypted"], "waitron.backup"),
      recoveryKey: "recovery-key",
      environment: "production",
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-restore]")).not.toBeNull();
    expect(await screenText(el, "restore", "[data-test=server-error]")).toContain(
      "could not be staged",
    );
  });

  it("shows Cloud approval and stages only the snapshot the operator confirmed", async () => {
    const requestId = "b6cbaee9-ee8b-4da5-b023-900547debb94";
    const pointId = "3a1d5560-c5bd-407a-b596-e63fbe2600d5";
    const pending = {
      requestId,
      code: "12345678",
      openCloudUrl: `https://cloud.example.test/recover#request=${requestId}`,
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "awaiting_owner",
    };
    const approved = {
      ...pending,
      state: "approved",
      point: {
        id: pointId,
        venueId: "a7f570e8-e510-49eb-b1a7-096ff72171f5",
        capturedAt: "2026-09-24T10:00:00.000Z",
        modules: { core: 1 },
      },
    };
    const startCloudRecovery = vi.fn().mockResolvedValue(pending);
    const cloudRecoveryStatus = vi.fn().mockResolvedValue(approved);
    const restoreFromCloud = vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true });
    const el = await mountSetupApp(
      stubApi({ startCloudRecovery, cloudRecoveryStatus, restoreFromCloud }),
    );
    goto(el, "cloud-restore");
    await flush(el);
    cloudRecoveryAction(el, "start");
    await flush(el);
    expect((await screenHost(el, "cloud-restore")).shadowRoot!.textContent).toContain("12345678");
    cloudRecoveryAction(el, "status");
    await flush(el);
    expect((await screenHost(el, "cloud-restore")).shadowRoot!.textContent).toContain("2026-09-24");
    cloudRecoveryAction(el, "restore", pointId);
    await flush(el);
    expect(restoreFromCloud).toHaveBeenCalledWith(pointId);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("submits one Cloud restore when the rendered button is clicked twice before the shell redraws", async () => {
    const pointId = "3a1d5560-c5bd-407a-b596-e63fbe2600d5";
    const approved = {
      requestId: "b6cbaee9-ee8b-4da5-b023-900547debb94",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=b6cbaee9-ee8b-4da5-b023-900547debb94",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "approved",
      point: {
        id: pointId,
        venueId: "a7f570e8-e510-49eb-b1a7-096ff72171f5",
        capturedAt: "2026-09-24T10:00:00.000Z",
        modules: { core: 1 },
      },
    };
    let finishRestore!: (value: { restoreStaged: true; restarting: true }) => void;
    const restorePending = new Promise<{ restoreStaged: true; restarting: true }>((resolve) => {
      finishRestore = resolve;
    });
    const restoreFromCloud = vi.fn().mockReturnValue(restorePending);
    const el = await mountSetupApp(
      stubApi({ cloudRecoveryStatus: vi.fn().mockResolvedValue(approved), restoreFromCloud }),
    );
    goto(el, "cloud-restore");
    await flush(el);
    cloudRecoveryAction(el, "status");
    await flush(el);
    const screen = (await screenHost(el, "cloud-restore")) as SetupCloudRestoreScreen;
    const checkbox = screen.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await screen.updateComplete;
    const restore = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!;
    restore.click();
    restore.click();
    expect(restoreFromCloud).toHaveBeenCalledTimes(1);
    expect(restoreFromCloud).toHaveBeenCalledWith(pointId);
    finishRestore({ restoreStaged: true, restarting: true });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("keeps the Cloud recovery screen available after a lost start reply", async () => {
    const startCloudRecovery = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost reply"))
      .mockResolvedValue({
        requestId: "b6cbaee9-ee8b-4da5-b023-900547debb94",
        code: "12345678",
        openCloudUrl:
          "https://cloud.example.test/recover#request=b6cbaee9-ee8b-4da5-b023-900547debb94",
        expiresAt: "2026-09-24T12:00:00.000Z",
        state: "awaiting_owner",
      });
    const el = await mountSetupApp(stubApi({ startCloudRecovery }));
    goto(el, "cloud-restore");
    await flush(el);
    cloudRecoveryAction(el, "start");
    await flush(el);
    expect(await screenText(el, "cloud-restore", "[data-test=server-error]")).toContain(
      "unavailable",
    );
    cloudRecoveryAction(el, "start");
    await flush(el);
    expect(startCloudRecovery).toHaveBeenCalledTimes(2);
    expect((await screenHost(el, "cloud-restore")).shadowRoot!.textContent).toContain("12345678");
  });

  it("routes a demo draft to review on setup-advance from venue", async () => {
    const el = await mountSetupApp();
    goto(el, "venue");
    patch(el, { mode: "demo" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-cert]")).toBeNull();
  });

  it("routes a live ES-common draft to cert on setup-advance from venue", async () => {
    const el = await mountSetupApp();
    // The seeded draft already carries `venue.location.fiscalTerritory = "ES-common"`.
    goto(el, "venue");
    patch(el, { mode: "live" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-cert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).toBeNull();
  });

  it("skips certificate and fiscal services in the development onboarding target", async () => {
    const el = await mountSetupApp(
      stubApi({
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
        getStatus: vi.fn().mockResolvedValue({
          provisioned: false,
          environment: "preproduction",
          developmentMode: true,
          needs: ["venue"],
        }),
      }),
    );
    await flush(el);
    goto(el, "venue");
    patch(el, { mode: "live" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
  });

  it("runs the fiscal test and exposes Continue only after the server reports acceptance", async () => {
    const runFiscalTest = vi.fn().mockResolvedValue({
      status: "accepted",
      testedAt: "2026-09-09T00:00:00.000Z",
    });
    const el = await mountSetupApp(stubApi({ runFiscalTest }));
    goto(el, "fiscal-test");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=screen-fiscal-test]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=run]")!
      .click();
    await flush(el);
    expect(runFiscalTest).toHaveBeenCalledOnce();
    expect(
      el
        .shadowRoot!.querySelector<HTMLElement>("[data-test=screen-fiscal-test]")!
        .shadowRoot!.querySelector("[data-test=continue]"),
    ).not.toBeNull();
  });

  it("routes a live non-ES-common draft to review on setup-advance (both operands matter)", async () => {
    const el = await mountSetupApp();
    goto(el, "venue");
    patch(el, {
      mode: "live",
      venue: { location: { fiscalTerritory: "ES-other" } },
    } as unknown as DeepPartial<ProvisionBody>);
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-cert]")).toBeNull();
  });

  it("ignores setup-advance when the current screen is not venue", async () => {
    const el = await mountSetupApp();
    goto(el, "review");
    await el.updateComplete;
    patch(el, { mode: "live" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-cert]")).toBeNull();
  });

  it("clears a routed venue error when advancing forward off the venue screen", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "provisioning.territory_country_mismatch", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(
      "country must match",
    );
    // The operator corrects and advances (demo → review): the stale banner does not follow.
    patch(el, { mode: "demo" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    goto(el, "venue");
    await el.updateComplete;
    expect(await screenText(el, "venue", "[data-test=server-error]")).toBeNull();
  });

  it("#onPatch deep-merges a screen's slice into the draft, preserving seeded siblings", async () => {
    const el = await mountSetupApp();
    expect(readDraft(el).venue?.country).toBe("ES");
    expect(readDraft(el).venue?.location?.timeZone).toBe("Europe/Madrid");

    patch(el, { mode: "live", venue: { taxId: "B12345678", location: { city: "Madrid" } } });

    const draft = readDraft(el);
    expect(draft.mode).toBe("live");
    expect(draft.venue?.taxId).toBe("B12345678");
    expect(draft.venue?.location?.city).toBe("Madrid");
    expect(draft.venue?.location?.timeZone).toBe("Europe/Madrid");
    expect(draft.venue?.location?.fiscalTerritory).toBe("ES-common");
    expect(draft.venue?.country).toBe("ES");
  });

  it("#onPatch skips an explicit undefined so a partial re-emit never deletes a sibling", async () => {
    const el = await mountSetupApp();
    patch(el, { venue: { taxId: "B12345678" } });
    patch(el, { mode: "demo", venue: { taxId: undefined, legalName: "Deli SL" } });
    const draft = readDraft(el);
    expect(draft.venue?.taxId).toBe("B12345678");
    expect(draft.venue?.legalName).toBe("Deli SL");
    expect(draft.mode).toBe("demo");
  });

  it("#onPatch replaces an array wholesale rather than element-merging it", async () => {
    const el = await mountSetupApp();
    patch(el, { venue: { location: { invoiceLocales: ["es-ES", "en-GB"] } } });
    expect(readDraft(el).venue?.location?.invoiceLocales).toEqual(["es-ES", "en-GB"]);
  });

  it("provisions on provision-requested and, on the 200, advances to done", async () => {
    const provision = vi.fn().mockResolvedValue({
      provisioned: true,
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("threads demo intent through to the done screen", async () => {
    const el = await mountSetupApp(
      stubApi({
        provision: vi.fn().mockResolvedValue({ provisioned: true, restarting: true }),
      }),
    );
    patch(el, { mode: "demo" });
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "done");
    expect((host as unknown as { onboardingIntent: string }).onboardingIntent).toBe("demo");
  });

  it("does not treat a live provision as demo mode on the done screen", async () => {
    const el = await mountSetupApp(
      stubApi({
        provision: vi.fn().mockResolvedValue({ provisioned: true, restarting: true }),
      }),
    );
    patch(el, { mode: "live" });
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "done");
    expect((host as unknown as { onboardingIntent: string }).onboardingIntent).toBe("live");
  });

  it("does not treat a prepared provision as demo mode on the done screen", async () => {
    const el = await mountSetupApp(
      stubApi({
        provision: vi.fn().mockResolvedValue({ provisioned: true, restarting: true }),
      }),
    );
    patch(el, { mode: "prepare" });
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "done");
    expect((host as unknown as { onboardingIntent: string }).onboardingIntent).toBe("prepare");
  });

  it("shows the in-flight state with a DISABLED provision control while the POST is pending", async () => {
    let resolveProvision!: (value: unknown) => void;
    const provision = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProvision = resolve;
        }),
    );
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await el.updateComplete;
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=status]")).not.toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=provision]")!.hasAttribute("disabled")).toBe(
      true,
    );
    resolveProvision({ provisioned: true, restarting: true });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("maps setup.request_invalid back to review with a banner naming the field", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "setup.request_invalid", params: { field: "taxId" } });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("taxId");
  });

  // Asserted on the form's own input, because a path the shell routes on but the form has no entry
  // for would land the operator on a form saying nothing at all.
  it.each([
    ["legalName", "legalName"],
    ["seriesCode", "seriesCode"],
    ["rectificativeSeriesCode", "rectificativeSeriesCode"],
    ["location.operationDescription", "operationDescription"],
  ])("sends a %s refusal back to the venue form with the field marked", async (field, key) => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "setup.request_invalid", params: { field } });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).toBeNull();
    const venue = await screenHost(el, "venue");
    expect((venue as unknown as { invalidField?: string }).invalidField).toBe(field);
    const input = venue.shadowRoot!.querySelector(`[data-test=${key}]`)!;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.hasAttribute("invalid")).toBe(true);
    expect((input as unknown as { error: string }).error).not.toBe("");
  });

  it("still routes a field the fiscal seat does not refuse to the review banner", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "setup.request_invalid", params: { field: "mode" } });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("mode");
  });

  it("drops the server's field mark when the operator navigates away and back", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "setup.request_invalid", params: { field: "seriesCode" } });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const marked = await screenHost(el, "venue");
    expect((marked as unknown as { invalidField?: string }).invalidField).toBe("seriesCode");
    goto(el, "admin");
    await el.updateComplete;
    goto(el, "venue");
    await el.updateComplete;
    const venue = await screenHost(el, "venue");
    expect((venue as unknown as { invalidField?: string }).invalidField).toBeUndefined();
  });

  it("maps a fieldless setup.request_invalid to a generic review banner", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.request_invalid", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("rejected the details");
  });

  it("routes a server-rejected admin email back to review with an actionable message", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "person.email_invalid", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("admin email");
  });

  it("routes setup.provisioning_secret_required back to the cert screen", async () => {
    const provision = vi.fn().mockRejectedValue({
      code: "setup.provisioning_secret_required",
      params: { module: "verifactu" },
    });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-cert]")).not.toBeNull();
  });

  it("maps setup.already_provisioning to an in-progress message with a reload (no retry)", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.already_provisioning", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(
      "already in progress",
    );
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent).toContain("Reload");
  });

  it("points at the certificate guide without promising a re-imaging section", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "server.internal", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    const help = host.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=trust-help]")!;
    expect(help.getAttribute("href")).toBe("/setup/trust");
    expect(host.shadowRoot!.textContent).not.toContain("re-imaged");
  });

  it("maps a conflicting saved operation to a terminal recovery message", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.operation_conflict", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("saved setup");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")).not.toBeNull();
  });

  it.each(["setup.already_provisioned", "deployment.already_stamped"])(
    "maps the fiscal 409 %s to 'already set up' with a reload and NO retry (re-POST is unrecoverable)",
    async (code) => {
      const provision = vi.fn().mockRejectedValue({ code, params: {} });
      const el = await mountSetupApp(stubApi({ provision }));
      provisionRequest(el);
      await flush(el);
      expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("already set up");
      const host = await screenHost(el, "provisioning");
      expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
      expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent).toContain(
        "open the till",
      );
    },
  );

  it("maps setup.not_ready to a not-ready message that CAN be retried", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.not_ready", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("isn't ready");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).not.toBeNull();
  });

  it("maps server.internal (the real generic-crash code) to a retryable in-place failure", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "server.internal", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(
      "Provisioning failed",
    );
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).not.toBeNull();
  });

  it("maps any unrecognised non-venue code through the default branch to a retryable failure", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "some.unexpected_code", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(
      "Provisioning failed",
    );
  });

  it.each([
    ["a bare TypeError (network drop mid-provision)", new TypeError("network")],
    ["a SyntaxError (non-JSON 502 error body)", new SyntaxError("Unexpected token < in JSON")],
  ])(
    "routes a code-less rejection (%s) to the generic retryable failure without stranding",
    async (_label, rejection) => {
      const rejections: PromiseRejectionEvent[] = [];
      const onReject = (e: PromiseRejectionEvent) => rejections.push(e);
      window.addEventListener("unhandledrejection", onReject);
      try {
        const provision = vi.fn().mockRejectedValue(rejection);
        const el = await mountSetupApp(stubApi({ provision }));
        provisionRequest(el);
        await flush(el);
        // On the provisioning screen with the generic retryable message + a retry control — NOT stranded
        // on the in-flight state, which is what a thrown `undefined.startsWith` would have left behind.
        expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(
          "Provisioning failed",
        );
        const host = await screenHost(el, "provisioning");
        expect(host.shadowRoot!.querySelector("[data-test=retry]")).not.toBeNull();
      } finally {
        window.removeEventListener("unhandledrejection", onReject);
      }
      expect(rejections).toEqual([]);
    },
  );

  it("clears a routed venue error on a manual re-navigation so it doesn't reappear stale", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "provisioning.territory_country_mismatch", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
    expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(
      "country must match",
    );
    goto(el, "admin");
    await el.updateComplete;
    goto(el, "venue");
    await el.updateComplete;
    expect(await screenText(el, "venue", "[data-test=server-error]")).toBeNull();
  });

  it.each([
    ["provisioning.territory_country_mismatch", "country must match the fiscal territory"],
    ["provisioning.invalid_locales", "Choose 1 or 2 invoice locales"],
    ["provisioning.duplicate_series_code", "must differ"],
    ["fiscal.regime_not_implemented", "isn't supported yet"],
  ])(
    "routes venue-data code %s BACK to the venue form with its message",
    async (code, fragment) => {
      const provision = vi.fn().mockRejectedValue({ code, params: {} });
      const el = await mountSetupApp(stubApi({ provision }));
      provisionRequest(el);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
      expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(fragment);
    },
  );

  it("routes an unlisted provisioning.* code back to venue with a generic message naming the code", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "provisioning.invalid_country", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
    expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(
      "provisioning.invalid_country",
    );
  });

  it("retries the POST when the provisioning screen's retry re-emits provision-requested", async () => {
    const provision = vi
      .fn()
      .mockRejectedValueOnce({ code: "setup.provision_failed", params: {} })
      .mockResolvedValue({ provisioned: true, restarting: true });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await flush(el);
    expect(provision).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it("never posts a stale AEAT cert on a demo provision reached by reverting from live", async () => {
    const provision = vi.fn().mockResolvedValue({
      provisioned: true,
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ provision }));
    // live → cert (PFX filled) → … → back to mode → switch to Demo: the draft still holds the cert.
    patch(el, {
      mode: "live",
      aeatCert: { pfxBase64: "AAAA", passphrase: "x", certKind: "sello" },
    });
    patch(el, { mode: "demo" });
    expect(readDraft(el).aeatCert?.pfxBase64).toBe("AAAA");
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    const body = provision.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.mode).toBe("demo");
    expect("aeatCert" in body).toBe(false);
  });

  it("mounts the real connect screen on the mirror path", async () => {
    const el = await mountSetupApp();
    goto(el, "connect");
    await el.updateComplete;
    const connect = await screenHost(el, "connect");
    expect(connect.shadowRoot!.querySelector("h1")?.textContent).toContain(
      "Connect to the primary",
    );
  });

  it("adopts on adopt-requested and, on the 200, advances to done — forwarding the body verbatim", async () => {
    const adopt = vi.fn().mockResolvedValue({ adopted: true, restarting: true });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(adopt).toHaveBeenCalledWith(adoptBody);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  // Weaker than its name: it checks the secret and its warning render, not that the secret is never
  // shown a second time.
  it("surfaces the break-glass secret ONCE on the done screen after a successful adopt", async () => {
    const secret = "bg-secret-once-9f3a";
    const adopt = vi.fn().mockResolvedValue({
      adopted: true,
      breakGlassSecret: secret,
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    expect(await screenText(el, "done", "[data-test=break-glass-secret]")).toBe(secret);
    // Whitespace is collapsed because the rendered copy wraps across lines.
    const warning = (await screenText(el, "done", "[data-test=break-glass-warning]"))
      ?.toLowerCase()
      .replace(/\s+/g, " ");
    expect(warning).toContain("will not be shown again");
  });

  it("shows the in-flight provisioning state while the adopt POST is pending", async () => {
    let resolveAdopt!: (value: unknown) => void;
    const adopt = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdopt = resolve;
        }),
    );
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-provisioning]")).not.toBeNull();
    resolveAdopt({ adopted: true, restarting: true });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it.each([
    ["mirror.bundle_fetch_failed", "reach the primary"],
    ["setup.request_invalid", "rejected the details"],
    ["setup.not_ready", "isn't ready"],
    ["server.internal", "Couldn't connect"],
    ["some.unexpected_code", "Couldn't connect"],
  ])(
    "routes the adopt failure %s back to the connect form with a banner",
    async (code, fragment) => {
      const adopt = vi.fn().mockRejectedValue({ code, params: {} });
      const el = await mountSetupApp(stubApi({ adopt }));
      adoptRequest(el);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
      expect(await screenText(el, "connect", "[data-test=server-error]")).toContain(fragment);
    },
  );

  it.each([
    ["a bare TypeError (network drop mid-adopt)", new TypeError("network")],
    ["a SyntaxError (non-JSON 502 error body)", new SyntaxError("Unexpected token < in JSON")],
  ])(
    "routes a code-less adopt rejection (%s) back to connect without stranding",
    async (_l, rejection) => {
      const rejections: PromiseRejectionEvent[] = [];
      const onReject = (e: PromiseRejectionEvent) => rejections.push(e);
      window.addEventListener("unhandledrejection", onReject);
      try {
        const adopt = vi.fn().mockRejectedValue(rejection);
        const el = await mountSetupApp(stubApi({ adopt }));
        adoptRequest(el);
        await flush(el);
        expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
        expect(await screenText(el, "connect", "[data-test=server-error]")).toContain(
          "Couldn't connect",
        );
      } finally {
        window.removeEventListener("unhandledrejection", onReject);
      }
      expect(rejections).toEqual([]);
    },
  );

  it("maps setup.already_provisioning on adopt to an in-progress message with a reload (no retry)", async () => {
    const adopt = vi.fn().mockRejectedValue({ code: "setup.already_provisioning", params: {} });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(
      "already in progress",
    );
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent).toContain("Reload");
  });

  it.each(["setup.already_provisioned", "deployment.already_stamped"])(
    "maps the fiscal 409 %s on adopt to 'already set up' with a bare reload and NO retry",
    async (code) => {
      const adopt = vi.fn().mockRejectedValue({ code, params: {} });
      const el = await mountSetupApp(stubApi({ adopt }));
      adoptRequest(el);
      await flush(el);
      expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("already set up");
      const host = await screenHost(el, "provisioning");
      expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
      const reload = host.shadowRoot!.querySelector("[data-test=reload]");
      expect(reload?.textContent?.trim()).toBe("Reload");
      expect(reload?.textContent).not.toContain("dashboard");
    },
  );

  it("re-adopts when the connect form re-emits adopt-requested after a routed-back failure", async () => {
    const adopt = vi
      .fn()
      .mockRejectedValueOnce({ code: "mirror.bundle_fetch_failed", params: {} })
      .mockResolvedValue({ adopted: true, restarting: true });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
    adoptRequest(el);
    await flush(el);
    expect(adopt).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });
});

describe("assembleBody", () => {
  it("omits the aeatCert key entirely for a demo draft (never null/empty)", () => {
    const body = assembleBody({ mode: "demo", venue: { taxId: "B1" } });
    expect("aeatCert" in body).toBe(false);
  });

  it("drops a stale certificate from a Prepare draft", () => {
    const body = assembleBody({
      mode: "prepare",
      aeatCert: { pfxBase64: "AAAA", passphrase: "x", certKind: "sello" },
    });
    expect("aeatCert" in body).toBe(false);
  });

  it("keeps a present certificate for a live draft", () => {
    const aeatCert = { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" as const };
    const body = assembleBody({ mode: "live", venue: { taxId: "B1" }, aeatCert });
    expect(body.aeatCert).toEqual(aeatCert);
  });

  it("drops a stale certificate when the mode is demo, even with a present PFX", () => {
    const body = assembleBody({
      mode: "demo",
      aeatCert: { pfxBase64: "AAAA", passphrase: "x", certKind: "sello" },
    });
    expect("aeatCert" in body).toBe(false);
  });

  it("drops an aeatCert whose pfxBase64 is empty", () => {
    const body = assembleBody({
      mode: "live",
      aeatCert: { pfxBase64: "", passphrase: "", certKind: "sello" },
    });
    expect("aeatCert" in body).toBe(false);
  });
});

describe("A2 mode boundaries", () => {
  it.each(["prepare", "live"] as const)(
    "discards Demo business identity when switching to %s, keeping the operator and address",
    async (mode) => {
      const el = await mountSetupApp();
      patch(el, {
        mode: "demo",
        venue: {
          taxId: "B12345674",
          legalName: "Demo company",
          tillName: "Caja 1",
          seriesCode: "FS",
          rectificativeSeriesCode: "FR",
          admin: { displayName: "Ada" },
          location: {
            name: "Calle Mayor",
            addressLine1: "Calle Mayor 1",
            operationDescription: "Demo description",
            invoiceLocales: ["es-ES"],
            dayCutover: "04:00",
          },
        },
      });
      patch(el, { mode });
      const draft = readDraft(el);
      expect(draft.venue?.taxId).toBeUndefined();
      expect(draft.venue?.legalName).toBeUndefined();
      expect(draft.venue?.location?.operationDescription).toBeUndefined();
      expect(draft.venue?.admin?.displayName).toBe("Ada");
      expect(draft.venue?.location?.addressLine1).toBe("Calle Mayor 1");
    },
  );
  it("passes fiscal defaults from the server to the shop form", async () => {
    const defaults = { verifactu: { operationDescription: "Venta en establecimiento" } };
    const el = await mountSetupApp(
      stubApi({ getVenueDefaults: vi.fn().mockResolvedValue(defaults) }),
    );
    await flush(el);
    goto(el, "venue");
    await flush(el);
    expect(((await screenHost(el, "venue")) as unknown as { defaults: unknown }).defaults).toEqual(
      defaults,
    );
  });
});

describe("modal shell", () => {
  it("renders the wizard inside an open, non-dismissible modal", async () => {
    const el = await mountSetupApp();
    const modal = el.shadowRoot!.querySelector("wt-modal") as HTMLElement & {
      open: boolean;
      dismissible: boolean;
    };
    expect(modal).not.toBeNull();
    expect(modal.open).toBe(true);
    expect(modal.dismissible).toBe(false);
    // The screens keep their own h1, so the modal is named by a label rather than its heading —
    // setting `heading` would paint a second title above the first.
    expect(modal.getAttribute("aria-label")).toBe("Set up your server");
    expect(modal.getAttribute("heading")).toBeNull();
  });

  it("mounts the current screen inside the modal, not beside it", async () => {
    const el = await mountSetupApp();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.querySelector("[data-test^=screen-]")).not.toBeNull();
  });
});

describe("connection checks", () => {
  it("does not start a second check while one is still running", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ environment: "preproduction", needs: ["venue"] })
      .mockReturnValue(new Promise(() => {}));
    const el = await mountSetupApp(
      stubApi({
        getStatus,
        getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }),
      }),
    );
    const host = await screenHost(el, "connection");
    host.dispatchEvent(new CustomEvent("connection-continue"));
    host.dispatchEvent(new CustomEvent("connection-continue"));
    await flush(el);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("ignores a boot read that answers after a newer check already succeeded", async () => {
    const boot = deferred<SetupStatus>();
    const getStatus = vi
      .fn()
      .mockReturnValueOnce(boot.promise)
      .mockResolvedValue({ environment: "preproduction", needs: ["venue"] });
    const el = await mountSetupApp(stubApi({ getStatus }));
    (await screenHost(el, "connection")).dispatchEvent(new CustomEvent("connection-continue"));
    await flush(el);
    boot.resolve({ provisioned: false, environment: "production", needs: ["venue"] });
    await flush(el);
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=environment]")?.textContent).toBe(
      "preproduction",
    );
  });

  it("writes nothing when the boot read answers after the element is detached", async () => {
    const boot = deferred<SetupStatus>();
    const el = await mountSetupApp(stubApi({ getStatus: vi.fn().mockReturnValue(boot.promise) }));
    el.remove();
    boot.resolve({ provisioned: false, environment: "production", needs: ["venue"] });
    await flush(el);
    expect(readState(el, ["screen", "environment"])).toEqual({
      screen: "connection",
      environment: undefined,
    });
  });
});

describe("venue defaults", () => {
  it("keeps defaults that arrive after the element is detached off the element", async () => {
    const defaults = deferred<unknown>();
    const el = await mountSetupApp(
      stubApi({ getVenueDefaults: vi.fn().mockReturnValue(defaults.promise) }),
    );
    el.remove();
    defaults.resolve({ verifactu: { operationDescription: "Venta en establecimiento" } });
    await flush(el);
    expect(readState(el, ["venueDefaults"])).toEqual({ venueDefaults: {} });
  });

  it("reloads the defaults when the shop form asks again, without the request leaving the shell", async () => {
    const defaults = { verifactu: { operationDescription: "Venta en establecimiento" } };
    const getVenueDefaults = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue(defaults);
    const el = await mountSetupApp(stubApi({ getVenueDefaults }));
    const leaked: Event[] = [];
    el.parentElement!.addEventListener("setup-defaults-requested", (e) => leaked.push(e));
    patch(el, { mode: "demo" });
    goto(el, "venue");
    await flush(el);
    const venue = await screenHost(el, "venue");
    expect(venue.shadowRoot!.querySelector("[data-test=defaults-error]")).not.toBeNull();
    venue.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-defaults]")!.click();
    await flush(el);
    expect(getVenueDefaults).toHaveBeenCalledTimes(2);
    expect(((await screenHost(el, "venue")) as unknown as { defaults: unknown }).defaults).toEqual(
      defaults,
    );
    expect(leaked).toEqual([]);
  });
});

describe("provision refusals that need a fiscal test", () => {
  it("sends setup.fiscal_test_required back to the fiscal test, clearing an earlier acceptance", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.fiscal_test_required", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    fiscalTestRequest(el);
    await flush(el);
    provisionRequest(el);
    await flush(el);
    const screen = await screenHost(el, "fiscal-test");
    expect(screen.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      "Run an accepted fiscal test before activating production.",
    );
    expect(screen.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-test=run]")).not.toBeNull();
  });
});

describe("restore, configuration and fiscal-test outcomes", () => {
  it("tells the operator to check the connection when a restore fails with no code", async () => {
    const el = await mountSetupApp(
      stubApi({ restore: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }),
    );
    restoreRequest(el, {
      artifact: new File(["encrypted"], "waitron.backup"),
      recoveryKey: "recovery-key",
      environment: "production",
    });
    await flush(el);
    expect(await screenText(el, "restore", "[data-test=server-error]")).toBe(
      "The backup could not be staged. Check the connection and try again.",
    );
  });

  it("returns a configuration export that cannot be opened to the live-source form", async () => {
    const el = await mountSetupApp(
      stubApi({
        stageConfiguration: vi
          .fn()
          .mockRejectedValue({ code: "setup.configuration_import_failed", params: {} }),
      }),
    );
    configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
    await flush(el);
    expect(await screenText(el, "live-source", "[role=alert]")).toBe(
      "The configuration export could not be opened. Check the file and passphrase.",
    );
    expect(readDraft(el).configurationImport).toBeUndefined();
  });

  it("treats a fiscal test the regime does not need as accepted", async () => {
    const el = await mountSetupApp(
      stubApi({ runFiscalTest: vi.fn().mockResolvedValue({ status: "not-applicable" }) }),
    );
    goto(el, "fiscal-test");
    fiscalTestRequest(el);
    await flush(el);
    const screen = await screenHost(el, "fiscal-test");
    expect(screen.shadowRoot!.querySelector("[role=status]")?.textContent).toContain(
      "AEAT accepted",
    );
    expect(screen.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
  });

  it("reports a fiscal test that could not run and offers the run again", async () => {
    const el = await mountSetupApp(
      stubApi({ runFiscalTest: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }),
    );
    goto(el, "fiscal-test");
    fiscalTestRequest(el);
    await flush(el);
    const screen = await screenHost(el, "fiscal-test");
    expect(screen.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      "The fiscal test could not run. Check the connection and try again.",
    );
    const run = screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=run]",
    )!;
    expect(run.disabled).toBe(false);
  });
});

describe("an answer that arrives after the element is detached", () => {
  const backup = {
    artifact: new File(["encrypted"], "waitron.backup"),
    recoveryKey: "recovery-key",
    environment: "production" as const,
  };
  const configFile = new File(["encrypted"], "prepared.waitron-config");
  const preview = {
    venue: { legalName: "Prepared SL", location: { id: "source-location", name: "Prepared" } },
    counts: {},
    reconnect: [],
  };

  it.each([
    {
      name: "a provision success",
      method: "provision",
      fire: provisionRequest,
      settle: (d: ReturnType<typeof deferred>) =>
        d.resolve({ provisioned: true, restarting: true }),
      unchanged: { screen: "provisioning" },
    },
    {
      name: "a provision refusal",
      method: "provision",
      fire: provisionRequest,
      settle: (d: ReturnType<typeof deferred>) =>
        d.reject({ code: "setup.request_invalid", params: {} }),
      unchanged: { screen: "provisioning", reviewError: undefined },
    },
    {
      name: "an adopt success",
      method: "adopt",
      fire: (el: SetupApp) => adoptRequest(el),
      settle: (d: ReturnType<typeof deferred>) =>
        d.resolve({ adopted: true, breakGlassSecret: "bg", restarting: true }),
      unchanged: { screen: "provisioning", breakGlassSecret: undefined, mirrorJoin: false },
    },
    {
      name: "an adopt refusal",
      method: "adopt",
      fire: (el: SetupApp) => adoptRequest(el),
      settle: (d: ReturnType<typeof deferred>) =>
        d.reject({ code: "mirror.bundle_fetch_failed", params: {} }),
      unchanged: { screen: "provisioning", connectError: undefined },
    },
    {
      name: "a restore success",
      method: "restore",
      fire: (el: SetupApp) => restoreRequest(el, backup),
      settle: (d: ReturnType<typeof deferred>) =>
        d.resolve({ restoreStaged: true, restarting: true }),
      unchanged: { screen: "provisioning" },
    },
    {
      name: "a restore refusal",
      method: "restore",
      fire: (el: SetupApp) => restoreRequest(el, backup),
      settle: (d: ReturnType<typeof deferred>) => d.reject({ code: "server.internal", params: {} }),
      unchanged: { screen: "provisioning", restoreError: undefined },
    },
    {
      name: "a staged configuration",
      method: "stageConfiguration",
      fire: (el: SetupApp) => configurationRequest(el, configFile, "passphrase"),
      settle: (d: ReturnType<typeof deferred>) => d.resolve(preview),
      unchanged: { screen: "live-source", configurationPreview: undefined },
    },
    {
      name: "a configuration refusal",
      method: "stageConfiguration",
      fire: (el: SetupApp) => configurationRequest(el, configFile, "passphrase"),
      settle: (d: ReturnType<typeof deferred>) => d.reject({ code: "server.internal", params: {} }),
      unchanged: { screen: "live-source", configurationError: undefined },
    },
    {
      name: "a fiscal test result",
      method: "runFiscalTest",
      fire: fiscalTestRequest,
      settle: (d: ReturnType<typeof deferred>) => d.resolve({ status: "accepted" }),
      unchanged: { fiscalTestStatus: undefined },
    },
    {
      name: "a fiscal test failure",
      method: "runFiscalTest",
      fire: fiscalTestRequest,
      settle: (d: ReturnType<typeof deferred>) => d.reject(new TypeError("Failed to fetch")),
      unchanged: { fiscalTestError: undefined },
    },
  ])("writes nothing for $name", async ({ method, fire, settle, unchanged }) => {
    const pending = deferred();
    const el = await mountSetupApp(stubApi({ [method]: vi.fn().mockReturnValue(pending.promise) }));
    goto(el, "live-source");
    fire(el);
    await el.updateComplete;
    el.remove();
    settle(pending);
    await flush(el);
    expect(readState(el, Object.keys(unchanged))).toEqual(unchanged);
    if (method === "stageConfiguration") expect(readDraft(el).configurationImport).toBeUndefined();
  });
});

describe("screen fallback", () => {
  it("shows the four-choice screen for a screen name outside the wizard's list", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "production",
      needs: ["venue"],
    } satisfies SetupStatus);
    const el = await mountSetupApp(stubApi({ getStatus }));
    goto(el, "no-such-screen" as Screen);
    await el.updateComplete;
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=environment]")?.textContent).toBe(
      "production",
    );
  });
});
