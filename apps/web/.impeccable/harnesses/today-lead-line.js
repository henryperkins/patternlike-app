async page => {
  const setup = /[?&]today=([^&#]+)/.exec(page.url())?.[1] ?? null;
  const setupMatch = /^(normal|fallback)-(\d+)$/.exec(setup ?? "");

  if (!setupMatch) {
    throw new Error(
      `Expected today=normal-<port> or today=fallback-<port>, received ${setup}`,
    );
  }

  const [, mode, port] = setupMatch;

  const readingId = "rdg_test_000000000001";
  const normalResponse = {
    schema_version: "0.3.0",
    reading: {
      schema_version: "0.3.0",
      output_schema: "daily-reading-v3",
      reading_id: readingId,
      local_date: "2026-08-09",
      generated_at: "2026-08-09T09:00:00Z",
      assembly_mode: "deterministic",
      revision: 2,
      locale: "en-US",
      domain_preference: "work",
      fallback_used: false,
      paragraphs: [
        {
          paragraph_id: "par_test_00000000001",
          role: "primary_theme",
          order: 1,
          text: "Steady pressure asks for a smaller, firmer commitment than the one you had in mind.",
        },
        {
          paragraph_id: "par_test_00000000002",
          role: "supporting_theme",
          order: 2,
          text: "A quieter influence favors patient conversations over immediate conclusions.",
        },
        {
          paragraph_id: "par_test_00000000003",
          role: "phase_context",
          order: 3,
          text: "This is the building stretch: the shape is set, the work is repetition.",
        },
        {
          paragraph_id: "par_test_00000000004",
          role: "timing",
          order: 4,
          text: "Closest on August 2, easing by January 26.",
        },
        {
          paragraph_id: "par_test_00000000005",
          role: "reflection",
          order: 5,
          text: "What would you keep doing if no one noticed for a month?",
        },
        {
          paragraph_id: "par_test_00000000006",
          role: "uncertainty_notice",
          order: 6,
          text: "Without a precise birth time, this reading does not use houses or chart angles.",
        },
        {
          paragraph_id: "par_test_00000000007",
          role: "context_label",
          order: 7,
          text: "Your preference for work helped break a tie between otherwise eligible themes.",
        },
      ],
    },
    evidence_url: `/v1/readings/${readingId}/evidence`,
  };

  const fallbackResponse = {
    ...normalResponse,
    reading: {
      ...normalResponse.reading,
      domain_preference: null,
      fallback_used: true,
      paragraphs: [
        {
          paragraph_id: "par_test_fallback0001",
          role: "safety_fallback",
          order: 1,
          text: "Nothing in the sky is pressing on your chart today. A quiet day is still a day worth noticing.",
        },
      ],
    },
  };

  const normalEvidence = {
    schema_version: "0.3.0",
    reading_id: readingId,
    revision: 2,
    revision_reason: "defect_repair",
    assembly_id: "asm_97e0e939b208250aecdde02747d367af",
    release_version: "release-12",
    created_at: "2026-08-09T09:00:00Z",
    paragraphs: [
      {
        paragraph_id: "par_test_00000000001",
        role: "primary_theme",
        evidence_lane: "celestial_facts",
        facts: [
          {
            id: "cyc_test",
            fact_type: "cycle_instance",
            phase: "building",
            orb_deg: 0.42,
            technique: "transit",
            pass_index: 1,
          },
        ],
        content: [
          {
            fragment_id: "phase.saturn-square-sun.building",
            content_version: "3",
            release_version: "release-12",
          },
        ],
        context_signals: [],
        ranking_factors: [
          { factor: "exactness", weight: 0.258, reason: "orb_0.42" },
          {
            factor: "body_importance",
            weight: 0.17,
            reason: "transiting_saturn",
          },
        ],
      },
    ],
  };

  const fallbackEvidence = {
    ...normalEvidence,
    paragraphs: [
      {
        paragraph_id: "par_test_fallback0001",
        role: "safety_fallback",
        evidence_lane: "operational",
        facts: [],
        content: [
          {
            fragment_id: "fallback.daily.en-US",
            content_version: "2",
            release_version: "release-12",
            content_type: "fallback_copy",
          },
        ],
        context_signals: [],
        ranking_factors: [],
      },
    ],
  };

  const response = mode === "fallback" ? fallbackResponse : normalResponse;
  const evidence = mode === "fallback" ? fallbackEvidence : normalEvidence;

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.route("**/v1/chart", async route => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "chart_not_found",
          message: "No active chart for user",
          request_id: "req_chart",
        },
      }),
    });
  });

  await page.route("**/v1/readings/today", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.route(`**/v1/readings/${readingId}/evidence`, async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(evidence),
    });
  });

  await page.goto(`http://127.0.0.1:${port}/#today`);
  const leadText = response.reading.paragraphs[0].text;
  await page.getByText(leadText, { exact: true }).waitFor();
  await page
    .locator(
      mode === "fallback"
        ? ".reading-block--safety_fallback"
        : ".reading-block--primary_theme",
    )
    .waitFor();

  if (mode === "fallback") {
    await page
      .getByText(/Nothing in your chart was eligible to be written about today/)
      .waitFor();
  }

  return { mode, title: await page.title(), url: page.url(), leadText };
}
