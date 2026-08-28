import providerBoundaryPolicy from "../../../../contracts/policies/pattern-provider-boundary-v1.json";

/**
 * Closed, reviewed vocabulary of private or internal opaque identifier prefixes.
 *
 * This set covers identifiers minted by API persistence, calculation, Pattern,
 * reading, and ontology control-plane code. Ontology-native public record/source
 * ids (`ont_` and `srcf_`) and provider-visible Pattern aliases (`clu_`, `f001`,
 * chapter/signature keys) are deliberately absent.
 *
 * Most prefixes are impossible in legitimate provider vocabulary and therefore
 * fail closed on any substring. The two colliding prefixes use their exact
 * production shape: `part_of_fortune` and `pre_1970_zone_boundary` are public
 * vocabulary, while `part_<32hex>` and `pre_<32hex>` are opaque internal ids.
 */
type PrivateOpaqueIdRule = {
  readonly prefix: string;
  readonly match: "substring" | "hex32";
};

export const PRIVATE_OPAQUE_ID_RULES =
  providerBoundaryPolicy.opaque_id_rules as readonly PrivateOpaqueIdRule[];

export type PrivateOpaqueIdPrefix = string;

/** Substring matching catches identifiers embedded inside provider-visible prose. */
export function findPrivateOpaqueIdPrefix(
  value: string,
): PrivateOpaqueIdPrefix | null {
  for (const rule of PRIVATE_OPAQUE_ID_RULES) {
    if (rule.match === "substring" && value.includes(rule.prefix)) {
      return rule.prefix;
    }
    if (
      rule.match === "hex32" &&
      new RegExp(`${rule.prefix}[0-9a-f]{32}`, "i").test(value)
    ) {
      return rule.prefix;
    }
  }
  return null;
}
