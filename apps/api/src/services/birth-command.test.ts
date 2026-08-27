import type { BirthProfileRequest } from "@patternlike/shared";
import { describe, expect, it } from "vitest";

import {
  birthCalcCommandMatchesRequest,
  buildBirthCalcCommand,
  decodeBirthProfilePayload,
  projectBirthPayloadForExport,
} from "./birth-command.js";

const request: BirthProfileRequest = {
  accuracy: "approximate",
  consent_id: "cns_birth_command_0001",
  birth_date: "1990-05-15",
  birth_time_local: "12:34:00",
  approximate_window_minutes: 30,
  timezone_hint: " America/Los_Angeles ",
  birthplace: {
    place_id: "plc_los_angeles_0001",
    label: "Los Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
  },
};

const resolution = {
  timezone: "America/Los_Angeles",
  confidence: "medium" as const,
  qualifiers: [
    {
      code: "near_zone_boundary" as const,
      message: "Confirm the timezone against a birth record.",
    },
  ],
};

describe("birth calculation command", () => {
  it("freezes normalized submitted fields separately from effective calculation input", () => {
    expect(buildBirthCalcCommand(request, resolution)).toEqual({
      schema_version: "birth-calc-command/v1",
      submitted: {
        accuracy: "approximate",
        consent_id: "cns_birth_command_0001",
        birth_date: "1990-05-15",
        birth_time_local: "12:34:00",
        approximate_window_minutes: 30,
        timezone_hint: "America/Los_Angeles",
        birthplace: {
          place_id: "plc_los_angeles_0001",
          label: "Los Angeles",
          latitude: 34.0522,
          longitude: -118.2437,
        },
      },
      effective: {
        accuracy: "approximate",
        birth_date: "1990-05-15",
        birth_time_local: "12:34:00",
        approximate_window_minutes: 30,
        timezone: "America/Los_Angeles",
        birthplace: {
          place_id: "plc_los_angeles_0001",
          label: "Los Angeles",
          latitude: 34.0522,
          longitude: -118.2437,
        },
        location_confidence: "medium",
        location_qualifier_codes: ["near_zone_boundary"],
      },
    });
  });

  it("normalizes every omitted nullable submitted field", () => {
    const command = buildBirthCalcCommand(
      {
        accuracy: "unknown",
        consent_id: "cns_birth_command_unknown",
      },
      { timezone: "UTC", confidence: "none", qualifiers: [] },
    );

    expect(command.submitted).toEqual({
      accuracy: "unknown",
      consent_id: "cns_birth_command_unknown",
      birth_date: null,
      birth_time_local: null,
      approximate_window_minutes: null,
      timezone_hint: null,
      birthplace: null,
    });
    expect(command.effective.birthplace).toEqual({
      place_id: null,
      label: null,
      latitude: null,
      longitude: null,
    });
  });

  it("compares every normalized submitted field on a failed retry", () => {
    const command = buildBirthCalcCommand(request, resolution);
    expect(
      birthCalcCommandMatchesRequest(command, {
        ...request,
        timezone_hint: "America/Los_Angeles",
      }),
    ).toBe(true);

    const changed: BirthProfileRequest[] = [
      { ...request, accuracy: "exact" },
      { ...request, consent_id: "cns_birth_command_changed" },
      { ...request, birth_date: "1991-05-15" },
      { ...request, birth_time_local: "12:35:00" },
      { ...request, approximate_window_minutes: 60 },
      { ...request, timezone_hint: "America/New_York" },
      {
        ...request,
        birthplace: { ...request.birthplace, place_id: "plc_changed" },
      },
      {
        ...request,
        birthplace: { ...request.birthplace, label: "Pasadena" },
      },
      {
        ...request,
        birthplace: { ...request.birthplace, latitude: 34.15 },
      },
      {
        ...request,
        birthplace: { ...request.birthplace, longitude: -118.15 },
      },
    ];
    for (const candidate of changed) {
      expect(birthCalcCommandMatchesRequest(command, candidate)).toBe(false);
    }
  });
});

describe("birth profile payload decoding and export projection", () => {
  const command = buildBirthCalcCommand(request, resolution);
  const legacy = {
    birth_date: "1990-05-15",
    birth_time_local: "12:34:00",
    birthplace: {
      place_id: "plc_los_angeles_0001",
      label: "Los Angeles",
      latitude: 34.0522,
      longitude: -118.2437,
    },
    approximate_window_minutes: 30,
    consent_id: "cns_birth_command_0001",
  };

  it("distinguishes valid v1 commands from exportable legacy payloads", () => {
    expect(decodeBirthProfilePayload(command)).toEqual({ kind: "v1", command });
    expect(decodeBirthProfilePayload(legacy)).toEqual({
      kind: "legacy",
      birth: legacy,
    });
  });

  it("allows resolved effective location and timezone fields to differ from submitted input", () => {
    const resolved = {
      ...command,
      effective: {
        ...command.effective,
        timezone: "America/New_York",
        birthplace: {
          place_id: "plc_los_angeles_0001",
          label: "Los Angeles, California",
          latitude: 34.05223,
          longitude: -118.24368,
        },
        location_confidence: "high" as const,
        location_qualifier_codes: ["approximate_match" as const],
      },
    };

    expect(decodeBirthProfilePayload(resolved)).toEqual({
      kind: "v1",
      command: resolved,
    });
    expect(birthCalcCommandMatchesRequest(resolved, request)).toBe(true);
  });

  it("rejects every hidden non-location mismatch in a claimed-v1 command", () => {
    const mismatches: Array<
      Partial<typeof command.effective>
    > = [
      { accuracy: "exact" },
      { birth_date: "1991-05-15" },
      { birth_time_local: "12:35:00" },
      { approximate_window_minutes: 60 },
    ];

    for (const effectiveChange of mismatches) {
      expect(
        decodeBirthProfilePayload({
          ...command,
          effective: {
            ...command.effective,
            ...effectiveChange,
          },
        }),
      ).toEqual({ kind: "malformed_v1" });
    }
  });

  it("distinguishes unknown versions from malformed documents claiming v1", () => {
    expect(
      decodeBirthProfilePayload({
        ...command,
        schema_version: "birth-calc-command/v2",
      }),
    ).toEqual({
      kind: "unknown_version",
      schemaVersion: "birth-calc-command/v2",
    });
    expect(
      decodeBirthProfilePayload({
        ...command,
        effective: {
          ...command.effective,
          timezone: null,
        },
      }),
    ).toEqual({ kind: "malformed_v1" });
  });

  it("projects only submitted fields from v1 and preserves the legacy shape", () => {
    const projected = projectBirthPayloadForExport(command);
    expect(projected).toEqual(command.submitted);
    expect(projected).not.toHaveProperty("schema_version");
    expect(projected).not.toHaveProperty("submitted");
    expect(projected).not.toHaveProperty("effective");
    expect(projectBirthPayloadForExport(legacy)).toEqual(legacy);
  });

  it("refuses unknown and corrupt claimed-v1 payloads instead of exporting internals", () => {
    expect(() =>
      projectBirthPayloadForExport({
        ...command,
        schema_version: "birth-calc-command/v2",
      })
    ).toThrow(/birth profile payload/i);
    expect(() =>
      projectBirthPayloadForExport({
        ...command,
        effective: {
          ...command.effective,
          timezone: null,
        },
      })
    ).toThrow(/birth profile payload/i);
  });
});
