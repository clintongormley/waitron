import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./departments-list.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
async function setup(write?: () => Promise<void>) {
  setLocale("en");
  const el = (await mount(
    "<departments-list></departments-list>",
  )) as HTMLElementTagNameMap["departments-list"];
  const writes: unknown[][] = [];
  el.api = new VenueServiceApi((async (path, method = "GET", input) => {
    if (method === "GET") return { tables: [] };
    writes.push([path, method, input]);
    await write?.();
  }) as DashboardRequest);
  el.model = structuredClone(zonesModel);
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return {
    el,
    table,
    writes,
    grip: table.shadowRoot!.querySelector<HTMLElement>('[data-test="zone-grip-z1"]')!,
  };
}
const point = (element: Element) => {
  const box = element.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
};
function pointer(
  target: Element | Document,
  type: string,
  at: { clientX: number; clientY: number },
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      ...at,
      pointerId: 42,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}
it("a grip drag lifts the complete visible row, marks every target cell and writes one move", async () => {
  const { el, table, writes, grip } = await setup();
  const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
  pointer(grip, "pointerdown", point(grip));
  pointer(document, "pointermove", point(target));
  const ghost = table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]');
  expect(ghost, "the full visible zone row follows the pointer").not.toBeNull();
  expect(ghost!.textContent).toContain("Terrace");
  expect(ghost!.textContent).toContain("Counter service");
  expect(ghost!.textContent).toContain("Paid before preparation");
  expect(ghost!.getBoundingClientRect().width).toBeGreaterThan(
    grip.getBoundingClientRect().width * 3,
  );
  expect([...target.querySelectorAll("td")].every((cell) => cell.part.contains("drop-into"))).toBe(
    true,
  );
  pointer(document, "pointerup", point(target));
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d2" }]]);
  expect(el.model!.zones[0]!.departmentId).toBe("d1");
  expect(table.shadowRoot!.querySelector('[part~="dragging"]')).toBeNull();
});
it.each(["same", "zone", "outside", "cancel", "escape", "disconnect", "refresh"])(
  "%s cancels without a move",
  async (state) => {
    const { el, table, writes, grip } = await setup();
    let target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
    if (state === "same")
      target = table.shadowRoot!.querySelector('[data-row-key="department:d1"]')!;
    if (state === "zone") target = table.shadowRoot!.querySelector('[data-row-key="zone:z4"]')!;
    pointer(grip, "pointerdown", point(grip));
    const at = state === "outside" ? { clientX: -10, clientY: -10 } : point(target);
    pointer(document, "pointermove", at);
    if (state === "cancel") pointer(document, "pointercancel", at);
    if (state === "escape")
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (state === "disconnect") el.remove();
    if (state === "refresh") {
      el.model = structuredClone(el.model);
      await el.updateComplete;
    }
    pointer(document, "pointerup", at);
    await el.updateComplete;
    expect(writes).toEqual([]);
    expect(table.shadowRoot!.querySelector('[part~="dragging"]')).toBeNull();
    expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).toBeNull();
  },
);
it("a press under five pixels sends no move", async () => {
  const { writes, grip } = await setup();
  const at = point(grip);
  pointer(grip, "pointerdown", at);
  pointer(document, "pointermove", { ...at, clientY: at.clientY + 4 });
  expect(
    grip.getRootNode() instanceof ShadowRoot &&
      (grip.getRootNode() as ShadowRoot).querySelector('[data-test="lifted-zone-row"]'),
  ).toBeNull();
  pointer(document, "pointerup", at);
  expect(writes).toEqual([]);
});

it("another pointer cannot move, release or cancel the active zone drag", async () => {
  const { table, writes, grip } = await setup();
  const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
  pointer(grip, "pointerdown", point(grip));
  for (const type of ["pointermove", "pointerup", "pointercancel"]) {
    document.dispatchEvent(
      new PointerEvent(type, {
        ...point(target),
        pointerId: 43,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  expect(writes).toEqual([]);
  expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).toBeNull();
  pointer(document, "pointermove", point(target));
  expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).not.toBeNull();
  pointer(document, "pointerup", point(target));
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d2" }]]);
});

it.each(["Enter", " "])(
  "keyboard drop with %j and no other live department cancels without writing",
  async (drop) => {
    const { el, table, writes } = await setup();
    el.model = { ...el.model!, departments: [el.model!.departments[0]!] };
    await el.updateComplete;
    await table.updateComplete;
    const grip = table.shadowRoot!.querySelector<HTMLElement>('[data-test="zone-grip-z1"]')!;
    grip.focus();
    await userEvent.keyboard("{Enter}");
    expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).not.toBeNull();
    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(table.shadowRoot!.querySelector('[part~="drop-into"]')).toBeNull();
    await userEvent.keyboard(drop === "Enter" ? "{Enter}" : " ");
    expect(writes).toEqual([]);
    expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).toBeNull();
  },
);

it("keyboard navigation wraps in both directions and ignores unrelated keys and other grips", async () => {
  const { el, table, writes, grip } = await setup();
  el.model = {
    ...el.model!,
    departments: [
      ...el.model!.departments,
      {
        id: "d4",
        name: "Last",
        tradingName: "Last shop",
        active: true,
      },
    ],
  };
  await el.updateComplete;
  await table.updateComplete;
  const key = (target: Element, value: string) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  key(grip, " ");
  key(grip, "ArrowUp");
  const marked = () =>
    [...table.shadowRoot!.querySelectorAll('[part~="drop-into"]')].map(
      (cell) => cell.closest("tr")!.dataset.rowKey,
    );
  expect(marked()).toEqual(Array(6).fill("department:d4"));
  key(grip, "ArrowDown");
  expect(marked()).toEqual(Array(6).fill("department:d2"));
  key(grip, "ArrowUp");
  expect(marked()).toEqual(Array(6).fill("department:d4"));
  key(grip, "a");
  key(table.shadowRoot!.querySelector('[data-test="zone-grip-z2"]')!, "ArrowDown");
  expect(marked()).toEqual(Array(6).fill("department:d4"));
  key(grip, " ");
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d4" }]]);
});
it("a real pointer drag releases over the pinned cell without opening an editor", async () => {
  const { el, table, grip, writes } = await setup();
  const opened = vi.fn();
  el.addEventListener("open-department", opened);
  el.addEventListener("edit-zone", opened);
  const target = table.shadowRoot!.querySelector(
    '[data-row-key="department:d2"] td[data-pinned="end"]',
  )!;
  await userEvent.dragAndDrop(page.elementLocator(grip), page.elementLocator(target));
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d2" }]]);
  expect(opened).not.toHaveBeenCalled();
});
it("keyboard grip pickup, destination selection and drop move once and keep row focus", async () => {
  const { table, grip, writes } = await setup();
  grip.focus();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d2" }]]);
  expect(table.shadowRoot!.activeElement).toBe(grip);
});
it("a pending move disables only conflicting grips and a refusal preserves assignment", async () => {
  let finish!: () => void;
  const { el, table, grip, writes } = await setup(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    throw { code: "zone.not_found" };
  });
  const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
  pointer(grip, "pointerdown", point(grip));
  pointer(document, "pointermove", point(target));
  pointer(document, "pointerup", point(target));
  await expect.poll(() => !!finish).toBe(true);
  await el.updateComplete;
  await table.updateComplete;
  expect((grip as HTMLButtonElement).disabled).toBe(true);
  expect(
    (table.shadowRoot!.querySelector('[data-test="zone-grip-z2"]') as HTMLButtonElement).disabled,
  ).toBe(false);
  const edit = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="edit-zone-z1"]',
  )!;
  const remove = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="delete-zone-z1"]',
  )!;
  expect(edit.disabled, "the moving zone cannot open a competing editor").toBe(true);
  expect(remove.disabled, "the moving zone cannot be deleted mid-request").toBe(true);
  const otherEdit = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="edit-zone-z2"]',
  )!;
  expect(otherEdit.disabled).toBe(false);
  const opened = vi.fn();
  el.addEventListener("edit-zone", opened);
  edit.click();
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="open-zone-name-z1"]')!.click();
  expect(opened).not.toHaveBeenCalled();
  finish();
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toBe("The change could not be saved.");
  expect(el.model!.zones[0]!.departmentId).toBe("d1");
  expect(writes).toHaveLength(1);
});
it("a lifted target makes room and the released full row slides into its slot", async () => {
  const { table, grip } = await setup();
  const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
  pointer(grip, "pointerdown", point(grip));
  pointer(document, "pointermove", point(target));
  const cells = [...target.querySelectorAll<HTMLElement>("td")];
  await expect
    .poll(() =>
      cells.every(
        (cell) =>
          parseFloat(getComputedStyle(cell).paddingBlockEnd) >=
          grip.closest("tr")!.getBoundingClientRect().height,
      ),
    )
    .toBe(true);
  pointer(document, "pointerup", point(target));
  const ghost = table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')!;
  expect(ghost, "the released row remains visible during its landing").not.toBeNull();
  expect(ghost.getAnimations()).toHaveLength(1);
  await expect
    .poll(() => table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]'))
    .toBeNull();
});
it("Escape suppresses the abandoned drag's later release click", async () => {
  const { el, table, grip, writes } = await setup();
  const opened = vi.fn();
  el.addEventListener("open-department", opened);
  const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
  pointer(grip, "pointerdown", point(grip));
  pointer(document, "pointermove", point(target));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  pointer(document, "pointerup", point(target));
  target.querySelector<HTMLElement>(".row-activate")!.click();
  expect(writes).toEqual([]);
  expect(opened).not.toHaveBeenCalled();
});
it("reduced motion lands immediately without retaining a row animation", async () => {
  const original = window.matchMedia.bind(window);
  const media = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      query === "(prefers-reduced-motion: reduce)"
        ? ({ ...original(query), matches: true } as MediaQueryList)
        : original(query),
    );
  try {
    const { table, grip, writes } = await setup();
    const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
    pointer(grip, "pointerdown", point(grip));
    pointer(document, "pointermove", point(target));
    pointer(document, "pointerup", point(target));
    await expect.poll(() => writes.length).toBe(1);
    expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).toBeNull();
    expect(table.shadowRoot!.querySelectorAll('[part~="drop-into"]')).toHaveLength(0);
  } finally {
    media.mockRestore();
  }
});
it("another zone can move while the first zone's request is pending", async () => {
  const releases: (() => void)[] = [];
  const { table, grip, writes } = await setup(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  try {
    const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
    pointer(grip, "pointerdown", point(grip));
    pointer(document, "pointermove", point(target));
    pointer(document, "pointerup", point(target));
    await expect.poll(() => writes.length).toBe(1);
    await table.updateComplete;
    const second = table.shadowRoot!.querySelector<HTMLElement>('[data-test="zone-grip-z2"]')!;
    pointer(second, "pointerdown", point(second));
    pointer(document, "pointermove", point(target));
    pointer(document, "pointerup", point(target));
    await expect
      .poll(() => writes)
      .toEqual([
        ["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d2" }],
        ["/management-api/venue-service/zones/z2", "PUT", { departmentId: "d2" }],
      ]);
  } finally {
    for (const release of releases) release();
  }
});

it.each(["department", "zone"] as const)(
  "a deleted %s cancels a lifted target before release",
  async (kind) => {
    const { el, table, writes, grip } = await setup();
    const target = table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!;
    pointer(grip, "pointerdown", point(grip));
    pointer(document, "pointermove", point(target));
    const at = point(target);
    const next = structuredClone(el.model!);
    if (kind === "department") next.departments = next.departments.filter((row) => row.id !== "d2");
    else {
      next.zones = next.zones.filter((row) => row.id !== "z1");
      next.floorZones = next.floorZones.filter((row) => row.id !== "z1");
    }
    el.model = next;
    await el.updateComplete;
    await table.updateComplete;
    const releaseAt =
      kind === "zone"
        ? point(table.shadowRoot!.querySelector('[data-row-key="department:d2"]')!)
        : at;
    pointer(document, "pointerup", releaseAt);
    expect(writes).toEqual([]);
    expect(table.shadowRoot!.querySelector('[data-test="lifted-zone-row"]')).toBeNull();
    expect(table.shadowRoot!.querySelector('[part~="drop-into"]')).toBeNull();
  },
);
it("the drop uses a department's position after scrolling", async () => {
  const { el, table, writes, grip } = await setup();
  el.style.height = "200px";
  const scroller = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  scroller.style.maxHeight = "180px";
  scroller.style.overflowY = "auto";
  const next = structuredClone(el.model!);
  for (let i = 3; i <= 12; i++)
    next.departments.push({
      id: `d${i}`,
      name: `Department ${i}`,
      tradingName: `Trading ${i}`,
      active: true,
    });
  el.model = next;
  await el.updateComplete;
  await table.updateComplete;
  const target = table.shadowRoot!.querySelector<HTMLElement>('[data-row-key="department:d12"]')!;
  expect(target.getBoundingClientRect().top).toBeGreaterThan(
    scroller.getBoundingClientRect().bottom,
  );
  pointer(grip, "pointerdown", point(grip));
  pointer(document, "pointermove", { ...point(grip), clientY: point(grip).clientY + 8 });
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(target.getBoundingClientRect().top).toBeLessThan(scroller.getBoundingClientRect().bottom);
  pointer(document, "pointermove", point(target));
  pointer(document, "pointerup", point(target));
  await expect
    .poll(() => writes)
    .toEqual([["/management-api/venue-service/zones/z1", "PUT", { departmentId: "d12" }]]);
});

it.each(["ArrowDown", "ArrowUp"])(
  "%s selects the nearest end from an unselected keyboard move",
  async (key) => {
    const { el, table, grip, writes } = await setup();
    el.model!.departments.push({ ...el.model!.departments[1]!, id: "d3", name: "Last" });
    el.requestUpdate();
    await el.updateComplete;
    await table.updateComplete;
    for (const pressed of [" ", key, "Enter"])
      grip.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressed,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/zones/z1",
          "PUT",
          { departmentId: key === "ArrowDown" ? "d2" : "d3" },
        ],
      ]);
  },
);
