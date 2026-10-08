import { afterEach, expect, it, vi } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import { DragEdgeScroll } from "./drag-edge-scroll.js";

const scroll = new DragEdgeScroll();
afterEach(() => {
  scroll.stop();
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
