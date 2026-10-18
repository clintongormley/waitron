import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { MediaQueryController } from "./media-query-controller.js";

@customElement("media-query-probe")
class MediaQueryProbe extends LitElement {
  readonly narrow = new MediaQueryController(this, "(max-width: 500px)");
  override render() {
    return html`<span>${this.narrow.matches ? "narrow" : "wide"}</span>`;
  }
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const start = { width: window.innerWidth, height: window.innerHeight };

async function viewport(width: number): Promise<void> {
  await page.viewport(width, 600);
  await frame();
}

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(start.width, start.height);
});

describe("MediaQueryController", () => {
  it("reads the query when connected, and repaints its host when the answer changes", async () => {
    await viewport(400);
    const { el } = await mountWidget<MediaQueryProbe>("media-query-probe", {});
    expect(el.shadowRoot!.textContent).toBe("narrow");

    await viewport(800);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toBe("wide");

    await viewport(400);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toBe("narrow");
  });

  it("stops following the query once its host is disconnected, and reads it again on reconnect", async () => {
    await viewport(800);
    const { el, host } = await mountWidget<MediaQueryProbe>("media-query-probe", {});
    expect(el.narrow.matches).toBe(false);

    el.remove();
    await viewport(400);
    expect(el.narrow.matches).toBe(false);

    host.append(el);
    expect(el.narrow.matches).toBe(true);
  });

  it("repaints its host on reconnect when the answer changed while it was away", async () => {
    await viewport(800);
    const { el, host } = await mountWidget<MediaQueryProbe>("media-query-probe", {});
    expect(el.shadowRoot!.textContent).toBe("wide");

    el.remove();
    await viewport(400);
    host.append(el);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toBe("narrow");
  });
});
