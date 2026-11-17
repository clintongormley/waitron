export const PHONE_WIDTH = 560;
const SWIPE_PX = 48;

export class DaySwipe {
  #from: { id: number; x: number; y: number } | undefined;
  #contacts = new Set<number>();

  constructor(private readonly step: (by: -1 | 1) => void) {}

  start(event: PointerEvent): void {
    if (event.pointerType === "mouse") return;
    if (this.#contacts.size === 0) {
      // Heard on the window, so a contact lifted outside the day still ends.
      window.addEventListener("pointerup", this.#end);
      window.addEventListener("pointercancel", this.#end);
      this.#from = { id: event.pointerId, x: event.clientX, y: event.clientY };
    } else {
      // A second contact ends the swipe; none starts until every contact has ended.
      this.#from = undefined;
    }
    this.#contacts.add(event.pointerId);
  }

  #end = (event: PointerEvent): void => {
    if (!this.#contacts.delete(event.pointerId)) return;
    const from = this.#from;
    if (this.#contacts.size === 0) this.stop();
    if (event.type !== "pointerup" || from?.id !== event.pointerId) return;
    const across = event.clientX - from.x;
    const down = event.clientY - from.y;
    if (Math.abs(across) < SWIPE_PX || Math.abs(across) <= 2 * Math.abs(down)) return;
    this.step(across < 0 ? 1 : -1);
  };

  stop(): void {
    this.#from = undefined;
    this.#contacts.clear();
    window.removeEventListener("pointerup", this.#end);
    window.removeEventListener("pointercancel", this.#end);
  }
}
