import { nothing, type Part } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import { MEDIA_FILENAME } from "@waitron/shared";

type Shape = "source" | "square" | "till" | "display";
type Presentation = Record<Shape, string> & { id: string; revision: number };
type Entry = { value?: Presentation; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
let timer: ReturnType<typeof setInterval> | undefined;
let scheduled = false;
let generation = 0;
let controller: AbortController | undefined;

function visible() {
  return document.visibilityState === "visible";
}
function stopTimer() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}
function schedule() {
  if (scheduled || !entries.size || !visible()) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (entries.size && visible()) void refresh();
  });
}
function visibilityChanged() {
  stopTimer();
  if (visible()) {
    startTimer();
    schedule();
  } else {
    generation++;
    controller?.abort();
  }
}
function startTimer() {
  if (timer === undefined && visible()) timer = setInterval(schedule, 15_000);
}
function subscribe(reference: string, listener: () => void) {
  if (!entries.size) {
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", schedule);
    startTimer();
  }
  let entry = entries.get(reference);
  if (!entry) {
    entry = { listeners: new Set() };
    entries.set(reference, entry);
  }
  entry.listeners.add(listener);
  schedule();
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) entries.delete(reference);
    if (!entries.size) {
      generation++;
      controller?.abort();
      stopTimer();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("online", schedule);
    }
  };
}
function presentation(value: unknown): value is Presentation {
  if (typeof value !== "object" || !value || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    Number.isSafeInteger(item.revision) &&
    (item.revision as number) >= 0 &&
    ["source", "square", "till", "display"].every(
      (shape) =>
        typeof item[shape] === "string" &&
        (item[shape] as string).startsWith("/media/") &&
        !(item[shape] as string).includes("\\"),
    )
  );
}
async function refresh(): Promise<void> {
  const version = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const references = [...entries.keys()];
  const requests: Promise<void>[] = [];
  for (let offset = 0; offset < references.length; offset += 100) {
    const chunk = references.slice(offset, offset + 100);
    requests.push(
      (async () => {
        try {
          const query = new URLSearchParams({ references: chunk.join(",") });
          const response = await fetch(`/media/presentations?${query}`, {
            credentials: "same-origin",
            cache: "no-store",
            signal,
          });
          if (!response.ok) return;
          const body: unknown = await response.json();
          if (
            version !== generation ||
            !visible() ||
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
          )
            return;
          const images: unknown = (body as Record<string, unknown>).images;
          if (!images || typeof images !== "object" || Array.isArray(images)) return;
          for (const ref of chunk) {
            const entry = entries.get(ref);
            if (!entry) continue;
            const value: unknown = (images as Record<string, unknown>)[ref];
            if (value !== undefined && !presentation(value)) continue;
            entry.value = value;
            for (const listener of entry.listeners) listener();
          }
        } catch {
          /* Retain the last successful presentation until a later refresh. */
        }
      })(),
    );
  }
  await Promise.all(requests);
}

export function invalidateMediaImages(): void {
  schedule();
}

class LiveMediaImage extends AsyncDirective {
  private reference: string | undefined;
  private shape: Shape = "square";
  private unsubscribe?: () => void;
  override render(reference: string | null | undefined, shape: Shape) {
    return reference ? (entries.get(reference)?.value?.[shape] ?? nothing) : nothing;
  }
  override update(_part: Part, [reference, shape]: [string | null | undefined, Shape]) {
    this.shape = shape;
    const valid = reference && MEDIA_FILENAME.test(reference) ? reference : undefined;
    if (valid !== this.reference) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.reference = valid;
      this.connect();
    }
    return this.render(this.reference, shape);
  }
  private connect() {
    if (this.isConnected && this.reference && !this.unsubscribe)
      this.unsubscribe = subscribe(this.reference, () =>
        this.setValue(this.render(this.reference, this.shape)),
      );
  }
  override disconnected() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
  override reconnected() {
    this.connect();
  }
}
export const liveMediaImage = directive(LiveMediaImage);
