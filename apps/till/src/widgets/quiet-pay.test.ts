import { expect, it } from "vitest";
import { render } from "lit";
import { quietEquipmentButton } from "./quiet-pay.js";

it("draws the equipment button's icon without any other file registering it", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  render(
    quietEquipmentButton(false, false, () => {}),
    host,
  );
  const icon = host.querySelector("wt-icon")!;
  await customElements.whenDefined("wt-icon");
  await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d") ?? "").not.toBe("");
  host.remove();
});
