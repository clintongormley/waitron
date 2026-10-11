import { BUILD_HEADER } from "@waitron/shared";

export const BUILD_CHANGED_EVENT = "waitron-build-changed";

export interface BuildWatchOptions {
  /** The page's own origin. Another server's build says nothing about the code this page runs. */
  origin: string;
  onChange: (build: string) => void;
}

/**
 * The first build a response from `origin` names is the page's own; the first different one after
 * it calls `onChange`, once.
 */
export function watchBuild(
  baseFetch: typeof fetch,
  { origin, onChange }: BuildWatchOptions,
): typeof fetch {
  let own: string | undefined;
  let told = false;
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init);
    if (told || !fromOrigin(input, origin)) return response;
    // fetch follows redirects, so the answer can come from another origin than the one asked.
    if (response.url !== "" && !fromOrigin(response.url, origin)) return response;
    const build = response.headers.get(BUILD_HEADER);
    if (build === null || build === "") return response;
    if (own === undefined) own = build;
    else if (build !== own) {
      told = true;
      // A listener that throws must not turn an answered request into a failed one.
      queueMicrotask(() => onChange(build));
    }
    return response;
  }) as typeof fetch;
}

function fromOrigin(input: RequestInfo | URL, origin: string): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}
