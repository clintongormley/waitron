for (const name of ["popover", "showPopover", "hidePopover", "togglePopover"])
  Reflect.deleteProperty(HTMLElement.prototype, name);

// Chromium keeps its closed-popover UA rule after removing the JavaScript API.
// A low-priority layer restores the display an older engine gives an open div.
const documentStyle = document.createElement("style");
documentStyle.textContent =
  "@layer simulation { [popover]:where(.\\:popover-open) { display: block; } }";
document.head.prepend(documentStyle);
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  const root = attach.call(this, options);
  const simulation = document.createElement("style");
  simulation.textContent =
    "@layer simulation { [popover]:where(.\\:popover-open) { display: block; } }";
  root.prepend(simulation);
  return root;
};
