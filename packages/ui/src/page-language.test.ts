import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { ChangeObserver } from "./change-observer.js";
import { subscribePageLanguage } from "./page-language.js";

class LanguageProbe extends LitElement {
  private readonly language = new ChangeObserver(this, subscribePageLanguage);
  override render() {
    return html`${document.documentElement.lang}`;
  }
}
customElements.define("language-probe", LanguageProbe);
const language = document.documentElement.lang;
const hosts: LanguageProbe[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  document.documentElement.lang = language;
  vi.restoreAllMocks();
});

it("shares one root-language observer and resumes hosts after reconnecting", async () => {
  const observe = vi.spyOn(MutationObserver.prototype, "observe");
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  for (let index = 0; index < 2; index++) {
    const host = document.createElement("language-probe") as LanguageProbe;
    hosts.push(host);
    document.body.append(host);
  }
  document.documentElement.lang = "es";
  await expect.poll(() => hosts.map((host) => host.shadowRoot?.textContent)).toEqual(["es", "es"]);
  expect(observe).toHaveBeenCalledTimes(1);
  hosts[0]!.remove();
  document.documentElement.lang = "en";
  await expect.poll(() => hosts[1]!.shadowRoot!.textContent).toBe("en");
  expect(hosts[0]!.shadowRoot!.textContent).toBe("es");
  expect(disconnect).not.toHaveBeenCalled();
  hosts[1]!.remove();
  expect(disconnect).toHaveBeenCalledTimes(1);
  document.body.append(hosts[0]!);
  await expect.poll(() => hosts[0]!.shadowRoot!.textContent).toBe("en");
  expect(observe).toHaveBeenCalledTimes(2);
});
