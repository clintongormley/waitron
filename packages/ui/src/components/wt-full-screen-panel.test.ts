import { afterEach, expect, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtFullScreenPanel } from "./wt-full-screen-panel.js";
import "../index.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateReducedMotion: (reducedMotion: "reduce" | "no-preference" | null) => Promise<void>;
  }
}

afterEach(async () => {
  cleanup();
  await commands.emulateReducedMotion(null);
});

const SHEET_TOKENS = [
  "--wt-radius-lg: 13px",
  "--wt-menu-sheet-shadow: 0px -3px 7px rgb(1, 2, 3)",
  "--wt-menu-sheet-handle-width: 37px",
  "--wt-menu-sheet-handle-height: 6px",
  "--wt-color-surface-sunken: rgb(4, 5, 6)",
  "--wt-duration-move: 9s",
].join(";");

async function mountPanel(attributes: string): Promise<WtFullScreenPanel> {
  const outer = await mount(`
    <div style="height:300px;width:320px">
      <button data-before>Before</button>
      <wt-full-screen-panel ${attributes} body-label="Menu" style="${SHEET_TOKENS}">
        <button slot="header" style="height:40px">Header</button>
        <p style="height:600px">Dishes</p>
        <button slot="footer" style="height:40px">Footer</button>
      </wt-full-screen-panel>
    </div>`);
  const panel = outer.querySelector("wt-full-screen-panel")!;
  await panel.updateComplete;
  return panel;
}

const handleOf = (panel: WtFullScreenPanel) =>
  panel.shadowRoot!.querySelector<HTMLElement>("[data-handle]");

test("a rising panel has rounded top corners, square bottom ones and an upward shadow", async () => {
  const panel = await mountPanel("rising");
  const look = getComputedStyle(panel);
  expect(look.borderTopLeftRadius).toBe("13px");
  expect(look.borderTopRightRadius).toBe("13px");
  expect(look.borderBottomLeftRadius).toBe("0px");
  expect(look.borderBottomRightRadius).toBe("0px");
  expect(look.boxShadow).toBe("rgb(1, 2, 3) 0px -3px 7px 0px");
});

test("a rising panel draws a centred, unnamed handle above its header that takes no tab stop", async () => {
  const panel = await mountPanel("rising");
  const handle = handleOf(panel);
  expect(handle).toBeInstanceOf(HTMLElement);
  const look = getComputedStyle(handle!);
  expect(look.backgroundColor).toBe("rgb(4, 5, 6)");
  const box = handle!.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  const header = panel.querySelector("[slot=header]")!.getBoundingClientRect();
  expect(box.width).toBe(37);
  expect(box.height).toBe(6);
  expect(box.left + box.width / 2).toBe(panelBox.left + panelBox.width / 2);
  expect(box.top).toBeGreaterThan(panelBox.top);
  expect(box.bottom).toBeLessThan(header.top);
  expect(handle!.getAttribute("aria-hidden")).toBe("true");
  expect(handle!.textContent).toBe("");

  host.querySelector<HTMLElement>("[data-before]")!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(panel.querySelector("[slot=header]"));
});

test("a rising panel still scrolls only its body, with the footer at its foot", async () => {
  const panel = await mountPanel("rising");
  const body = panel.shadowRoot!.querySelector<HTMLElement>("[part=body]")!;
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  expect(body.getBoundingClientRect().top).toBe(
    panel.querySelector("[slot=header]")!.getBoundingClientRect().bottom,
  );
  expect(panel.querySelector("[slot=footer]")!.getBoundingClientRect().bottom).toBe(
    panel.getBoundingClientRect().bottom,
  );
});

test("rising reflects to its attribute and can be switched off again", async () => {
  const panel = await mountPanel("");
  panel.rising = true;
  await panel.updateComplete;
  expect(panel.hasAttribute("rising")).toBe(true);
  expect(handleOf(panel)).toBeInstanceOf(HTMLElement);
  panel.rising = false;
  await panel.updateComplete;
  expect(panel.hasAttribute("rising")).toBe(false);
  expect(handleOf(panel)).toBeNull();
});

test("without rising the panel keeps its plain look: no corners, shadow, handle or rise", async () => {
  await commands.emulateReducedMotion("no-preference");
  const panel = await mountPanel("");
  const look = getComputedStyle(panel);
  expect(look.borderTopLeftRadius).toBe("0px");
  expect(look.borderTopRightRadius).toBe("0px");
  expect(look.boxShadow).toBe("none");
  expect(look.transitionDuration).toBe("0s");
  expect(look.borderTopStyle).toBe("none");
  expect(look.gridTemplateRows.split(" ")).toHaveLength(3);
  expect(handleOf(panel)).toBeNull();
  expect(panel.getAnimations()).toEqual([]);
  expect(panel.querySelector("[slot=header]")!.getBoundingClientRect().top).toBe(
    panel.getBoundingClientRect().top,
  );
});

test("a rising panel rises from below on first draw", async () => {
  await commands.emulateReducedMotion("no-preference");
  const panel = await mountPanel("rising");
  const look = getComputedStyle(panel);
  expect(look.transitionProperty).toBe("translate");
  expect(look.transitionDuration).toBe("9s");
  const rise = panel.getAnimations().map((a) => (a as CSSTransition).transitionProperty);
  expect(rise).toEqual(["translate"]);
});

test("a rising panel does not move when reduced motion is asked for", async () => {
  await commands.emulateReducedMotion("reduce");
  const panel = await mountPanel("rising");
  expect(getComputedStyle(panel).transitionDuration).toBe("0s");
  expect(panel.getAnimations()).toEqual([]);
  expect(getComputedStyle(panel).translate).toBe("none");
});

test("only the named panel body scrolls, between fixed header and footer slots", async () => {
  const panel = await mount(`
    <wt-full-screen-panel body-label="Payment details">
      <div slot="header" style="height:56px">Pay</div>
      <div data-details style="height:500px">Payment details</div>
      <button slot="footer" style="height:52px">Charge</button>
    </wt-full-screen-panel>`);
  host.style.setProperty("--wt-color-bg", "rgb(9, 15, 23)");
  host.style.height = "260px";
  const body = panel.shadowRoot?.querySelector<HTMLElement>("[part=body]");
  expect(body).toBeInstanceOf(HTMLElement);
  const box = panel.getBoundingClientRect();
  const head = panel.querySelector("[slot=header]")!;
  const foot = panel.querySelector("[slot=footer]")!;

  await vi.waitFor(() => expect(body!.tabIndex).toBe(0));
  expect(body!.getAttribute("aria-label")).toBe("Payment details");
  expect(getComputedStyle(panel).backgroundColor).toBe("rgb(9, 15, 23)");
  expect(box.height).toBe(260);
  expect(body!.scrollHeight).toBeGreaterThan(body!.clientHeight);
  expect(getComputedStyle(body!).overscrollBehaviorY).toBe("contain");
  body!.scrollTop = 100;
  expect(body!.scrollTop).toBe(100);
  expect(head.getBoundingClientRect().top).toBe(box.top);
  expect(foot.getBoundingClientRect().bottom).toBe(box.bottom);

  panel.querySelector<HTMLElement>("[data-details]")!.style.height = "20px";
  await vi.waitFor(() => expect(body!.hasAttribute("tabindex")).toBe(false));
});

test("makes the payment details reachable by Tab when a resize brings in scrolling", async () => {
  const panel = await mount(`
    <div style="height: 380px">
      <wt-full-screen-panel body-label="Payment details">
        <button slot="header">Back</button>
        <div style="height: 300px">Payment details</div>
      </wt-full-screen-panel>
    </div>`);
  const body = panel
    .querySelector("wt-full-screen-panel")!
    .shadowRoot!.querySelector<HTMLElement>("[part=body]")!;
  expect(body.scrollHeight).toBe(body.clientHeight);
  expect(body.hasAttribute("tabindex")).toBe(false);

  panel.style.height = "200px";
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  await vi.waitFor(() => expect(body.tabIndex).toBe(0));
  expect(body.getAttribute("aria-label")).toBe("Payment details");
  panel.querySelector("button")!.focus();
  await userEvent.tab();
  expect(body.matches(":focus")).toBe(true);

  panel.style.height = "380px";
  await vi.waitFor(() => expect(body.hasAttribute("tabindex")).toBe(false));
});
