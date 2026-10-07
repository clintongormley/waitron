import { html, type ReactiveController, type ReactiveControllerHost } from "lit";
import {
  createLeaveCoordinator,
  trackDraft,
  type DraftOwner,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveDecision,
} from "@waitron/ui-core/unsaved-changes";
import "./components/wt-unsaved-changes.js";

export interface LeaveCopy {
  heading: string;
  message: string;
  keepLabel: string;
  discardLabel: string;
}

interface CoordinatorRequest {
  accept(coordinator: LeaveCoordinator): void;
}
interface Question {
  finish(decision: LeaveDecision): void;
}

export class LeaveController implements ReactiveController {
  private current?: LeaveCoordinator;
  private question?: Question;

  constructor(private readonly host: ReactiveControllerHost & HTMLElement) {
    host.addController(this);
  }

  get coordinator(): LeaveCoordinator {
    if (!this.current) throw new Error("Leave coordinator requires a connected application");
    return this.current;
  }

  hostConnected(): void {
    this.current = createLeaveCoordinator(
      (_request, signal) =>
        new Promise<LeaveDecision>((resolve) => {
          const finish = (decision: LeaveDecision) => {
            signal.removeEventListener("abort", abort);
            if (this.question !== question) return;
            this.question = undefined;
            this.host.requestUpdate();
            resolve(decision);
          };
          const abort = () => finish("keep");
          const question = { finish };
          this.question = question;
          signal.addEventListener("abort", abort, { once: true });
          this.host.requestUpdate();
        }),
      this.host.ownerDocument.defaultView!,
    );
    this.host.addEventListener("wt-leave-coordinator", this.onRequest);
    this.host.requestUpdate();
  }

  forceReset(): void {
    this.current?.forceReset();
  }

  hostDisconnected(): void {
    this.host.removeEventListener("wt-leave-coordinator", this.onRequest);
    this.current?.dispose();
    this.current = undefined;
  }

  private readonly onRequest = (event: Event): void => {
    event.stopPropagation();
    (event as CustomEvent<CoordinatorRequest>).detail.accept(this.coordinator);
  };

  render(copy: LeaveCopy) {
    const question = this.question;
    const choose = (event: CustomEvent<{ decision: LeaveDecision }>): void => {
      event.stopPropagation();
      if (question === this.question) question?.finish(event.detail.decision);
    };
    return html`<wt-unsaved-changes
      .open=${this.question !== undefined}
      .heading=${copy.heading}
      .message=${copy.message}
      .keepLabel=${copy.keepLabel}
      .discardLabel=${copy.discardLabel}
      @wt-unsaved-choice=${choose}
    ></wt-unsaved-changes>`;
  }
}

/** The nearest application owns the registry, including forms contributed through shadow roots. */
export function leaveCoordinatorFor(host: HTMLElement): LeaveCoordinator | undefined {
  let coordinator: LeaveCoordinator | undefined;
  host.dispatchEvent(
    new CustomEvent<CoordinatorRequest>("wt-leave-coordinator", {
      detail: {
        accept: (value) => {
          coordinator = value;
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  return coordinator;
}

/**
 * The coordinator comes back beside the scope because a form's leave paths still ask "is there an
 * application?" — with none, the scope only tracks whether the draft changed.
 */
export function draftScopeFor<T>(
  host: HTMLElement,
  owner: DraftOwner<T>,
): { coordinator: LeaveCoordinator | undefined; scope: DraftScope<T> } {
  const coordinator = leaveCoordinatorFor(host);
  const scope = coordinator ? coordinator.register(owner) : trackDraft(owner);
  // A baseline is not a reactive property, so a form left open after a save would keep Save loud.
  const redraw = () => (host as Partial<ReactiveControllerHost>).requestUpdate?.();
  return {
    coordinator,
    scope: {
      id: scope.id,
      changed: () => scope.changed(),
      isDirty: () => scope.isDirty(),
      commit(submitted) {
        scope.commit(submitted);
        redraw();
      },
      dispose() {
        scope.dispose();
        redraw();
      },
    },
  };
}

export function saveActionState(
  scope: Pick<DraftScope<unknown>, "isDirty"> | undefined,
  options?: { savableAtOpen?: boolean },
): { variant: "primary" | "secondary"; unchanged: boolean } {
  const unchanged = !(options?.savableAtOpen || scope?.isDirty());
  return { variant: unchanged ? "secondary" : "primary", unchanged };
}
