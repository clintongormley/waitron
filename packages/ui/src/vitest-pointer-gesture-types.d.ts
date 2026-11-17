export interface MouseDragOptions {
  /** Turns the mouse wheel, button still held, once the pointer reaches `selectors[after]`. */
  wheel?: { after: number; deltaY: number };
}

export interface MouseMoveOptions {
  steps?: number;
  /** Keeps the first centre's x for every later point, so the path runs straight up or down. */
  keepX?: boolean;
}

export interface TouchGesture {
  at: string;
  holdMs?: number;
  moveTo?: string;
  moveBy?: { x: number; y: number };
}
