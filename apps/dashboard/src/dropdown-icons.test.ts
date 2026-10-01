import { afterEach, expect, test } from "vitest";
import { registerIcons, type WtCombobox } from "@waitron/ui";
import { DASHBOARD_ICONS } from "./icons.js";

// As main.ts does.
registerIcons(DASHBOARD_ICONS);

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

test("the dashboard's icon set holds the icons a dropdown draws: its chevron and the chosen row's tick", async () => {
  const el = document.createElement("wt-combobox") as WtCombobox;
  el.label = "Course";
  el.options = [
    { value: "starter", label: "Starter" },
    { value: "main", label: "Main" },
  ];
  el.value = "main";
  document.body.append(el);
  mounted.push(el);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await el.updateComplete;
  for (const selector of [".chevron", ".tick"]) {
    const icon = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      selector,
    )!;
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d"), selector).toBeTruthy();
  }
});
