import * as core from "@waitron/ui-core";
import { WtInput } from "@waitron/ui-core/components/wt-input";
import { applyTokens } from "@waitron/ui-core/tokens";
import { submitOnEnter } from "@waitron/ui-core/submit-on-enter";

if (WtInput !== core.WtInput || customElements.get("wt-input") !== WtInput) {
  throw new Error("Entry points have distinct component implementations");
}
const app = document.querySelector<HTMLElement>("#app")!;
applyTokens(app);
app.style.cssText =
  "background:var(--wt-color-bg);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4);min-height:100vh;box-sizing:border-box";
document.body.style.margin = "0";
core.registerIcons({ account: "M2 2h12v12H2z" });
app.innerHTML = `<wt-card>
<h1 slot="header">Sign in</h1>
<form novalidate>
<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>
<wt-input id="email" label="Email" name="email" autocomplete="email" type="email" required></wt-input>
<wt-input id="password" label="Password" name="password" autocomplete="current-password" type="password" required>
<wt-button id="reveal" slot="end" aria-label="Show password"><wt-icon name="account"></wt-icon></wt-button>
</wt-input>
<wt-form-actions><wt-button id="submit" variant="primary">Sign in</wt-button></wt-form-actions>
</form><p>Submissions: <span id="submissions">0</span></p><wt-spinner label="Loading example" hidden></wt-spinner>
</wt-card>`;
const email = app.querySelector<WtInput>("#email")!;
const password = app.querySelector<WtInput>("#password")!;
const reveal = app.querySelector<core.WtButton>("#reveal")!;
const button = app.querySelector<core.WtButton>("#submit")!;
const summary = app.querySelector("wt-form-error-summary")!;
let count = 0;
reveal.addEventListener("click", () => {
  password.type = password.type === "password" ? "text" : "password";
  reveal.ariaLabel = password.type === "password" ? "Show password" : "Hide password";
});
app.querySelector("form")!.addEventListener("keydown", (event) => submitOnEnter(event, button));
button.addEventListener("click", () => {
  email.error = email.shadowRoot!.querySelector("input")!.validity.valid
    ? ""
    : "Enter a valid email address.";
  password.error = password.value ? "" : "Enter your password.";
  summary.errors = [email.error, password.error].filter(Boolean);
  if (summary.errors.length) (email.error ? email : password).focus();
  else app.querySelector("#submissions")!.textContent = String(++count);
});
await Promise.all(
  [...app.querySelectorAll("*")].map((el) =>
    "updateComplete" in el ? el.updateComplete : undefined,
  ),
);
const sheets = document.adoptedStyleSheets.length;
core.applyTokens(app);
if (sheets !== document.adoptedStyleSheets.length) throw new Error("Duplicate document sheet");
const nestedHost = document.createElement("div");
app.append(nestedHost);
const shadow = nestedHost.attachShadow({ mode: "open" });
const nested = document.createElement("div");
nested.id = "nested-theme";
nested.style.color = "var(--wt-color-text)";
shadow.append(nested);
applyTokens(nested);
applyTokens(nested);
if (shadow.adoptedStyleSheets.length !== 1) throw new Error("Duplicate shadow sheet");
document.body.dataset.ready = "true";
