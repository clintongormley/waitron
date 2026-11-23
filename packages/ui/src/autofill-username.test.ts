import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { afterEach, expect, it } from "vitest";
import { autofillUsername, autofillUsernameStyles } from "./index.js";
import { cleanup, mount } from "./test-helpers.js";

class UsernameHost extends LitElement {
  static override styles = autofillUsernameStyles;
  @property({ attribute: false }) email: string | null = null;
  @property({ attribute: false }) mode: "confirmation" | "login" = "confirmation";
  override render() {
    return html`${autofillUsername(this.email, this.mode)}<input type="password" />`;
  }
}
customElements.define("test-autofill-username", UsernameHost);
afterEach(cleanup);

async function mountHost(email: string | null, mode?: "confirmation" | "login") {
  const el = (await mount("<test-autofill-username></test-autofill-username>")) as UsernameHost;
  el.email = email;
  if (mode) el.mode = mode;
  await el.updateComplete;
  return el.shadowRoot!.querySelector<HTMLInputElement>("input:not([type=password])");
}

it("names the saved login with a hidden, read-only username field out of the tab order", async () => {
  const input = (await mountHost("owner@example.com"))!;
  expect(input.name).toBe("username");
  expect(input.type).toBe("email");
  expect(input.autocomplete).toBe("username");
  expect(input.value).toBe("owner@example.com");
  expect(input.tabIndex).toBe(-1);
  expect(input.getAttribute("aria-hidden")).toBe("true");
  expect(input.readOnly).toBe(true);
  expect(input.hasAttribute("data-autofill-username")).toBe(false);
  const style = getComputedStyle(input);
  expect(style.position).toBe("absolute");
  expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  expect(input.getBoundingClientRect().height).toBeLessThanOrEqual(1);
  expect(style.clipPath).toBe("inset(50%)");
});

it("draws nothing to confirm when there is no email", async () => {
  expect(await mountHost(null)).toBeNull();
  expect(await mountHost("")).toBeNull();
});

it("on a login, is named email and marked, even before an email is known", async () => {
  const input = (await mountHost(null, "login"))!;
  expect(input.name).toBe("email");
  expect(input.hasAttribute("data-autofill-username")).toBe(true);
  expect(input.value).toBe("");
});
