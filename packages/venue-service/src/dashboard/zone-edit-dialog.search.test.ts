import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import * as settings from "./zone-edit-dialog.js";
import { t } from "./strings.js";
import { cleanupZoneEditors, mountZoneEditor, zoneFields } from "../testing/zone-edit-fixture.js";

afterEach(() => {
  cleanupZoneEditors();
  setLocale("en-GB");
});
it.each(["en-GB", "es-ES"])(
  "zone declarations equal mounted named controls/labels in %s",
  async (locale) => {
    setLocale(locale);
    const { el } = await mountZoneEditor();
    await zoneFields(el);
    const actual = new Set<string>();
    const collect = async (root: Element | ShadowRoot): Promise<void> => {
      for (const element of root.children) {
        await (element as Element & { updateComplete?: Promise<unknown> }).updateComplete;
        const name = element.getAttribute("name");
        if (
          name &&
          element.localName.startsWith("wt-") &&
          ("value" in element || "checked" in element)
        ) {
          actual.add(JSON.stringify([name, element.getAttribute("label")]));
          continue;
        }
        if (name && element.matches("input, select, textarea"))
          actual.add(JSON.stringify([name, element.getAttribute("aria-label")]));
        if (element.shadowRoot) await collect(element.shadowRoot);
        await collect(element);
      }
    };
    await collect(el.shadowRoot!);
    const declarations = Reflect.get(settings, "zoneSettingFields") as
      readonly { name: string; labelKey: Parameters<typeof t>[0] }[] | undefined;
    expect(declarations, "zone editor publishes searchable controls").toBeDefined();
    expect(
      new Set(declarations!.map(({ name, labelKey }) => JSON.stringify([name, t(labelKey)]))),
    ).toEqual(actual);
  },
);
