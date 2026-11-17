import { html } from "lit";
import { afterEach, expect, test } from "vitest";
import { cleanup, elementPixels, host, mount } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = ["Bar", "Terrace", "Dining room", "Kitchen", "Patio", "Cellar"].map(
  (name, i) => ({ id: String(i), name }),
);

// A fixed-height block makes every row the same height whatever fonts the machine has, so the row
// edges land where the test expects them.
const block = (text: string) => html`<span style="display:block;height:23px">${text}</span>`;

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => block(row.name) },
  { key: "actions", label: "Actions", pinned: "end", cell: () => block("⋮") },
];

const surface = "255,255,255";

test("the pinned column's divider stays unbroken across row edges at 150% screen scaling", async () => {
  const el = (await mount(
    '<wt-data-table aria-label="Zones"></wt-data-table>',
  )) as WtDataTable<Row>;
  host.style.setProperty("--wt-color-border", "rgb(0, 0, 0)");
  host.style.setProperty("--wt-color-surface", "rgb(255, 255, 255)");
  host.style.setProperty("--wt-color-surface-raised", "rgb(255, 255, 255)");
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;

  const scale = devicePixelRatio;
  expect(scale).toBe(1.5);
  const cells = [...el.shadowRoot!.querySelectorAll("tbody td[data-pinned=end]")].map((cell) =>
    cell.getBoundingClientRect(),
  );
  expect(cells).toHaveLength(rows.length);
  // Without a row edge between screen pixels the check below could not fail.
  expect(cells.some((cell) => !Number.isInteger(cell.bottom * scale))).toBe(true);

  const at = await elementPixels(el);
  const top = cells[0]!.top;
  const last = cells.at(-1)!;
  const middle = (last.top + last.bottom) / 2;
  const step = 1 / scale;
  // The divider's screen column is one next to the cell's left edge that, in the middle of every
  // row, holds the same colour and not the surface's. The line's colour is read from there rather
  // than assumed: its side edges can fall between screen pixels too, which blends it with the surface.
  const near = Math.round(cells[0]!.left * scale);
  const middles = [-2, -1, 0, 1, 2].map((n) => {
    const x = (near + n + 0.5) * step;
    return { x, colours: cells.map((cell) => at(x, (cell.top + cell.bottom) / 2).join()) };
  });
  const divider = middles.find(
    ({ colours }) => colours[0] !== surface && colours.every((colour) => colour === colours[0]),
  );
  expect(divider).toBeDefined();
  const line = divider!.colours[0]!.split(",").map(Number);
  // Each row's own border crosses the line in the same colour, so a pixel darker than the line is
  // expected; a lighter one is a gap. The check runs from the first row's top to the last row's
  // middle: every edge between two rows lies in that span, and the table's own bottom edge is not
  // one of them.
  const lighter: string[] = [];
  for (let y = Math.ceil(top * scale) + 0.5; y < middle * scale; y++) {
    const pixel = at(divider!.x, y * step);
    if (pixel.some((channel, i) => channel > line[i]!))
      lighter.push(`${(y * step).toFixed(2)}px: ${pixel.join()}`);
  }
  expect(lighter).toEqual([]);
});
