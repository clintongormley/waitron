/** A handheld's bar draws no Order tab, so with no held table on its bar the order screen is
 * reached through its address. */
export function openOrderAddress(): void {
  history.pushState(null, "", "/tabs/order");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
