import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
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

  it("renders a stub for every screen the machine can reach", async () => {
    const el = await mountSetupApp();
    const screens: Screen[] = ["admin", "venue", "cert", "review", "provisioning", "done", "mode"];
    for (const screen of screens) {
      goto(el, screen);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`[data-test=screen-${screen}]`)).not.toBeNull();
    }
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
});
