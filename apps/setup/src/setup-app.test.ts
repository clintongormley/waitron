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
    ...overrides,
  } as unknown as SetupApi;
}

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

/** Reads a `[data-test]` element's trimmed text out of a mounted screen's own shadow root. */
async function screenText(el: SetupApp, screen: Screen, sel: string): Promise<string | null> {
  const host = await screenHost(el, screen);
  return host.shadowRoot!.querySelector<HTMLElement>(sel)?.textContent?.trim() ?? null;
}

describe("setup-app", () => {
  it("renders the mode screen with the setup heading on boot", async () => {
    const el = await mountSetupApp();
    expect(el.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
    const mode = await screenHost(el, "mode");
    expect(mode.shadowRoot!.querySelector("h1")?.textContent).toContain("Set up this Waitron box");
  });

  it("boot reads the box environment via getStatus and surfaces it", async () => {
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
    // The shell rendered its first screen despite the rejection, and no environment is shown.
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
    const screens: Screen[] = ["admin", "venue", "cert", "review", "provisioning", "done", "mode"];
    for (const screen of screens) {
      goto(el, screen);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)).not.toBeNull();
    }
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

  it("maps a fieldless setup.request_invalid to a generic review banner", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.request_invalid", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
    expect(await screenText(el, "review", "[data-test=error]")).toContain("rejected the details");
  });

  it("routes setup.aeat_cert_required back to the cert screen", async () => {
    const provision = vi.fn().mockRejectedValue({ code: "setup.aeat_cert_required", params: {} });
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
      .mockRejectedValue({ code: "provisioning.id_sistema_invalid", params: {} });
    const el = await mountSetupApp(stubApi({ provision }));
    provisionRequest(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
    expect(await screenText(el, "venue", "[data-test=server-error]")).toContain(
      "provisioning.id_sistema_invalid",
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
});

describe("assembleBody", () => {
  it("omits the aeatCert key entirely for a demo draft (never null/empty)", () => {
    const body = assembleBody({ mode: "demo", venue: { taxId: "B1" } });
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
