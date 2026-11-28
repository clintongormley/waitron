/** Where the draft bar's height is kept: its order pane, whose sent rows it covers as well as the
 * new ones, else its parent. */
export function barHolder(bar: HTMLElement): HTMLElement {
  return bar.closest<HTMLElement>("[data-draft-pane]") ?? bar.parentElement!;
}

export function barSize(bar: HTMLElement, height: number): void {
  barHolder(bar).style.setProperty("--draft-bar-size", `${Math.ceil(height)}px`);
}

export function dockSize(dock: HTMLElement, height: number): void {
  dock.parentElement!.style.setProperty("--order-dock-size", `${Math.ceil(height)}px`);
}
