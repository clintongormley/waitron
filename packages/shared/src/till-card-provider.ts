/** The card provider a till pays through, named for the till: what a stored reader provider maps to. */
export type TillReaderProvider = "sumup_cloud" | "stripe_terminal";

export function tillProviderForReader(
  provider: string | undefined,
): TillReaderProvider | undefined {
  if (provider === "sumup") return "sumup_cloud";
  if (provider === "stripe") return "stripe_terminal";
  return undefined;
}
