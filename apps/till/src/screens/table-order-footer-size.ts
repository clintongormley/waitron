export function barSize(bar: HTMLElement, height: number): void {
  bar.parentElement!.style.setProperty("--draft-bar-size", `${Math.ceil(height)}px`);
}

export function dockSize(dock: HTMLElement, height: number): void {
  dock.parentElement!.style.setProperty("--order-dock-size", `${Math.ceil(height)}px`);
}
