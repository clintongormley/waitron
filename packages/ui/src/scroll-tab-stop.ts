type ScrollTabStop = "none" | "overflow" | "always";

export function syncScrollTabStop(
  body: HTMLElement,
  mode: ScrollTabStop,
  label?: string | null,
  labelledBy?: string,
): void {
  if (mode === "always" || (mode === "overflow" && body.scrollHeight > body.clientHeight)) {
    body.tabIndex = 0;
    // A scrollable group may contain landmarks of its own.
    body.setAttribute("role", "group");
    if (labelledBy) body.setAttribute("aria-labelledby", labelledBy);
    else body.removeAttribute("aria-labelledby");
    if (label && !labelledBy) body.setAttribute("aria-label", label);
    else body.removeAttribute("aria-label");
  } else {
    for (const name of ["tabindex", "role", "aria-labelledby", "aria-label"])
      body.removeAttribute(name);
  }
}
