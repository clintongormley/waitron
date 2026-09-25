import { codeOf } from "../i18n/codes.js";

/** The field a refusal belongs beside, by what the error carries (packages/catalogue/src/errors.ts):
 * `menu_section.translation_required` names a language, `menu_section.invalid` a field. */
export function fieldOf(error: unknown): string {
  const params = (error as { params?: { field?: unknown; language?: unknown } }).params;
  if (codeOf(error) === "menu_section.translation_required" && typeof params?.language === "string")
    return `names-${params.language}`;
  return typeof params?.field === "string" ? params.field : "_form";
}

/**
 * Writes to a section's member list, run one after another in the order asked, because a move
 * leaves the list's focus on the row rather than waiting for the answer. Each write names the scope
 * it belongs to: the list, or whatever else decides which moves were made against the same order.
 */
export class ListWriteQueue {
  #chain: Promise<void> = Promise.resolve();
  readonly #pending = new Map<unknown, number>();
  readonly #refusals = new Map<unknown, number>();

  run(scope: unknown, task: () => Promise<void>): void {
    this.#pending.set(scope, (this.#pending.get(scope) ?? 0) + 1);
    // A write that throws must not reject the chain, or every write queued after it is skipped.
    this.#chain = this.#chain
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        const left = this.#pending.get(scope)! - 1;
        if (left === 0) this.#pending.delete(scope);
        else this.#pending.set(scope, left);
      });
  }

  /**
   * Queues a move made against the order `scope` showed. Once a move is refused, the moves already
   * queued behind it in the same scope were made against an order the server never reached, so they
   * are dropped; a move queued after the refusal is kept. `last` is false while another write in
   * the same scope waits behind this one.
   */
  move<T>(
    scope: unknown,
    send: () => Promise<T>,
    moved: (result: T, last: boolean) => void | Promise<void>,
    refused: (error: unknown) => void | Promise<void>,
  ): void {
    const refusals = this.#refusals.get(scope) ?? 0;
    this.run(scope, async () => {
      if ((this.#refusals.get(scope) ?? 0) !== refusals) return;
      let result: T;
      try {
        result = await send();
      } catch (error) {
        this.#refusals.set(scope, refusals + 1);
        await refused(error);
        return;
      }
      await moved(result, this.#pending.get(scope) === 1);
    });
  }
}
