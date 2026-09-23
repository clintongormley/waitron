import { afterEach, expect, test } from "vitest";
import { applyTokens } from "./tokens/index.js";

// Every primitive under src/components/*.ts is picked up automatically via import.meta.glob, the
// same rationale (and the same silent-registry-drift risk a hand-maintained list would carry) as
// no-hardcoded-chrome.test.ts.
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
  // "./components/wt-button.ts" -> "wt-button". Every primitive's file name is its own custom
  // element tag (confirmed across all six today), so no separate tag-name registry is needed.
  const tag = path.replace(/^\.\/components\//, "").replace(/\.ts$/, "");
  for (const value of Object.values(mod)) {
    if (isStyledCtor(value)) allComponents.push({ tag, ctor: value });
  }
}

// "Interactive" = reflects a `disabled` property. That's the same line docs/developers/design-
// system.md's own "Primitives" table and "--wt-tap-min"/"Focus delegation" sections already draw
// between wt-button/wt-input/wt-switch (which document `disabled` and both rules) and
// wt-card/wt-icon/wt-dialog (which don't). Reading it off Lit's own `elementProperties` — a
// static map populated at class-definition time, no instance required — keeps this filter in
// sync with the components automatically, the same way the glob above keeps the file list itself
// in sync; nothing to remember to update when a new primitive is added.
const interactiveComponents = allComponents.filter(
  ({ ctor }) => ctor.elementProperties?.get("disabled")?.reflect === true,
);

test("discovers at least one interactive primitive", () => {
  // Guards against the glob, or the disabled-reflection filter above, silently breaking and this
  // file going green by generating zero tests below — the same concern
  // no-hardcoded-chrome.test.ts documents about a registry that quietly stops covering anything.
  expect(interactiveComponents.length).toBeGreaterThan(0);
});

test("the interactive set is exactly wt-button and wt-input", () => {
  expect(interactiveComponents.map(({ tag }) => tag).sort()).toEqual(["wt-button", "wt-input"]);
});

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

/**
 * Mounts a bare `<tag></tag>` inside a themed host deliberately narrower than --wt-tap-min
 * (44px). A hit-target element that gets its width from `width: 100%` on an ancestor rather than
 * its own `min-width` token shrinks to fit this container, which is exactly the axis the tap-min
 * rule cares about. An element that enforces `min-width` itself is unaffected — min-width is a
 * floor, not a request, so it overflows a narrower container instead of shrinking to fit it. The
 * ordinary unconstrained-width mount() in test-helpers.ts would let a missing min-width go
 * unnoticed here, since a real page is almost always wider than 44px regardless of the token.
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

    // The focused control IS the hit target: it's the element that actually receives pointer and
    // keyboard interaction, which is precisely what --wt-tap-min governs (see "Focus delegation"
    // and "--wt-tap-min" in docs/developers/design-system.md).
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
