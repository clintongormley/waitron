import { navigationGuardFor } from "./navigation-guard.js";

/** A held modifier key or another button keeps the browser's own handling of a link, such as
 * opening a new tab. */
export function leftToBrowser(event: MouseEvent): boolean {
  return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

/** Opens a click on a same-origin link accepted by `isAppPath` inside `host` with `open` instead of
 * the browser, and returns the function that stops it. Listening in the capture phase, this runs
 * before an anchor's own click handler, so an anchor that handles a plain click itself says so
 * with `data-own-click`. A disabled anchor's navigation is cancelled here; its own click handler
 * still runs. */
export function captureAppLinks(
  host: HTMLElement,
  isAppPath: (path: string) => boolean,
  open: (url: URL) => void = (url) => void navigationGuardFor(window)?.write(url),
): () => void {
  const capture = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement && node.hasAttribute("href"),
      );
    if (!anchor) return;
    if (anchor.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    if (
      leftToBrowser(event) ||
      anchor.hasAttribute("data-own-click") ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("href")?.startsWith("#") ||
      (anchor.target !== "" && anchor.target !== "_self")
    )
      return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || !isAppPath(url.pathname)) return;
    event.preventDefault();
    event.stopPropagation();
    open(url);
  };
  host.addEventListener("click", capture, true);
  return () => host.removeEventListener("click", capture, true);
}
