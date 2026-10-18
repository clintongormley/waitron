import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

const TEXT = "The unit you sell it in.";
const HREF = "/guide/products#selling-unit";
const LABEL = "Read more in the guide";

async function mountBadge(mode: "always" | "help-mode", guide: string): Promise<WtHelpTooltip> {
  const container = await mount(
    '<div style="position: relative; padding: var(--wt-space-5)">' +
      `<wt-help-tooltip mode="${mode}" aria-label="Help: Selling unit" ${guide}>${TEXT}</wt-help-tooltip>` +
      "</div>",
  );
  const badge = container.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  if (mode === "help-mode") setHelpMode(true);
  await badge.updateComplete;
  return badge;
}

const WITH_GUIDE = `guide-href="${HREF}" guide-label="${LABEL}"`;

function parts(badge: WtHelpTooltip) {
  const root = badge.shadowRoot!;
  return {
    button: root.querySelector("button")!,
    popup: root.querySelector<HTMLElement>("[popover]")!,
    link: root.querySelector<HTMLAnchorElement>("a[part=guide]"),
  };
}

async function open(badge: WtHelpTooltip) {
  const found = parts(badge);
  await userEvent.click(found.button);
  await vi.waitFor(() => expect(found.popup.matches(":popover-open")).toBe(true));
  await badge.updateComplete;
  return found;
}

describe.each(["always", "help-mode"] as const)("a %s badge", (mode) => {
  test("draws no link unless both guide-href and guide-label are set", async () => {
    for (const guide of ["", `guide-href="${HREF}"`, `guide-label="${LABEL}"`]) {
      const badge = await mountBadge(mode, guide);
      expect(parts(badge).link).toBeNull();
      expect(badge.shadowRoot!.querySelector("a")).toBeNull();
      cleanup();
    }
  });

  test("the open box shows the text, then a link that opens the guide in a new tab", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const { popup, link } = await open(badge);
    expect(link).not.toBeNull();
    expect(popup.contains(link)).toBe(true);
    expect(link!.getAttribute("href")).toBe(HREF);
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")?.split(/\s+/)).toContain("noopener");
    expect(link!.textContent?.trim()).toBe(LABEL);
    const text = popup.querySelector("[role=tooltip]")!;
    expect(text.compareDocumentPosition(link!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link!.checkVisibility()).toBe(true);
  });

  test("the badge's description is the text alone, not the link", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const { button, popup } = await open(badge);
    await expect.element(button).toHaveAccessibleDescription(TEXT);
    const described = badge.shadowRoot!.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(described).not.toBe(popup);
    expect(described.getAttribute("role")).toBe("tooltip");
    expect(described.querySelector("a")).toBeNull();
    expect(popup.hasAttribute("role")).toBe(false);
  });

  test("Tab from the badge reaches the link, and the box stays open", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const { popup, link } = await open(badge);
    expect(link).not.toBeNull();
    await userEvent.keyboard("{Tab}");
    expect(badge.shadowRoot!.activeElement).toBe(link);
    await badge.updateComplete;
    expect(popup.matches(":popover-open")).toBe(true);
  });

  test("Tab past the link closes the box", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const next = document.createElement("button");
    next.textContent = "Next";
    host.append(next);
    const { popup, link } = await open(badge);
    expect(link).not.toBeNull();
    await userEvent.keyboard("{Tab}");
    expect(badge.shadowRoot!.activeElement).toBe(link);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(next);
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  });

  test("Escape on the link closes the box and puts focus back on the badge", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const { button, popup, link } = await open(badge);
    expect(link).not.toBeNull();
    await userEvent.keyboard("{Tab}");
    expect(badge.shadowRoot!.activeElement).toBe(link);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    expect(badge.shadowRoot!.activeElement).toBe(button);
  });

  test("a click on the link closes the box and is not prevented", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    const { popup, link } = await open(badge);
    const seen: boolean[] = [];
    const record = (event: MouseEvent) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", record);
    try {
      await userEvent.click(link!);
    } finally {
      document.removeEventListener("click", record);
    }
    expect(seen).toEqual([false]);
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  });

  test("paints the link from the tokens", async () => {
    const badge = await mountBadge(mode, WITH_GUIDE);
    badge.style.setProperty("--wt-color-primary-text", "rgb(1, 2, 3)");
    badge.style.setProperty("--wt-tap-min", "50px");
    const { link } = await open(badge);
    const style = getComputedStyle(link!);
    expect(style.color).toBe("rgb(1, 2, 3)");
    expect(style.minHeight).toBe("50px");
    expect(link!.getBoundingClientRect().height).toBeGreaterThanOrEqual(50);
  });

  test("without a link the box is unchanged", async () => {
    const badge = await mountBadge(mode, "");
    const { button, popup } = await open(badge);
    expect(popup.getAttribute("role")).toBe("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(popup.id);
    await expect.element(button).toHaveAccessibleDescription(TEXT);
  });
});

describe.each([
  ["a link is added", "", WITH_GUIDE, true],
  ["the link is cleared", WITH_GUIDE, "", false],
] as const)("while the box is open and %s", (_name, before, _after, linked) => {
  async function openThenSwitch() {
    const badge = await mountBadge("always", before);
    const found = await open(badge);
    badge.guideHref = linked ? HREF : "";
    badge.guideLabel = linked ? LABEL : "";
    await badge.updateComplete;
    return { badge, ...found };
  }

  test("the box stays the same element and stays open", async () => {
    const { badge, popup, button } = await openThenSwitch();
    expect(parts(badge).popup).toBe(popup);
    expect(popup.isConnected).toBe(true);
    expect(popup.matches(":popover-open")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(parts(badge).link === null).toBe(!linked);
    await expect.element(button).toHaveAccessibleDescription(TEXT);
  });

  test("Escape still closes it and puts focus back on the badge", async () => {
    const { badge, popup, button } = await openThenSwitch();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    await badge.updateComplete;
    expect(badge.shadowRoot!.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("a click outside still closes it", async () => {
    const { badge, popup, button } = await openThenSwitch();
    const outside = document.createElement("button");
    outside.textContent = "Elsewhere";
    host.prepend(outside);
    await userEvent.click(outside);
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    await badge.updateComplete;
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
