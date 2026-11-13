import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderGuestMenuPage } from "../../../server/src/guest-menu-page.js";
import type { PublicGuestMenu } from "@waitron/shared";
const menu: PublicGuestMenu = {
  name: "Lunch",
  language: "en",
  languages: ["en", "es"],
  members: [
    {
      kind: "section",
      name: "Starters",
      members: [
        {
          kind: "product",
          name: '<img src=x onerror="alert(1)">',
          description: "Soup & bread",
          price: { min: "3.00", max: "6.00" },
          unit: "ea",
          allergens: { gluten: { kinds: ["wheat"] } },
          dietary: ["vegan"],
          variants: [],
          modifiers: [],
        },
      ],
    },
  ],
};
let frame: HTMLIFrameElement | undefined;
afterEach(() => {
  frame?.remove();
});
async function render(language = "en") {
  frame = document.createElement("iframe");
  frame.style.width = "380px";
  frame.style.height = "600px";
  const loaded = new Promise<void>((resolve) =>
    frame!.addEventListener("load", () => resolve(), { once: true }),
  );
  frame.srcdoc = renderGuestMenuPage({ ...menu, language }, "The Restaurant", "en");
  document.body.append(frame);
  await loaded;
  return frame.contentDocument!;
}
it("renders escaped guest content and section links in the chosen language", async () => {
  const doc = await render("es");
  expect(doc.body.textContent).toContain('<img src=x onerror="alert(1)">');
  expect(doc.querySelector("img")).toBeNull();
  expect(doc.body.textContent).toContain("Cereales con gluten (Trigo)");
  const link = doc.querySelector<HTMLAnchorElement>("nav a")!;
  expect(doc.getElementById(link.hash.slice(1))?.textContent).toContain("Starters");
  expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth);
});
it("opens explanations only on activation, with keyboard and Escape dismissal", async () => {
  const doc = await render();
  const button = doc.querySelector<HTMLButtonElement>("button[popovertarget]")!;
  const explanation = doc.getElementById(button.getAttribute("popovertarget")!)!;
  button.focus();
  expect(explanation.matches(":popover-open")).toBe(false);
  await userEvent.keyboard("{Enter}");
  expect(explanation.matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(explanation.matches(":popover-open")).toBe(false);
  button.focus();
  await userEvent.keyboard(" ");
  expect(explanation.matches(":popover-open")).toBe(true);
});

it("lets a manager open the rendered page and change its language", async () => {
  const { DashboardApi } = await import("../api/client.js");
  const { mountWidget, cleanupWidgets } = await import("./test-helpers.js");
  const { GuestMenuPreview } = await import("./guest-menu-preview.js");
  const api = new DashboardApi("", async (input) => {
    const language = new URL(String(input), location.origin).searchParams.get("language") || "en";
    return new Response(
      JSON.stringify({
        html: renderGuestMenuPage({ ...menu, language }, "The Restaurant", "en"),
        language,
        languages: ["en", "es"],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const { el } = await mountWidget<InstanceType<typeof GuestMenuPreview>>(
    "dashboard-guest-menu-preview",
    { api, menuId: "menu" },
  );
  try {
    await page.elementLocator(el.shadowRoot!.querySelector("wt-button")!).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.srcdoc)
      .toContain("The Restaurant");
    const choose = el.shadowRoot!.querySelector("wt-combobox")!;
    choose.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "es" }, bubbles: true, composed: true }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("iframe")?.srcdoc)
      .toContain("Leyenda de alérgenos");
  } finally {
    cleanupWidgets();
  }
});
