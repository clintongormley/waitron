export function startWithPopover(start: () => void, failed: (error: unknown) => void): void {
  if (Object.hasOwn(HTMLElement.prototype, "popover")) {
    start();
    return;
  }
  void import("@oddbird/popover-polyfill").then(start, (error: unknown) => {
    failed(error);
    start();
  });
}
