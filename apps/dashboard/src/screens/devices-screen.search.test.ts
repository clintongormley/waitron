import { afterEach, expect, it, vi } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  device,
  deviceProfile,
  deviceScreen,
  mountDeviceApp,
  savedScreen,
  station as importedStation,
} from "../testing/device-settings-fixture.js";
import * as editor from "./devices-screen.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
it.each(["en-GB", "es-ES"])("declarations equal mounted names and labels in %s", async (locale) => {
  expect(editor).toHaveProperty("deviceSettingFields");
  const union = new Set<string>();
  const variants = [
    { factor: "till", kind: "pass", caps: ["show-expo", "show-station"] },
    { factor: "phone-portrait", kind: "pass_monitor", caps: ["show-expo"] },
    { factor: "kds", kind: "station", caps: [] },
    { factor: "kds", kind: "pass", caps: [] },
    { factor: "kds", kind: "pass_monitor", caps: [] },
    { factor: "kds", kind: null, caps: [] },
    { factor: "till", kind: null, caps: [] },
    { factor: "till", kind: null, caps: [], different: true },
    { factor: null, kind: null, caps: [] },
    { factor: "till", kind: "pass", caps: ["show-expo"], empty: true },
    { factor: "kds", kind: "pass", caps: [], empty: true },
  ] as const;
  for (const variant of variants) {
    const profiles =
      variant.factor === null
        ? []
        : [
            { ...deviceProfile, formFactor: variant.factor, capabilities: [...variant.caps] },
            {
              ...deviceProfile,
              id: "dp2",
              formFactor: "different" in variant ? "kds" : variant.factor,
            },
          ];
    const row = {
      ...device,
      profileRetired: variant.factor === null,
      kitchenScreens: variant.kind
        ? [
            {
              ...savedScreen(variant.kind),
              ...("empty" in variant ? { everyStation: false, stations: [] } : {}),
            },
          ]
        : [],
    };
    const kitchen = variant.kind
      ? [
          {
            profileId: "dp1",
            screens: {
              [variant.kind]: { stationIds: "empty" in variant ? [] : null, zoneIds: null },
            },
          },
        ]
      : [];
    const { app } = await mountDeviceApp({
      locale,
      profiles,
      devices: [row],
      kitchen,
      stations: "empty" in variant ? [] : undefined,
      path: "/devices/device/d1",
    });
    const screen = deviceScreen(app);
    await expect
      .poll(() =>
        screen.shadowRoot!.querySelector("[name=defaultReaderId]")?.hasAttribute("disabled"),
      )
      .toBe(false);
    const modal = screen.shadowRoot!.querySelector("[data-test=edit-device-modal]")!;
    const actual = new Map<string, string>();
    for (const field of modal.querySelectorAll<HTMLElement & { label?: string }>("[name]")) {
      const name = field.getAttribute("name")!;
      const group = field.closest("fieldset, [role=group]");
      const headingId = group?.getAttribute("aria-labelledby");
      const label =
        group?.querySelector("legend")?.textContent?.trim() ??
        (headingId ? modal.querySelector(`[id="${headingId}"]`)?.textContent?.trim() : field.label);
      expect(label, name).toBeTruthy();
      actual.set(name, label!);
    }
    // An empty choice group is still a setting.
    for (const group of modal.querySelectorAll("fieldset")) {
      if (group.querySelector("[name]")) continue;
      expect(group.getAttribute("data-test")).toBe("edit-made-here");
      actual.set("madeHereStationIds", group.querySelector("legend")!.textContent!.trim());
    }
    const data = {
      deviceProfiles: profiles,
      kitchenScreens: kitchen,
      stations: "empty" in variant ? [] : [importedStation],
      zones: [{ id: "z1", name: "Bar", displayOrder: 0, active: true }],
    };
    const declared = editor.deviceSettingFields
      .filter((f) => editor.deviceSettingIsOffered(f.name, row, data))
      .map((f) => [f.name, t(f.labelKey)] as const);
    expect(new Map(declared), JSON.stringify(variant)).toEqual(actual);
    expect(declared).toHaveLength(new Map(declared).size);
    for (const name of actual.keys()) union.add(name);
    cleanupWidgets();
  }
  expect(union).toEqual(new Set(editor.deviceSettingFields.map((f) => f.name)));
});
it("reader refusal still hides its field after the other editor reads settle", async () => {
  let refused = false;
  const { app } = await mountDeviceApp({
    path: "/devices/device/d1",
    respond: (path) => {
      if (!path.endsWith("/d1/reader")) return undefined;
      refused = true;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "authorization.not_permitted" } }), {
          status: 403,
        }),
      );
    },
  });
  await expect.poll(() => deviceScreen(app).shadowRoot!.querySelector("[name=name]")).toBeTruthy();
  await expect.poll(() => refused).toBe(true);
  await expect
    .poll(() => deviceScreen(app).shadowRoot!.querySelector("[name=defaultReaderId]"))
    .toBeNull();
});
