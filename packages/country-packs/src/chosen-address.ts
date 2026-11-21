import {
  findAdministrativeArea,
  type AdministrativeArea,
  type CountryPack,
  type ResolvedAddress,
} from "@waitron/country";
import { provinceOfPostalCode } from "./registered-address.js";

/** The area an address chosen from the search lies in: the one its area code names, else the one
 *  its postcode names. */
export function areaOfChosenAddress(
  pack: CountryPack,
  address: ResolvedAddress,
): AdministrativeArea | undefined {
  return (
    (address.administrativeAreaCode === undefined
      ? undefined
      : findAdministrativeArea(pack, address.administrativeAreaCode)) ??
    provinceOfPostalCode(pack, address.postalCode)
  );
}
