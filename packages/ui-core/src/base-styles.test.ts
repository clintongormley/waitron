import { css, html, LitElement } from "lit";
import { expect, test } from "vitest";
import { baseStyles, disabledStyles, visuallyHiddenStyles } from "./base-styles.js";
test("exports a Lit stylesheet", () => {
  expect(baseStyles.cssText).toContain("box-sizing");
});

// Every shared stylesheet this module exports must read colour from `--wt-*` tokens, never a literal
// hex — a hardcoded chrome colour would not follow the user's theme. Parameterised so a new shared
// stylesheet added here is covered by naming it in the table.
test.each([
  ["baseStyles", baseStyles],
  ["disabledStyles", disabledStyles],
  ["visuallyHiddenStyles", visuallyHiddenStyles],
])("%s declares no literal colours", (_name, styles) => {
  expect(styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

class BoldProbe extends LitElement {
  static override styles = [
    baseStyles,
    css`
      h2.own {
        font-weight: var(--wt-font-weight-medium);
      }
    `,
  ];
  override render() {
    return html`<strong>s</strong><b>b</b>
      <h1>1</h1>
      <h2>2</h2>
      <h3>3</h3>
      <h4>4</h4>
      <h5>5</h5>
      <h6>6</h6>
      <h2 class="own">own</h2>
      <table>
        <tr>
          <th>t</th>
        </tr>
      </table>
      <span class="control" style="font-weight: var(--wt-font-weight-bold)">c</span>`;
  }
}
customElements.define("base-styles-bold-probe", BoldProbe);

test("every bold reads the Bold weight, and a component's own weight wins", async () => {
  const root = document.createElement("div");
  root.style.setProperty("--wt-font-weight-bold", "800");
  root.style.setProperty("--wt-font-weight-medium", "500");
  const probe = document.createElement("base-styles-bold-probe") as BoldProbe;
  root.append(probe);
  document.body.append(root);
  try {
    await probe.updateComplete;
    const shadow = probe.shadowRoot!;
    const weight = (selector: string) =>
      getComputedStyle(shadow.querySelector(selector)!).fontWeight;
    expect(weight("span.control"), "the setting is there").toBe("800");
    for (const selector of ["strong", "b", "h1", "h2:not(.own)", "h3", "h4", "h5", "h6", "th"]) {
      expect(weight(selector), selector).toBe("800");
    }
    expect(weight("h2.own"), "a component's own rule wins").toBe("500");
  } finally {
    root.remove();
  }
});

class OrderProbe extends LitElement {
  static override styles = [
    css`
      h3 {
        font-weight: var(--wt-font-weight-medium);
      }
    `,
    baseStyles,
  ];
  override render() {
    return html`<h3>3</h3>`;
  }
}
customElements.define("base-styles-order-probe", OrderProbe);

test("a component's own weight wins even when its styles come before baseStyles", async () => {
  const root = document.createElement("div");
  root.style.setProperty("--wt-font-weight-bold", "800");
  root.style.setProperty("--wt-font-weight-medium", "500");
  const probe = document.createElement("base-styles-order-probe") as OrderProbe;
  root.append(probe);
  document.body.append(root);
  try {
    await probe.updateComplete;
    expect(getComputedStyle(probe.shadowRoot!.querySelector("h3")!).fontWeight).toBe("500");
  } finally {
    root.remove();
  }
});

class PlainProbe extends LitElement {
  static override styles = baseStyles;
  override render() {
    return html`<span>plain</span>`;
  }
}
customElements.define("base-styles-plain-probe", PlainProbe);

class BoldHostProbe extends LitElement {
  static override styles = baseStyles;
  override render() {
    return html`<strong><base-styles-plain-probe></base-styles-plain-probe></strong>`;
  }
}
customElements.define("base-styles-bold-host-probe", BoldHostProbe);

/** A page root that draws ordinary text at the Normal weight, as each app's `index.html` does. */
function pageRoot(normal: string, bold: string): HTMLElement {
  const root = document.createElement("div");
  root.style.setProperty("--wt-font-weight-normal", normal);
  root.style.setProperty("--wt-font-weight-bold", bold);
  root.style.fontWeight = "var(--wt-font-weight-normal)";
  document.body.append(root);
  return root;
}

test("ordinary text in a component draws the page root's Normal weight", async () => {
  const root = pageRoot("800", "600");
  const probe = document.createElement("base-styles-plain-probe") as PlainProbe;
  root.append(probe);
  try {
    await probe.updateComplete;
    expect(getComputedStyle(probe.shadowRoot!.querySelector("span")!).fontWeight).toBe("800");
  } finally {
    root.remove();
  }
});

test("a component with no weight of its own, drawn inside bold text, stays bold", async () => {
  const root = pageRoot("400", "800");
  const outer = document.createElement("base-styles-bold-host-probe") as BoldHostProbe;
  root.append(outer);
  try {
    await outer.updateComplete;
    const inner = outer.shadowRoot!.querySelector<PlainProbe>("base-styles-plain-probe")!;
    await inner.updateComplete;
    expect(getComputedStyle(inner.shadowRoot!.querySelector("span")!).fontWeight).toBe("800");
  } finally {
    root.remove();
  }
});
