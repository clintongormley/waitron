import { expect, it } from "vitest";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { venueDetailPatch, venueDetailProblems } from "./venue-details-form.js";

it("submits a normalized name correction without turning untouched legacy nulls into required changes", () => {
  const saved = venueDetailsFixture({
    addressLine1: null,
    postalCode: null,
    city: null,
    province: null,
  }).details;
  const patch = venueDetailPatch(saved, {
    ...saved,
    name: "  Cafe\u0301  ",
    addressLine1: "",
    postalCode: "",
    city: "",
    province: "",
  });
  expect(patch).toEqual({ name: "Café" });
  expect(venueDetailProblems(patch)).toEqual({});
});

it("removes a reverted legacy-null field from the patch but refuses to clear a stored city", () => {
  const saved = venueDetailsFixture({ city: null }).details;
  expect(venueDetailPatch(saved, { ...saved, city: "Toledo" })).toEqual({ city: "Toledo" });
  expect(venueDetailPatch(saved, { ...saved, city: "" })).toEqual({});
  const withCity = venueDetailsFixture().details;
  expect(venueDetailProblems(venueDetailPatch(withCity, { ...withCity, city: " " }))).toEqual({
    city: "required",
  });
});

it("clears the optional second address line with null", () => {
  const saved = venueDetailsFixture({ addressLine2: "Upstairs" }).details;
  expect(venueDetailPatch(saved, { ...saved, addressLine2: "  " })).toEqual({ addressLine2: null });
  expect(venueDetailProblems({ addressLine2: null })).toEqual({});
});

it("leaves normalized zone aliases, cutover spellings and unchanged legacy invalid values out", () => {
  const saved = venueDetailsFixture({ timeZone: "US/Eastern", dayCutover: "06:00:00" }).details;
  expect(
    venueDetailPatch(saved, { ...saved, timeZone: "America/New_York", dayCutover: "06:00" }),
  ).toEqual({});
  const legacy = venueDetailsFixture({ timeZone: "legacy-invalid" }).details;
  expect(venueDetailPatch(legacy, { ...legacy, name: "Changed" })).toEqual({ name: "Changed" });
});

it("keeps proposed clock and city fields relative to the opening snapshot", () => {
  const saved = venueDetailsFixture().details;
  const proposal = { ...saved, timeZone: "UTC", city: "Toledo" };
  expect(venueDetailPatch(saved, proposal)).toEqual({ timeZone: "UTC", city: "Toledo" });
});

it("marks every invalid changed required field", () => {
  expect(
    venueDetailProblems({
      name: "",
      addressLine1: "",
      city: "",
      postalCode: "",
      province: "",
      timeZone: "",
      dayCutover: "",
    }),
  ).toEqual({
    name: "required",
    addressLine1: "required",
    city: "required",
    postalCode: "required",
    province: "required",
    timeZone: "required",
    dayCutover: "required",
  });
});

it.each(["name", "addressLine1", "addressLine2", "city"] as const)(
  "counts Unicode code points for changed %s",
  (field) => {
    expect(venueDetailProblems({ [field]: "😀".repeat(200) })).toEqual({});
    expect(venueDetailProblems({ [field]: "😀".repeat(201) })).toEqual({ [field]: "length" });
  },
);

it.each(["bad/zone", "+02:00", "-0500"])("refuses %s as a changed named zone", (timeZone) => {
  expect(venueDetailProblems({ timeZone })).toEqual({ timeZone: "time_zone" });
});

it.each(["04:00garbage", "25:00", "04:00:01"])("refuses the changed cutover %s", (dayCutover) => {
  expect(venueDetailProblems({ dayCutover })).toEqual({ dayCutover: "cutover" });
});

it("normalizes a valid changed zone and HH:MM:00 cutover", () => {
  const saved = venueDetailsFixture().details;
  const patch = venueDetailPatch(saved, {
    ...saved,
    timeZone: "  US/Eastern ",
    dayCutover: " 04:30:00 ",
  });
  expect(patch).toEqual({ timeZone: "America/New_York", dayCutover: "04:30" });
  expect(venueDetailProblems(patch)).toEqual({});
});
