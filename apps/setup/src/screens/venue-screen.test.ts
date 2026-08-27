import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

/** Collects the two composed events the screen emits UP; both bubble+compose, so the host hears them. */
function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupVenueScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** Types `value` into the wt-input at `[data-test=field]` by firing its composed `wt-change`. */
async function type(el: SetupVenueScreen, field: string, value: string): Promise<void> {
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Picks `value` in the native `<select>` at `[data-test=field]` and fires its `change`. */
async function pick(el: SetupVenueScreen, field: string, value: string): Promise<void> {
  const select = q(el, `[data-test=${field}]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** Toggles the invoice-locale checkbox for `locale` to `checked`, firing its `change`. */
async function toggleLocale(el: SetupVenueScreen, locale: string, checked: boolean): Promise<void> {
  const box = q(el, `[data-test=locale-${locale}]`) as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** The valid text-field values a complete venue carries; `addressLine2` is deliberately left blank. */
const VALID: Record<string, string> = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Deli del Sol SL",
  name: "Calle Mayor",
  operationDescription: "Delicatessen",
  addressLine1: "Calle Mayor 1",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  dayCutover: "06:00",
  tillName: "Mostrador 1",
  seriesCode: "FA",
  rectificativeSeriesCode: "RF",
};

/** Fills every required text field with a valid value (leaving `addressLine2` blank), then any overrides. */
async function fillValid(
  el: SetupVenueScreen,
  overrides: Record<string, string> = {},
): Promise<void> {
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    await type(el, key, value);
  }
}

/** The nested location slice the valid `VALID` fixture emits — `addressLine2` blank becomes `null`. */
const EXPECTED_LOCATION = {
  name: "Calle Mayor",
  fiscalTerritory: "ES-common",
  invoiceLocales: ["es-ES"],
  operationDescription: "Delicatessen",
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
};

const EXPECTED_VENUE = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Deli del Sol SL",
  location: EXPECTED_LOCATION,
  tillName: "Mostrador 1",
  seriesCode: "FA",
  rectificativeSeriesCode: "RF",
};

afterEach(cleanupWidgets);

describe("setup-venue-screen", () => {
  it("collects every field and emits the nested venue patch, then advances to review", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    // The whole patch is pinned by field NAME — a mis-named field (this repo's dominant defect) fails here.
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { venue: EXPECTED_VENUE } } },
      { kind: "goto", detail: { screen: "review" } },
    ]);
  });

  it("emits a blank addressLine2 as null, and a filled one as its string", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await type(el, "addressLine2", "   "); // whitespace-only counts as blank
    q(el, "[data-test=next]")!.click();
    let patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.addressLine2).toBeNull();

    const second = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events2 = collect(second.host);
    await fillValid(second.el);
    await type(second.el, "addressLine2", "Piso 2");
    q(second.el, "[data-test=next]")!.click();
    patch = (events2[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.addressLine2).toBe("Piso 2");
  });

  it("routes a live ES-common venue to the cert step", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "live" },
    });
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    expect(events.at(-1)).toEqual({ kind: "goto", detail: { screen: "cert" } });
  });

  it("routes a demo venue straight to review (no cert step)", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    expect(events.at(-1)).toEqual({ kind: "goto", detail: { screen: "review" } });
  });

  it("seeds the editable fields from the draft so Back-then-forward is non-destructive", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      mode: "demo",
      venue: {
        country: "ES",
        taxId: "B87654321",
        legalName: "Bar Pepe SL",
        location: {
          name: "Plaza Vieja",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES", "ca-ES"],
          operationDescription: "Bar",
          addressLine1: "Plaza Vieja 3",
          addressLine2: "Local B",
          postalCode: "08002",
          city: "Barcelona",
          province: "Barcelona",
          timeZone: "Atlantic/Canary",
          dayCutover: "05:30",
        },
        tillName: "Barra",
        seriesCode: "AA",
        rectificativeSeriesCode: "RA",
      },
    };
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft });
    const val = (field: string) =>
      (q(el, `[data-test=${field}]`) as unknown as { value: string }).value;
    expect(val("taxId")).toBe("B87654321");
    expect(val("legalName")).toBe("Bar Pepe SL");
    expect(val("name")).toBe("Plaza Vieja");
    expect(val("addressLine2")).toBe("Local B");
    expect(val("city")).toBe("Barcelona");
    expect(val("seriesCode")).toBe("AA");
    expect((q(el, "[data-test=timeZone]") as HTMLSelectElement).value).toBe("Atlantic/Canary");
    expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(true);
  });

  it("seeds a null addressLine2 as a blank field", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      venue: { location: { addressLine2: null } },
    };
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft });
    expect((q(el, "[data-test=addressLine2]") as unknown as { value: string }).value).toBe("");
  });

  // The seriesCode-equality guard. Prove-by-deletion: drop the equality check (so it never adds to the
  // invalid set) and this flips red — a same-series-code Next would then emit and advance.
  it("blocks Next when seriesCode equals rectificativeSeriesCode, marking both invalid", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { seriesCode: "FA", rectificativeSeriesCode: "FA" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=error]")!.getAttribute("role")).toBe("alert");
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=rectificativeSeriesCode]")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks Next and marks the blank field invalid when a required field is empty", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { taxId: "   " }); // whitespace-only required field
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=taxId]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=legalName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("blocks Next when no invoice locale is selected", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "es-ES", false); // the only default locale off → zero selected
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
  });

  it("blocks Next when more than two invoice locales are selected", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "ca-ES", true);
    await toggleLocale(el, "gl-ES", true); // es-ES + ca-ES + gl-ES = three
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
  });

  it("carries a second locale and a changed time zone through into the patch", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "en-GB", true);
    await pick(el, "timeZone", "Atlantic/Canary");
    await pick(el, "fiscalTerritory", "ES-common");
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.invoiceLocales).toEqual(["es-ES", "en-GB"]);
    expect(patch.venue?.location?.timeZone).toBe("Atlantic/Canary");
  });

  it("clears the banner once the form is valid and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click(); // empty form → banner
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(events.some((e) => e.kind === "goto")).toBe(true);
  });

  it("steps back to admin without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "admin" } }]);
  });
});
