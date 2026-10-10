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
