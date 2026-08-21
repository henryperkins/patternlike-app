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
export const PRIVATE_OPAQUE_ID_RULES = [
  { prefix: "acc_", match: "substring" },
  { prefix: "asp_", match: "substring" },
  { prefix: "asm_", match: "substring" },
  { prefix: "aud_", match: "substring" },
  { prefix: "cht_", match: "substring" },
  { prefix: "clm_", match: "substring" },
  { prefix: "cns_", match: "substring" },
  { prefix: "cs_", match: "substring" },
  { prefix: "csr_", match: "substring" },
  { prefix: "ctx_", match: "substring" },
  { prefix: "cyc_", match: "substring" },
  { prefix: "cyp_", match: "substring" },
  { prefix: "del_", match: "substring" },
  { prefix: "dsf_", match: "substring" },
  { prefix: "evt_", match: "substring" },
  { prefix: "exp_", match: "substring" },
  { prefix: "pgen_", match: "substring" },
  { prefix: "gen_", match: "substring" },
  { prefix: "gin_sha256_", match: "substring" },
  { prefix: "idn_", match: "substring" },
  { prefix: "job_", match: "substring" },
  { prefix: "nat_", match: "substring" },
  { prefix: "nfs_", match: "substring" },
  { prefix: "nft_", match: "substring" },
  { prefix: "opart_", match: "substring" },
  { prefix: "oprun_", match: "substring" },
  { prefix: "paae_", match: "substring" },
  { prefix: "par_", match: "substring" },
  { prefix: "part_", match: "hex32" },
  { prefix: "pat_", match: "substring" },
  { prefix: "pgc_", match: "substring" },
  { prefix: "poer_", match: "substring" },
  { prefix: "pre_", match: "hex32" },
  { prefix: "prel_", match: "substring" },
  { prefix: "rdg_", match: "substring" },
  { prefix: "req_", match: "substring" },
  { prefix: "rfb_", match: "substring" },
  { prefix: "rsc_", match: "substring" },
  { prefix: "ses_", match: "substring" },
  { prefix: "sgn_", match: "substring" },
  { prefix: "sig_", match: "substring" },
  { prefix: "trc_", match: "substring" },
  { prefix: "tts_", match: "substring" },
  { prefix: "tzc_", match: "substring" },
  { prefix: "usr_", match: "substring" },
] as const;

export type PrivateOpaqueIdPrefix =
  (typeof PRIVATE_OPAQUE_ID_RULES)[number]["prefix"];

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
