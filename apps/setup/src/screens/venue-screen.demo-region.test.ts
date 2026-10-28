import { VALENCIA_DEMO_TEXT } from "@waitron/country-packs/demo/testing";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { ProvisionBody } from "../api/client.js";
import type { DeepPartial } from "../setup-app.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { SetupVenueScreen } from "./venue-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const field = (el: SetupVenueScreen, key: string) =>
  el.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
async function native(el: SetupVenueScreen, key: string) {
  const component = field(el, key);
  await component.updateComplete;
  return component.shadowRoot!.querySelector<HTMLInputElement>("input")!;
}
async function fill(el: SetupVenueScreen, key: string, value: string) {
  await userEvent.fill(await native(el, key), value);
  await el.updateComplete;
}
async function mount(draft: DeepPartial<ProvisionBody> = { mode: "demo" }) {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft,
    defaults: { verifactu: { operationDescription: "Restaurant service" } },
  });
  return el;
}
async function submit(el: SetupVenueScreen) {
  const patches: DeepPartial<ProvisionBody>[] = [];
  el.addEventListener("setup-patch", (event) =>
    patches.push((event as CustomEvent<{ patch: DeepPartial<ProvisionBody> }>).detail.patch),
  );
  for (const [key, value] of [
    ["addressLine1", "1 Main Street"],
    ["city", "Demo city"],
  ])
    await fill(el, key!, value!);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
  await el.updateComplete;
  return patches;
}
for (const locale of ["en-GB", "es-ES"] as const)
  describe(`demo region in ${locale}`, () => {
    it("follows postcode and explicit province changes only while the name is automatic", async () => {
      setLocale(locale);
      const el = await mount();
      expect((await native(el, "name")).value).toBe("Casa Delgado");
      await fill(el, "postalCode", "08001");
      expect((await native(el, "name")).value).toBe("Can Delgado");
      await fill(el, "postalCode", "28013");
      expect((await native(el, "name")).value).toBe("Casa Delgado");
      await chooseOption(field(el, "province"), "07");
      await el.updateComplete;
      expect((await native(el, "name")).value).toBe("Can Delgado");
      await fill(el, "postalCode", "07001");
      const patches = await submit(el);
      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({
        demoLocationNameSource: "automatic",
        venue: {
          location: {
            name: "Can Delgado",
            province: "Balears, Illes",
            postalCode: "07001",
            invoiceLocales: ["es-ES"],
          },
        },
      });
    });
    it.each(["My restaurant", "Casa Delgado"])(
      "keeps a typed %s through region changes",
      async (name) => {
        setLocale(locale);
        const el = await mount();
        await fill(el, "name", "My first name");
        await fill(el, "name", name);
        await fill(el, "postalCode", "08001");
        expect((await native(el, "name")).value).toBe(name);
        expect(await submit(el)).toMatchObject([
          {
            demoLocationNameSource: "custom",
            venue: { location: { name, province: "Barcelona", invoiceLocales: ["ca-ES"] } },
          },
        ]);
      },
    );
    it("leaves the last automatic name intact for incomplete or invalid geography", async () => {
      const el = await mount();
      await fill(el, "postalCode", "08001");
      for (const code of ["2", "00000", ""]) {
        await fill(el, "postalCode", code);
        expect((await native(el, "name")).value).toBe("Can Delgado");
        expect(await submit(el)).toHaveLength(0);
      }
    });
    it("keeps an empty custom name invalid instead of refilling it on a region change", async () => {
      const el = await mount();
      await fill(el, "name", "");
      await fill(el, "postalCode", "08001");
      expect((await native(el, "name")).value).toBe("");
      expect(await submit(el)).toHaveLength(0);
      expect(field(el, "name").invalid).toBe(true);
    });
    it("treats a restored nonempty unmarked draft as custom", async () => {
      const el = await mount({ mode: "demo", venue: { location: { name: "Casa Delgado" } } });
      await fill(el, "postalCode", "08001");
      expect((await native(el, "name")).value).toBe("Casa Delgado");
      expect(await submit(el)).toMatchObject([{ demoLocationNameSource: "custom" }]);
    });
  });

for (const locale of ["en-GB", "es-ES"] as const)
  it(`keeps automatic and custom Valencian names through restored drafts (${locale})`, async () => {
    setLocale(locale);
    const el = await mount();
    await fill(el, "postalCode", "46001");
    expect((await native(el, "name")).value).toBe(VALENCIA_DEMO_TEXT.locationName);
    const automatic = (await submit(el))[0]!;
    expect(automatic).toMatchObject({
      demoLocationNameSource: "automatic",
      venue: {
        location: {
          name: VALENCIA_DEMO_TEXT.locationName,
          province: VALENCIA_DEMO_TEXT.province,
          invoiceLocales: ["es-ES"],
        },
      },
    });
    cleanupWidgets();
    const restored = await mount({ mode: "demo", ...automatic });
    await fill(restored, "postalCode", "08001");
    expect((await native(restored, "name")).value).toBe(VALENCIA_DEMO_TEXT.catalanLocation);
    await fill(restored, "name", VALENCIA_DEMO_TEXT.locationName);
    await fill(restored, "postalCode", "28013");
    expect((await native(restored, "name")).value).toBe(VALENCIA_DEMO_TEXT.locationName);
    const custom = (await submit(restored))[0]!;
    expect(custom.demoLocationNameSource).toBe("custom");
    cleanupWidgets();
    const customRestored = await mount({ mode: "demo", ...custom });
    await fill(customRestored, "postalCode", "46001");
    expect((await native(customRestored, "name")).value).toBe(VALENCIA_DEMO_TEXT.locationName);
    expect((await submit(customRestored))[0]!.demoLocationNameSource).toBe("custom");
  });
