import type { UrlPathConfig } from "@waitron/ui";

export const dashboardPath: UrlPathConfig = {
  basePath: "/manage",
  primary: "dashboard",
  children: {
    "*": { view: "view" },
    catalogue: { product: "product", category: "category" },
    "prep-stations": { test: "test" },
    menus: { menu: "menu", view: "view" },
    modifiers: { view: "view", list: "list" },
    orders: {
      status: "status",
      from: "from",
      to: "to",
      dates: "dates",
      credited: "credited",
      staff: "staff",
      table: "table",
      q: "q",
    },
    printers: { view: "view", printer: "printer" },
    floor: { "floor-view": "view", "floor-zone": "zone" },
    "canvas-editor": { canvas: "canvas", "canvas-tab": "tab" },
  },
};
