import type { ReactiveController, ReactiveControllerHost } from "lit";
/**
 * What the product editor can create without leaving itself. "modifier" is the old option group,
 * which no surface of the editor opens any more; it stays while the catalogue screen still renders
 * `dashboard-modifier-form`, which Task 13 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` removes.
 */
export type ProductChildKind = "unit" | "category" | "modifier" | "extras" | "options";
interface Effects {
  /** The row that was written. Only its `id` is read here — a kind whose row carries a plain `name`
   * (an extras or options list) has no localized name to hand over, and needs none. */
  accept(kind: ProductChildKind, value: { id: string }): void;
  refresh(kind: ProductChildKind): Promise<void>;
  loadError(error: unknown): void;
  focus(kind: ProductChildKind): void;
}

/** The composing screen owns lookups and child forms; this controller owns only the create lifecycle. */
export class ProductChildCreate implements ReactiveController {
  kind: ProductChildKind | null = null;
  busy = false;
  error: unknown = null;
  #generation = 0;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly effects: Effects,
  ) {
    host.addController(this);
  }
  hostDisconnected(): void {
    this.reset();
  }

  /** Every product switch or close invalidates requests started by the preceding editor. */
  reset(): void {
    this.#generation++;
    this.kind = null;
    this.busy = false;
    this.error = null;
    this.host.requestUpdate();
  }
  open(kind: ProductChildKind): void {
    if (this.kind !== null) return;
    this.kind = kind;
    this.error = null;
    this.host.requestUpdate();
  }
  cancel(): void {
    if (this.busy || this.kind === null) return;
    const kind = this.kind;
    this.kind = null;
    this.error = null;
    this.host.requestUpdate();
    void this.#focus(kind, this.#generation);
  }
  async #focus(kind: ProductChildKind, generation: number): Promise<void> {
    await this.host.updateComplete;
    if (generation === this.#generation && this.kind === null) this.effects.focus(kind);
  }
  async submit(write: () => Promise<{ id: string }>): Promise<void> {
    if (this.busy || this.kind === null) return;
    const generation = this.#generation;
    const kind = this.kind;
    this.busy = true;
    this.error = null;
    this.host.requestUpdate();
    let value: { id: string };
    try {
      value = await write();
    } catch (error) {
      if (generation === this.#generation) {
        this.busy = false;
        this.error = error;
        this.host.requestUpdate();
      }
      return;
    }
    if (generation !== this.#generation) return;
    this.kind = null;
    this.busy = false;
    this.host.requestUpdate();
    // The write is durable. A failed lookup refresh must not reopen a form that can create it twice.
    try {
      this.effects.accept(kind, value);
      await this.#focus(kind, generation);
      if (generation !== this.#generation) return;
      await this.effects.refresh(kind);
    } catch (error) {
      if (generation === this.#generation) this.effects.loadError(error);
    }
  }
}
