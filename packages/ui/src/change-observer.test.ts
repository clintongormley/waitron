import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import * as ui from "./index.js";

class ObservedTheme extends LitElement {
  override render() {
    return html`<span>${ui.currentThemeChoice()}</span>`;
  }
}
customElements.define("observed-theme", ObservedTheme);
const mounted: ObservedTheme[] = [];
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
  ui.chooseTheme("device");
});

function probe() {
  const host = document.createElement("observed-theme") as ObservedTheme;
  mounted.push(host);
  return host;
}

it("redraws connected hosts and resumes after a disconnected interval", async () => {
  const host = probe();
  new ui.ChangeObserver(host, ui.subscribeThemeChoice);
  document.body.append(host);
  ui.chooseTheme("dark");
  await host.updateComplete;
  expect(host.shadowRoot!.textContent).toBe("dark");
  host.remove();
  ui.chooseTheme("light");
  await host.updateComplete;
  expect(host.shadowRoot!.textContent).toBe("dark");
  document.body.append(host);
  ui.chooseTheme("device");
  await host.updateComplete;
  expect(host.shadowRoot!.textContent).toBe("device");
});

it("calls the supplied handler once per change across reconnects", async () => {
  const host = probe();
  const applied: string[] = [];
  new ui.ChangeObserver(host, ui.subscribeThemeChoice, () => {
    applied.push(ui.currentThemeChoice());
  });
  document.body.append(host);
  await host.updateComplete;
  ui.chooseTheme("dark");
  expect(applied).toEqual(["dark"]);
  expect(host.shadowRoot!.textContent).toBe("device");
  host.remove();
  ui.chooseTheme("light");
  document.body.append(host);
  ui.chooseTheme("device");
  expect(applied).toEqual(["dark", "device"]);
});
