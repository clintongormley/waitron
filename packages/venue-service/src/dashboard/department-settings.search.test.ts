import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import * as settings from "./department-settings.js";
import { t } from "./strings.js";
import {
  cleanupDepartmentEditors,
  mountDepartmentEditor,
  selectDepartmentTab,
  supplyReceiptEditor,
} from "../testing/department-edit-fixture.js";

afterEach(() => {
  cleanupDepartmentEditors();
  setLocale("en");
});

it.each(["en", "es"] as const)(
  "keeps searchable department settings aligned with the actual controls (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, form } = await mountDepartmentEditor();
    el.model = structuredClone(el.model);
    el.model.departments[2]!.active = true;
    el.model.serviceSteps = [
      { id: "s1", departmentId: "d1", name: "Start", start: "seated", courseId: null, minutes: 0 },
      { id: "s2", departmentId: "d1", name: "Later", start: "seated", courseId: null, minutes: 5 },
    ];
    await el.updateComplete;
    await form.updateComplete;
    await supplyReceiptEditor(el, form, "Dining service");
    await expect
      .poll(() => form.shadowRoot!.querySelector("[name=operationDescription]"))
      .toBeTruthy();
    const actual = new Set<string>();
    const collect = async (root: Element | ShadowRoot, tab: string): Promise<void> => {
      for (const element of root.children) {
        await (element as Element & { updateComplete?: Promise<unknown> }).updateComplete;
        const name = element.getAttribute("name");
        if (name?.startsWith("transferDestination-")) {
          const label = element.closest("fieldset")!.querySelector("legend")!.textContent!.trim();
          actual.add(JSON.stringify(["destinationDepartmentIds", label, tab]));
        } else if (
          name &&
          element.localName.startsWith("wt-") &&
          ("value" in element || "checked" in element)
        ) {
          if (["serviceStepName", "serviceStepStart", "serviceStepMinutes"].includes(name)) {
            const steps = element.getRootNode() as ShadowRoot;
            const label = steps
              .querySelector("[data-test=service-steps-heading]")!
              .textContent!.trim();
            actual.add(JSON.stringify(["serviceSteps", label, tab]));
          } else {
            actual.add(JSON.stringify([name, "label" in element ? element.label : null, tab]));
          }
          continue;
        } else if (name && element.matches("input, select, textarea")) {
          actual.add(JSON.stringify([name, element.textContent!.trim(), tab]));
        }
        if (element.shadowRoot) await collect(element.shadowRoot, tab);
        await collect(element, tab);
      }
    };
    for (const tab of ["details", "service", "transfers"] as const) {
      await selectDepartmentTab(form, tab);
      await collect(form.shadowRoot!.querySelector(`[slot=${tab}]`)!, tab);
    }
    const declarations = Reflect.get(settings, "departmentSettingFields") as
      readonly { name: string; labelKey: Parameters<typeof t>[0]; tab: string }[] | undefined;
    expect(declarations, "the department publishes its searchable controls").toBeDefined();
    expect(
      new Set(
        declarations!.map(({ name, labelKey, tab }) => JSON.stringify([name, t(labelKey), tab])),
      ),
    ).toEqual(actual);
  },
);
