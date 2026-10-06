import { leaveCoordinatorFor } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import indexHtml from "../index.html?raw";
import { SetupApp, assembleBody } from "./setup-app.js";
import type { DeepPartial, Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi, SetupStatus } from "./api/client.js";
import type { SetupCloudRestoreScreen } from "./screens/cloud-restore-screen.js";
import type { SetupRestoreBucketScreen } from "./screens/restore-bucket-screen.js";
import type { SetupRestoreScreen } from "./screens/restore-screen.js";
import type { SetupDoneScreen } from "./screens/done-screen.js";
import type { BucketRestoreRequestDetail } from "./events.js";
import { currentLocale, setLocale } from "./i18n/t.js";

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
    restoreFromBucket: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
    startCloudRecovery: vi.fn(),
    cloudRecoveryStatus: vi.fn(),
    startCloudRecoveryAgain: vi.fn(),
    restoreFromCloud: vi.fn(),
    stageConfiguration: vi.fn(),
    runFiscalTest: vi.fn().mockResolvedValue({ status: "accepted" }),
    resetIncompleteAdopt: vi.fn().mockResolvedValue({ resetStaged: true, restarting: true }),
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

const wizard = (el: SetupApp) => el.shadowRoot!.querySelector<HTMLElement>("main")!;

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
  request: {
    artifact: File;
    recoveryKey: string;
    environment: "production" | "preproduction";
    oldBoxGone?: boolean;
  },
): void {
  wizard(el).dispatchEvent(
    new CustomEvent("restore-requested", {
      detail: { request: { oldBoxGone: false, ...request } },
      bubbles: true,
      composed: true,
    }),
  );
}

function bucketRequest(el: SetupApp, request: Partial<BucketRestoreRequestDetail> = {}): void {
  wizard(el).dispatchEvent(
    new CustomEvent("bucket-restore-requested", {
      detail: {
        request: {
          kit: "k",
          environment: "production",
          oldBoxGone: false,
          venueConfirmed: null,
          ...request,
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
}

function cloudRecoveryAction(
  el: SetupApp,
  action: "start" | "status" | "start-again" | "restore",
  pointId?: string,
  oldBoxGone?: boolean,
): void {
  wizard(el).dispatchEvent(
    new CustomEvent("cloud-restore-action", {
      detail: { action, pointId, oldBoxGone },
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

/** The message under the field `data-test` names: a shared field's own `error`, or else the
 * screen's `#<name>-error` paragraph. */
function messageUnder(screen: HTMLElement, name: string): string | null {
  const field = screen.shadowRoot!.querySelector<HTMLElement & { error: string }>(
    `:is(wt-input, wt-textarea, wt-combobox)[data-test="${name}"]`,
  );
  if (field !== null) return field.error;
  return screen.shadowRoot!.querySelector(`#${name}-error`)?.textContent ?? null;
}

/** The kit and environment are shared fields, whose invalid marking is inside their own shadow roots,
 * where a `[aria-invalid=true]` query of the screen cannot see it. */
async function expectBucketSharedFieldsUnmarked(screen: HTMLElement): Promise<void> {
  for (const [field, control] of [
    ["kit", "textarea"],
    ["environment", ".trigger"],
  ] as const) {
    const box = screen.shadowRoot!.querySelector<
      HTMLElement & { error: string; invalid: boolean; updateComplete: Promise<unknown> }
    >(`[data-test=${field}]`)!;
    await box.updateComplete;
    expect({ field, error: box.error, invalid: box.invalid }).toEqual({
      field,
      error: "",
      invalid: false,
    });
    expect(box.shadowRoot!.querySelector(control)!.getAttribute("aria-invalid")).toBe("false");
  }
}

/** The one message above a screen's primary action, or "" when it shows none. */
async function bottomOf(host: HTMLElement): Promise<string> {
  const actions = host.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

/** The stopped-partway message offers the reset in place of support, and nothing else. */
async function expectAdoptIncompleteWithReset(el: SetupApp): Promise<void> {
  expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).toBeNull();
  const text = (await screenText(el, "provisioning", "[data-test=error]"))!.replace(/\s+/g, " ");
  expect(text).toContain("partly set up");
  expect(text).toContain("stopped partway");
  expect(text).toContain("admin person ID and password you used to connect");
  expect(text).not.toContain("Contact support");
  const host = await screenHost(el, "provisioning");
  expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
  expect(host.shadowRoot!.querySelector("[data-test=reload]")).toBeNull();
  expect(host.shadowRoot!.querySelector("[data-test=reset]")?.textContent?.trim()).toBe(
    "Reset this server",
  );
}

describe("setup-app", () => {
  it("draws text on the page itself, outside the app, at the 14px body size", () => {
    // In the app, tokens sit on <html> and index.html styles <body>; anything rendered straight into
    // the page rather than inside the app's own element inherits the body's size.
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
    document.head.append(style);
    applyTokens(document.documentElement);
    try {
      expect(getComputedStyle(document.body).fontSize).toBe("14px");
    } finally {
      style.remove();
      document.documentElement.removeAttribute("data-wt-theme-root");
    }
  });

  it("draws its text at the 14px body size", async () => {
    const el = await mountSetupApp();
    expect(getComputedStyle(wizard(el)).fontSize).toBe("14px");
  });

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
    expect(host.shadowRoot!.querySelector("[data-test=trust-help]")?.textContent?.trim()).toBe(
      "Install certificate",
    );
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
  });

  it("does not repeat the certificate note once the connection question has been answered", async () => {
    const el = await mountSetupApp(
      stubApi({ getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: true }) }),
    );
    await flush(el);
    (await screenHost(el, "connection"))
      .shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!
      .click();
    await flush(el);
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=cert-note]")).toBeNull();
  });

  it("keeps the certificate note when the connection question was never asked", async () => {
    const el = await mountSetupApp(
      stubApi({ getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }) }),
    );
    await flush(el);
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=cert-note]")).not.toBeNull();
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

  it("boot reads the box environment via getStatus and the mode screen warns of a production box", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "production",
      needs: ["venue"],
    } satisfies SetupStatus);
    const el = await mountSetupApp(stubApi({ getStatus }));
    await flush(el);
    expect(getStatus).toHaveBeenCalledOnce();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=production-warning]")).not.toBeNull();
  });

  it("still renders when boot's getStatus rejects (the try/catch is proven)", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountSetupApp(stubApi({ getStatus }));
    await flush(el);
    const connection = await screenHost(el, "connection");
    expect(connection.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
    goto(el, "mode");
    await el.updateComplete;
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=choose-demo]")).not.toBeNull();
    expect(mode.shadowRoot!.querySelector("[data-test=production-warning]")).toBeNull();
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
      false,
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
    expect(await bottomOf(await screenHost(el, "restore"))).toContain("could not be staged");
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
    expect(restoreFromCloud).toHaveBeenCalledWith(pointId, false);
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
    expect(restoreFromCloud).toHaveBeenCalledWith(pointId, false);
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
    expect(await bottomOf(await screenHost(el, "cloud-restore"))).toContain("unavailable");
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
    expect(await bottomOf(await screenHost(el, "venue"))).toContain("country must match");
    // The operator corrects and advances (demo → review): the stale message does not follow.
    patch(el, { mode: "demo" });
    advance(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    goto(el, "venue");
    await el.updateComplete;
    expect(await bottomOf(await screenHost(el, "venue"))).toBe("");
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

  it("shows the in-flight spinner without a provision control while the POST is pending", async () => {
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
    expect(host.shadowRoot!.querySelector("wt-spinner")).not.toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=provision]")).toBeNull();
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
    const next = venue.shadowRoot!.querySelector("[data-test=next]") as HTMLElement & {
      disabled: boolean;
    };
    expect(next.disabled).toBe(false);
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

  it("maps the fiscal 409 setup.already_provisioned to 'already set up' with a reload and NO retry", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.already_provisioned", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("already set up");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent).toContain(
      "open the till",
    );
  });

  it("maps deployment.already_stamped to a partly-set-up message that sends the operator to support, with a bare reload and NO retry", async () => {
    const provision = vi.fn().mockRejectedValue({
      code: "deployment.already_stamped",
      params: { stamped: "production", requested: "preproduction" },
    });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const text = await screenText(el, "provisioning", "[data-test=error]");
    expect(text).toContain("partly set up");
    expect(text).toContain("Contact support");
    expect(text).not.toContain("already set up");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent?.trim()).toBe(
      "Reload",
    );
  });

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
    expect(await bottomOf(await screenHost(el, "venue"))).toContain("country must match");
    goto(el, "admin");
    await el.updateComplete;
    goto(el, "venue");
    await el.updateComplete;
    expect(await bottomOf(await screenHost(el, "venue"))).toBe("");
  });

  it.each([
    ["provisioning.territory_country_mismatch", "country must match the fiscal territory"],
    ["provisioning.invalid_locales", "Choose the receipt language."],
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
      expect(await bottomOf(await screenHost(el, "venue"))).toContain(fragment);
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
    expect(await bottomOf(await screenHost(el, "venue"))).toContain("provisioning.invalid_country");
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
    ["mirror.bundle_fetch_failed", 502, "its reply couldn't be used"],
    ["setup.request_invalid", 400, "rejected the details"],
    ["setup.not_ready", 503, "isn't ready"],
    ["server.internal", 500, "Couldn't connect"],
    ["some.unexpected_code", 400, "Couldn't connect"],
  ])(
    "routes the adopt failure %s (HTTP %i) back to the connect form with a message above Connect",
    async (code, status, fragment) => {
      const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
      const el = await mountSetupApp(stubApi({ adopt }));
      adoptRequest(el);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
      expect(await bottomOf(await screenHost(el, "connect"))).toContain(fragment);
    },
  );

  // A primary of this version answers every refused login with `password.invalid`, which the fetcher
  // in `apps/server/src/mirror-bundle-fetch.ts` passes on, so this sentence must not name one (A153).
  it.each([
    [
      "en-GB",
      "Couldn't join the primary server: it couldn't be reached, it refused the request, or its reply couldn't be used. Check that the address is your restaurant's primary Waitron server, then try again.",
    ],
    [
      "es-ES",
      "No se ha podido unir al servidor principal: no se ha podido contactar con él, ha rechazado la solicitud o su respuesta no se ha podido usar. Comprueba que la dirección es la del servidor principal de Waitron de tu restaurante e inténtalo de nuevo.",
    ],
  ] as const)(
    "says a failed join covers an unreachable primary, a refused request or an unusable reply, naming no refused login (%s)",
    async (locale, sentence) => {
      try {
        const adopt = vi
          .fn()
          .mockRejectedValue({ code: "mirror.bundle_fetch_failed", params: {}, status: 502 });
        const el = await mountSetupApp(stubApi({ adopt }));
        setLocale(locale);
        adoptRequest(el);
        await flush(el);
        expect(await bottomOf(await screenHost(el, "connect"))).toBe(sentence);
      } finally {
        setLocale("en-GB");
      }
    },
  );

  it.each([
    ["mirror.primary_url_invalid", {}, "primaryUrl", "Check the primary server address."],
    [
      "setup.request_invalid",
      { field: "primaryUrl" },
      "primaryUrl",
      "Check the primary server address.",
    ],
    [
      "setup.request_invalid",
      { field: "credential.personId" },
      "personId",
      "Check the admin login (person id).",
    ],
    [
      "setup.request_invalid",
      { field: "credential.password" },
      "password",
      "Check the admin password.",
    ],
    [
      "setup.request_invalid",
      { field: "credential.totp" },
      "totp",
      "Check the authenticator code (if required).",
    ],
  ])(
    "sends the adopt refusal %s %o back to connect under its field, leaving Connect working",
    async (code, params, field, message) => {
      const adopt = vi.fn().mockRejectedValue({ code, params, status: 400 });
      const el = await mountSetupApp(stubApi({ adopt }));
      adoptRequest(el);
      await flush(el);
      const connect = await screenHost(el, "connect");
      const input = connect.shadowRoot!.querySelector(`[data-test=${field}]`)!;
      expect(input.getAttribute("error")).toBe(message);
      expect(await bottomOf(connect)).toBe("Correct the highlighted fields to continue.");
      const button = connect.shadowRoot!.querySelector("[data-test=connect]") as HTMLElement & {
        disabled: boolean;
      };
      expect(button.disabled).toBe(false);
    },
  );

  it("keeps an adopt refusal of a field the connect form does not show above Connect", async () => {
    const adopt = vi.fn().mockRejectedValue({
      code: "setup.request_invalid",
      params: { field: "credential" },
      status: 400,
    });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    const connect = await screenHost(el, "connect");
    expect(await bottomOf(connect)).toContain("rejected the details");
    expect(connect.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
  });

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
        expect(await bottomOf(await screenHost(el, "connect"))).toContain("Couldn't connect");
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

  it("maps the fiscal 409 setup.already_provisioned on adopt to 'already set up' with a bare reload and NO retry", async () => {
    const adopt = vi.fn().mockRejectedValue({ code: "setup.already_provisioned", params: {} });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("already set up");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    const reload = host.shadowRoot!.querySelector("[data-test=reload]");
    expect(reload?.textContent?.trim()).toBe("Reload");
    expect(reload?.textContent).not.toContain("dashboard");
  });

  it("maps deployment.already_stamped on adopt to a partly-set-up message that sends the operator to support, with a bare reload, NO retry and NO reset", async () => {
    const adopt = vi.fn().mockRejectedValue({ code: "deployment.already_stamped", params: {} });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).toBeNull();
    const text = await screenText(el, "provisioning", "[data-test=error]");
    expect(text).toContain("partly set up");
    expect(text).toContain("for a different environment");
    expect(text).toContain("Contact support");
    expect(text).not.toContain("already set up");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent?.trim()).toBe(
      "Reload",
    );
  });

  it("maps setup.adopt_incomplete on adopt to a stopped-partway message that offers the reset, with NO retry", async () => {
    const adopt = vi.fn().mockRejectedValue({ code: "setup.adopt_incomplete", params: {} });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    await expectAdoptIncompleteWithReset(el);
  });

  it("maps setup.operation_conflict on adopt to the terminal saved-setup message with a reload (no retry)", async () => {
    const adopt = vi
      .fn()
      .mockRejectedValue({ code: "setup.operation_conflict", params: {}, status: 409 });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).toBeNull();
    expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("saved setup");
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent?.trim()).toBe(
      "Reload",
    );
  });

  it("re-adopts when the connect form re-emits adopt-requested after a routed-back failure", async () => {
    const adopt = vi
      .fn()
      .mockRejectedValueOnce({ code: "mirror.bundle_fetch_failed", params: {}, status: 502 })
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

  describe("what the operator typed on the connect form", () => {
    const TYPED = {
      primaryUrl: "https://primary.example",
      personId: "op-7",
      password: "  kept secret ",
      totp: "123456",
    };

    const input = (connect: HTMLElement, field: string) =>
      connect
        .shadowRoot!.querySelector(`[data-test=${field}]`)!
        .shadowRoot!.querySelector("input")!;

    /** Types every field through the real inputs and presses Connect. */
    async function typeAndConnect(el: SetupApp): Promise<void> {
      goto(el, "connect");
      await el.updateComplete;
      const connect = await screenHost(el, "connect");
      for (const [field, value] of Object.entries(TYPED)) {
        await userEvent.fill(input(connect, field), value);
      }
      connect.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
      await flush(el);
    }

    const sentBody = {
      primaryUrl: "https://primary.example",
      credential: { personId: "op-7", password: "  kept secret ", totp: "123456" },
    };

    it.each([
      [
        "names a field",
        { code: "setup.request_invalid", params: { field: "credential.password" } },
      ],
      ["names no field", { code: "mirror.bundle_fetch_failed", params: {} }],
    ])(
      "is still in every field but the one-time code after a refusal that %s, and Connect sends it with a new code",
      async (_label, refusal) => {
        const adopt = vi
          .fn()
          .mockRejectedValueOnce({ ...refusal, status: 400 })
          .mockResolvedValue({ adopted: true, restarting: true });
        const el = await mountSetupApp(stubApi({ adopt }));
        await typeAndConnect(el);
        expect(adopt).toHaveBeenCalledWith(sentBody);

        const connect = await screenHost(el, "connect");
        for (const field of ["primaryUrl", "personId", "password"] as const) {
          expect(input(connect, field).value).toBe(TYPED[field]);
        }
        expect(input(connect, "totp").value).toBe("");
        const button = connect.shadowRoot!.querySelector("[data-test=connect]") as HTMLElement & {
          disabled: boolean;
        };
        expect(button.disabled).toBe(false);

        await userEvent.fill(input(connect, "totp"), "654321");
        button.click();
        await flush(el);
        expect(adopt).toHaveBeenCalledTimes(2);
        expect(adopt).toHaveBeenLastCalledWith({
          ...sentBody,
          credential: { ...sentBody.credential, totp: "654321" },
        });
        expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
      },
    );

    it("shows a refusal naming a field under that field, with the typed password kept", async () => {
      const adopt = vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "credential.password" },
        status: 400,
      });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      const connect = await screenHost(el, "connect");
      expect(connect.shadowRoot!.querySelector("[data-test=password]")!.getAttribute("error")).toBe(
        "Check the admin password.",
      );
      expect(input(connect, "password").value).toBe(TYPED.password);
    });

    // Owner rule (C95): a refused login must not say whether the person exists, so it marks no
    // field; a message under the code or the password would say the details before it were right.
    it("says only that the login failed, above Connect, when the primary refuses the login", async () => {
      const adopt = vi
        .fn()
        .mockRejectedValue({ code: "password.invalid", params: {}, status: 401 });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      await new Promise((resolve) => setTimeout(resolve));
      const connect = await screenHost(el, "connect");
      expect(await bottomOf(connect)).toBe(
        "The login failed. Check the admin person ID, password and authenticator code, then try again.",
      );
      for (const field of ["primaryUrl", "personId", "password", "totp"] as const) {
        expect(
          connect.shadowRoot!.querySelector(`[data-test=${field}]`)!.getAttribute("error"),
        ).toBe("");
        expect(input(connect, field).getAttribute("aria-invalid")).toBe("false");
      }
      expect(input(connect, "personId").value).toBe(TYPED.personId);
      expect(input(connect, "password").value).toBe(TYPED.password);
      expect(input(connect, "totp").value).toBe("");
      expect(connect.shadowRoot!.activeElement).toBeNull();
    });

    it.each([
      ["totp.invalid", 401],
      ["person.not_found", 404],
    ])("marks no field for %s", async (code, status) => {
      const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      const connect = await screenHost(el, "connect");
      for (const field of ["personId", "totp"] as const) {
        expect(
          connect.shadowRoot!.querySelector(`[data-test=${field}]`)!.getAttribute("error"),
        ).toBe("");
      }
      expect(await bottomOf(connect)).toBe(
        "Couldn't connect to the primary. Check the address and login, then try again.",
      );
    });

    it("shows a refusal of the one-time code under that field, empty and focused", async () => {
      const adopt = vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "credential.totp" },
        status: 400,
      });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      await new Promise((resolve) => setTimeout(resolve));
      const connect = await screenHost(el, "connect");
      const totp = connect.shadowRoot!.querySelector<HTMLElement>("[data-test=totp]")!;
      expect(totp.getAttribute("error")).toBe("Check the authenticator code (if required).");
      expect(input(connect, "totp").value).toBe("");
      expect(totp.shadowRoot!.activeElement).toBe(input(connect, "totp"));
      expect(input(connect, "password").value).toBe(TYPED.password);
    });

    it("is dropped from the shell once a later Connect succeeds", async () => {
      const adopt = vi
        .fn()
        .mockRejectedValueOnce({ code: "mirror.bundle_fetch_failed", params: {}, status: 502 })
        .mockResolvedValue({ adopted: true, restarting: true });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      expect(readState(el, ["connectRequest"])).toEqual({ connectRequest: sentBody });
      (await screenHost(el, "connect"))
        .shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!
        .click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
      expect(readState(el, ["connectRequest"])).toEqual({ connectRequest: undefined });
    });

    it("is not kept once the operator discards changes and leaves the connect screen", async () => {
      const adopt = vi.fn().mockRejectedValue({
        code: "mirror.bundle_fetch_failed",
        params: {},
        status: 502,
      });
      const el = await mountSetupApp(stubApi({ adopt }));
      await typeAndConnect(el);
      goto(el, "role");
      await el.updateComplete;
      const warning = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "wt-unsaved-changes",
      )!;
      await expect.poll(() => warning.open).toBe(true);
      warning.dispatchEvent(
        new CustomEvent("wt-unsaved-choice", {
          detail: { decision: "discard" },
          bubbles: true,
          composed: true,
        }),
      );
      await expect.poll(() => readState(el, ["screen"]).screen).toBe("role");
      goto(el, "connect");
      await el.updateComplete;
      const connect = await screenHost(el, "connect");
      for (const field of Object.keys(TYPED)) {
        expect(input(connect, field).value).toBe("");
      }
    });
  });

  describe("an adopt refusal read against the saved setup operation", () => {
    type SavedOperation = NonNullable<SetupStatus["operation"]>;
    const savedOperation = (kind: SavedOperation["kind"], phase: SavedOperation["phase"]) => ({
      id: "op-1",
      kind,
      phase,
      updatedAt: "2026-09-26T10:00:00.000Z",
    });
    const statusWith = (operation?: SavedOperation) =>
      vi.fn().mockResolvedValue({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
        ...(operation === undefined ? {} : { operation }),
      } satisfies SetupStatus);
    // 409: setup-api.ts's ADOPT_STATUS; 500: packages/server-kit/src/error-boundary.ts.
    const answered = [
      ["setup.operation_conflict", 409],
      ["server.internal", 500],
    ] as const;

    async function expectAdoptIncomplete(el: SetupApp): Promise<void> {
      await expectAdoptIncompleteWithReset(el);
      expect(await screenText(el, "provisioning", "[data-test=error]")).not.toContain(
        "saved setup",
      );
    }

    async function expectConflictMessageOrConnectForm(el: SetupApp, code: string): Promise<void> {
      if (code === "setup.operation_conflict") {
        expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("saved setup");
        const host = await screenHost(el, "provisioning");
        expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
      } else {
        expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
        expect(await bottomOf(await screenHost(el, "connect"))).toContain("Couldn't connect");
      }
    }

    it.each([...answered, ["mirror.bundle_fetch_failed", 502] as const])(
      "shows the partly-set-up message for %s (HTTP %i) when the status reports an adopt stopped past its start",
      async (code, status) => {
        const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
        const getStatus = statusWith(savedOperation("adopt", "venue_committed"));
        const el = await mountSetupApp(stubApi({ adopt, getStatus }));
        adoptRequest(el);
        await flush(el);
        await expectAdoptIncomplete(el);
      },
    );

    it.each([
      ["no saved operation", undefined],
      ["an adopt still at its start", savedOperation("adopt", "started")],
      ["a completed adopt", savedOperation("adopt", "complete")],
      ["a provision past its start", savedOperation("provision", "venue_committed")],
      ["a restore past its start", savedOperation("restore", "venue_committed")],
    ])(
      "keeps the saved-setup message for a conflict and the connect form otherwise when the status reports %s",
      async (_label, operation) => {
        for (const [code, status] of answered) {
          const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
          const el = await mountSetupApp(stubApi({ adopt, getStatus: statusWith(operation) }));
          adoptRequest(el);
          await flush(el);
          await expectConflictMessageOrConnectForm(el, code);
        }
      },
    );

    it.each(answered)(
      "keeps the saved-setup message for a conflict and the connect form otherwise for %s when the status read itself fails",
      async (code, status) => {
        const getStatus = statusWith();
        const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
        const el = await mountSetupApp(stubApi({ adopt, getStatus }));
        getStatus.mockRejectedValue(new TypeError("Failed to fetch"));
        adoptRequest(el);
        await flush(el);
        await expectConflictMessageOrConnectForm(el, code);
      },
    );

    // A dropped connection says nothing about the adopt, which may still be running on the server
    // at a phase past "started".
    it("sends a rejection with no HTTP status back to the connect form without reading the status", async () => {
      const getStatus = statusWith(savedOperation("adopt", "venue_committed"));
      const adopt = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const el = await mountSetupApp(stubApi({ adopt, getStatus }));
      const bootReads = getStatus.mock.calls.length;
      adoptRequest(el);
      await flush(el);
      expect(getStatus).toHaveBeenCalledTimes(bootReads);
      expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
      expect(await bottomOf(await screenHost(el, "connect"))).toContain("Couldn't connect");
    });

    it.each([
      ["setup.adopt_incomplete", 409, "stopped partway"],
      ["setup.already_provisioning", 409, "already in progress"],
      ["setup.already_provisioned", 400, "already set up"],
      ["deployment.already_stamped", 409, "for a different environment"],
    ])("maps %s (HTTP %i) without reading the status", async (code, status, fragment) => {
      const getStatus = statusWith(savedOperation("adopt", "venue_committed"));
      const adopt = vi.fn().mockRejectedValue({ code, params: {}, status });
      const el = await mountSetupApp(stubApi({ adopt, getStatus }));
      const bootReads = getStatus.mock.calls.length;
      adoptRequest(el);
      await flush(el);
      expect(getStatus).toHaveBeenCalledTimes(bootReads);
      expect(await screenText(el, "provisioning", "[data-test=error]")).toContain(fragment);
    });
  });
});

describe("resetting a join that stopped partway", () => {
  const LOGIN = { personId: "op-1", password: "  correct horse  " };

  async function offerReset(api: SetupApi): Promise<SetupApp> {
    const el = await mountSetupApp(api);
    adoptRequest(el);
    await flush(el);
    return el;
  }

  async function openReset(el: SetupApp): Promise<HTMLElement> {
    const host = await screenHost(el, "provisioning");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await el.updateComplete;
    return screenHost(el, "reset");
  }

  async function submitReset(el: SetupApp, login = LOGIN): Promise<void> {
    const screen = await screenHost(el, "reset");
    for (const [field, value] of Object.entries(login)) {
      screen
        .shadowRoot!.querySelector(`[data-test=${field}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    }
    await (screen as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await flush(el);
  }

  const incomplete = () =>
    vi.fn().mockRejectedValue({ code: "setup.adopt_incomplete", params: {}, status: 409 });

  it.each([
    ["the refusal names it", incomplete(), undefined],
    [
      "the saved setup shows it",
      vi.fn().mockRejectedValue({ code: "server.internal", params: {}, status: 500 }),
      vi.fn().mockResolvedValue({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
        operation: {
          id: "op-1",
          kind: "adopt",
          phase: "membership_seeded",
          updatedAt: "2026-09-26T10:00:00.000Z",
        },
      } satisfies SetupStatus),
    ],
  ])(
    "offers the reset screen when %s, and Back returns to the message",
    async (_label, adopt, getStatus) => {
      const el = await offerReset(
        stubApi(getStatus === undefined ? { adopt } : { adopt, getStatus }),
      );
      await expectAdoptIncompleteWithReset(el);
      const screen = await openReset(el);
      expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Reset this server");
      screen.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
      await el.updateComplete;
      await expectAdoptIncompleteWithReset(el);
    },
  );

  it.each([
    ["setup.operation_conflict", 409],
    ["deployment.already_stamped", 409],
    ["server.internal", 500],
  ])("does not offer the reset after a provision refused with %s", async (code, status) => {
    const provision = vi.fn().mockRejectedValue({ code, params: {}, status });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
  });

  it("does not offer the reset after an adopt that stopped partway is followed by a fresh adopt refused otherwise", async () => {
    const adopt = incomplete();
    const el = await offerReset(stubApi({ adopt }));
    adopt.mockRejectedValue({ code: "setup.already_provisioning", params: {}, status: 409 });
    adoptRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=error]")!.textContent).toContain(
      "already in progress",
    );
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
  });

  it("offers Try again, not the reset, when a provision fails after an adopt that stopped partway", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "server.internal", params: {}, status: 500 });
    const el = await offerReset(stubApi({ adopt: incomplete(), provision }));
    await expectAdoptIncompleteWithReset(el);
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    expect(host.shadowRoot!.querySelector("[data-test=error]")!.textContent).toContain(
      "Provisioning failed",
    );
    expect(host.shadowRoot!.querySelector("[data-test=retry]")).not.toBeNull();
    expect(host.shadowRoot!.querySelector("[data-test=reset]")).toBeNull();
  });

  it.each([
    [
      "a backup file",
      (el: SetupApp) =>
        restoreRequest(el, {
          artifact: new File(["encrypted"], "waitron.backup"),
          recoveryKey: "k",
          environment: "production",
        }),
    ],
    ["the bucket", (el: SetupApp) => bucketRequest(el)],
  ])(
    "drops the reset offer when a restore from %s starts after an adopt that stopped partway",
    async (_label, request) => {
      const pending = deferred();
      const el = await offerReset(
        stubApi({
          adopt: incomplete(),
          restore: vi.fn().mockReturnValue(pending.promise),
          restoreFromBucket: vi.fn().mockReturnValue(pending.promise),
        }),
      );
      await expectAdoptIncompleteWithReset(el);
      request(el);
      await flush(el);
      expect(readState(el, ["provisionMessage", "provisionCanReset"])).toEqual({
        provisionMessage: undefined,
        provisionCanReset: false,
      });
      pending.resolve({ restoreStaged: true, restarting: true });
      await flush(el);
    },
  );

  it("posts the typed person ID and password to the reset route", async () => {
    const resetIncompleteAdopt = vi.fn().mockResolvedValue({ resetStaged: true, restarting: true });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    expect(resetIncompleteAdopt).toHaveBeenCalledExactlyOnceWith({
      personId: "op-1",
      password: "  correct horse  ",
    });
  });

  it("keeps reset-requested inside the wizard", async () => {
    const el = await offerReset(stubApi({ adopt: incomplete() }));
    const escaped: Event[] = [];
    el.parentElement!.addEventListener("reset-requested", (e) => escaped.push(e));
    await openReset(el);
    await submitReset(el);
    expect(escaped).toEqual([]);
  });

  it("keeps an empty form from posting", async () => {
    const resetIncompleteAdopt = vi.fn();
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el, { personId: "", password: "" });
    expect(resetIncompleteAdopt).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=screen-reset]")).not.toBeNull();
  });

  it("shows Resetting… and sends one request while the reset is in flight", async () => {
    const pending = deferred();
    const resetIncompleteAdopt = vi.fn().mockReturnValue(pending.promise);
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    const screen = await openReset(el);
    await submitReset(el);
    await (screen as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const button = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!;
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent!.trim()).toBe("Resetting…");
    screen.dispatchEvent(
      new CustomEvent("reset-requested", {
        detail: { credential: LOGIN },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(resetIncompleteAdopt).toHaveBeenCalledTimes(1);
    pending.resolve({ resetStaged: true, restarting: true });
    await flush(el);
  });

  it("tells the operator to wait and reload once the reset is staged", async () => {
    const el = await offerReset(stubApi({ adopt: incomplete() }));
    await openReset(el);
    await submitReset(el);
    expect((await screenText(el, "reset", "[data-test=outcome]"))?.replace(/\s+/g, " ")).toBe(
      "The server is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: contact support.",
    );
    expect(await screenText(el, "reset", "[data-test=reload]")).toBe("Reload");
  });

  it.each([
    [
      "setup.reset_unavailable",
      "There is no half-finished join to reset on this server. Reload to start setup again.",
    ],
    ["setup.already_provisioning", "Setup is already in progress on this server."],
    [
      "setup.operation_conflict",
      "This server has saved setup work for a different request. Resume the original setup or contact support.",
    ],
  ])("ends at a Reload for %s", async (code, message) => {
    const resetIncompleteAdopt = vi.fn().mockRejectedValue({ code, params: {}, status: 409 });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    const screen = await screenHost(el, "reset");
    const outcome = screen.shadowRoot!.querySelector("[data-test=outcome]")!;
    expect(outcome.getAttribute("role")).toBe("alert");
    expect(outcome.textContent!.replace(/\s+/g, " ").trim()).toBe(message);
    expect(await screenText(el, "reset", "[data-test=reload]")).toBe("Reload");
    expect(screen.shadowRoot!.querySelector("[data-test=personId]")).toBeNull();
  });

  it("marks no field and names the refused login when the password is refused", async () => {
    const resetIncompleteAdopt = vi
      .fn()
      .mockRejectedValue({ code: "password.invalid", params: {}, status: 401 });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    const screen = await screenHost(el, "reset");
    expect(screen.shadowRoot!.querySelector("[data-test=personId]")!.hasAttribute("invalid")).toBe(
      false,
    );
    expect(screen.shadowRoot!.querySelector("[data-test=password]")!.hasAttribute("invalid")).toBe(
      false,
    );
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(
      "That person ID and password are not the admin login used to connect this server. Check them and try again.",
    );
    const reset = screen.shadowRoot!.querySelector("[data-test=reset]") as HTMLElement & {
      disabled: boolean;
    };
    expect(reset.disabled).toBe(false);
  });

  it.each([
    ["personId", "Check the admin person ID."],
    ["password", "Check the admin password."],
  ])(
    "marks the %s field a setup.request_invalid names, leaving the reset working",
    async (field, message) => {
      const resetIncompleteAdopt = vi
        .fn()
        .mockRejectedValue({ code: "setup.request_invalid", params: { field }, status: 400 });
      const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
      await openReset(el);
      await submitReset(el);
      const screen = await screenHost(el, "reset");
      const input = screen.shadowRoot!.querySelector(`[data-test=${field}]`)!;
      expect(input.getAttribute("error")).toBe(message);
      expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
      const reset = screen.shadowRoot!.querySelector("[data-test=reset]") as HTMLElement & {
        disabled: boolean;
      };
      expect(reset.disabled).toBe(false);
    },
  );

  it("names a second refused login after the operator corrects the password", async () => {
    const resetIncompleteAdopt = vi
      .fn()
      .mockRejectedValue({ code: "password.invalid", params: {}, status: 401 });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    await submitReset(el, { personId: "op-1", password: "battery staple" });
    expect(resetIncompleteAdopt).toHaveBeenCalledTimes(2);
    const screen = await screenHost(el, "reset");
    expect(screen.shadowRoot!.querySelector("[data-test=password]")!.getAttribute("error")).toBe(
      "",
    );
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(
      "That person ID and password are not the admin login used to connect this server. Check them and try again.",
    );
  });

  it("shows the same general message again when a second reset fails the same way", async () => {
    const resetIncompleteAdopt = vi
      .fn()
      .mockRejectedValue({ code: "server.internal", params: {}, status: 500 });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    await submitReset(el);
    expect(resetIncompleteAdopt).toHaveBeenCalledTimes(2);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(
      "The server could not be reset. Check the connection and try again.",
    );
  });

  it.each([
    [{ retryAfterSeconds: 30 }, "Too many attempts. Wait 30 seconds, then try again."],
    [{ retryAfterSeconds: 1 }, "Too many attempts. Wait 1 second, then try again."],
    [{}, "Too many attempts. Wait a few minutes, then try again."],
    [{ retryAfterSeconds: "30" }, "Too many attempts. Wait a few minutes, then try again."],
  ])("asks the operator to wait when attempts are throttled (%o)", async (params, message) => {
    const resetIncompleteAdopt = vi
      .fn()
      .mockRejectedValue({ code: "password.throttled", params, status: 429 });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(message);
  });

  it.each([
    [
      "setup.request_invalid",
      400,
      "The server rejected the details. Check the admin person ID and password, then try again.",
    ],
    ["setup.not_ready", 503, "The server isn't ready yet. Wait a moment, then try again."],
  ])("keeps the form with its own message for %s", async (code, status, message) => {
    const resetIncompleteAdopt = vi.fn().mockRejectedValue({ code, params: {}, status });
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(message);
    const screen = await screenHost(el, "reset");
    expect(screen.shadowRoot!.querySelector("[data-test=personId]")).not.toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-test=reset]")!.hasAttribute("disabled")).toBe(
      false,
    );
  });

  it.each([
    ["server.internal", { code: "server.internal", params: {}, status: 500 }],
    ["a dropped connection", new TypeError("Failed to fetch")],
    ["a rejection carrying nothing", undefined],
  ])("keeps the form with a general message for %s", async (_label, error) => {
    const resetIncompleteAdopt = vi.fn().mockRejectedValue(error);
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(
      "The server could not be reset. Check the connection and try again.",
    );
    const screen = await screenHost(el, "reset");
    expect(screen.shadowRoot!.querySelector("[data-test=reset]")!.hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("clears the last refusal when a new reset starts and when the operator steps away", async () => {
    const pending = deferred();
    const resetIncompleteAdopt = vi
      .fn()
      .mockRejectedValueOnce({ code: "password.invalid", params: {}, status: 401 })
      .mockRejectedValueOnce({ code: "server.internal", params: {}, status: 500 })
      .mockReturnValueOnce(pending.promise);
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    await submitReset(el);
    const screen = await screenHost(el, "reset");
    expect((screen as HTMLElement & { credentialsRejected: boolean }).credentialsRejected).toBe(
      false,
    );
    expect(await bottomOf(await screenHost(el, "reset"))).toBe(
      "The server could not be reset. Check the connection and try again.",
    );
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
    await el.updateComplete;
    await openReset(el);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe("");
    await submitReset(el);
    expect(await bottomOf(await screenHost(el, "reset"))).toBe("");
    pending.resolve({ resetStaged: true, restarting: true });
    await flush(el);
  });

  it.each([
    ["a staged reset", (d: ReturnType<typeof deferred>) => d.resolve({ resetStaged: true })],
    [
      "a refused reset",
      (d: ReturnType<typeof deferred>) =>
        d.reject({ code: "password.invalid", params: {}, status: 401 }),
    ],
  ])("writes nothing for %s that answers after the element is detached", async (_label, settle) => {
    const pending = deferred();
    const resetIncompleteAdopt = vi.fn().mockReturnValue(pending.promise);
    const el = await offerReset(stubApi({ adopt: incomplete(), resetIncompleteAdopt }));
    await openReset(el);
    await submitReset(el);
    el.remove();
    settle(pending);
    await flush(el);
    expect(
      readState(el, ["resetOutcome", "resetCredentialsRejected", "resetError", "resetBusy"]),
    ).toEqual({
      resetOutcome: undefined,
      resetCredentialsRejected: false,
      resetError: undefined,
      resetBusy: true,
    });
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

describe("page shell", () => {
  it("renders the wizard in a page rather than a modal", async () => {
    const el = await mountSetupApp();
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(wizard(el).querySelector("[data-test^=screen-]")).not.toBeNull();
  });

  it("centres the page in a 704px column in a wide window", async () => {
    const el = await mountSetupApp();
    const host = el.parentElement!;
    host.style.width = "2000px";
    await el.updateComplete;
    const hostBox = host.getBoundingClientRect();
    const pageBox = wizard(el).getBoundingClientRect();
    expect(pageBox.width).toBeLessThan(hostBox.width);
    expect(pageBox.width).toBe(704);
    expect(Math.abs(pageBox.left - hostBox.left - (hostBox.right - pageBox.right))).toBeLessThan(1);
  });

  it.each([1280, 390])(
    "puts the language chooser at the trailing end of the card's header, beside the logo, %ipx wide",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 844);
      try {
        const el = await mountSetupApp();
        const header = wizard(el).querySelector<HTMLElement>(":scope > header")!;
        const chooser = header.querySelector<HTMLElement>("wt-language-chooser")!;
        expect(chooser).not.toBeNull();
        const logo = header.querySelector<HTMLElement>("[data-test=setup-logo]")!;
        expect(
          logo.compareDocumentPosition(chooser) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        const headerBox = header.getBoundingClientRect();
        const logoBox = logo.getBoundingClientRect();
        const trigger = chooser
          .shadowRoot!.querySelector("[data-test=lang-trigger]")!
          .getBoundingClientRect();
        expect(Math.abs(logoBox.left - headerBox.left)).toBeLessThan(1);
        expect(Math.abs(trigger.right - headerBox.right)).toBeLessThan(1);
        expect(trigger.left).toBeGreaterThan(logoBox.right);
        const middle = (box: DOMRect) => box.top + box.height / 2;
        expect(Math.abs(middle(trigger) - middle(logoBox))).toBeLessThan(1);
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  it.each([
    [1280, "English", "name"],
    [390, "EN", "code"],
  ] as const)(
    "at %ipx the chooser shows %s, and its trigger is named in full for a screen reader",
    async (width, shown, part) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 844);
      try {
        const el = await mountSetupApp();
        const trigger = el
          .shadowRoot!.querySelector("wt-language-chooser")!
          .shadowRoot!.querySelector<HTMLElement>("[data-test=lang-trigger]")!;
        const name = trigger.querySelector<HTMLElement>("[part=name]")!;
        const code = trigger.querySelector<HTMLElement>("[part=code]")!;
        const [visible, hidden] = part === "name" ? [name, code] : [code, name];
        expect(getComputedStyle(visible).display).not.toBe("none");
        expect(getComputedStyle(hidden).display).toBe("none");
        expect(visible.textContent!.trim()).toBe(shown);
        expect(trigger.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(
          "English",
        );
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  const screens: Screen[] = [
    "connection",
    "role",
    "connect",
    "restore",
    "restore-bucket",
    "cloud-restore",
    "live-source",
    "configuration-preview",
    "fiscal-test",
    "mode",
    "admin",
    "venue",
    "cert",
    "review",
    "provisioning",
    "reset",
    "done",
  ];

  it.each(screens)("shows the Waitron logo above the %s screen", async (screen) => {
    const el = await mountSetupApp();
    goto(el, screen);
    await el.updateComplete;
    const logo = wizard(el).querySelector<HTMLElement>("[data-test=setup-logo]")!;
    const shown = wizard(el).querySelector(`[data-test=screen-${screen}]`)!;
    expect(logo.getAttribute("role")).toBe("img");
    expect(logo.getAttribute("aria-label")).toBe("Waitron");
    expect(logo.querySelector("svg")).not.toBeNull();
    expect(logo.compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["light", "dark"] as const)(
    "paints the logo's word in the text colour and its waiter in the primary colour (%s theme)",
    async (theme) => {
      const el = await mountSetupApp();
      const host = el.parentElement!;
      host.setAttribute("data-theme", theme);
      const probe = document.createElement("span");
      host.appendChild(probe);
      const colourOf = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const svg = wizard(el).querySelector("[data-test=setup-logo] svg")!;
      // Found by the brand file's own ink, not by position, so a reordered file fails here.
      const waiter = svg.querySelector(':scope > g[fill="#1f6feb"]');
      const word = svg.querySelector(':scope > g[fill="#16181d"]');
      expect(getComputedStyle(word!).fill).toBe(colourOf("--wt-color-text"));
      expect(getComputedStyle(waiter!).fill).toBe(colourOf("--wt-color-primary"));
    },
  );
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
    expect(mode.shadowRoot!.querySelector("[data-test=production-warning]")).toBeNull();
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

  it("clears the routed fiscal-test banner on a manual re-navigation so it doesn't reappear stale", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.fiscal_test_required", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toContain(
      "Run an accepted fiscal test before activating production.",
    );
    goto(el, "review");
    await el.updateComplete;
    goto(el, "fiscal-test");
    await el.updateComplete;
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toBeNull();
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
    expect(await bottomOf(await screenHost(el, "restore"))).toBe(
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
    expect(await bottomOf(await screenHost(el, "live-source"))).toBe(
      "The configuration export could not be opened. Check the file and passphrase.",
    );
    expect(readDraft(el).configurationImport).toBeUndefined();
  });

  it.each([
    [
      "en-GB",
      "This export is not compatible with this Waitron version. Export it again from a box running the current version, then load the new export.",
    ],
    [
      "es-ES",
      "Esta exportación no es compatible con esta versión de Waitron. Vuelve a exportar desde un equipo con la versión actual y carga la nueva exportación.",
    ],
  ] as const)(
    "explains how to replace an incompatible configuration export (%s)",
    async (locale, sentence) => {
      try {
        for (const field of ["version", "module:core", "modules"]) {
          const el = await mountSetupApp(
            stubApi({
              stageConfiguration: vi.fn().mockRejectedValue({
                code: "setup.request_invalid",
                params: { field },
                status: 400,
              }),
            }),
          );
          setLocale(locale);
          configurationRequest(
            el,
            new File(["encrypted"], "prepared.waitron-config"),
            "passphrase",
          );
          await flush(el);
          expect(await bottomOf(await screenHost(el, "live-source"))).toBe(sentence);
          expect(readDraft(el).configurationImport).toBeUndefined();
          expect(
            el.shadowRoot!.querySelector("[data-test=screen-configuration-preview]"),
          ).toBeNull();
        }
      } finally {
        setLocale("en-GB");
      }
    },
  );

  it.each([
    [
      "en-GB",
      "This configuration export is from an older format. Export it again from a current box.",
    ],
    [
      "es-ES",
      "Esta exportación de configuración usa un formato anterior. Vuelve a exportarla desde un equipo actualizado.",
    ],
  ] as const)("explains the retired configuration format (%s)", async (locale, sentence) => {
    try {
      const el = await mountSetupApp(
        stubApi({
          stageConfiguration: vi
            .fn()
            .mockRejectedValue({ code: "setup.configuration_outdated", params: {}, status: 400 }),
        }),
      );
      setLocale(locale);
      configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
      await flush(el);
      expect(await bottomOf(await screenHost(el, "live-source"))).toBe(sentence);
      expect(readDraft(el).configurationImport).toBeUndefined();
      expect(el.shadowRoot!.querySelector("[data-test=screen-configuration-preview]")).toBeNull();
    } finally {
      setLocale("en-GB");
    }
  });

  it.each([
    ["setup.request_invalid", "artifact"],
    ["setup.request_invalid", "module:"],
    ["setup.request_invalid", 12],
    ["setup.request_invalid", undefined],
    ["backup.artifact_invalid", "module:core"],
  ])("keeps other configuration refusals generic (%s, %s)", async (code, field) => {
    const el = await mountSetupApp(
      stubApi({
        stageConfiguration: vi.fn().mockRejectedValue({ code, params: { field }, status: 400 }),
      }),
    );
    configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
    await flush(el);
    expect(await bottomOf(await screenHost(el, "live-source"))).toBe(
      "The configuration export could not be opened. Check the file and passphrase.",
    );
  });

  it.each([
    [
      "en-GB",
      "category.name_taken",
      "The export has two categories named “Bebidas” in the same place. Rename one in your prepared restaurant, export again, then load the new export.",
    ],
    [
      "en-GB",
      "product.name_taken",
      "The export has two active products or variants named “Bebidas”. Rename one in your prepared restaurant, export again, then load the new export.",
    ],
    [
      "es-ES",
      "category.name_taken",
      "La exportación tiene dos categorías llamadas «Bebidas» en el mismo lugar. Cambia el nombre de una en tu restaurante preparado, vuelve a exportar y carga la nueva exportación.",
    ],
    [
      "es-ES",
      "product.name_taken",
      "La exportación tiene dos productos o variantes activos llamados «Bebidas». Cambia el nombre de uno en tu restaurante preparado, vuelve a exportar y carga la nueva exportación.",
    ],
  ] as const)(
    "names the duplicate when setup refuses a configuration export for it (%s, %s)",
    async (locale, code, sentence) => {
      try {
        const el = await mountSetupApp(
          stubApi({
            stageConfiguration: vi
              .fn()
              .mockRejectedValue({ code, params: { field: "name", name: "Bebidas" }, status: 409 }),
          }),
        );
        setLocale(locale);
        configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
        await flush(el);
        expect(await bottomOf(await screenHost(el, "live-source"))).toBe(sentence);
        expect(readDraft(el).configurationImport).toBeUndefined();
      } finally {
        setLocale("en-GB");
      }
    },
  );

  it.each([
    ["backup.artifact_invalid", 422],
    ["backup.archive_invalid", 422],
    ["recovery.passphrase_invalid", 422],
    ["image.invalid_metadata", 400],
    ["content.language_invalid", 400],
  ] as const)(
    "gives the could-not-open sentence for an export setup refuses with %s (%i)",
    async (code, status) => {
      const el = await mountSetupApp(
        stubApi({
          stageConfiguration: vi.fn().mockRejectedValue({ code, params: {}, status }),
        }),
      );
      configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
      await flush(el);
      expect(await bottomOf(await screenHost(el, "live-source"))).toBe(
        "The configuration export could not be opened. Check the file and passphrase.",
      );
      expect(readDraft(el).configurationImport).toBeUndefined();
    },
  );

  it("falls back to the could-not-open sentence for a duplicate refusal carrying no name", async () => {
    const el = await mountSetupApp(
      stubApi({
        stageConfiguration: vi
          .fn()
          .mockRejectedValue({ code: "product.name_taken", params: {}, status: 409 }),
      }),
    );
    configurationRequest(el, new File(["encrypted"], "prepared.waitron-config"), "passphrase");
    await flush(el);
    expect(await bottomOf(await screenHost(el, "live-source"))).toBe(
      "The configuration export could not be opened. Check the file and passphrase.",
    );
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

  it("shows the authority rejection from the API and clears it after an uncertain retry", async () => {
    const el = await mountSetupApp(
      stubApi({
        runFiscalTest: vi
          .fn()
          .mockResolvedValueOnce({
            status: "rejected",
            rejections: [{ code: "1161", message: "Importe total incorrecto" }],
          })
          .mockResolvedValueOnce({ status: "uncertain" }),
      }),
    );
    goto(el, "fiscal-test");
    fiscalTestRequest(el);
    await flush(el);
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toContain("1161");
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toContain(
      "Importe total incorrecto",
    );
    fiscalTestRequest(el);
    await flush(el);
    expect(await screenText(el, "fiscal-test", "[role=alert]")).not.toContain("1161");
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toContain("uncertain");
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

  it("clears a could-not-run banner once the operator leaves the fiscal test and comes back", async () => {
    const el = await mountSetupApp(
      stubApi({ runFiscalTest: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }),
    );
    goto(el, "fiscal-test");
    fiscalTestRequest(el);
    await flush(el);
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toBe(
      "The fiscal test could not run. Check the connection and try again.",
    );
    goto(el, "review");
    await el.updateComplete;
    goto(el, "fiscal-test");
    await el.updateComplete;
    expect(await screenText(el, "fiscal-test", "[role=alert]")).toBeNull();
  });
});

describe("restore from my bucket", () => {
  const VENUE = { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" };

  async function refusedWith(error: unknown): Promise<SetupRestoreBucketScreen> {
    const el = await mountSetupApp(
      stubApi({ restoreFromBucket: vi.fn().mockRejectedValue(error) }),
    );
    bucketRequest(el);
    await flush(el);
    await flush(el);
    return (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
  }

  it("stages a bucket rebuild and shows the rebuild outcome", async () => {
    const restoreFromBucket = vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el);
    await flush(el);
    await flush(el);
    expect(restoreFromBucket).toHaveBeenCalledWith({
      kit: "k",
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: null,
    });
    const done = (await screenHost(el, "done")) as SetupDoneScreen;
    expect(done.rebuilt).toBe(true);
  });

  it("shows the provisioning screen while the rebuild is staged, with no earlier failure on it", async () => {
    const pending = deferred();
    const el = await mountSetupApp(
      stubApi({
        provision: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        restoreFromBucket: vi.fn().mockReturnValue(pending.promise),
      }),
    );
    provisionRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).not.toBeNull();
    bucketRequest(el);
    await flush(el);
    expect(await screenText(el, "provisioning", "[data-test=error]")).toBeNull();
    pending.resolve({ restoreStaged: true, restarting: true });
  });

  it("returns to the bucket screen asking about the old server when it looks alive", async () => {
    const screen = await refusedWith({
      code: "restore.stream_source_live",
      params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
      status: 409,
    });
    expect(screen.liveSince).toBe("2026-09-23T11:58:00.000Z");
    expect(screen.liveUnknown).toBe(false);
    expect(screen.errorMessage).toBeUndefined();
  });

  it("returns the request it sent, so the owner's entries are kept", async () => {
    const restoreFromBucket = vi.fn().mockRejectedValue({
      code: "restore.stream_source_live",
      params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
      status: 409,
    });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el, { kit: "WAITRON-RECOVERY-KIT-1:abc", environment: "preproduction" });
    await flush(el);
    await flush(el);
    const screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    expect(screen.request).toEqual({
      kit: "WAITRON-RECOVERY-KIT-1:abc",
      environment: "preproduction",
      oldBoxGone: false,
      venueConfirmed: null,
    });
    expect(screen.shadowRoot!.querySelector<HTMLTextAreaElement>("[data-test=kit]")!.value).toBe(
      "WAITRON-RECOVERY-KIT-1:abc",
    );
  });

  // #646: the shell hands the restored copy's names to the screen for confirmation.
  it("returns to the bucket screen showing whose copy it is when the venue is unconfirmed", async () => {
    const screen = await refusedWith({
      code: "restore.stream_venue_unconfirmed",
      params: VENUE,
      status: 409,
    });
    expect(screen.venue).toEqual(VENUE);
    expect(screen.errorMessage).toBeUndefined();
  });

  // An empty tax id never counts as confirmed, so offering to confirm it would loop for ever.
  it("says a copy that names no tax id cannot be restored, and offers no confirmation", async () => {
    const screen = await refusedWith({
      code: "restore.stream_venue_unconfirmed",
      params: { ...VENUE, taxId: "" },
      status: 409,
    });
    expect(screen.venue).toBeUndefined();
    expect(screen.errorMessage).toBe(
      "The copy in the bucket names no business tax id, so it cannot be confirmed or restored.",
    );
  });

  it.each([[{ reason: "clock" }], [{ reason: "bucket" }]])(
    "asks the old-box question when whether the old server is writing could not be checked (%o)",
    async (params) => {
      const screen = await refusedWith({
        code: "restore.stream_source_unchecked",
        params,
        status: 409,
      });
      expect(screen.liveUnknown).toBe(true);
      expect(screen.liveSince).toBeUndefined();
    },
  );

  it("still asks the old-box question when the server gave no time the old server last wrote", async () => {
    const screen = await refusedWith({
      code: "restore.stream_source_live",
      params: {},
      status: 409,
    });
    expect(screen.liveUnknown).toBe(true);
  });

  // Review Focus 2: the wrong kit is refused before anything changes, and the owner is told which
  // way it is wrong. (The server refuses; these pin the words the wizard puts on each refusal.)
  // A refusal about a field the screen shows is told under that field.
  const FIELD_OF_BUCKET_REFUSAL: Record<string, string | undefined> = {
    "backup.stream_kit_invalid": "kit",
    "restore.environment_mismatch": "environment",
    "setup.request_invalid": "kit",
  };
  it.each([
    [
      "backup.stream_kit_invalid",
      undefined,
      "This is not a Waitron recovery kit. Upload the kit file, or paste the whole kit.",
    ],
    [
      "backup.stream_kit_invalid",
      { reason: "not_found" },
      "This is not a Waitron recovery kit. Upload the kit file, or paste the whole kit.",
    ],
    [
      "backup.stream_kit_invalid",
      { reason: "encoding" },
      "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Upload the kit file as it was saved, or paste the whole kit.",
    ],
    [
      "backup.stream_kit_invalid",
      { reason: "shape" },
      "This recovery kit is incomplete or damaged, perhaps cut short when it was copied. Upload the kit file as it was saved, or paste the whole kit.",
    ],
    [
      "restore.stream_pointer_missing",
      undefined,
      "The bucket in this kit holds no copy of this restaurant.",
    ],
    [
      "restore.stream_pointer_unverified",
      undefined,
      "The copy in the bucket was not written by the server this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
    ],
    [
      "restore.stream_pointer_unverified",
      { reason: "signature" },
      "The copy in the bucket was not written by the server this kit belongs to. Check that the kit is this restaurant's newest. Nothing was changed.",
    ],
    [
      "restore.stream_pointer_unverified",
      { reason: "venue_mismatch" },
      "The bucket's record of its newest copy names a different restaurant from this kit. Nothing was changed.",
    ],
    [
      "backup.stream_pointer_invalid",
      { reason: "shape" },
      "The bucket's record of its newest copy is damaged, so it cannot be rebuilt from. Nothing was changed.",
    ],
    [
      "restore.stream_integrity_failed",
      undefined,
      "The copy read from the bucket is damaged. Nothing on this server was changed.",
    ],
    [
      "restore.stream_state_missing",
      { nodeId: "n1" },
      "The copy in the bucket does not hold the old server's locked settings, so it cannot be rebuilt from.",
    ],
    [
      "recovery.passphrase_invalid",
      undefined,
      "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest kit.",
    ],
    [
      "backup.artifact_invalid",
      { reason: "magic" },
      "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest kit.",
    ],
    [
      "backup.archive_invalid",
      { reason: "magic" },
      "The recovery key in this kit does not open the latest copy. If the recovery key was changed, use the newest kit.",
    ],
    [
      "backup.stream_restore_failed",
      { exitCode: 1, diskFull: false },
      "The copy could not be downloaded from the bucket. Check this server's internet connection and that the bucket still exists, then try again.",
    ],
    [
      "backup.stream_request_failed",
      { operation: "get", key: "k", status: 403, name: "AccessDenied" },
      "The bucket did not answer, or refused the key in this kit. Check this server's internet connection and that the bucket and its key still exist, then try again.",
    ],
    [
      "restore.environment_mismatch",
      { backup: "preproduction", target: "production" },
      "The copy comes from the other environment. Choose the environment it came from.",
    ],
    [
      "provisioning.database_ahead",
      undefined,
      "The copy in the bucket was made by newer Waitron software than this server has. Update this server, then try again.",
    ],
    [
      "restore.schema_too_new",
      { module: "core", backup: 9, target: 8 },
      "The copy in the bucket was made by newer Waitron software than this server has. Update this server, then try again.",
    ],
    [
      "setup.already_provisioning",
      undefined,
      "Setup is already in progress on this server. Wait for it to finish, then reload this page.",
    ],
    ["setup.not_ready", undefined, "The server isn't ready yet. Wait a moment, then try again."],
    [
      "setup.operation_conflict",
      undefined,
      "This server has saved setup work for a different request. Resume the original setup or contact support.",
    ],
    ["setup.request_invalid", { field: "kit" }, "Check the recovery kit."],
    [
      "restore.hook_failed",
      { module: "fiscal", code: "x.y" },
      "The copy could not be restored. (restore.hook_failed)",
    ],
  ])("explains %s (%o) and stays on the bucket screen", async (code, params, message) => {
    const screen = await refusedWith({ code, params, status: 400 });
    expect(screen.errorMessage).toBe(message);
    const field = FIELD_OF_BUCKET_REFUSAL[code];
    if (field === undefined) {
      expect(await bottomOf(screen)).toBe(message);
    } else {
      expect(messageUnder(screen, field)).toBe(message);
      expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
      const button = screen.shadowRoot!.querySelector("[data-test=restore]") as HTMLElement & {
        disabled: boolean;
      };
      expect(button.disabled).toBe(false);
    }
  });

  it("says to check the environment under it when the server's request check names it", async () => {
    const screen = await refusedWith({
      code: "setup.request_invalid",
      params: { field: "environment" },
      status: 400,
    });
    expect(messageUnder(screen, "environment")).toBe("Check the environment.");
    expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
  });

  it.each([
    [
      "oldBoxGone",
      {
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        status: 409,
      },
      "old-box-gone",
      "Check your answer about the old server.",
    ],
    [
      "venueConfirmed",
      { code: "restore.stream_venue_unconfirmed", params: VENUE, status: 409 },
      "venue-confirmed",
      "Check the confirmation that this is your business.",
    ],
  ])(
    "says to check the %s tick box under it when the server's request check names it",
    async (field, question, box, message) => {
      const restoreFromBucket = vi
        .fn()
        .mockRejectedValueOnce(question)
        .mockRejectedValueOnce({ code: "setup.request_invalid", params: { field }, status: 400 });
      const el = await mountSetupApp(stubApi({ restoreFromBucket }));
      bucketRequest(el);
      await flush(el);
      bucketRequest(el);
      await flush(el);
      await flush(el);
      const screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
      await screen.updateComplete;
      const input = screen.shadowRoot!.querySelector(`[data-test=${box}]`)!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.shadowRoot!.querySelector(`#${box}-error`)!.textContent).toBe(message);
      expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
      const button = screen.shadowRoot!.querySelector("[data-test=restore]") as HTMLElement & {
        disabled: boolean;
      };
      expect(button.disabled).toBe(false);
      await vi.waitFor(() => expect(screen.shadowRoot!.activeElement).toBe(input));
    },
  );

  it.each([
    ["oldBoxGone", "Check your answer about the old server."],
    ["venueConfirmed", "Check the confirmation that this is your business."],
  ])(
    "says above Restore to check the %s tick box when that tick box is not on the screen",
    async (field, message) => {
      const screen = await refusedWith({
        code: "setup.request_invalid",
        params: { field },
        status: 400,
      });
      expect(await bottomOf(screen)).toBe(message);
      expect(screen.shadowRoot!.querySelector("[aria-invalid=true]")).toBeNull();
      await expectBucketSharedFieldsUnmarked(screen);
    },
  );

  it.each([
    [
      "oldBoxGone",
      {
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        status: 409,
      },
      "old-box-gone",
    ],
    [
      "venueConfirmed",
      { code: "restore.stream_venue_unconfirmed", params: VENUE, status: 409 },
      "venue-confirmed",
    ],
  ])("drops the %s tick box's refusal once the owner changes it", async (field, question, box) => {
    const restoreFromBucket = vi
      .fn()
      .mockRejectedValueOnce(question)
      .mockRejectedValueOnce({ code: "setup.request_invalid", params: { field }, status: 400 });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el);
    await flush(el);
    bucketRequest(el);
    await flush(el);
    await flush(el);
    const screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    await screen.updateComplete;
    const input = screen.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${box}]`)!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.click();
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector(`#${box}-error`)).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("says the server rejected the details, naming no field, when its request check names none", async () => {
    const screen = await refusedWith({ code: "setup.request_invalid", params: {}, status: 400 });
    expect(await bottomOf(screen)).toBe(
      "The server rejected the details. Check your entries, then try again.",
    );
    expect(screen.shadowRoot!.querySelector("[aria-invalid=true]")).toBeNull();
    await expectBucketSharedFieldsUnmarked(screen);
  });

  // Review Focus 5, the wizard's half.
  it("says the disk filled during the download", async () => {
    const screen = await refusedWith({ code: "restore.stream_disk_full", status: 507 });
    expect(screen.errorMessage).toBe(
      "This server's disk filled while the copy was downloading. Nothing on this server was changed. Free some space and try again.",
    );
  });

  it("tells the owner to check the connection when nothing answered", async () => {
    const screen = await refusedWith(new TypeError("Failed to fetch"));
    expect(screen.errorMessage).toBe(
      "The copy could not be restored. Check the connection and try again.",
    );
  });

  it("does not stay on the provisioning screen when the rejection carries nothing", async () => {
    const screen = await refusedWith(undefined);
    expect(screen.errorMessage).toBe(
      "The copy could not be restored. Check the connection and try again.",
    );
  });

  it("forgets the kit once the rebuild is staged", async () => {
    const restoreFromBucket = vi
      .fn()
      .mockRejectedValueOnce({ code: "restore.stream_disk_full", status: 507 })
      .mockResolvedValueOnce({ restoreStaged: true, restarting: true });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el);
    await flush(el);
    expect(readState(el, ["bucketRequest"]).bucketRequest).not.toBeUndefined();
    bucketRequest(el);
    await flush(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    expect(readState(el, ["bucketRequest"])).toEqual({ bucketRequest: undefined });
  });

  // An answer the server asked for belongs to the kit it checked; another kit is another copy.
  it("drops the old-server time and the venue it held for another kit", async () => {
    const restoreFromBucket = vi
      .fn()
      .mockRejectedValueOnce({
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        status: 409,
      })
      .mockRejectedValueOnce({
        code: "restore.stream_venue_unconfirmed",
        params: VENUE,
        status: 409,
      })
      .mockRejectedValueOnce({ code: "restore.stream_disk_full", status: 507 });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el, { kit: "first" });
    await flush(el);
    bucketRequest(el, { kit: "first", oldBoxGone: true });
    await flush(el);
    let screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    // Same kit: the answered question is kept, so the next send still carries the answer.
    expect({ liveSince: screen.liveSince, venue: screen.venue }).toEqual({
      liveSince: "2026-09-23T11:58:00.000Z",
      venue: VENUE,
    });
    bucketRequest(el, { kit: "second" });
    await flush(el);
    screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    expect({
      liveSince: screen.liveSince,
      liveUnknown: screen.liveUnknown,
      venue: screen.venue,
    }).toEqual({ liveSince: undefined, liveUnknown: false, venue: undefined });
  });

  it.each([
    [
      [
        {
          code: "restore.stream_source_live",
          params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        },
        { code: "restore.stream_source_unchecked", params: { reason: "clock" } },
      ],
      { liveSince: undefined, liveUnknown: true },
    ],
    [
      [
        { code: "restore.stream_source_unchecked", params: { reason: "clock" } },
        {
          code: "restore.stream_source_live",
          params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        },
      ],
      { liveSince: "2026-09-23T11:58:00.000Z", liveUnknown: false },
    ],
  ])("shows only the latest old-server refusal (%o)", async ([first, second], expected) => {
    const restoreFromBucket = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el);
    await flush(el);
    bucketRequest(el);
    await flush(el);
    const screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual(expected);
  });

  it("forgets the refusal and the request once the owner leaves the screen", async () => {
    const restoreFromBucket = vi.fn().mockRejectedValue({
      code: "restore.stream_venue_unconfirmed",
      params: VENUE,
      status: 409,
    });
    const el = await mountSetupApp(stubApi({ restoreFromBucket }));
    bucketRequest(el);
    await flush(el);
    await flush(el);
    goto(el, "role");
    await flush(el);
    goto(el, "restore-bucket");
    await flush(el);
    const screen = (await screenHost(el, "restore-bucket")) as SetupRestoreBucketScreen;
    expect({ venue: screen.venue, request: screen.request }).toEqual({
      venue: undefined,
      request: undefined,
    });
  });
});

describe("restoring a backup file whose old server may still be running", () => {
  const backup = {
    artifact: new File([Uint8Array.from([1])], "b.wbk"),
    recoveryKey: "k",
    environment: "production" as const,
  };

  it.each([
    [
      {
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
        status: 409,
      },
      { liveSince: "2026-09-23T11:58:00.000Z", liveUnknown: false },
    ],
    [
      { code: "restore.stream_source_unchecked", params: { reason: "bucket" }, status: 409 },
      { liveSince: undefined, liveUnknown: true },
    ],
  ])(
    "returns to the archive screen asking about the old server (%o)",
    async (refusal, expected) => {
      const restore = vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockResolvedValueOnce({ restoreStaged: true, restarting: true });
      const el = await mountSetupApp(stubApi({ restore }));
      restoreRequest(el, backup);
      await flush(el);
      await flush(el);
      const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
      expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual(expected);
      expect(screen.errorMessage).toBeUndefined();
      expect(screen.request).toEqual({ ...backup, oldBoxGone: false });
      // The owner confirms: the resend carries the answer, which the client turns into the header.
      restoreRequest(el, { ...backup, oldBoxGone: true });
      await flush(el);
      await flush(el);
      expect(restore).toHaveBeenLastCalledWith(backup.artifact, "k", "production", true);
      expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    },
  );

  it.each([
    ["recovery.passphrase_invalid", {}, "recoveryKey", "Check the recovery key."],
    [
      "restore.environment_mismatch",
      { backup: "preproduction", target: "production" },
      "environment",
      "The backup comes from the other environment. Choose the environment it came from.",
    ],
    ["setup.request_invalid", { field: "artifact" }, "artifact", "Check the backup file."],
    ["setup.request_invalid", { field: "recoveryKey" }, "recoveryKey", "Check the recovery key."],
    [
      "setup.request_invalid",
      { field: "environment" },
      "environment",
      "Check the backup environment.",
    ],
  ])(
    "returns the archive refusal %s %o under the %s field, leaving Restore working",
    async (code, params, field, message) => {
      const el = await mountSetupApp(
        stubApi({ restore: vi.fn().mockRejectedValue({ code, params, status: 400 }) }),
      );
      restoreRequest(el, backup);
      await flush(el);
      const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
      expect(screen.invalidField).toBe(field);
      const id = field === "recoveryKey" ? "recovery-key" : field;
      expect(messageUnder(screen, id)).toBe(message);
      expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
      const button = screen.shadowRoot!.querySelector("[data-test=restore]") as HTMLElement & {
        disabled: boolean;
      };
      expect(button.disabled).toBe(false);
    },
  );

  it("keeps an archive refusal of a field the form does not show, above Restore", async () => {
    const el = await mountSetupApp(
      stubApi({
        restore: vi
          .fn()
          .mockRejectedValue({ code: "setup.request_invalid", params: { field: "oldBoxGone" } }),
      }),
    );
    restoreRequest(el, backup);
    await flush(el);
    const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
    expect(screen.invalidField).toBeUndefined();
    expect(await bottomOf(screen)).toContain("setup.request_invalid");
  });

  it("does not stay on the provisioning screen when the rejection carries nothing", async () => {
    const el = await mountSetupApp(stubApi({ restore: vi.fn().mockRejectedValue(undefined) }));
    restoreRequest(el, backup);
    await flush(el);
    expect(await bottomOf(await screenHost(el, "restore"))).toBe(
      "The backup could not be staged. Check the connection and try again.",
    );
  });

  it("forgets the backup and key once the restore is staged", async () => {
    const restore = vi
      .fn()
      .mockRejectedValueOnce({
        code: "restore.stream_source_unchecked",
        params: { reason: "clock" },
      })
      .mockResolvedValueOnce({ restoreStaged: true, restarting: true });
    const el = await mountSetupApp(stubApi({ restore }));
    restoreRequest(el, backup);
    await flush(el);
    expect(readState(el, ["restoreRequest"]).restoreRequest).not.toBeUndefined();
    restoreRequest(el, { ...backup, oldBoxGone: true });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    expect(readState(el, ["restoreRequest"])).toEqual({ restoreRequest: undefined });
  });

  it("drops the old-server question it held for another backup file", async () => {
    const restore = vi
      .fn()
      .mockRejectedValueOnce({
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
      })
      .mockRejectedValueOnce({ code: "server.internal" });
    const el = await mountSetupApp(stubApi({ restore }));
    restoreRequest(el, backup);
    await flush(el);
    restoreRequest(el, { ...backup, artifact: new File(["other"], "other.wbk") });
    await flush(el);
    const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: undefined,
      liveUnknown: false,
    });
  });

  it("shows only the latest old-server refusal on the archive path", async () => {
    const restore = vi
      .fn()
      .mockRejectedValueOnce({
        code: "restore.stream_source_live",
        params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
      })
      .mockRejectedValueOnce({
        code: "restore.stream_source_unchecked",
        params: { reason: "bucket" },
      });
    const el = await mountSetupApp(stubApi({ restore }));
    restoreRequest(el, backup);
    await flush(el);
    restoreRequest(el, backup);
    await flush(el);
    const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: undefined,
      liveUnknown: true,
    });
  });

  it("forgets the old-server question once the owner leaves the screen", async () => {
    const restore = vi.fn().mockRejectedValue({
      code: "restore.stream_source_unchecked",
      params: { reason: "clock" },
      status: 409,
    });
    const el = await mountSetupApp(stubApi({ restore }));
    restoreRequest(el, backup);
    await flush(el);
    await flush(el);
    goto(el, "role");
    await flush(el);
    goto(el, "restore");
    await flush(el);
    const screen = (await screenHost(el, "restore")) as SetupRestoreScreen;
    expect({ liveUnknown: screen.liveUnknown, request: screen.request }).toEqual({
      liveUnknown: false,
      request: undefined,
    });
  });
});

describe("restoring a Cloud snapshot whose old server may still be running", () => {
  const pointId = "3a1d5560-c5bd-407a-b596-e63fbe2600d5";
  const approved = (id = pointId) => ({
    requestId: "b6cbaee9-ee8b-4da5-b023-900547debb94",
    code: "12345678",
    openCloudUrl: "https://cloud.example.test/recover#request=b6cbaee9-ee8b-4da5-b023-900547debb94",
    expiresAt: "2026-09-24T12:00:00.000Z",
    state: "approved" as const,
    point: {
      id,
      venueId: "a7f570e8-e510-49eb-b1a7-096ff72171f5",
      capturedAt: "2026-09-24T10:00:00.000Z",
      modules: { core: 1 },
    },
  });
  const live = {
    code: "restore.stream_source_live",
    params: { lastChangeAt: "2026-09-23T11:58:00.000Z" },
    status: 409,
  };
  const unchecked = {
    code: "restore.stream_source_unchecked",
    params: { reason: "bucket" },
    status: 409,
  };

  async function approvedCloudApp(overrides: Partial<Record<keyof SetupApi, unknown>>) {
    const el = await mountSetupApp(
      stubApi({ cloudRecoveryStatus: vi.fn().mockResolvedValue(approved()), ...overrides }),
    );
    goto(el, "cloud-restore");
    await flush(el);
    cloudRecoveryAction(el, "status");
    await flush(el);
    return el;
  }

  async function cloudScreen(el: SetupApp): Promise<SetupCloudRestoreScreen> {
    return (await screenHost(el, "cloud-restore")) as SetupCloudRestoreScreen;
  }

  it.each([
    [live, { liveSince: "2026-09-23T11:58:00.000Z", liveUnknown: false }],
    [unchecked, { liveSince: undefined, liveUnknown: true }],
    [
      { code: "restore.stream_source_live", params: {}, status: 409 },
      { liveSince: undefined, liveUnknown: true },
    ],
  ])("returns to the Cloud screen asking about the old server (%o)", async (refusal, expected) => {
    const restoreFromCloud = vi
      .fn()
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce({ restoreStaged: true, restarting: true });
    const el = await approvedCloudApp({ restoreFromCloud });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    const screen = await cloudScreen(el);
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual(expected);
    expect(screen.errorMessage).toBeUndefined();
    expect(screen.shadowRoot!.querySelector("[data-test=live-warning]")).not.toBeNull();
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    expect(restoreFromCloud.mock.calls).toEqual([
      [pointId, false],
      [pointId, true],
    ]);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  it.each([[{ code: "server.internal", status: 500 }], [undefined]])(
    "keeps the Cloud-unavailable sentence for any other refusal of the restore (%o)",
    async (refusal) => {
      const el = await approvedCloudApp({
        restoreFromCloud: vi.fn().mockRejectedValue(refusal),
      });
      cloudRecoveryAction(el, "restore", pointId, false);
      await flush(el);
      const screen = await cloudScreen(el);
      expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
        liveSince: undefined,
        liveUnknown: false,
      });
      expect(screen.errorMessage).toBe(
        "Cloud recovery is unavailable. Check the connection or request expiry, then try again.",
      );
    },
  );

  const cloudNewerSoftware =
    "This snapshot was made by newer Waitron software than this server has. Update this server, then try again.";
  const cloudUnopenable =
    "This snapshot could not be opened. It is damaged, or the recovery key Waitron Cloud holds for it does not open it.";
  it.each([
    ["restore.schema_too_new", 409, cloudNewerSoftware],
    ["recovery.passphrase_invalid", 422, cloudUnopenable],
    ["backup.artifact_invalid", 422, cloudUnopenable],
    ["backup.archive_invalid", 422, cloudUnopenable],
    [
      "restore.environment_mismatch",
      409,
      "This snapshot is not from a preparation or demo venue, and Cloud recovery restores only those.",
    ],
  ])(
    "says why a Cloud restore refused with %s cannot work by trying again",
    async (code, status, sentence) => {
      const el = await approvedCloudApp({
        restoreFromCloud: vi.fn().mockRejectedValue({ code, params: {}, status }),
      });
      cloudRecoveryAction(el, "restore", pointId, false);
      await flush(el);
      const screen = await cloudScreen(el);
      expect(screen.errorMessage).toBe(sentence);
      expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
        liveSince: undefined,
        liveUnknown: false,
      });
    },
  );

  const unavailable =
    "Cloud recovery is unavailable. Check the connection or request expiry, then try again.";

  it("says to check the old-server tick box under it when the server's request check names it", async () => {
    const restoreFromCloud = vi
      .fn()
      .mockRejectedValueOnce(live)
      .mockRejectedValueOnce({
        code: "setup.request_invalid",
        params: { field: "oldBoxGone" },
        status: 400,
      });
    const el = await approvedCloudApp({ restoreFromCloud });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    const screen = await cloudScreen(el);
    await screen.updateComplete;
    const input = screen.shadowRoot!.querySelector("[data-test=old-box-gone]")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.shadowRoot!.querySelector("#old-box-gone-error")!.textContent).toBe(
      "Check your answer about the old server.",
    );
    expect(await bottomOf(screen)).toBe("Correct the highlighted fields to continue.");
    expect(screen.shadowRoot!.textContent).not.toContain(unavailable);
    const button = screen.shadowRoot!.querySelector("[data-test=restore]") as HTMLElement & {
      disabled: boolean;
    };
    expect(button.disabled).toBe(false);
    await vi.waitFor(() => expect(screen.shadowRoot!.activeElement).toBe(input));
  });

  it("says above Restore to check the old-server answer when that tick box is not on the screen", async () => {
    const el = await approvedCloudApp({
      restoreFromCloud: vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "oldBoxGone" },
        status: 400,
      }),
    });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    const screen = await cloudScreen(el);
    expect(await bottomOf(screen)).toBe("Check your answer about the old server.");
    expect(screen.shadowRoot!.querySelector("[aria-invalid=true]")).toBeNull();
  });

  it("says above Restore to check the approved snapshot when the server's request check names the point", async () => {
    const el = await approvedCloudApp({
      restoreFromCloud: vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "pointId" },
        status: 400,
      }),
    });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    const screen = await cloudScreen(el);
    expect(await bottomOf(screen)).toBe("Check the approved snapshot.");
    expect(screen.shadowRoot!.querySelector("[aria-invalid=true]")).toBeNull();
    expect(screen.shadowRoot!.querySelector("p.error[id$='-error']")).toBeNull();
    expect(screen.shadowRoot!.textContent).not.toContain(unavailable);
    const button = screen.shadowRoot!.querySelector("[data-test=restore]") as HTMLElement & {
      disabled: boolean;
    };
    expect(button.disabled).toBe(false);
  });

  it("shows the old-server refusal again when the next Restore is refused the same way", async () => {
    const refusal = {
      code: "setup.request_invalid",
      params: { field: "oldBoxGone" },
      status: 400,
    };
    const restoreFromCloud = vi
      .fn()
      .mockRejectedValueOnce(unchecked)
      .mockRejectedValueOnce(refusal)
      .mockRejectedValueOnce(refusal);
    const el = await approvedCloudApp({ restoreFromCloud });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    let screen = await cloudScreen(el);
    const sentence = "Check your answer about the old server.";
    expect(screen.shadowRoot!.querySelector("#old-box-gone-error")!.textContent).toBe(sentence);
    for (const box of ["acknowledge", "old-box-gone"]) {
      const input = screen.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${box}]`)!;
      input.checked = true;
      input.dispatchEvent(new Event("change"));
      await screen.updateComplete;
    }
    expect(screen.shadowRoot!.querySelector("#old-box-gone-error")).toBeNull();
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    await flush(el);
    expect(restoreFromCloud).toHaveBeenLastCalledWith(pointId, true);
    screen = await cloudScreen(el);
    expect(screen.shadowRoot!.querySelector("#old-box-gone-error")!.textContent).toBe(sentence);
    expect(
      screen.shadowRoot!.querySelector("[data-test=old-box-gone]")!.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("leaves no old-server refusal behind once the server accepts the next Restore", async () => {
    const restoreFromCloud = vi
      .fn()
      .mockRejectedValueOnce(unchecked)
      .mockRejectedValueOnce({
        code: "setup.request_invalid",
        params: { field: "oldBoxGone" },
        status: 400,
      })
      .mockResolvedValueOnce({ restoreStaged: true, restarting: true });
    const el = await approvedCloudApp({ restoreFromCloud });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    expect((await cloudScreen(el)).shadowRoot!.querySelector("#old-box-gone-error")).not.toBeNull();
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=screen-cloud-restore]")).toBeNull();
    expect(readState(el, ["cloudRecoveryError", "cloudInvalidField"])).toEqual({
      cloudRecoveryError: undefined,
      cloudInvalidField: undefined,
    });
  });

  it.each([[{}], [{ field: "kit" }], [{ field: 5 }]])(
    "says the server rejected the details when its request check names no field, or one other than oldBoxGone or pointId (%o)",
    async (params) => {
      const el = await approvedCloudApp({
        restoreFromCloud: vi
          .fn()
          .mockRejectedValue({ code: "setup.request_invalid", params, status: 400 }),
      });
      cloudRecoveryAction(el, "restore", pointId, false);
      await flush(el);
      const screen = await cloudScreen(el);
      expect(await bottomOf(screen)).toBe(
        "The server rejected the details. Check your entries, then try again.",
      );
      expect(screen.shadowRoot!.querySelector("[aria-invalid=true]")).toBeNull();
      expect(screen.shadowRoot!.querySelector("p.error[id$='-error']")).toBeNull();
    },
  );

  describe("in Spanish", () => {
    afterEach(() => setLocale("en-GB"));

    it.each([
      [{ field: "pointId" }, "Revisa la instantánea aprobada."],
      [{ field: "oldBoxGone" }, "Revisa tu respuesta sobre el servidor anterior."],
      [
        {},
        "El servidor ha rechazado los datos. Revisa lo que has introducido e inténtalo de nuevo.",
      ],
    ])("says above Restore what the request check refused (%o)", async (params, sentence) => {
      const el = await approvedCloudApp({
        restoreFromCloud: vi
          .fn()
          .mockRejectedValue({ code: "setup.request_invalid", params, status: 400 }),
      });
      setLocale("es-ES");
      cloudRecoveryAction(el, "restore", pointId, false);
      await flush(el);
      expect(await bottomOf(await cloudScreen(el))).toBe(sentence);
    });
  });

  it("shows only the latest old-server refusal on the Cloud path", async () => {
    const restoreFromCloud = vi
      .fn()
      .mockRejectedValueOnce(live)
      .mockRejectedValueOnce(unchecked)
      .mockRejectedValueOnce(live);
    const el = await approvedCloudApp({ restoreFromCloud });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    let screen = await cloudScreen(el);
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: undefined,
      liveUnknown: true,
    });
    cloudRecoveryAction(el, "restore", pointId, true);
    await flush(el);
    screen = await cloudScreen(el);
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: "2026-09-23T11:58:00.000Z",
      liveUnknown: false,
    });
  });

  it("keeps the question while the same snapshot is approved and drops it for another", async () => {
    const cloudRecoveryStatus = vi
      .fn()
      .mockResolvedValueOnce(approved())
      .mockResolvedValueOnce(approved())
      .mockResolvedValueOnce(approved("3a1d5560-c5bd-407a-b596-e63fbe2600d6"));
    const el = await approvedCloudApp({
      cloudRecoveryStatus,
      restoreFromCloud: vi.fn().mockRejectedValue(unchecked),
    });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    cloudRecoveryAction(el, "status");
    await flush(el);
    expect((await cloudScreen(el)).liveUnknown).toBe(true);
    cloudRecoveryAction(el, "status");
    await flush(el);
    const screen = await cloudScreen(el);
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: undefined,
      liveUnknown: false,
    });
  });

  it("forgets the old-server question once the owner leaves the screen", async () => {
    const el = await approvedCloudApp({ restoreFromCloud: vi.fn().mockRejectedValue(live) });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    goto(el, "restore");
    await flush(el);
    goto(el, "cloud-restore");
    await flush(el);
    const screen = await cloudScreen(el);
    expect({ liveSince: screen.liveSince, liveUnknown: screen.liveUnknown }).toEqual({
      liveSince: undefined,
      liveUnknown: false,
    });
  });

  it("clears a cloud-recovery error message once the owner leaves the screen", async () => {
    const el = await approvedCloudApp({
      restoreFromCloud: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
    });
    cloudRecoveryAction(el, "restore", pointId, false);
    await flush(el);
    expect(await bottomOf(await screenHost(el, "cloud-restore"))).toBe(
      "Cloud recovery is unavailable. Check the connection or request expiry, then try again.",
    );
    goto(el, "restore");
    await flush(el);
    goto(el, "cloud-restore");
    await flush(el);
    expect(await bottomOf(await screenHost(el, "cloud-restore"))).toBe("");
  });

  it("writes nothing for an old-server refusal that arrives after the element is detached", async () => {
    const pending = deferred();
    const el = await approvedCloudApp({
      restoreFromCloud: vi.fn().mockReturnValue(pending.promise),
    });
    cloudRecoveryAction(el, "restore", pointId, false);
    await el.updateComplete;
    el.remove();
    pending.reject(live);
    await flush(el);
    expect(readState(el, ["screen", "cloudLiveSince", "cloudRecoveryError"])).toEqual({
      screen: "provisioning",
      cloudLiveSince: undefined,
      cloudRecoveryError: undefined,
    });
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
      name: "a bucket restore success",
      method: "restoreFromBucket",
      fire: (el: SetupApp) => bucketRequest(el),
      settle: (d: ReturnType<typeof deferred>) =>
        d.resolve({ restoreStaged: true, restarting: true }),
      unchanged: { screen: "provisioning", rebuilt: false },
    },
    {
      name: "a bucket restore refusal",
      method: "restoreFromBucket",
      fire: (el: SetupApp) => bucketRequest(el),
      settle: (d: ReturnType<typeof deferred>) =>
        d.reject({ code: "restore.stream_source_live", params: { lastChangeAt: "x" } }),
      unchanged: {
        screen: "provisioning",
        bucketLiveSince: undefined,
        bucketRestoreError: undefined,
      },
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

  it("writes nothing for a saved-setup read that answers an adopt refusal", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    } satisfies SetupStatus);
    const adopt = vi
      .fn()
      .mockRejectedValue({ code: "setup.operation_conflict", params: {}, status: 409 });
    const el = await mountSetupApp(stubApi({ adopt, getStatus }));
    const bootReads = getStatus.mock.calls.length;
    const pending = deferred<SetupStatus>();
    getStatus.mockReturnValue(pending.promise);
    adoptRequest(el);
    await flush(el);
    expect(getStatus).toHaveBeenCalledTimes(bootReads + 1);
    el.remove();
    pending.resolve({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
      operation: {
        id: "op-1",
        kind: "adopt",
        phase: "venue_committed",
        updatedAt: "2026-09-26T10:00:00.000Z",
      },
    });
    await flush(el);
    expect(readState(el, ["screen", "provisionMessage", "connectError"])).toEqual({
      screen: "provisioning",
      provisionMessage: undefined,
      connectError: undefined,
    });
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
    expect(mode.shadowRoot!.querySelector("[data-test=production-warning]")).not.toBeNull();
  });
});

describe("the wizard's language", () => {
  afterEach(() => {
    setLocale("en-GB");
  });

  const unreachable = () => stubApi({ getStatus: vi.fn().mockRejectedValue(new TypeError()) });

  async function mountWithBrowserLanguages(
    languages: readonly string[],
    api: SetupApi,
  ): Promise<SetupApp> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mounted.push(host);
    const el = document.createElement("setup-app") as SetupApp;
    el.api = api;
    el.browserLanguages = languages;
    host.appendChild(el);
    await flush(el);
    return el;
  }

  async function choose(el: SetupApp, code: string): Promise<void> {
    const chooser = el.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("wt-language-chooser")!;
    chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=lang-trigger]")!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await chooser.updateComplete;
    chooser.shadowRoot!.querySelector<HTMLElement>(`[data-test=lang-${code}]`)!.click();
    await flush(el);
  }

  it("speaks the browser's language when nothing has been chosen", async () => {
    const el = await mountWithBrowserLanguages(["fr-FR", "es-MX"], unreachable());
    expect(document.documentElement.lang).toBe("es-ES");
    expect(document.title).toBe("Waitron — configura tu servidor");
    expect(await screenText(el, "connection", "[role=alert]")).toBe(
      "No hemos podido contactar con el servidor. Comprueba que está encendido y tu conexión de red.",
    );
  });

  it("speaks British English when the browser names no language the wizard speaks", async () => {
    await mountWithBrowserLanguages(["fr-FR"], unreachable());
    expect(document.documentElement.lang).toBe("en-GB");
    expect(document.title).toBe("Waitron — set up your server");
  });

  it("names the chosen language on the chooser once the page switches to it", async () => {
    const el = await mountWithBrowserLanguages(["en-GB"], unreachable());
    const trigger = () =>
      el
        .shadowRoot!.querySelector("wt-language-chooser")!
        .shadowRoot!.querySelector("[data-test=lang-trigger] [part=name]")!
        .textContent!.trim();
    expect(trigger()).toBe("English");
    await choose(el, "es-ES");
    expect(trigger()).toBe("Español");
  });

  it("offers the language chooser, and a choice re-words the message already on screen", async () => {
    const el = await mountWithBrowserLanguages(["en-GB"], unreachable());
    expect(await screenText(el, "connection", "[role=alert]")).toBe(
      "We could not reach the server. Check its power and your network connection.",
    );
    await choose(el, "es-ES");
    expect(document.documentElement.lang).toBe("es-ES");
    expect(document.title).toBe("Waitron — configura tu servidor");
    expect(await screenText(el, "connection", "[role=alert]")).toBe(
      "No hemos podido contactar con el servidor. Comprueba que está encendido y tu conexión de red.",
    );
  });

  it("keeps the operator's choice when the wizard is attached again", async () => {
    const el = await mountWithBrowserLanguages(["en-GB"], stubApi());
    await choose(el, "es-ES");
    const host = el.parentElement!;
    el.remove();
    host.appendChild(el);
    await flush(el);
    expect(currentLocale()).toBe("es-ES");
  });

  it("re-words a review refusal after a switch", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "person.email_invalid", params: {} });
    const el = await mountWithBrowserLanguages(["en-GB"], stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    await choose(el, "es-ES");
    expect(await screenText(el, "review", "[data-test=error]")).toBe(
      "El correo del administrador no es válido. Revísalo y vuelve a configurar.",
    );
  });

  it("re-words a provisioning outcome and its reload label after a switch", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.already_provisioned", params: {} });
    const el = await mountWithBrowserLanguages(["en-GB"], stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    await choose(el, "es-ES");
    expect(await screenText(el, "provisioning", "[data-test=error]")).toBe(
      "Este servidor ya está configurado.",
    );
    expect(await screenText(el, "provisioning", "[data-test=reload]")).toBe(
      "Recargar para abrir la caja",
    );
  });

  it("sends a chosen language with the provision, for the admin account", async () => {
    const provision = vi.fn().mockResolvedValue({ provisioned: true, restarting: true });
    const el = await mountWithBrowserLanguages(["en-GB"], stubApi({ provision }));
    await choose(el, "es-ES");
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    expect(provision.mock.calls[0]![1]).toBe("es-ES");
  });

  it("leaves the admin account's language to the browser's header when nothing was chosen", async () => {
    const provision = vi.fn().mockResolvedValue({ provisioned: true, restarting: true });
    const el = await mountWithBrowserLanguages(["es-ES"], stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    expect(provision.mock.calls[0]).toHaveLength(1);
  });
});

describe("application unsaved changes renderer", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const decision of ["keep", "discard"] as const) {
      it(`${locale}: ${decision} uses the shell's single localized confirmation`, async () => {
        const el = await mountSetupApp();
        await flush(el);
        setLocale(locale);
        await el.updateComplete;
        const child = el.shadowRoot!.querySelector<HTMLElement>("div, main")!;
        const coordinator = leaveCoordinatorFor(child);
        expect(coordinator, "descendant resolves the application registry").toBeDefined();
        let draft = "Original";
        const scope = coordinator!.register({
          id: child,
          current: () => draft,
          snapshot: (value) => value,
          equal: (a, b) => a === b,
          restore: (value) => {
            draft = value;
          },
        });
        draft = "Edited";
        scope.changed();
        let left = 0;
        const pending = coordinator!.request({
          scopes: [scope.id],
          reason: "cancel",
          proceed() {
            left++;
          },
        });
        await el.updateComplete;
        const questions = el.shadowRoot!.querySelectorAll("wt-unsaved-changes");
        expect(questions).toHaveLength(1);
        const question = questions[0]!;
        await question.updateComplete;
        const modal = question.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        expect(question.heading).toBe(
          locale === "en-GB" ? "Discard unsaved changes?" : "¿Descartar los cambios sin guardar?",
        );
        expect(question.message).toBe(
          locale === "en-GB"
            ? "Your changes have not been saved."
            : "Tus cambios no se han guardado.",
        );
        expect(question.keepLabel).toBe(locale === "en-GB" ? "Keep editing" : "Seguir editando");
        expect(question.discardLabel).toBe(
          locale === "en-GB" ? "Discard changes" : "Descartar cambios",
        );
        question.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${decision}"]`)!.click();
        expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
        expect(left).toBe(decision === "keep" ? 0 : 1);
        expect(draft).toBe(decision === "keep" ? "Edited" : "Original");
        scope.dispose();
      });
    }
  }
});
