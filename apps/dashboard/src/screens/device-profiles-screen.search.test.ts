import { afterEach, expect, it, vi } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  deviceProfile,
  mountProfileApp,
  profileScreen,
} from "../testing/device-settings-fixture.js";
import * as editor from "./device-profiles-screen.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
it.each(["en-GB", "es-ES"])(
  "declarations equal mounted controls, labels and tabs in %s",
  async (locale) => {
    expect(editor).toHaveProperty("profileSettingFields");
    const union = new Set<string>();
    for (const [formFactor, equipment] of [
      ["till", "full"],
      ["phone-portrait", "empty"],
      ["tablet-landscape", "a4"],
      ["kds", "full"],
    ] as const) {
      const profile = {
        ...deviceProfile,
        formFactor,
        departmentId: "bar",
        allowedZoneIds: ["z1"],
        capabilities: ["show-station", "show-expo"],
      };
      for (const kind of ["station", "pass", "pass_monitor"] as const) {
        const screens = { [kind]: { stationIds: [], zoneIds: kind === "station" ? null : [] } };
        const { app } = await mountProfileApp({
          locale,
          profiles: [profile],
          kitchen: [{ profileId: "dp1", screens }],
          path: "/device-profiles/profile/dp1",
          respond(path) {
            const answer =
              path === "/management-api/printers" && equipment === "full"
                ? [{ id: "pr1", name: "Counter", active: true, hasCashDrawer: true }]
                : path === "/management-api/page-printers" && equipment === "a4"
                  ? [{ id: "a4", name: "Office", active: true }]
                  : path === "/management-api/payments/readers" && equipment === "full"
                    ? [{ id: "r1", name: "Counter", active: true }]
                    : undefined;
            return answer ? Promise.resolve(new Response(JSON.stringify(answer))) : undefined;
          },
        });
        const screen = profileScreen(app);
        await expect.poll(() => screen.shadowRoot!.querySelector("[name=name]")).toBeTruthy();
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[data-test=printers-loading]"))
          .toBeNull();
        if (formFactor !== "kds" && equipment !== "empty")
          await expect
            .poll(() => screen.shadowRoot!.querySelector("[name=invoicePrinterDefaultId]"))
            .toBeTruthy();
        if (formFactor !== "kds" && equipment === "full")
          await expect
            .poll(() => screen.shadowRoot!.querySelector("[name=defaultReaderId]"))
            .toBeTruthy();
        const actual = new Set<string>();
        const form = screen.shadowRoot!.querySelector("[data-test=editor-form]")!;
        for (const field of form.querySelectorAll<HTMLElement & { label?: string }>("[name]")) {
          const tab = field.closest("section[slot]")?.getAttribute("slot");
          const name = field.getAttribute("name")!;
          const group = field.closest("[role=group]");
          const heading = group?.getAttribute("aria-labelledby");
          const label =
            heading &&
            name !== "capabilities" &&
            name !== "showNonPassStations" &&
            !(name === "kitchenScreens" && formFactor !== "kds")
              ? form.querySelector(`[id="${heading}"]`)?.textContent?.trim()
              : field.label;
          actual.add(JSON.stringify([name, label, tab]));
          if (field.getAttribute("data-test")?.includes("-every-"))
            actual.add(JSON.stringify([name, field.label, tab]));
        }
        for (const group of form.querySelectorAll("[role=group]")) {
          if (group.querySelector("[name]")) continue;
          const next = group.nextElementSibling;
          const name = next?.getAttribute("name")?.replace("DefaultId", "Ids");
          const heading = group.getAttribute("aria-labelledby");
          if (name && heading)
            actual.add(
              JSON.stringify([
                name,
                form.querySelector(`[id="${heading}"]`)!.textContent!.trim(),
                "equipment",
              ]),
            );
        }
        const declared = editor.profileSettingFields
          .filter((f) => f.offered(profile, screens, equipment !== "empty", equipment === "full"))
          .map((f) => JSON.stringify([f.name, t(f.labelKey), f.tab]));
        expect(new Set(declared), formFactor).toEqual(actual);
        expect(declared).toHaveLength(new Set(declared).size);
        declared.forEach((value) => union.add(value));
        cleanupWidgets();
      }
    }
    expect(union).toEqual(
      new Set(
        editor.profileSettingFields.map((f) => JSON.stringify([f.name, t(f.labelKey), f.tab])),
      ),
    );
  },
);
