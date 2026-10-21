export interface VenueThemeAnswer {
  readonly hash: string;
  readonly css: string;
  readonly logo: unknown;
}

export function isVenueThemeAnswer(value: unknown): value is VenueThemeAnswer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.hash === "string" && typeof answer.css === "string" && "logo" in answer;
}
