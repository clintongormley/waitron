const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

export function subscribePageLanguage(listener: () => void): () => void {
  if (observer === undefined) {
    observer = new MutationObserver(() => {
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer!.disconnect();
      observer = undefined;
    }
  };
}
