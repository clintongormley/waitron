import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtModal } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { fill, setLocale, t } from "../i18n/t.js";
import "./about-dialog.js";
import type { AboutDialog } from "./about-dialog.js";

const released: LegalAbout = {
  release: { version: "1.2.3", releasedOn: "2026-10-22" },
  build: "b",
};

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(about: LegalAbout | null): Promise<AboutDialog> {
  const { el } = await mountWidget<AboutDialog>("dashboard-about-dialog", { open: true, about });
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  await modal.updateComplete;
  return el;
}

const text = (el: AboutDialog) => el.shadowRoot!.querySelector("wt-modal")!.textContent ?? "";
const frames = (el: AboutDialog) => [...el.shadowRoot!.querySelectorAll("iframe")];

it("shows the version and its date, the licence, and frames the box's declaration", async () => {
  setLocale("en-GB");
  const el = await mount(released);
  expect(text(el)).toContain("Version 1.2.3, released 22 October 2026");
  expect(text(el)).toContain(t("about.licence"));
  expect(frames(el).map((frame) => frame.getAttribute("src"))).toEqual(["/legal/declaration"]);
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  expect(modal.open).toBe(true);
  expect(modal.getAttribute("aria-label")).toBe(t("about.title"));
});

it("dates the version in the interface language", async () => {
  setLocale("es");
  const el = await mount(released);
  const date = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date("2026-10-22T00:00:00Z"),
  );
  expect(text(el)).toContain(fill("about.version", { version: "1.2.3", date }));
});

it("says it is a test build when the box has no release", async () => {
  const el = await mount({ release: null, build: "abc123" });
  expect(text(el)).toContain("Test build abc123");
  expect(text(el)).not.toContain("Version");
  expect(frames(el)).toHaveLength(1);
});

it("adds the English note only when the language is not Spanish", async () => {
  setLocale("en-GB");
  const english = await mount(released);
  expect(text(english)).toContain(
    "Waitron's statement of compliance with Spain's invoicing-software rules, in Spanish as the law requires.",
  );
  cleanupWidgets();
  setLocale("es");
  const spanish = await mount(released);
  expect(text(spanish)).not.toContain(t("about.declaration_note"));
  expect(text(spanish)).toContain(t("about.licence"));
});

it("close dispatches about-close", async () => {
  const el = await mount(released);
  const closed = new Promise<Event>((resolve) =>
    el.addEventListener("about-close", resolve, { once: true }),
  );
  const close = el.shadowRoot!.querySelector<WtButton>('wt-button[slot="footer"]')!;
  expect(close.textContent?.trim()).toBe(t("about.close"));
  close.click();
  const event = await closed;
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});

let pagesShown = 0;

/** Puts a same-origin page in the frame and waits until it has loaded. */
async function showPage(frame: HTMLIFrameElement): Promise<Document> {
  const page = `page-${++pagesShown}`;
  frame.srcdoc = `<body tabindex="0" data-page="${page}"><p>Declaration</p></body>`;
  await vi.waitFor(() => {
    expect(frame.contentDocument?.body?.dataset.page).toBe(page);
    expect(frame.contentDocument!.readyState).toBe("complete");
  });
  return frame.contentDocument!;
}

it.each([1, 2])(
  "Escape pressed inside the framed declaration closes the window (page %i of the frame)",
  async (pages) => {
    const el = await mount(released);
    const frame = frames(el)[0]!;
    let page = await showPage(frame);
    if (pages === 2) {
      const next = await showPage(frame);
      expect(next).not.toBe(page);
      page = next;
    }
    const closes: Event[] = [];
    el.addEventListener("about-close", (event) => closes.push(event));
    page.body.focus();
    expect(el.shadowRoot!.activeElement).toBe(frame);
    expect(page.activeElement).toBe(page.body);

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(closes).toHaveLength(1));
    expect(
      el.shadowRoot!.querySelector<WtModal>("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(false);
  },
);

it("a page from another origin in the frame, which it cannot reach into, raises no error", async () => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", onError);
  try {
    const el = await mount(released);
    const frame = frames(el)[0]!;
    const loaded = new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    frame.src = "data:text/html,<p>Elsewhere</p>";
    await loaded;
    expect(frame.contentDocument).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
    expect(el.shadowRoot!.querySelector<WtModal>("wt-modal")!.open).toBe(true);
  } finally {
    window.removeEventListener("error", onError);
  }
});
