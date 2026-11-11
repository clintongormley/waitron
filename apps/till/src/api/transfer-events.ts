export async function readEventStream(
  url: string,
  fetchImpl: typeof fetch,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "GET",
    credentials: "include",
    headers: { accept: "text/event-stream" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => undefined);
    const error =
      parsed !== null && typeof parsed === "object" && "error" in parsed ? parsed.error : undefined;
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "server.internal";
    throw { code, status: response.status };
  }
  if (response.body === null) throw new TypeError("Event stream has no body");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  try {
    while (!signal?.aborted) {
      const chunk = await reader.read();
      if (chunk.done || signal?.aborted) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (!signal?.aborted) onEvent(event, data.join("\n"));
          event = "";
          data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).replace(/^ /, "");
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
