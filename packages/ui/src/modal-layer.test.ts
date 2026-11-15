import { afterEach, expect, test, vi } from "vitest";
import { modalClosed, modalOpened, onModalChange, underModal } from "./modal-layer.js";

const opened: Element[] = [];
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const modal of opened.splice(0)) modalClosed(modal);
  document.body.replaceChildren();
});

function open(modal: Element, order: number): Element {
  opened.push(modal);
  modalOpened(modal, order);
  return modal;
}

function listen(listener: () => void): () => void {
  const stop = onModalChange(listener);
  stops.push(stop);
  return stop;
}

function box(parent: Node = document.body): HTMLElement {
  const element = document.createElement("div");
  parent.appendChild(element);
  return element;
}

test("opening and closing a window tell every listener", () => {
  const first = vi.fn();
  const second = vi.fn();
  listen(first);
  listen(second);
  const modal = open(box(), 1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  modalClosed(modal);
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(2);
});

test("closing a window that was never opened tells nobody", () => {
  const listener = vi.fn();
  listen(listener);
  modalClosed(box());
  expect(listener).not.toHaveBeenCalled();
});

test("closing a window twice tells listeners once", () => {
  const listener = vi.fn();
  listen(listener);
  const modal = open(box(), 1);
  modalClosed(modal);
  modalClosed(modal);
  expect(listener).toHaveBeenCalledTimes(2);
});

test("a listener that stops listening while being told hears no more, and the next one still hears", () => {
  const self = vi.fn(() => stopSelf());
  const later = vi.fn();
  const stopSelf = listen(self);
  listen(later);
  const modal = open(box(), 1);
  modalClosed(modal);
  expect(self).toHaveBeenCalledTimes(1);
  expect(later).toHaveBeenCalledTimes(2);
});

test("a listener stopped by another while an opening is being told still hears that opening", () => {
  const removed = vi.fn();
  listen(() => stopRemoved());
  const stopRemoved = listen(removed);
  const modal = open(box(), 1);
  expect(removed).toHaveBeenCalledTimes(1);
  modalClosed(modal);
  expect(removed).toHaveBeenCalledTimes(1);
});

test("a listener stopped by another while a closing is being told still hears that closing", () => {
  const modal = open(box(), 1);
  const removed = vi.fn();
  listen(() => stopRemoved());
  const stopRemoved = listen(removed);
  modalClosed(modal);
  expect(removed).toHaveBeenCalledTimes(1);
});

test("a listener added while others are being told hears from the next change on", () => {
  const added = vi.fn();
  let adding = true;
  listen(() => {
    if (adding) listen(added);
    adding = false;
  });
  const modal = open(box(), 1);
  expect(added).not.toHaveBeenCalled();
  modalClosed(modal);
  expect(added).toHaveBeenCalledTimes(1);
});

test("a stopped listener hears nothing more", () => {
  const listener = vi.fn();
  const stop = listen(listener);
  const modal = open(box(), 1);
  stop();
  modalClosed(modal);
  expect(listener).toHaveBeenCalledTimes(1);
});

test("nothing is under a window while none is open", () => {
  expect(underModal(box())).toBe(false);
});

test("what is outside the open window is under it", () => {
  open(box(), 1);
  expect(underModal(box())).toBe(true);
});

test("what is inside the open window is not under it", () => {
  const modal = open(box(), 1);
  expect(underModal(box(box(modal)))).toBe(false);
  expect(underModal(modal)).toBe(false);
});

test("what is inside an earlier window is under the latest one, in either opening order", () => {
  const earlier = box();
  const later = box();
  open(later, 2);
  open(earlier, 1);
  expect(underModal(box(earlier))).toBe(true);
  expect(underModal(box(later))).toBe(false);
});

test("closing the latest window leaves what is inside the earlier one free", () => {
  const earlier = open(box(), 1);
  const later = open(box(), 2);
  const inside = box(earlier);
  modalClosed(later);
  expect(underModal(inside)).toBe(false);
});

test("an element slotted into the open window is not under it", () => {
  const host = box();
  const root = host.attachShadow({ mode: "open" });
  const modal = open(box(root), 1);
  modal.appendChild(document.createElement("slot"));
  const slotted = box(host);
  expect(slotted.assignedSlot).not.toBeNull();
  expect(underModal(slotted)).toBe(false);
});

test("an element slotted into a component outside the open window is under it", () => {
  open(box(), 1);
  const host = box();
  host.attachShadow({ mode: "open" }).appendChild(document.createElement("slot"));
  expect(underModal(box(host))).toBe(true);
});

test("an element inside a component's own drawing, inside the open window, is not under it", () => {
  const modal = open(box(), 1);
  const root = box(modal).attachShadow({ mode: "open" });
  expect(underModal(box(root))).toBe(false);
});
