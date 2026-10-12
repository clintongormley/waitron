import { capturePointer, releasePointer, DRAG_THRESHOLD_PX } from "@waitron/dashboard-kit";
import { DragEdgeScroll } from "@waitron/ui/src/drag-edge-scroll.js";
import type { VenueServiceView } from "./client.js";
type Point = { x: number; y: number };
type Drag = {
  zoneId: string;
  parentId: string;
  model: VenueServiceView;
  grip: HTMLElement;
  row: HTMLElement;
  pointerId?: number;
  start: Point;
  point: Point;
  offsetY: number;
  lifted: boolean;
  target: string;
  ghost?: HTMLElement;
};
export class DepartmentsZonesDrag {
  private drag?: Drag;
  private readonly scroll = new DragEdgeScroll();
  private markedTarget = "";
  private readonly cellStyles = new Map<HTMLElement, { padding: string; transition: string }>();
  private readonly landings = new Set<{ ghost: HTMLElement; animation: Animation }>();
  private clickDetach?: () => void;
  constructor(
    private readonly root: () => ShadowRoot | undefined,
    private readonly model: () => VenueServiceView | undefined,
    private readonly move: (zoneId: string, departmentId: string, keyboard: boolean) => void,
  ) {}
  start(event: PointerEvent, zoneId: string) {
    if (event.button !== 0 || this.drag) return;
    const model = this.model(),
      grip = event.currentTarget as HTMLElement;
    const zone = model?.zones.find((zone) => zone.id === zoneId && zone.active !== false);
    const row = grip.closest<HTMLElement>("tr");
    if (!zone || !row || !model) return;
    event.preventDefault();
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    this.drag = {
      zoneId,
      parentId: zone.departmentId,
      model,
      grip,
      row,
      pointerId: event.pointerId,
      start: point,
      point,
      offsetY: point.y - row.getBoundingClientRect().top,
      lifted: false,
      target: "",
    };
    capturePointer(grip, event.pointerId);
    document.addEventListener("pointermove", this.pointerMove, true);
    document.addEventListener("pointerup", this.pointerUp, true);
    document.addEventListener("pointercancel", this.pointerCancel, true);
    document.addEventListener("keydown", this.escape, true);
  }
  key(event: KeyboardEvent, zoneId: string) {
    const active = this.drag;
    if (!active && (event.key === " " || event.key === "Enter")) {
      const model = this.model(),
        zone = model?.zones.find((zone) => zone.id === zoneId && zone.active !== false),
        grip = event.currentTarget as HTMLElement;
      const row = grip.closest<HTMLElement>("tr");
      if (!zone || !row || !model) return;
      event.preventDefault();
      event.stopPropagation();
      const box = row.getBoundingClientRect(),
        point = { x: box.left, y: box.top };
      this.drag = {
        zoneId,
        parentId: zone.departmentId,
        model,
        grip,
        row,
        start: point,
        point,
        offsetY: 0,
        lifted: false,
        target: "",
      };
      this.lift();
      document.addEventListener("keydown", this.escape, true);
      return;
    }
    if (!active || active.pointerId !== undefined || active.zoneId !== zoneId) return;
    if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      this.cancel();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      this.finish();
      return;
    }
    const targets = this.targets();
    const index = targets.findIndex((row) => row.id === active.target);
    const next =
      targets[(index + (event.key === "ArrowDown" ? 1 : -1) + targets.length) % targets.length];
    active.target = next?.id ?? "";
    this.mark();
    this.row(`department:${active.target}`)?.scrollIntoView({ block: "nearest" });
  }
  reconcile() {
    if (this.drag && this.model() !== this.drag.model) {
      if (this.drag.lifted && this.drag.pointerId !== undefined)
        this.blockClick(this.drag.pointerId);
      this.cancel();
    }
  }
  dispose() {
    for (const landing of this.landings) {
      landing.animation.cancel();
      landing.ghost.remove();
    }
    this.landings.clear();
    this.cancel();
    this.clickDetach?.();
    this.clickDetach = undefined;
  }
  private targets() {
    return (
      this.model()?.departments.filter((row) => row.active && row.id !== this.drag?.parentId) ?? []
    );
  }
  private row(key: string) {
    return this.root()?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
  }
  private readonly pointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.point = { x: event.clientX, y: event.clientY };
    if (
      !drag.lifted &&
      Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) >= DRAG_THRESHOLD_PX
    )
      this.lift();
    if (!drag.lifted) return;
    event.preventDefault();
    event.stopPropagation();
    this.track();
    this.scroll.update(drag.point);
  };
  private readonly pointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag.point = { x: event.clientX, y: event.clientY };
    if (this.drag.lifted) {
      event.preventDefault();
      event.stopPropagation();
      this.track();
      this.blockClick();
    }
    this.finish();
  };
  private readonly pointerCancel = (event: PointerEvent) => {
    if (this.drag?.pointerId === event.pointerId) this.cancel();
  };
  private readonly escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.drag) {
      event.preventDefault();
      event.stopPropagation();
      if (this.drag.lifted && this.drag.pointerId !== undefined)
        this.blockClick(this.drag.pointerId);
      this.cancel();
    }
  };
  private lift() {
    const drag = this.drag,
      root = this.root();
    if (!drag || !root) return;
    drag.lifted = true;
    drag.row.part.add("dragging");
    drag.row.setAttribute("aria-disabled", "true");
    const ghost = document.createElement("div"),
      table = document.createElement("table"),
      body = document.createElement("tbody");
    const clone = drag.row.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-row-key");
    clone.removeAttribute("aria-disabled");
    clone.part.remove("dragging");
    for (const control of clone.querySelectorAll("[data-test]"))
      control.removeAttribute("data-test");
    for (const [index, cell] of [...clone.querySelectorAll<HTMLElement>(":scope > td")].entries())
      cell.style.width = `${drag.row.children[index]!.getBoundingClientRect().width}px`;
    body.append(clone);
    table.append(body);
    ghost.append(table);
    ghost.dataset.test = "lifted-zone-row";
    ghost.className = "zone-row-lift";
    ghost.part.add("zone-row-lift");
    Object.assign(ghost.style, {
      position: "fixed",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "3",
    });
    ghost.setAttribute("aria-hidden", "true");
    table.style.width = `${drag.row.getBoundingClientRect().width}px`;
    root.append(ghost);
    drag.ghost = ghost;
    this.position();
    const scroller = root.querySelector<HTMLElement>(".scroll");
    ghost.scrollLeft = scroller?.scrollLeft ?? 0;
    if (drag.pointerId !== undefined) this.scroll.start(drag.grip, drag.point, () => this.track());
  }
  private position() {
    const drag = this.drag,
      root = this.root();
    if (!drag?.ghost || !root) return;
    const bounds = root.host.getBoundingClientRect();
    const top = Math.max(bounds.top, 0),
      bottom = Math.min(bounds.bottom, innerHeight);
    const y = Math.max(
      top,
      Math.min(drag.point.y - drag.offsetY, bottom - drag.row.getBoundingClientRect().height),
    );
    Object.assign(drag.ghost.style, {
      left: `${bounds.left}px`,
      top: `${y}px`,
      width: `${bounds.width}px`,
    });
  }
  private track() {
    const drag = this.drag;
    if (!drag || !drag.lifted) return;
    if (this.model() !== drag.model) {
      this.cancel();
      return;
    }
    this.position();
    drag.target =
      this.targets().find((target) => {
        const box = this.row(`department:${target.id}`)?.getBoundingClientRect();
        return (
          box &&
          drag.point.x >= box.left &&
          drag.point.x <= box.right &&
          drag.point.y >= box.top &&
          drag.point.y <= box.bottom
        );
      })?.id ?? "";
    this.mark();
  }
  private mark() {
    const drag = this.drag;
    if (!drag || this.markedTarget === drag.target) return;
    this.clearMarks();
    this.markedTarget = drag.target;
    drag.row.part.add("dragging");
    drag.row.setAttribute("aria-disabled", "true");
    for (const cell of this.row(`department:${drag.target}`)?.querySelectorAll<HTMLElement>(
      ":scope > td",
    ) ?? []) {
      this.cellStyles.set(cell, {
        padding: cell.style.paddingBlockEnd,
        transition: cell.style.transition,
      });
      cell.part.add("drop-into");
      cell.style.transition = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "padding-block-end var(--wt-duration-move)";
      cell.style.paddingBlockEnd = `calc(var(--wt-space-3) + ${drag.row.getBoundingClientRect().height}px)`;
    }
  }
  private clearMarks() {
    const root = this.root();
    this.markedTarget = "";
    for (const [cell, style] of this.cellStyles) {
      cell.style.paddingBlockEnd = style.padding;
      cell.style.transition = style.transition;
    }
    this.cellStyles.clear();
    for (const element of root?.querySelectorAll<HTMLElement>(
      '[part~="dragging"], [part~="drop-into"]',
    ) ?? []) {
      element.part.remove("dragging", "drop-into");
      element.removeAttribute("aria-disabled");
    }
  }
  private blockClick(pointerId?: number) {
    this.clickDetach?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detach = () => {
      clearTimeout(timer);
      document.removeEventListener("click", block, true);
      document.removeEventListener("pointerup", released, true);
      this.clickDetach = undefined;
    };
    const block = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      detach();
    };
    const released = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        document.removeEventListener("pointerup", released, true);
        timer = setTimeout(detach, 0);
      }
    };
    this.clickDetach = detach;
    document.addEventListener("click", block, true);
    if (pointerId === undefined) timer = setTimeout(detach, 0);
    else document.addEventListener("pointerup", released, true);
  }
  private finish() {
    const drag = this.drag;
    const target =
      drag &&
      drag.lifted &&
      this.model() === drag.model &&
      this.targets().some((row) => row.id === drag.target)
        ? drag.target
        : "";
    const ghost = drag?.ghost;
    const targetBox = target
      ? this.row(`department:${target}`)?.getBoundingClientRect()
      : undefined;
    if (ghost && targetBox && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rawDuration = getComputedStyle(this.root()!.host)
        .getPropertyValue("--wt-duration-move")
        .trim();
      const duration = parseFloat(rawDuration) * (rawDuration.endsWith("ms") ? 1 : 1000);
      const shift =
        targetBox.bottom -
        drag!.row.getBoundingClientRect().height -
        ghost.getBoundingClientRect().top;
      drag!.ghost = undefined;
      const animation = ghost.animate(
        [{ transform: "translateY(0px)" }, { transform: `translateY(${shift}px)` }],
        { duration: Number.isFinite(duration) ? duration : 0, easing: "ease" },
      );
      const landing = { ghost, animation };
      this.landings.add(landing);
      void animation.finished
        .catch(() => {})
        .then(() => {
          ghost.remove();
          this.landings.delete(landing);
        });
    }
    this.cancel();
    if (drag && target) {
      this.move(drag.zoneId, target, drag.pointerId === undefined);
      if (drag.grip.isConnected) drag.grip.focus();
    }
  }
  cancel() {
    const drag = this.drag;
    this.drag = undefined;
    this.scroll.stop();
    this.clearMarks();
    drag?.ghost?.remove();
    if (drag?.pointerId !== undefined) releasePointer(drag.grip, drag.pointerId);
    document.removeEventListener("pointermove", this.pointerMove, true);
    document.removeEventListener("pointerup", this.pointerUp, true);
    document.removeEventListener("pointercancel", this.pointerCancel, true);
    document.removeEventListener("keydown", this.escape, true);
  }
}
