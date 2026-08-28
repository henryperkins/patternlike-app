export const ACCOUNT_PROCESSING_POLICY_VERSION =
  "account-processing-v1-2026-08-28" as const;

export const ACCOUNT_PROCESSING_ALLOWED_USES = Object.freeze([
  "chart_fact",
  "cycle_detection",
  "uncertainty_model",
] as const);

export type AccountProcessingUiSurface = "onboarding" | "privacy_center";

export interface AccountProcessingPolicy {
  readonly version: string;
  readonly kind: "account_processing";
  readonly sourceId: "AST-01";
  readonly permissionTier: 0;
  readonly allowedUses: typeof ACCOUNT_PROCESSING_ALLOWED_USES;
  readonly provider: null;
  readonly scopes: readonly [];
  readonly connectorAccountId: null;
  readonly disclosure: {
    readonly text: string;
    readonly links: {
      readonly patternlike_terms: "/terms.html";
      readonly patternlike_privacy: "/privacy.html";
    };
  };
}

const launchPolicy: AccountProcessingPolicy = Object.freeze({
  version: ACCOUNT_PROCESSING_POLICY_VERSION,
  kind: "account_processing",
  sourceId: "AST-01",
  permissionTier: 0,
  allowedUses: ACCOUNT_PROCESSING_ALLOWED_USES,
  provider: null,
  scopes: Object.freeze([]) as readonly [],
  connectorAccountId: null,
  disclosure: Object.freeze({
    text:
      "Pattern/Like uses the birth date, local birth time, accuracy choice, place label, coordinates, and timezone you submit to calculate your natal chart, timing cycles, and uncertainty. The API sends those values to Pattern/Like's calculation service; it does not send them to a generative model. Pattern/Like encrypts the submitted profile and retained birth fields under your account key while retaining the calculated chart facts needed by the product. Separate permissions govern generated readings, Your Pattern, research, and model training. You may withdraw this permission at any time. Withdrawal retains the account data but stops serving it by freezing the account; regrant, export, and account deletion remain available.",
    links: Object.freeze({
      patternlike_terms: "/terms.html",
      patternlike_privacy: "/privacy.html",
    }),
  }),
});

/** Append-only registry: issued policy entries are never edited or repointed. */
export const ACCOUNT_PROCESSING_POLICIES: Readonly<Record<string, AccountProcessingPolicy>> =
  Object.freeze({
    [ACCOUNT_PROCESSING_POLICY_VERSION]: launchPolicy,
  });

export const CURRENT_ACCOUNT_PROCESSING_POLICY_VERSION =
  ACCOUNT_PROCESSING_POLICY_VERSION;

export const CURRENT_ACCOUNT_PROCESSING_POLICY =
  ACCOUNT_PROCESSING_POLICIES[CURRENT_ACCOUNT_PROCESSING_POLICY_VERSION]!;

export function accountProcessingPolicy(
  version: string,
): AccountProcessingPolicy | null {
  return (
    ACCOUNT_PROCESSING_POLICIES[version] ?? null
  );
}
