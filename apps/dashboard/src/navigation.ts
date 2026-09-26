import type { UrlPathConfig } from "@waitron/ui";

export const dashboardPath: UrlPathConfig = {
  basePath: "/manage",
  primary: "dashboard",
  children: {
    "*": { view: "view" },
    catalogue: { view: "view", product: "product" },
    menus: { menu: "menu", view: "view" },
    printers: { view: "view", printer: "printer" },
    floor: { "floor-view": "view", "floor-zone": "zone" },
    "canvas-editor": { canvas: "canvas", "canvas-tab": "tab" },
  },
};
