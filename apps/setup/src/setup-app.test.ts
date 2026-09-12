import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { SetupApp, assembleBody } from "./setup-app.js";
import type { DeepPartial, Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi, SetupStatus } from "./api/client.js";

// A minimal real-Chromium mount. Importing ./setup-app.js above registers the `setup-app` custom
// element via its @customElement decorator. Each test gets a fresh themed host, cleaned up afterwards.

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

/**
 * A fake {@link SetupApi} covering the only method the shell calls on boot (`getStatus`). `provision`
 * is stubbed so a later step could call it; a test overrides either with its own `vi.fn()`. Cast
 * through `unknown` because the shell touches only this surface, mirroring the dashboard's `stubApi`.
 */
function stubApi(overrides: Partial<Record<keyof SetupApi, unknown>> = {}): SetupApi {
  return {
    getStatus: vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    } satisfies SetupStatus),
    provision: vi.fn().mockResolvedValue({ provisioned: true, tenantId: "t-1", restarting: true }),
    adopt: vi.fn().mockResolvedValue({
      adopted: true,
      tenantId: "t-1",
      breakGlassSecret: "bg-default",
      restarting: true,
    }),
    restore: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
    stageConfiguration: vi.fn(),
    runFiscalTest: vi.fn().mockResolvedValue({ status: "accepted" }),
    ...overrides,
  } as unknown as SetupApi;
}

/** The connect screen's assembled adopt body — the shape the shell forwards straight to `api.adopt`. */
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
  await el.updateComplete;
  return el;
}

/** Drains the microtask queue (settling the awaited boot promise) then Lit's render. */
async function flush(el: SetupApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The shell's event-listening container, from which composed screen events are dispatched in tests. */
const wizard = (el: SetupApp) => el.shadowRoot!.querySelector<HTMLElement>(".wizard")!;

/**
 * The real `mode`/`admin`/`review` screens each render into their OWN shadow root, so the shell's
 * `shadowRoot.querySelector` cannot see their contents. This grabs the mounted screen host and awaits
 * its render, so a test can read into its shadow root. `updateComplete` is awaited because the shell
 * awaiting its own render does not await a freshly-mounted child's.
 */
async function screenHost(el: SetupApp, screen: Screen): Promise<HTMLElement> {
  const host = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${screen}]`,
  )!;
  await host.updateComplete;
  return host;
}

/** Reads the shell's private accumulated draft — the internal the `setup-patch` merge writes into,
 * which has no DOM surface until the later `review` screen. TS-private is erased at runtime. */
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

/** Fires the composed, screen-agnostic `setup-advance` the venue screen emits on a valid Next. */
function advance(el: SetupApp): void {
  wizard(el).dispatchEvent(new CustomEvent("setup-advance", { bubbles: true, composed: true }));
}

/** Fires the composed `provision-requested` the review + provisioning screens emit, into the shell. */
function provisionRequest(el: SetupApp): void {
  wizard(el).dispatchEvent(
    new CustomEvent("provision-requested", { bubbles: true, composed: true }),
  );
}

/** Fires the composed `adopt-requested` the connect screen emits (with its assembled body), into the shell. */
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

function configurationRequest(el: SetupApp, artifact: File, passphrase: string): void {
  wizard(el).dispatchEvent(
    new CustomEvent("configuration-requested", {
      detail: { request: { artifact, passphrase } },
      bubbles: true,
      composed: true,
    }),
  );
}

/** Reads a `[data-test]` element's trimmed text out of a mounted screen's own shadow root. */
async function screenText(el: SetupApp, screen: Screen, sel: string): Promise<string | null> {
  const host = await screenHost(el, screen);
  return host.shadowRoot!.querySelector<HTMLElement>(sel)?.textContent?.trim() ?? null;
}

describe("setup-app", () => {
  it("renders the four-choice onboarding screen on boot", async () => {
    const el = await mountSetupApp();
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("h1")?.textContent).toContain("Set up this Waitron box");
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
    // The shell rendered its first screen despite the rejection, and no environment is shown on it.
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("[data-test=environment]")).toBeNull();
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

  // Fix (m): the venue→cert/review conditional lives in the SHELL now (it owns the merged draft), not
  // in the venue screen. On a screen-agnostic `setup-advance` from venue, the shell routes by the
  // draft's `mode` and fiscal territory. Both branches are asserted here.

  // Prove-by-deletion of the `mode === "live"` operand: change it to a constant `true` and this test
  // (demo → review) flips red, since a demo draft would then route to cert.
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

  // Prove-by-deletion of the `fiscalTerritory === "ES-common"` operand: drop it (leaving only
  // `mode === "live"`) and this test flips red — a live NON-ES-common draft would then route to cert.
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

  // The advance is inert off the venue screen (only venue emits it today, but the guard is real).
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

  // A routed-back venue error must not linger once the operator corrects it and advances forward — the
  // shell clears it on `setup-advance` just as it does on a manual `setup-goto`. Prove-by-deletion: drop
  // the `this.venueError = undefined` line in `#onAdvance` and this flips red.
  it("clears a routed venue error when advancing forward off the venue screen", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "provisioning.territory_country_mismatch", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    // Routed back to venue with the server banner.
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
    // Seeded defaults are present before any patch.
    expect(readDraft(el).venue?.country).toBe("ES");
    expect(readDraft(el).venue?.location?.timeZone).toBe("Europe/Madrid");

    patch(el, { mode: "live", venue: { taxId: "B12345678", location: { city: "Madrid" } } });

    const draft = readDraft(el);
    expect(draft.mode).toBe("live");
    expect(draft.venue?.taxId).toBe("B12345678");
    // The nested patch merged into location WITHOUT dropping the seeded time zone / territory.
    expect(draft.venue?.location?.city).toBe("Madrid");
    expect(draft.venue?.location?.timeZone).toBe("Europe/Madrid");
    expect(draft.venue?.location?.fiscalTerritory).toBe("ES-common");
    // And the seeded country survived the venue-level merge.
    expect(draft.venue?.country).toBe("ES");
  });

  it("#onPatch skips an explicit undefined so a partial re-emit never deletes a sibling", async () => {
    const el = await mountSetupApp();
    patch(el, { venue: { taxId: "B12345678" } });
    // A later patch whose taxId is undefined must not wipe the value already collected.
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
      tenantId: "t-1",
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  // The done screen's first-run backup nudge (Task 8) is gated on the wizard's own DEMO/LIVE choice —
  // NOT `config.devMode` (`WAITRON_ENV=dev`), which this browser wizard never observes. `draft.mode`
  // is what the shell already holds by the time provisioning succeeds, so it is threaded straight
  // through as the done screen's `onboardingIntent` property.
  it("threads demo intent through to the done screen", async () => {
    const el = await mountSetupApp(
      stubApi({
        provision: vi
          .fn()
          .mockResolvedValue({ provisioned: true, tenantId: "t-1", restarting: true }),
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
        provision: vi
          .fn()
          .mockResolvedValue({ provisioned: true, tenantId: "t-1", restarting: true }),
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
        provision: vi
          .fn()
          .mockResolvedValue({ provisioned: true, tenantId: "t-1", restarting: true }),
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
    resolveProvision({ provisioned: true, tenantId: "t-1", restarting: true });
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

  // Task 5: the four venue text fields the fiscal regime refuses are fields the venue FORM owns, and
  // that form cannot evaluate the rule itself — so the refusal goes back to the form with the field
  // marked, not to a review-screen banner quoting a raw field path. Prove-by-deletion: drop the
  // `VENUE_FORM_FIELDS` branch and this flips red (the shell lands on review).
  it.each(["legalName", "seriesCode", "rectificativeSeriesCode", "location.operationDescription"])(
    "sends a %s refusal back to the venue form with the field marked",
    async (field) => {
      const provision = vi
        .fn()
        .mockRejectedValue({ code: "setup.request_invalid", params: { field } });
      const el = await mountSetupApp(stubApi({ provision }));
      provisionRequest(el);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).toBeNull();
      const venue = await screenHost(el, "venue");
      expect((venue as unknown as { invalidField?: string }).invalidField).toBe(field);
      // No stale banner beside the marked field — the field's own explanation is the message now.
      expect(venue.shadowRoot!.querySelector("[data-test=server-error]")).toBeNull();
    },
  );

  // A field the venue form does not own still gets the old review banner: there is nowhere better to
  // send the operator, and every other collecting screen validates its own fields already.
  it("still routes a field the venue form does not own to the review banner", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "setup.request_invalid", params: { field: "mode" } });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("mode");
  });

  // A mark must not outlive the attempt that produced it: the operator navigating away and back, or
  // firing a fresh provision, starts clean. Prove-by-deletion: drop the clear in `#onGoto` and the
  // second mount still carries `seriesCode`.
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

  // Fix (k): a terminal 409 offers a RELOAD action, not a retry — the shell wires the label per code.
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

  // Fix 2: `#request` has no try/catch, so a network drop rejects `provision()` with a bare `TypeError`
  // and a non-JSON error body (the dev proxy's 502 HTML) rejects with a `SyntaxError` — neither carries
  // a `.code`. Without the coercion `#mapProvisionError` did `undefined.startsWith(...)`, throwing out of
  // the catch as an unhandled rejection and stranding the operator on "Provisioning…" forever. Prove by
  // deletion: drop the `typeof … === "string" ? … : "server.internal"` coercion and this flips red.
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
      expect(rejections).toEqual([]); // the catch handled it — nothing escaped
    },
  );

  // Fix 3: a routed-back server error must not reappear once the operator has corrected + advanced and
  // later steps back onto that screen manually. `#onGoto` clears it; the error-routing in
  // `#mapProvisionError` assigns `screen` directly (not via goto), so the banner still shows initially.
  // Prove by deletion: drop the `this.venueError = undefined` line in `#onGoto` and this flips red.
  it("clears a routed venue error on a manual re-navigation so it doesn't reappear stale", async () => {
    const provision = vi
      .fn()
      .mockRejectedValue({ code: "provisioning.territory_country_mismatch", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    // Routed back to venue with the server banner showing.
    expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
    expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(
      "country must match",
    );
    // The operator navigates away (Back to admin) and returns to venue: the stale banner is gone.
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
      .mockResolvedValue({ provisioned: true, tenantId: "t-1", restarting: true });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    const host = await screenHost(el, "provisioning");
    host.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await flush(el);
    expect(provision).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  // The CRITICAL fiscal guard, at the shell boundary that actually POSTs: a draft carrying a live
  // certificate that was later reverted to demo must NOT ship the cert. Asserts the REAL posted body.
  it("never posts a stale AEAT cert on a demo provision reached by reverting from live", async () => {
    const provision = vi.fn().mockResolvedValue({
      provisioned: true,
      tenantId: "t-1",
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ provision }));
    // live → cert (PFX filled) → … → back to mode → switch to Demo: the draft still holds the cert.
    patch(el, {
      mode: "live",
      aeatCert: { pfxBase64: "AAAA", passphrase: "x", certKind: "sello" },
    });
    patch(el, { mode: "demo" });
    expect(readDraft(el).aeatCert?.pfxBase64).toBe("AAAA"); // the stale cert is still in the draft
    provisionRequest(el);
    await flush(el);
    expect(provision).toHaveBeenCalledOnce();
    const body = provision.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.mode).toBe("demo");
    expect("aeatCert" in body).toBe(false);
  });

  // ── The mirror path (C2b Task 13): role=mirror → connect → adopt → provisioning → done. ──

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
    const adopt = vi.fn().mockResolvedValue({ adopted: true, tenantId: "t-1", restarting: true });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    // The shell forwards the connect screen's assembled body straight through — credential stays the
    // structured object, never re-shaped into a string.
    expect(adopt).toHaveBeenCalledWith(adoptBody);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  // The adopt 200 carries the break-glass secret ONCE (spec §4.2). The wizard must SHOW it to the
  // operator to record before the box restarts — the server never logs or re-issues it, so a discarded
  // secret is gone for good. Prove-by-deletion: drop the `this.breakGlassSecret = outcome.breakGlassSecret`
  // capture (or the done-screen panel) and this flips red.
  it("surfaces the break-glass secret ONCE on the done screen after a successful adopt", async () => {
    const secret = "bg-secret-once-9f3a";
    const adopt = vi.fn().mockResolvedValue({
      adopted: true,
      tenantId: "t-1",
      breakGlassSecret: secret,
      restarting: true,
    });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
    // The value itself is rendered for the operator to copy.
    expect(await screenText(el, "done", "[data-test=break-glass-secret]")).toBe(secret);
    // Alongside the "record it now, it won't be shown again" instruction. Whitespace is collapsed
    // because the rendered copy wraps across lines.
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
    resolveAdopt({ adopted: true, tenantId: "t-1", restarting: true });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-done]")).not.toBeNull();
  });

  // The retryable adopt failures route BACK to the connect form with a banner — the connect form (not
  // the provisioning screen, which fires `provision-requested`) is the mirror path's retry surface, so
  // a re-submit re-fires `adopt-requested`. Prove-by-deletion: point the default branch at
  // `provisioning` instead of `connect` and these flip red.
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

  // A code-less rejection (network drop / non-JSON body) must not strand the operator or throw an
  // unhandled `undefined.startsWith`. Prove-by-deletion: drop the `typeof … === "string"` coercion.
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
    "maps the fiscal 409 %s on adopt to 'already set up' with a dashboard reload and NO retry",
    async (code) => {
      const adopt = vi.fn().mockRejectedValue({ code, params: {} });
      const el = await mountSetupApp(stubApi({ adopt }));
      adoptRequest(el);
      await flush(el);
      expect(await screenText(el, "provisioning", "[data-test=error]")).toContain("already set up");
      const host = await screenHost(el, "provisioning");
      expect(host.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
      expect(host.shadowRoot!.querySelector("[data-test=reload]")?.textContent).toContain(
        "open the dashboard",
      );
    },
  );

  // The connect screen's own re-submit is the retry: a routed-back failure, corrected and re-fired,
  // reaches `api.adopt` again and succeeds.
  it("re-adopts when the connect form re-emits adopt-requested after a routed-back failure", async () => {
    const adopt = vi
      .fn()
      .mockRejectedValueOnce({ code: "mirror.bundle_fetch_failed", params: {} })
      .mockResolvedValue({ adopted: true, tenantId: "t-1", restarting: true });
    const el = await mountSetupApp(stubApi({ adopt }));
    adoptRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-connect]")).not.toBeNull();
    adoptRequest(el); // the operator corrects and re-submits
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

  // Prove-by-deletion of the mode gate: drop `draft.mode === "live" &&` and this flips red — a demo
  // provision would then carry the stale cert (the CRITICAL fiscal defect).
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
