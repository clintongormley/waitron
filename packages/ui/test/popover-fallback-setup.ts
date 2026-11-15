for (const name of ["popover", "showPopover", "hidePopover", "togglePopover"])
  Reflect.deleteProperty(HTMLElement.prototype, name);

// Removing APIs leaves Chromium's UA hiding and positioning rules in place.
// This low-priority layer restores a plain div; actual component/polyfill styles win.
const simulation = document.createElement("style");
simulation.textContent = `@layer simulation { [popover] {
  display: block; position: static; inset: auto; margin: 0; border: 0; padding: 0;
  width: auto; height: auto; background: transparent; color: inherit; overflow: visible;
} }`;
document.head.prepend(simulation);
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  const root = attach.call(this, options);
  root.prepend(simulation.cloneNode(true));
  return root;
};
