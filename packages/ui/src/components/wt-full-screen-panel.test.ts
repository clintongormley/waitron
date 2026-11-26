import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

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
