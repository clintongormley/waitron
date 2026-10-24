import type { WtVenueLogo } from "../src/components/wt-venue-logo.js";

/** A filled PNG of the given size, as a data URL. */
export function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1e5b3a";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/**
 * Resolves with the next logo box to send `wt-logo-load`, once it has drawn the image at its own
 * shape. Call it before whatever makes the image load: the event is heard on `document`.
 */
export function nextLogoLoad(): Promise<{ logo: WtVenueLogo; img: HTMLImageElement }> {
  return new Promise((resolve) => {
    document.addEventListener(
      "wt-logo-load",
      (event) => {
        const logo = event.composedPath()[0] as WtVenueLogo;
        void logo.updateComplete
          .then(() => new Promise((frame) => requestAnimationFrame(frame)))
          .then(() =>
            resolve({ logo, img: logo.shadowRoot!.querySelector<HTMLImageElement>("img")! }),
          );
      },
      { once: true },
    );
  });
}
