import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type DeepPartial, type Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi } from "./api/client.js";
import type { SetupVenueScreen } from "./screens/venue-screen.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const initialVenue = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Deli del Sol SL",
  taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
  seriesCode: "FA",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "RF",
  location: {
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
  },
};
type State = { screen: Screen; draft: DeepPartial<ProvisionBody> };
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const field = (venue: SetupVenueScreen, key: string) =>
  venue.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
async function edit(venue: SetupVenueScreen, key: string, value: string) {
  field(venue, key).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await venue.updateComplete;
}
async function mount(
  draft: DeepPartial<ProvisionBody> = { mode: "prepare", venue: structuredClone(initialVenue) },
) {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    provision: vi.fn(),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect((el as unknown as State).screen).toBe("mode"));
  Object.assign(el, {
    draft,
    screen: "venue",
  });
  await el.updateComplete;
  const venue = el.shadowRoot!.querySelector<SetupVenueScreen>("setup-venue-screen")!;
  await venue.updateComplete;
  return { el, venue, host, api };
}
async function choose(el: SetupApp, decision: "keep" | "discard") {
  warning(el).dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
function back(venue: SetupVenueScreen) {
  venue.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
function next(venue: SetupVenueScreen) {
  venue.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("setup venue unsaved changes", () => {
  it("a seeded demo stays clean until a shown field changes", async () => {
    const { el, venue } = await mount({ mode: "demo", venue: structuredClone(initialVenue) });
    expect(unload()).toBe(false);
    await edit(venue, "name", "Authored demo name");
    expect(unload()).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(venue, "name").value).toBe("Authored demo name");
    await edit(venue, "name", initialVenue.location.name);
    expect(unload()).toBe(false);
  });
  it.each([
    ["country", ""],
    ["province", "08"],
  ])("Back protects the %s selection", async (key, value) => {
    const { el, venue } = await mount();
    await edit(venue, key, value);
    expect(unload()).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(venue, key).value).toBe(value);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft.venue).toEqual(initialVenue);
  });

  it("Back protects an invalid empty receipt-language selection and clears after revert", async () => {
    const { el, venue } = await mount();
    const radio = venue.shadowRoot!.querySelector<HTMLInputElement>('[data-test="locale-es-ES"]')!;
    radio.checked = false;
    radio.dispatchEvent(new Event("change"));
    await venue.updateComplete;
    expect(unload()).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(radio.checked).toBe(false);
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await venue.updateComplete;
    expect(unload()).toBe(false);
  });

  it("loaded description defaults keep an untouched child clean", async () => {
    const draft = { mode: "prepare" as const, venue: structuredClone(initialVenue) };
    delete (draft.venue.location as Partial<typeof initialVenue.location>).operationDescription;
    const { el, venue } = await mount(draft);
    expect(unload()).toBe(false);
    Object.assign(el, { venueDefaults: { verifactu: { operationDescription: "Loaded default" } } });
    await el.updateComplete;
    await venue.updateComplete;
    expect(field(venue, "operationDescription").value).toBe("Loaded default");
    expect(leaveCoordinatorFor(venue)!.isDirty([venue])).toBe(false);
    expect(unload()).toBe(false);
    back(venue);
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect(warning(el).open).toBe(false);
  });

  it("loaded defaults leave another authored field protected", async () => {
    const draft = { mode: "prepare" as const, venue: structuredClone(initialVenue) };
    delete (draft.venue.location as Partial<typeof initialVenue.location>).operationDescription;
    const { el, venue } = await mount(draft);
    await edit(venue, "city", "Authored city");
    Object.assign(el, { venueDefaults: { verifactu: { operationDescription: "Loaded default" } } });
    await el.updateComplete;
    await venue.updateComplete;
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect(field(venue, "city").value).toBe("Madrid");
    expect(field(venue, "operationDescription").value).toBe("Loaded default");
  });
  it.each([
    ["taxId", "A58818501"],
    ["legalName", "New legal name"],
    ["taxpayerDomicile", "New fiscal address"],
    ["name", "New venue"],
    ["operationDescription", "New activity"],
    ["addressLine1", "New street"],
    ["addressLine2", "Upstairs"],
    ["postalCode", "08001"],
    ["city", "Barcelona"],
    ["dayCutover", "07:00"],
    ["seriesCode", "FB"],
    ["fullSeriesCode", "FC"],
    ["rectificativeSeriesCode", "RD"],
  ])("Back protects the authored %s until Discard", async (key, value) => {
    const { el, venue, api } = await mount();
    await edit(venue, key, value);
    expect(unload()).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    expect((el as unknown as State).screen).toBe("venue");
    expect(field(venue, key).value).toBe(value);
    await choose(el, "keep");
    expect(field(venue, key).value).toBe(value);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft.venue).toEqual(initialVenue);
    expect(api.provision).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
  });

  it("clean and reverted values leave without asking", async () => {
    const { el, venue } = await mount();
    expect(unload()).toBe(false);
    await edit(venue, "name", "Edited venue");
    expect(unload()).toBe(true);
    await edit(venue, "name", initialVenue.location.name);
    expect(unload()).toBe(false);
    back(venue);
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect(warning(el).open).toBe(false);
  });

  it("compares normalized tax IDs and empty optional addresses", async () => {
    const { el, venue } = await mount();
    await edit(venue, "taxId", "b 1234567 4");
    await edit(venue, "addressLine2", "   ");
    expect(unload()).toBe(false);
    back(venue);
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect(warning(el).open).toBe(false);
  });

  it("invalid Next retains the invalid value and Back still asks", async () => {
    const { el, venue } = await mount();
    await edit(venue, "postalCode", "wrong");
    next(venue);
    await venue.updateComplete;
    expect((el as unknown as State).screen).toBe("venue");
    expect(field(venue, "postalCode").invalid).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(venue, "postalCode").value).toBe("wrong");
  });

  it("Next commits the exact child before advancing but keeps the accepted root dirty", async () => {
    const { el, venue, api } = await mount();
    await edit(venue, "name", "  New venue  ");
    await edit(venue, "taxId", "b 1234567 4");
    await edit(venue, "addressLine2", "   ");
    expect(unload()).toBe(true);
    const coordinator = leaveCoordinatorFor(venue)!;
    let dirtyAtAdvance: boolean | undefined;
    venue.addEventListener("setup-advance", () => {
      dirtyAtAdvance = coordinator.isDirty([venue]);
    });
    next(venue);
    await expect.poll(() => (el as unknown as State).screen).toBe("review");
    expect(coordinator.isDirty([venue])).toBe(false);
    expect(dirtyAtAdvance).toBe(false);
    expect(warning(el).open).toBe(false);
    expect((el as unknown as State).draft.venue).toEqual({
      ...initialVenue,
      location: { ...initialVenue.location, name: "  New venue  " },
    });
    expect(unload()).toBe(true);
    expect(api.provision).not.toHaveBeenCalled();
  });

  it("Next invalidates an unanswered Back without undoing the accepted values", async () => {
    const { el, venue } = await mount();
    await edit(venue, "city", "New city");
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    next(venue);
    await expect.poll(() => (el as unknown as State).screen).toBe("review");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("review");
    expect((el as unknown as State).draft.venue!.location!.city).toBe("New city");
  });

  it("a field change invalidates an unanswered Back", async () => {
    const { el, venue } = await mount();
    await edit(venue, "city", "First edit");
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(venue, "city", "Newer edit");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("venue");
    expect(field(venue, "city").value).toBe("Newer edit");
  });

  it("background draft updates and reconnect keep the original child baseline", async () => {
    const { el, venue, host } = await mount();
    await edit(venue, "name", "Edited venue");
    (el as unknown as State).draft = {
      mode: "prepare",
      venue: { ...initialVenue, location: { ...initialVenue.location, name: "Background venue" } },
    };
    await el.updateComplete;
    expect(field(venue, "name").value).toBe("Edited venue");
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    await venue.updateComplete;
    expect(leaveCoordinatorFor(venue)!.isDirty([venue])).toBe(true);
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(venue, "name").value).toBe("Edited venue");
  });

  it("same-step navigation retains edits without asking", async () => {
    const { el, venue } = await mount();
    await edit(venue, "city", "Edited city");
    venue.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "venue" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(warning(el).open).toBe(false);
    expect(field(venue, "city").value).toBe("Edited city");
    expect(venue.isConnected).toBe(true);
  });

  it("replacing the venue form invalidates its unanswered Back", async () => {
    const { el, venue } = await mount();
    await edit(venue, "city", "Edited city");
    back(venue);
    await expect.poll(() => warning(el).open).toBe(true);
    Object.assign(el, { screen: "admin" });
    await el.updateComplete;
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    await el.updateComplete;
    expect((el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft.venue).toEqual(initialVenue);
    expect(unload()).toBe(false);
  });

  it("native Escape keeps the form and restores focus to Back", async () => {
    const { el, venue } = await mount();
    const input = field(venue, "name").shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "Native venue edit");
    await userEvent.click(page.getByRole("button", { name: "Back", exact: true }));
    await expect.poll(() => warning(el).open).toBe(true);
    const closed = new Promise((resolve) =>
      warning(el)
        .shadowRoot!.querySelector("wt-modal")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await expect.poll(() => warning(el).open).toBe(false);
    expect((el as unknown as State).screen).toBe("venue");
    expect(input.value).toBe("Native venue edit");
    const button = venue
      .shadowRoot!.querySelector("[data-test=back]")!
      .shadowRoot!.querySelector("button")!;
    await expect
      .poll(() => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active;
      })
      .toBe(button);
  });
});
