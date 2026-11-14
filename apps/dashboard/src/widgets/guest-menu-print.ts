export function printGuestMenu(
  html: string,
  print: (view: Window) => void = (view) => view.print(),
): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0" });
  frame.addEventListener(
    "load",
    async () => {
      const view = frame.contentWindow!;
      view.addEventListener("afterprint", () => frame.remove(), { once: true });
      try {
        await Promise.all([...view.document.images].map((image) => image.decode()));
        await view.document.fonts.ready;
        print(view);
      } catch {
        frame.remove();
      }
    },
    { once: true },
  );
  frame.srcdoc = html;
  document.body.append(frame);
}
