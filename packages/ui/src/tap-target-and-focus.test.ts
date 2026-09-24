import { afterEach, expect, test } from "vitest";
import { applyTokens } from "./tokens/index.js";

const modules = import.meta.glob(["./components/*.ts", "!./components/*.test.ts"], {
  eager: true,
}) as Record<string, Record<string, unknown>>;

interface StyledCtor {
  styles: unknown;
  elementProperties?: Map<string, { reflect?: boolean }>;
}

function isStyledCtor(value: unknown): value is StyledCtor {
  return typeof value === "function" && "styles" in value;
}

interface DiscoveredComponent {
  tag: string;
  ctor: StyledCtor;
}

const allComponents: DiscoveredComponent[] = [];
for (const [path, mod] of Object.entries(modules)) {
  // A primitive's file name is its custom element tag.
  const tag = path.replace(/^\.\/components\//, "").replace(/\.ts$/, "");
  for (const value of Object.values(mod)) {
    if (isStyledCtor(value)) allComponents.push({ tag, ctor: value });
  }
}

// "Interactive" means reflects a `disabled` property; a primitive that does not is never checked
// here, whatever it renders.
const interactiveComponents = allComponents.filter(
  ({ ctor }) => ctor.elementProperties?.get("disabled")?.reflect === true,
);

test("discovers at least one interactive primitive", () => {
  expect(interactiveComponents.length).toBeGreaterThan(0);
});

test("the interactive set is exactly wt-button, wt-combobox, wt-input, wt-price-input, and wt-switch", () => {
  // A primitive leaving or joining the set otherwise changes only how many tests run below.
  expect(interactiveComponents.map(({ tag }) => tag).sort()).toEqual([
    "wt-button",
    "wt-combobox",
    "wt-input",
    "wt-price-input",
    "wt-switch",
  ]);
});

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

/**
 * A host narrower than --wt-tap-min, so a control relying on an ancestor's width instead of its own
 * `min-width` shrinks below the tap target.
 */
async function mountNarrow(
  tag: string,
): Promise<HTMLElement & { updateComplete: Promise<unknown> }> {
  const wrapper = document.createElement("div");
  wrapper.style.width = "20px";
  document.body.appendChild(wrapper);
  mounted.push(wrapper);
  applyTokens(wrapper);
  wrapper.innerHTML = `<${tag}></${tag}>`;
  const el = wrapper.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

for (const { tag } of interactiveComponents) {
  test(`${tag} delegates focus to an inner control that clears the 44×44 tap target`, async () => {
    const el = await mountNarrow(tag);

    el.focus();
    const active = el.shadowRoot?.activeElement;
    expect(
      active,
      `${tag}.focus() should delegate focus to a control inside its shadow root`,
    ).not.toBeNull();

    // The focused control is the hit target --wt-tap-min governs.
    const rect = active!.getBoundingClientRect();
    expect(
      rect.width,
      `${tag}'s focused control should be at least 44px wide`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      rect.height,
      `${tag}'s focused control should be at least 44px tall`,
    ).toBeGreaterThanOrEqual(44);
  });
}
