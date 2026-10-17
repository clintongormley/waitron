import { navigationGuardFor } from "@waitron/ui";

/** A copy of the dashboard shell's capturing link handler (`#onAppLink` in
 *  `apps/dashboard/src/dashboard-app.ts`): an in-app link without `data-own-click` is cancelled,
 *  stopped before it reaches the screen, and written through the window's navigation guard. */
export function captureShellLinks(host: HTMLElement): () => void {
  const capture = (event: MouseEvent) => {
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
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.hasAttribute("data-own-click") ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("href")?.startsWith("#") ||
      (anchor.target !== "" && anchor.target !== "_self")
    )
      return;
    const url = new URL(anchor.href);
    if (
      url.origin !== location.origin ||
      (url.pathname !== "/manage" && !url.pathname.startsWith("/manage/"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    void navigationGuardFor(window)?.write(url);
  };
  host.addEventListener("click", capture, true);
  return () => host.removeEventListener("click", capture, true);
}
