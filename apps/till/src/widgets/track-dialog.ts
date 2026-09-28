import { nothing } from "lit";
import { AsyncDirective, directive, type ElementPart } from "lit/async-directive.js";

type Dialog = Element & { open: boolean };

/** Every dialog element drawn with {@link trackDialog} and still in the page. */
const drawn = new Set<Dialog>();

class TrackDialog extends AsyncDirective {
  #dialog?: Dialog;

  render(): typeof nothing {
    return nothing;
  }

  override update(part: ElementPart): typeof nothing {
    this.#dialog = part.element as Dialog;
    if (this.isConnected) drawn.add(this.#dialog);
    return this.render();
  }

  protected override disconnected(): void {
    drawn.delete(this.#dialog!);
  }

  protected override reconnected(): void {
    drawn.add(this.#dialog!);
  }
}

/** Goes on every `wt-dialog`, `wt-modal` or `dialog` the till draws, so {@link dialogOpenUnder} can
 * find it without searching the page. */
export const trackDialog = directive(TrackDialog);

function within(node: Node, root: Node): boolean {
  for (
    let at: Node | null = node;
    at !== null;
    at = at instanceof ShadowRoot ? at.host : at.parentNode
  )
    if (at === root) return true;
  return false;
}

/** Whether a dialog drawn with {@link trackDialog} under `root`, through any shadow roots, is open. */
export function dialogOpenUnder(root: Node): boolean {
  for (const dialog of drawn) if (dialog.open && within(dialog, root)) return true;
  return false;
}
