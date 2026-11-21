import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  type AdministrativeArea,
  type CountryPack,
  type ResolvedAddress,
} from "@waitron/country";
import { joinRegisteredAddress } from "./registered-address.js";

/** The area an address chosen from the search lies in: the one its area code names, else the one
 *  its postcode names. */
export function areaOfChosenAddress(
  pack: CountryPack,
  address: ResolvedAddress,
): AdministrativeArea | undefined {
  const postal = pack.postalCode?.validate(address.postalCode);
  return (
    (address.administrativeAreaCode === undefined
      ? undefined
      : findAdministrativeArea(pack, address.administrativeAreaCode)) ??
    (postal?.valid === true
      ? findAdministrativeAreaByPostalCode(pack, postal.normalized)
      : undefined)
  );
}

/** A chosen address as a registered business address is written: "lines, postcode city, province". */
export function oneLineAddress(pack: CountryPack, address: ResolvedAddress): string {
  const [street = "", ...more] = address.lines;
  return joinRegisteredAddress({
    street,
    line2: more.filter((line) => line.trim() !== "").join(", "),
    postalCode: address.postalCode,
    city: address.locality,
    province: areaOfChosenAddress(pack, address)?.name ?? "",
  });
}
