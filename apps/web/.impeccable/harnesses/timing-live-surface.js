async page => {
  const setup = /[?&]timing=([^&#]+)/.exec(page.url())?.[1] ?? null;
  const setupMatch = /^(live|not-scanned)-(\d+)$/.exec(setup ?? "");

  if (!setupMatch) {
    throw new Error(
      `Expected timing=live-<port> or timing=not-scanned-<port>, received ${setup}`,
    );
  }

  const [, mode, port] = setupMatch;
  const chartResponse = {
    schema_version: "0.2.0",
    id: "cht_timing_harness_0001",
    user_id: "usr_timing_harness_0001",
    profile_version: 1,
    fingerprint: `sha256:${"d".repeat(64)}`,
    contract_id: "calc-contract-launch",
    contract_version: "0.2.0",
    container_digest: `sha256:${"c".repeat(64)}`,
    tzdb_version: "2026a",
    birth: {
      accuracy: "exact",
      utc_instant: null,
      timezone: null,
      place_label: null,
      latitude: null,
      longitude: null,
    },
    positions: [
      {
        body: "sun",
        longitude_deg: 54.12,
        sign: "taurus",
        house: 10,
        retrograde: false,
      },
      {
        body: "moon",
        longitude_deg: 201.4,
        sign: "libra",
        house: 3,
        retrograde: false,
      },
      {
        body: "ascendant",
        longitude_deg: 10,
        sign: "aries",
        house: 1,
        retrograde: false,
      },
    ],
    houses: {
      system_used: "placidus",
      fallback_applied: false,
      cusps_deg: [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
    },
    angles: { ascendant_deg: 10, midheaven_deg: 280 },
    aspects: [],
    uncertainty: {
      accuracy: "exact",
      window: null,
      suppressed_features: [],
      qualified_features: [],
      user_facing_summary: "Birth time is exact; houses and angles are included.",
    },
    calculated_at: "2026-07-30T15:00:00Z",
    status: "active",
  };

  const activeCycle = {
    cycle_id: "cyc_0123456789abcdef0123456789abcdef",
    technique: "transit",
    body: "saturn",
    target: "sun",
    aspect: "square",
    status: "active",
    phase: "reconsidering",
    start_at: "2026-07-19T05:22:10Z",
    exact_at: "2026-08-02T14:11:07Z",
    end_at: "2027-01-26T18:44:02Z",
    duration_days: 191.55685185185186,
    orb_deg: 3,
    passes: [
      {
        pass_index: 1,
        direction: "direct",
        exact_at: "2026-08-02T14:11:07Z",
      },
      {
        pass_index: 2,
        direction: "retrograde",
        exact_at: "2026-10-19T03:52:44Z",
      },
      {
        pass_index: 3,
        direction: "direct",
        exact_at: "2027-01-11T21:07:19Z",
      },
    ],
  };

  const upcomingCycle = {
    cycle_id: "cyc_fedcba9876543210fedcba9876543210",
    technique: "transit",
    body: "jupiter",
    target: "moon",
    aspect: "trine",
    status: "upcoming",
    phase: null,
    start_at: "2026-09-03T08:00:00Z",
    exact_at: "2026-09-12T17:30:00Z",
    end_at: "2026-09-22T02:00:00Z",
    duration_days: 18.75,
    orb_deg: 4,
    passes: [
      {
        pass_index: 1,
        direction: "direct",
        exact_at: "2026-09-12T17:30:00Z",
      },
    ],
  };

  const currentResponse = {
    schema_version: "0.3.0",
    as_of: "2026-08-10T05:15:00Z",
    calculation_status: {
      mode: "persisted_daily_reading_scan",
      state: "current",
      last_refresh_at: "2026-08-10T05:01:12Z",
      last_refresh_local_date: "2026-08-10",
    },
    applied_filters: { phase: null, duration: null },
    unreadable_cycle_count: 1,
    cycles: [activeCycle, upcomingCycle],
  };

  const notScannedResponse = {
    schema_version: "0.3.0",
    as_of: "2026-08-10T05:15:00Z",
    calculation_status: {
      mode: "persisted_daily_reading_scan",
      state: "not_scanned",
      last_refresh_at: null,
      last_refresh_local_date: null,
    },
    applied_filters: { phase: null, duration: null },
    unreadable_cycle_count: 0,
    cycles: [],
  };

  const timingResponse = mode === "live" ? currentResponse : notScannedResponse;

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.route("**/v1/chart", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartResponse),
    });
  });

  await page.route("**/v1/timing*", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(timingResponse),
    });
  });

  await page.goto(`http://127.0.0.1:${port}/#timing`);
  await page
    .getByRole("heading", {
      level: 1,
      name: "Where each cycle stands today.",
    })
    .waitFor();

  if (mode === "live") {
    await page
      .getByRole("heading", { level: 3, name: "Saturn square your Sun" })
      .waitFor();
    await page.getByText("1 stored cycle could not be read.", { exact: true }).waitFor();
  } else {
    await page
      .getByRole("heading", {
        level: 2,
        name: "No cycles have been calculated yet.",
      })
      .waitFor();
  }

  const cycleCount = await page.locator(".timing-cycle").count();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    fits: document.documentElement.scrollWidth <= window.innerWidth,
  }));

  if (!overflow.fits) {
    throw new Error(
      `Timing surface overflows horizontally: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
    );
  }

  return { mode, url: page.url(), cycleCount, overflow };
}
