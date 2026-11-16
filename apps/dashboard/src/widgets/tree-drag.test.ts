import { render, nothing } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mediaTestReference, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import { dragGhost, placeDragGhost, TreePointerDrag } from "./tree-drag.js";

const replacements = useMediaPresentations();
let host: HTMLDivElement;
let pointerDrag: TreePointerDrag<string[], string> | undefined;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  pointerDrag?.finish();
  pointerDrag = undefined;
  document.dispatchEvent(new PointerEvent("pointerup"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  render(nothing, host);
  host.remove();
});
it("keeps the dragged row's name and pointer position as its square photo follows replacement", async () => {
  const reference = mediaTestReference("folder.png");
  const replacement = mediaTestReference("replacement.webp");
  render(dragGhost({ label: "Included lunch", image: reference, folder: true }), host);
  const img = host.querySelector("img")!;
  await vi.waitFor(() =>
    expect(img.getAttribute("src")).toBe(
      `/media/renditions/v1/${reference}/square/7500-2500-200.webp`,
    ),
  );
  placeDragGhost(host, { x: 20, y: 70 });
  replacements.set(reference, replacement);
  invalidateMediaImages();
  await vi.waitFor(() =>
    expect(img.getAttribute("src")).toBe(
      `/media/renditions/v1/${replacement}/square/7500-2500-200.webp`,
    ),
  );
  expect(host.textContent).toContain("Included lunch");
  expect(host.querySelector<HTMLElement>(".drag-ghost")!.style.transform).toBe(
    "translate(20px, 70px)",
  );
  expect(img.alt).toBe("");
  expect(img.draggable).toBe(false);
});

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 7,
    pointerType: "mouse",
    button: 0,
    clientX: 10,
    clientY: 10,
    cancelable: true,
    ...init,
  });
}

function dragFixture() {
  host.innerHTML =
    '<table style="position:fixed;inset:0;width:200px;height:100px"><tbody><tr data-row-key="folder"><td>Folder</td></tr></tbody></table>';
  let allowed = true;
  const seen: { over: string | undefined; target: string | undefined }[] = [];
  const ended: boolean[] = [];
  const drops: string[][] = [];
  const cursor = document.body.style.cursor;
  pointerDrag = new TreePointerDrag<string[], string>({
    activate: (key) => (key === "gone" ? undefined : [key, "selected"]),
    targetFor: (_data, over) => (allowed && over === "folder" ? "destination" : undefined),
    sameTarget: (a, b) => a === b,
    moved: ({ over, target }) => seen.push({ over, target }),
    ended: (active) => ended.push(active),
    drop: (data, target) => {
      expect(pointerDrag!.state).toBeNull();
      expect(document.body.style.cursor).toBe(cursor);
      drops.push([...data, target]);
    },
  });
  return {
    drag: pointerDrag,
    seen,
    ended,
    drops,
    refuse: () => {
      allowed = false;
    },
    allow: () => {
      allowed = true;
    },
  };
}

it("waits for five pixels, follows only the pressed pointer and drops its captured selection after cleanup", () => {
  const { drag, seen, ended, drops } = dragFixture();
  drag.start(pointer("pointerdown"), "source");
  document.dispatchEvent(pointer("pointermove", { clientX: 14 }));
  document.dispatchEvent(pointer("pointermove", { pointerId: 8, clientX: 30 }));
  expect(seen).toEqual([]);
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  expect(seen).toEqual([{ over: "folder", target: "destination" }]);
  expect(document.body.style.cursor).toBe("grabbing");
  document.dispatchEvent(pointer("pointerup", { pointerId: 8 }));
  expect(drops).toEqual([]);
  document.dispatchEvent(pointer("pointerup"));
  expect(drops).toEqual([["source", "selected", "destination"]]);
  expect(ended).toEqual([true]);
  document.dispatchEvent(pointer("pointermove", { clientX: 40 }));
  expect(seen).toHaveLength(1);
});

it("rechecks the destination on release and re-hits the painted row after scrolling", () => {
  const { drag, seen, drops, refuse } = dragFixture();
  drag.start(pointer("pointerdown"), "source");
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  refuse();
  drag.revalidate();
  expect(seen.at(-1)).toEqual({ over: "folder", target: undefined });
  host.querySelector("tr")!.dataset.rowKey = "elsewhere";
  drag.repaint();
  expect(seen.at(-1)).toEqual({ over: "elsewhere", target: undefined });
  document.dispatchEvent(pointer("pointerup"));
  expect(drops).toEqual([]);
});

it("refuses a destination removed after the last move", () => {
  const { drag, drops, refuse } = dragFixture();
  drag.start(pointer("pointerdown"), "source");
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  refuse();
  document.dispatchEvent(pointer("pointerup"));
  expect(drops).toEqual([]);
});

it.each(["pointercancel", "Escape"])("cleans up an active %s without dropping", (ending) => {
  const { drag, drops, ended } = dragFixture();
  drag.start(pointer("pointerdown"), "source");
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  if (ending === "Escape")
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  else document.dispatchEvent(pointer(ending));
  expect(drag.state).toBeNull();
  expect(ended).toEqual([true]);
  expect(drops).toEqual([]);
});

it("leaves a press inactive, rejects other buttons and clears a vanished source", () => {
  const { drag, seen, ended, drops } = dragFixture();
  expect(drag.start(pointer("pointerdown", { button: 2 }), "source")).toBe(false);
  expect(drag.start(pointer("pointerdown", { ctrlKey: true }), "source")).toBe(false);
  expect(drag.state).toBeNull();
  drag.start(pointer("pointerdown"), "source");
  expect(drag.start(pointer("pointerdown", { pointerId: 8 }), "other")).toBe(false);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(drag.state?.active).toBe(false);
  document.dispatchEvent(pointer("pointerup"));
  drag.start(pointer("pointerdown"), "gone");
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  expect(drag.state).toBeNull();
  expect(ended).toEqual([false, false]);
  expect(seen).toEqual([]);
  expect(drops).toEqual([]);
});

it("does not introduce a new drop on release when no destination was offered", () => {
  const { drag, drops, refuse, allow } = dragFixture();
  drag.start(pointer("pointerdown"), "source");
  refuse();
  document.dispatchEvent(pointer("pointermove", { clientX: 15 }));
  allow();
  document.dispatchEvent(pointer("pointerup"));
  expect(drops).toEqual([]);
});
