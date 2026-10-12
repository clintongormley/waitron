import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import { DragEdgeScroll } from "./drag-edge-scroll.js";

let scroll: DragEdgeScroll;
beforeEach(() => {
  scroll = new DragEdgeScroll();
});
afterEach(() => {
  if (scroll !== undefined) scroll.stop();
  vi.restoreAllMocks();
  cleanup();
});
const frames = async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
};

async function fixture(axis: "x" | "y" = "y", shadow = false) {
  const host = await mount("<div></div>");
  const parent = shadow ? host.attachShadow({ mode: "open" }) : host;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:100px;left:100px;width:240px;height:200px;overflow:auto";
  const row = document.createElement("div");
  row.style.cssText = axis === "y" ? "height:1000px;width:100px" : "width:1000px;height:100px";
  parent.append(box);
  box.append(row);
  return { box, row, edge: box.getBoundingClientRect() };
}

it.each(["x", "y"] as const)(
  "scrolls %s in both directions and refreshes the painted drop position",
  async (axis) => {
    const { box, row, edge } = await fixture(axis);
    let last = -1;
    const read = () => {
      last = axis === "y" ? box.scrollTop : box.scrollLeft;
    };
    scroll.start(
      row,
      {
        x: axis === "x" ? edge.right - 5 : edge.left + 20,
        y: axis === "y" ? edge.bottom - 5 : edge.top + 20,
      },
      read,
      axis,
    );
    await expect.poll(() => last, { timeout: 1500 }).toBeGreaterThan(100);
    scroll.update({ x: edge.left + 5, y: edge.top + 5 });
    await expect
      .poll(() => (axis === "y" ? box.scrollTop : box.scrollLeft), { timeout: 1500 })
      .toBe(0);
  },
);

it("finds a scroller inside a shadow root through a slotted row", async () => {
  const { box, row, edge } = await fixture("y", true);
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>";
  box.append(host);
  host.append(row);
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(60);
});

it.each(["middle", "outside", "stop", "detach"])(
  "ends the loop on %s and leaves no scheduled frame",
  async (end) => {
    const { box, row, edge } = await fixture();
    scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {});
    await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(40);
    if (end === "middle") scroll.update({ x: edge.left + 20, y: edge.top + 100 });
    else if (end === "outside") scroll.update({ x: edge.left - 20, y: edge.bottom - 5 });
    else if (end === "detach") row.remove();
    else scroll.stop();
    await frames();
    const ended = box.scrollTop;
    const original = window.requestAnimationFrame.bind(window);
    const scheduled = vi.spyOn(window, "requestAnimationFrame");
    for (let i = 0; i < 3; i++) await new Promise(original);
    expect(box.scrollTop).toBe(ended);
    expect(scheduled).not.toHaveBeenCalled();
  },
);

it("does not scroll a list that fits and restarts a stopped loop after another pointer move", async () => {
  const { box, row, edge } = await fixture();
  row.style.height = "100px";
  let refreshes = 0;
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {
    refreshes++;
  });
  await frames();
  expect(box.scrollTop).toBe(0);
  expect(refreshes).toBe(0);
  row.style.height = "1000px";
  scroll.update({ x: edge.left + 20, y: edge.bottom - 5 });
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(40);
});

it("stops at the end of a box and reaches an outer scroller at that edge", async () => {
  const { box, row, edge } = await fixture();
  const inner = document.createElement("div");
  inner.style.cssText = "height:200px;overflow:auto";
  box.append(inner);
  inner.append(row);
  const tail = document.createElement("div");
  tail.style.height = "500px";
  box.append(tail);
  inner.scrollTop = inner.scrollHeight;
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(40);
  expect(inner.scrollTop).toBe(inner.scrollHeight - inner.clientHeight);
  scroll.stop();
  box.removeChild(inner);
  box.removeChild(tail);
  box.append(row);
  box.scrollTop = box.scrollHeight;
  let refreshes = 0;
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {
    refreshes++;
  });
  await frames();
  expect(refreshes).toBe(0);
});

it("scrolls faster closer to the edge and uses the host tap size for the band", async () => {
  const { box, row, edge } = await fixture();
  row.style.setProperty("--wt-tap-min", "60px");
  let resolve: () => void = () => {};
  const moved = new Promise<void>((done) => {
    resolve = done;
  });
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 50 }, () => {
    scroll.stop();
    resolve();
  });
  await moved;
  const far = box.scrollTop;
  expect(far).toBeGreaterThan(0);
  box.scrollTop = 0;
  await new Promise<void>((done) =>
    scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {
      scroll.stop();
      done();
    }),
  );
  expect(box.scrollTop).toBeGreaterThan(far);
});

it("scrolls inside a top-layer dialog without clipping against the table underneath", async () => {
  const host = await mount("<div></div>");
  host.style.cssText = "height:20px;overflow:hidden";
  const dialog = document.createElement("dialog");
  host.append(dialog);
  dialog.style.cssText = "position:fixed;top:100px;left:100px;margin:0;padding:0;border:0";
  const box = document.createElement("div");
  box.style.cssText = "height:200px;width:240px;overflow:auto";
  const row = document.createElement("div");
  row.style.height = "1000px";
  box.append(row);
  dialog.append(box);
  dialog.showModal();
  const edge = box.getBoundingClientRect();
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 5 }, () => {});
  try {
    await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(60);
  } finally {
    dialog.close();
  }
});

it.each(["x", "y"] as const)(
  "scrolls the document along %s when the viewport is the only scrolling box",
  async (axis) => {
    const host = await mount("<div></div>");
    host.style.cssText = "height:2000px;width:3000px";
    host.style.setProperty("--wt-tap-min", "invalid");
    const root = document.scrollingElement!;
    const restore = { top: root.scrollTop, left: root.scrollLeft };
    root.scrollTop = 0;
    root.scrollLeft = 0;
    scroll.start(
      host,
      {
        x: axis === "x" ? window.innerWidth - 5 : 20,
        y: axis === "y" ? window.innerHeight - 5 : 20,
      },
      () => {},
      axis,
    );
    try {
      await expect
        .poll(() => (axis === "y" ? root.scrollTop : root.scrollLeft), { timeout: 1500 })
        .toBeGreaterThan(60);
    } finally {
      scroll.stop();
      root.scrollTop = restore.top;
      root.scrollLeft = restore.left;
    }
  },
);

it("uses the nearer visible horizontal edge when an ancestor clips a wider scroller", async () => {
  const { box, row } = await fixture("x");
  const clip = document.createElement("div");
  clip.style.cssText =
    "position:fixed;left:100px;top:100px;width:120px;height:150px;overflow:hidden";
  box.parentNode!.appendChild(clip);
  clip.append(box);
  box.style.position = "absolute";
  box.style.left = "0";
  box.style.top = "0";
  const edge = clip.getBoundingClientRect();
  scroll.start(row, { x: edge.right - 5, y: edge.top + 20 }, () => {}, "x");
  await expect.poll(() => box.scrollLeft, { timeout: 1500 }).toBeGreaterThan(60);
  scroll.update({ x: edge.right + 5, y: edge.top + 20 });
  const ended = box.scrollLeft;
  await frames();
  expect(box.scrollLeft).toBe(ended);
});

it("uses the viewport edge when the box extends below the screen", async () => {
  const { box, row, edge } = await fixture();
  box.style.top = `${window.innerHeight - 100}px`;
  scroll.start(row, { x: edge.left + 20, y: window.innerHeight - 5 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(60);
});

it("makes progress just inside the edge band instead of rounding every frame to zero", async () => {
  const { box, row, edge } = await fixture();
  row.style.setProperty("--wt-tap-min", "44px");
  scroll.start(row, { x: edge.left + 20, y: edge.bottom - 43.9 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(1);
});

/** The box scrolled part way, so it can move either way, and a probe that reports whether one
 * frame of edge scrolling from `point` moved it. */
async function scrolledBox(css = "") {
  const { box, row } = await fixture();
  box.style.cssText += css;
  box.scrollTop = 300;
  const moves = async (point: { x: number; y: number }) => {
    const before = box.scrollTop;
    scroll.start(row, point, () => {});
    await frames();
    scroll.stop();
    const moved = box.scrollTop - before;
    box.scrollTop = before;
    return moved;
  };
  return { box, row, edge: box.getBoundingClientRect(), moves };
}

it("scrolls a box whose overflow is scroll as well as one whose overflow is auto", async () => {
  const { box, edge, moves } = await scrolledBox("overflow:scroll");
  expect(getComputedStyle(box).overflowY).toBe("scroll");
  expect(await moves({ x: edge.left + 20, y: edge.bottom - 5 })).toBeGreaterThan(0);
});

it("ignores a pointer above, beside or to the right of the box", async () => {
  const { edge, moves } = await scrolledBox();
  expect(await moves({ x: edge.left + 20, y: edge.top - 5 })).toBe(0);
  expect(await moves({ x: edge.right + 5, y: edge.bottom - 5 })).toBe(0);
  expect(await moves({ x: edge.right + 5, y: edge.top + 5 })).toBe(0);
});

it("scrolls from the very first and last pixels of the box's edges", async () => {
  const { box, edge, moves } = await scrolledBox();
  const bottom = edge.top + box.clientHeight;
  expect(await moves({ x: edge.left + 20, y: edge.top })).toBeLessThan(0);
  expect(await moves({ x: edge.left + 20, y: bottom })).toBeGreaterThan(0);
  expect(await moves({ x: edge.left, y: edge.top + 5 })).toBeLessThan(0);
  expect(await moves({ x: edge.right, y: edge.top + 5 })).toBeLessThan(0);
});

it("keeps still outside the edge bands, which split a short box into halves", async () => {
  const { box, edge, moves } = await scrolledBox();
  expect(await moves({ x: edge.left + 20, y: edge.bottom - 60 })).toBe(0);
  expect(await moves({ x: edge.left + 20, y: edge.top + 60 })).toBe(0);
  box.style.height = "60px";
  const short = box.getBoundingClientRect();
  expect(await moves({ x: short.left + 20, y: short.top + 30 })).toBe(0);
  expect(await moves({ x: short.left + 20, y: short.top + 25 })).toBeLessThan(0);
  expect(await moves({ x: short.left + 20, y: short.top + 35 })).toBeGreaterThan(0);
});

it("scrolls up faster closer to the top edge", async () => {
  const { box, row, edge } = await fixture();
  const step = async (y: number) => {
    box.scrollTop = 300;
    await new Promise<void>((done) =>
      scroll.start(row, { x: edge.left + 20, y }, () => {
        scroll.stop();
        done();
      }),
    );
    return 300 - box.scrollTop;
  };
  const near = await step(edge.top + 5);
  const far = await step(edge.top + 35);
  expect(far).toBeGreaterThan(0);
  expect(near).toBeGreaterThan(far);
});

it("measures the edge bands from inside the box's border", async () => {
  const { edge, moves } = await scrolledBox("border:30px solid transparent;border-width:30px");
  expect(await moves({ x: edge.left + 50, y: edge.top + 40 })).toBeLessThan(0);
  expect(await moves({ x: edge.left + 50, y: edge.bottom - 40 })).toBeGreaterThan(0);
});

it("measures the horizontal edge bands from inside the box's border", async () => {
  const { box, row } = await fixture("x");
  box.style.borderLeft = "30px solid transparent";
  box.scrollLeft = 300;
  const edge = box.getBoundingClientRect();
  scroll.start(row, { x: edge.left + 40, y: edge.top + 20 }, () => {}, "x");
  await expect.poll(() => box.scrollLeft, { timeout: 1500 }).toBeLessThan(250);
});

it("passes over a box that fits across to reach an outer one that scrolls across", async () => {
  const { box, row } = await fixture("x");
  const inner = document.createElement("div");
  inner.style.cssText = "width:1000px;height:120px;overflow:auto";
  box.append(inner);
  inner.append(row);
  let refreshes = 0;
  const edge = box.getBoundingClientRect();
  scroll.start(
    row,
    { x: edge.right - 5, y: edge.top + 20 },
    () => {
      refreshes++;
    },
    "x",
  );
  await expect.poll(() => box.scrollLeft, { timeout: 1500 }).toBeGreaterThan(40);
  expect(inner.scrollLeft).toBe(0);
  expect(refreshes).toBeGreaterThan(0);
});

it("uses the nearer visible top edge when an ancestor clips the top of the box", async () => {
  const { box, row } = await fixture();
  const clip = document.createElement("div");
  clip.style.cssText =
    "position:fixed;left:100px;top:150px;width:240px;height:300px;overflow:hidden";
  box.parentNode!.appendChild(clip);
  clip.append(box);
  box.style.position = "absolute";
  box.style.left = "0";
  box.style.top = "-100px";
  box.scrollTop = 300;
  const edge = clip.getBoundingClientRect();
  scroll.start(row, { x: edge.left + 20, y: edge.top + 5 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeLessThan(250);
});

it("ignores a pointer beside the part of the box an ancestor clips away", async () => {
  const { box, row } = await fixture();
  const clip = document.createElement("div");
  clip.style.cssText =
    "position:fixed;left:200px;top:50px;width:100px;height:400px;overflow:hidden";
  box.parentNode!.appendChild(clip);
  clip.append(box);
  box.style.position = "absolute";
  box.style.left = "-60px";
  box.style.top = "50px";
  box.style.width = "240px";
  box.scrollTop = 300;
  const edge = box.getBoundingClientRect();
  const visible = clip.getBoundingClientRect();
  for (const x of [visible.left - 20, visible.right + 20]) {
    scroll.start(row, { x, y: edge.bottom - 5 }, () => {});
    await frames();
    expect(box.scrollTop, `pointer at x=${x}`).toBe(300);
  }
  scroll.start(row, { x: visible.left + 20, y: edge.bottom - 5 }, () => {});
  await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(300);
});

it("scrolls one step a frame when the owner refreshes the point after every scroll", async () => {
  const { box, row, edge } = await fixture();
  const point = { x: edge.left + 20, y: edge.bottom - 1 };
  scroll.start(row, point, () => scroll.update(point));
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await new Promise(requestAnimationFrame);
    seen.push(box.scrollTop);
  }
  scroll.stop();
  const steps = seen.slice(1).map((top, i) => top - seen[i]!);
  expect(Math.max(...steps)).toBeGreaterThan(0);
  expect(Math.max(...steps)).toBeLessThanOrEqual(16);
});
