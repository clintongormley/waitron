import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import "./about-sheet.js";
import type { SetupAboutSheet } from "./about-sheet.js";

type Lit = HTMLElement & LitElement;

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const modalOf = (sheet: SetupAboutSheet) => sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
const closeButton = (sheet: SetupAboutSheet) =>
  sheet.shadowRoot!.querySelector<Lit>('wt-button[slot="footer"]')!;

async function mountOpen(): Promise<SetupAboutSheet> {
  const { el } = await mountWidget<SetupAboutSheet>("setup-about-sheet", { open: true });
  await modalOf(el).updateComplete;
  return el;
}

it("draws nothing to see while closed", async () => {
  const { el } = await mountWidget<SetupAboutSheet>("setup-about-sheet", {});
  expect(modalOf(el).open).toBe(false);
  expect(el.shadowRoot!.querySelector("iframe")).toBeNull();
});

it("frames /legal/declaration under the heading About Waitron while open", async () => {
  const el = await mountOpen();
  const modal = modalOf(el);
  expect(modal.open).toBe(true);
  expect(modal.size).toBe("full");
  expect(modal.getAttribute("aria-label")).toBe(t("shell.about.title"));
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("shell.about.title"));
  const frame = el.shadowRoot!.querySelector("iframe")!;
  expect(frame.getAttribute("src")).toBe("/legal/declaration");
  expect(frame.title).toBe(t("shell.about.title"));
  expect(closeButton(el).textContent!.trim()).toBe(t("shell.about.close"));
});

it("follows a language change while open", async () => {
  const el = await mountOpen();
  const english = t("shell.about.title");
  setLocale("es-ES");
  expect(t("shell.about.title")).not.toBe(english);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("shell.about.title"));
});

it.each([
  [
    "Close",
    (sheet: SetupAboutSheet) =>
      userEvent.click(closeButton(sheet).shadowRoot!.querySelector("button")!),
  ],
  ["Escape", () => userEvent.keyboard("{Escape}")],
] as const)("%s asks its owner to close it with about-close", async (_name, close) => {
  const el = await mountOpen();
  const closed = new Promise<Event>((resolve) =>
    el.addEventListener("about-close", resolve, { once: true }),
  );
  await close(el);
  const event = await closed;
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});

const frameOf = (sheet: SetupAboutSheet) => sheet.shadowRoot!.querySelector("iframe")!;
const dialogOpen = (sheet: SetupAboutSheet) =>
  modalOf(sheet).shadowRoot!.querySelector("dialog")!.open;

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
  "Escape pressed inside the framed declaration asks to close (page %i of the frame)",
  async (pages) => {
    const el = await mountOpen();
    const frame = frameOf(el);
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
    expect(dialogOpen(el)).toBe(false);
  },
);

it.each([
  ["the opener had focus at opening", true],
  ["nothing had focus at opening", false],
] as const)(
  "Escape pressed inside the framed declaration hands focus back to the opener once its owner clears open (%s)",
  async (_name, openerFocused) => {
    const { el, host } = await mountWidget<SetupAboutSheet>("setup-about-sheet", {});
    const earlierInTabOrder = document.createElement("button");
    earlierInTabOrder.textContent = "Elsewhere";
    const opener = document.createElement("button");
    opener.textContent = "About";
    host.prepend(earlierInTabOrder, opener);
    el.addEventListener("about-close", () => {
      el.open = false;
      el.opener = null;
    });
    if (openerFocused) opener.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(openerFocused ? opener : document.body);
    el.opener = opener;
    el.open = true;
    await el.updateComplete;
    await modalOf(el).updateComplete;
    expect(dialogOpen(el)).toBe(true);
    const page = await showPage(frameOf(el));
    page.body.focus();
    expect(el.shadowRoot!.activeElement).toBe(frameOf(el));

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(el.open).toBe(false));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("iframe")).toBeNull();
    const focused = () => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    };
    await expect.poll(focused).toBe(opener);
  },
);

it("stops listening to the framed page as soon as it asks to close, before its owner clears open", async () => {
  const el = await mountOpen();
  const page = await showPage(frameOf(el));
  const closed = new Promise<Event>((resolve) =>
    el.addEventListener("about-close", resolve, { once: true }),
  );
  await userEvent.click(closeButton(el).shadowRoot!.querySelector("button")!);
  await closed;
  expect(frameOf(el).contentDocument).toBe(page);
  const requestClose = vi.spyOn(modalOf(el), "requestClose");

  page.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  expect(requestClose).not.toHaveBeenCalled();
});

it("a page from another origin in the frame, which it cannot reach into, raises no error", async () => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", onError);
  try {
    const el = await mountOpen();
    const frame = frameOf(el);
    const loaded = new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    frame.src = "data:text/html,<p>Elsewhere</p>";
    await loaded;
    expect(frame.contentDocument).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
    expect(modalOf(el).open).toBe(true);
  } finally {
    window.removeEventListener("error", onError);
  }
});
