import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import {
  ACCOUNT_PROCESSING_CONSENT_PATH,
  accountProcessingGranted,
  accountProcessingNotGranted,
  accountProcessingRevokedFreeze,
  accountProcessingUnexplainedFreeze,
} from "../test/account-processing-fixture.js";
import { AccountAccessRecovery } from "./AccountAccessRecovery.js";

describe("account access recovery", () => {
  it("regrants a proven consent freeze and keeps account controls available", async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    const onSignOut = vi.fn();
    const restored = {
      ...accountProcessingGranted,
      account_status: "active",
      regrant_will_restore_access: false,
      ui_surface: "privacy_center",
    };
    mockApiResponses({
      [`PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: restored,
      },
    });

    render(
      <AccountAccessRecovery
        consent={accountProcessingRevokedFreeze}
        onRestored={onRestored}
        onSignOut={onSignOut}
        onDeletionAccepted={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /account is frozen/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/regrant.*restore access/i)).toBeInTheDocument();
    expect(screen.getByText(accountProcessingRevokedFreeze.disclosure.text))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Restore access/i }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());
    const regrant = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)[0]!;
    expect(regrant.method).toBe("PUT");
    expect(regrant.body).toEqual({
      policy_version: accountProcessingRevokedFreeze.policy_version,
    });
    expect(regrant.headers.get("x-consent-ui-surface")).toBe("privacy_center");
    expect(regrant.headers.get("idempotency-key")).toMatch(
      /^web-account-processing-/,
    );

    await user.click(screen.getByRole("button", { name: /Sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("uses a fresh key after a valid replay still reports not granted", async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    let grants = 0;
    const restored = {
      ...accountProcessingGranted,
      account_status: "active" as const,
      regrant_will_restore_access: false as const,
      ui_surface: "privacy_center" as const,
    };
    const responses: Parameters<typeof mockApiResponses>[0] = {};
    Object.defineProperty(responses, `PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`, {
      enumerable: true,
      get: () => ({
        status: 200,
        body: grants++ === 0 ? accountProcessingRevokedFreeze : restored,
      }),
    });
    mockApiResponses(responses);

    render(
      <AccountAccessRecovery
        consent={accountProcessingRevokedFreeze}
        onRestored={onRestored}
        onSignOut={vi.fn()}
        onDeletionAccepted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Restore access/i }));
    expect(await screen.findByRole("status", { name: /Account recovery status/i }))
      .toHaveTextContent(/not active yet/i);
    await user.click(screen.getByRole("button", { name: /Restore access/i }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledOnce());

    const keys = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("does not claim regrant can clear an unexplained freeze", () => {
    mockApiResponses({});
    render(
      <AccountAccessRecovery
        consent={accountProcessingUnexplainedFreeze}
        onRestored={vi.fn()}
        onSignOut={vi.fn()}
        onDeletionAccepted={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /access is paused/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot confirm that regranting will clear/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore access/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
  });

  it("offers current-policy reconfirmation for an active account", () => {
    mockApiResponses({});
    render(
      <AccountAccessRecovery
        consent={accountProcessingNotGranted}
        onRestored={vi.fn()}
        onSignOut={vi.fn()}
        onDeletionAccepted={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /Review calculation permission/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Grant permission and continue/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/account is frozen/i)).not.toBeInTheDocument();
  });
});
