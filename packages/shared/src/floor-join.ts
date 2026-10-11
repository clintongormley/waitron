/** Where a table joining another goes. Places are whole grid squares; `x`, `y` is the unturned top-left corner. */
export type JoinSide = "left" | "right" | "top" | "bottom";

export interface JoinPlace {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export const JOIN_SIDES: readonly JoinSide[] = ["left", "right", "top", "bottom"];

/** A new table's width and height, in grid squares. */
export const NEW_TABLE_SIZE = 8;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The side of `target` nearest `moving`'s centre, in the target's turned frame: each axis's offset
 * is weighed by both tables' sizes along it, a tie goes left–right, and coinciding centres give
 * `right`.
 */
export function joinSide(target: JoinPlace, moving: JoinPlace): JoinSide {
  const dx = moving.x + moving.width / 2 - (target.x + target.width / 2);
  const dy = moving.y + moving.height / 2 - (target.y + target.height / 2);
  const turn = radians(target.rotation);
  const across = dx * Math.cos(turn) + dy * Math.sin(turn);
  const down = dy * Math.cos(turn) - dx * Math.sin(turn);
  if (
    Math.abs(across) / (target.width + moving.width) >=
    Math.abs(down) / (target.height + moving.height)
  ) {
    return across < 0 ? "left" : "right";
  }
  return down < 0 ? "top" : "bottom";
}

/** The step that keeps `low + step` and `high + step` within 0–999: a group moved as one. */
export function heldStep(step: number, low: number, high: number): number {
  return Math.min(Math.max(step, -low), 999 - high);
}

/** The step every member of a group takes so that each one's `x`, `y` corner stays within 0–999. */
export function groupStep(
  members: readonly { x: number; y: number }[],
  step: { x: number; y: number },
): { dx: number; dy: number } {
  const xs = members.map((m) => m.x);
  const ys = members.map((m) => m.y);
  return {
    dx: heldStep(step.x, Math.min(...xs), Math.max(...xs)),
    dy: heldStep(step.y, Math.min(...ys), Math.max(...ys)),
  };
}

const held = (value: number): number => Math.min(Math.max(Math.round(value), 0), 999);

/**
 * Where `moving` sits so that, in the target's turned frame, the two share the edge on `side` with
 * their centres lined up across it. It takes the target's rotation; its corner is rounded to whole
 * squares and held to 0–999.
 */
export function touchingPlace(
  target: JoinPlace,
  moving: Pick<JoinPlace, "width" | "height">,
  side: JoinSide,
): { x: number; y: number; rotation: number } {
  const reachX = (target.width + moving.width) / 2;
  const reachY = (target.height + moving.height) / 2;
  const across = side === "right" ? reachX : side === "left" ? -reachX : 0;
  const down = side === "bottom" ? reachY : side === "top" ? -reachY : 0;
  const turn = radians(target.rotation);
  const centreX = target.x + target.width / 2 + across * Math.cos(turn) - down * Math.sin(turn);
  const centreY = target.y + target.height / 2 + across * Math.sin(turn) + down * Math.cos(turn);
  return {
    x: held(centreX - moving.width / 2),
    y: held(centreY - moving.height / 2),
    rotation: target.rotation,
  };
}

const SIDE_ORDER: Record<JoinSide, readonly JoinSide[]> = {
  left: ["left", "top", "bottom", "right"],
  right: ["right", "top", "bottom", "left"],
  top: ["top", "left", "right", "bottom"],
  bottom: ["bottom", "left", "right", "top"],
};

type Span = readonly [number, number];

/** The box's least and greatest reach along each axis of a frame turned by `turn` radians. */
function spans(box: JoinPlace, turn: number): { across: Span; down: Span } {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const tilt = radians(box.rotation) - turn;
  const halfAcross =
    Math.abs((box.width / 2) * Math.cos(tilt)) + Math.abs((box.height / 2) * Math.sin(tilt));
  const halfDown =
    Math.abs((box.width / 2) * Math.sin(tilt)) + Math.abs((box.height / 2) * Math.cos(tilt));
  const across = centreX * Math.cos(turn) + centreY * Math.sin(turn);
  const down = centreY * Math.cos(turn) - centreX * Math.sin(turn);
  return {
    across: [across - halfAcross, across + halfAcross],
    down: [down - halfDown, down + halfDown],
  };
}

const depth = (a: Span, b: Span): number => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/**
 * The side `moving` joins `target` on: the first in `SIDE_ORDER[preferred]` whose `touchingPlace`
 * covers none of `members` (the target's merge, the target included) by a square or more both
 * ways. The order depends on `preferred` alone, so a server that never saw the drop picks as the
 * till does. Boxes are compared by their extents in the target's turned frame, so a member turned
 * another way counts by its corners. When every side is covered it keeps `preferred`.
 */
export function freeSide(
  target: JoinPlace,
  moving: Pick<JoinPlace, "width" | "height">,
  members: readonly JoinPlace[],
  preferred: JoinSide,
): JoinSide {
  const turn = radians(target.rotation);
  const others = members.map((member) => spans(member, turn));
  const free = SIDE_ORDER[preferred].find((side) => {
    const box = spans({ ...moving, ...touchingPlace(target, moving, side) }, turn);
    return others.every(
      (other) => depth(box.across, other.across) < 1 || depth(box.down, other.down) < 1,
    );
  });
  return free ?? preferred;
}
