import { render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { equipmentLabelItems } from "./equipment-label-menu.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

it("hands back the pressed item itself as the opener outside a row menu, where no screen renders it", async () => {
  const open = vi.fn();
  const host = document.createElement("div");
  hosts.push(host);
  document.body.append(host);
  render(equipmentLabelItems("p1", open), host);
  const item = host.querySelector<HTMLElement>('[data-test="qr-label-p1"]')!;
  item.click();
  expect(open).toHaveBeenCalledExactlyOnceWith("qr", item);
});
