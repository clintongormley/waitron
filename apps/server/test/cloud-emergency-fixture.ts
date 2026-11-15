export const emergencyReply = (
  installationId: string,
  venueId: string,
  asOf = "2026-11-10T12:00:00.000Z",
) => ({
  version: 1,
  installationId,
  venueId,
  countryCode: "ES",
  asOf,
  emergency: {
    status: "ready",
    open: true,
    closedReason: null,
    address: "https://emergency.example.test/",
    codeIssuedAt: "2026-11-01T09:00:00.000Z",
  },
  prices: { status: "unavailable", reason: "not_published" },
});
