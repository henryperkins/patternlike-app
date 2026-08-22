# Today Lead Line Implementation Plan

> **ARCHIVED 2026-08-22 — complete.** Shipped in
> `apps/web/src/components/TodayView.tsx` and its Today-scoped `styles.css`
> rules. Do not execute. Index: [`../README.md`](../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today theme-first by implementing the approved Lead Line composition while preserving every existing reading, preference, error, and evidence behavior.

**Architecture:** Keep `TodayView` and `WhyThisDrawer` behavior intact. Add one semantic layout boundary around the chapter and its provenance disclosure, then use scoped Today CSS to subordinate the date, enlarge the eligible lead paragraph, flatten notices into annotations, and keep provenance on the same editorial measure. No API types, routes, contracts, copy, or neighboring components change.

**Tech Stack:** React 19, strict TypeScript ES modules, Vite 8, Vitest 4, Testing Library, existing CSS tokens, Playwright CLI.

## Global Constraints

- Treat `apps/web/.impeccable/mocks/today-lead-line.png` as the approved compositional north star and `apps/web/.impeccable/surfaces/apps-web-src-components-todayview-tsx.md` as the route contract.
- Limit application edits to `TodayView.tsx`, `TodayView.test.tsx`, and Today-scoped rules in `styles.css`.
- Preserve the response contract, paragraph order, lazy evidence fetch, retry/focus behavior, preference gates, fallback treatment, unauthorized escalation, and all existing reader-facing copy.
- Do not add journaling, saving, acknowledgment, a Timing link, API work, new dependencies, raster UI, or changes to other routes.
- Preserve square geometry, one-pixel structural rules, flat paper layers, existing typography families, and Signal Coral's restricted role.
- Maintain one `h1`, semantic article/details behavior, keyboard focus, live status messaging, reduced-motion behavior, and the WCAG 2.2 AA target.
- Use Node 20+; keep two-space indentation, double quotes, trailing commas, and `.js` suffixes on local imports.
- Do not stage or commit unless the user separately authorizes Git integration; preserve all unrelated and previously approved untracked files.

---

### Task 1: Establish the theme-first editorial column

**Files:**
- Modify: `apps/web/src/components/TodayView.test.tsx:35`
- Modify: `apps/web/src/components/TodayView.tsx:126`
- Modify: `apps/web/src/styles.css:1398`
- Read-only reference: `apps/web/.impeccable/mocks/today-lead-line.png`
- Read-only reference: `apps/web/.impeccable/surfaces/apps-web-src-components-todayview-tsx.md`

**Interfaces:**
- Consumes: the existing `DailyReadingResponse`, role-specific `reading-block--<role>` classes, and unchanged `WhyThisDrawer` props.
- Produces: a `.today-reading` layout boundary whose first child is `.today-body` and whose optional second child is `.today-evidence`; no exported TypeScript interface changes.

- [ ] **Step 1: Write the failing structural regression test**

Add this test inside `describe("TodayView", ...)`, after the paragraph-order test:

```tsx
it("keeps the lead and provenance in one editorial column", async () => {
  const { container } = renderToday({
    [TODAY]: ok(todayResponse),
    [EVIDENCE]: ok(evidenceGraph),
  });
  await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

  const column = container.querySelector<HTMLElement>(".today-reading");
  expect(column).not.toBeNull();

  const body = column!.querySelector<HTMLElement>(".today-body");
  const lead = column!.querySelector<HTMLElement>(".reading-block--primary_theme");
  const evidence = column!.querySelector<HTMLDetailsElement>(".today-evidence");

  expect(body).not.toBeNull();
  expect(lead).toBe(body!.firstElementChild);
  expect(evidence).toBe(body!.nextElementSibling);
});
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run:

```powershell
npm test --workspace apps/web -- TodayView.test.tsx
```

Expected: FAIL in `keeps the lead and provenance in one editorial column` because `.today-reading` does not exist. Existing Today tests remain green.

- [ ] **Step 3: Add the shared reading-column boundary**

In `TodayReading`, replace the separate body and drawer siblings with this structure while leaving paragraph mapping, drawer keying, props, and conditional rendering unchanged:

```tsx
<div className="today-reading">
  <div className="today-body">
    {paragraphs.map((paragraph) => (
      <Paragraph key={paragraph.paragraph_id} paragraph={paragraph} />
    ))}
  </div>

  {response.evidence_url ? (
    <WhyThisDrawer
      key={reading.reading_id}
      readingId={reading.reading_id}
      paragraphOrder={paragraphs.map((paragraph) => paragraph.paragraph_id)}
      onReload={onReload}
      onUnauthorized={onUnauthorized}
    />
  ) : null}
</div>
```

Retain the existing explanatory comment above `WhyThisDrawer`; move it with the conditional rather than deleting it.

- [ ] **Step 4: Implement the approved Lead Line hierarchy in scoped CSS**

Update the Today section so it contains these rules and removes the superseded `today-body` gap/margin, small lede, bordered reflection, and card-like notice declarations:

```css
.today-page__header {
  align-items: end;
}

.today-page__header h1 {
  font-size: clamp(36px, 3.6vw, 46px);
  line-height: 1;
  letter-spacing: -0.045em;
}

.today-fallback-note {
  width: min(700px, 100%);
}

.today-reading {
  width: min(700px, 100%);
  margin-top: 44px;
}

.today-body {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0;
  margin: 0;
  border-bottom: 1px solid var(--line);
}

.reading-block,
.reading-reflection,
.reading-notice {
  padding: 28px 0;
}

.reading-block--primary_theme,
.reading-block--safety_fallback {
  padding-top: 8px;
  padding-bottom: 40px;
}

.reading-block--primary_theme::before,
.reading-block--safety_fallback::before {
  display: block;
  width: 34px;
  height: 4px;
  margin-bottom: 22px;
  background: var(--coral);
  content: "";
}

.reading-paragraph--lede {
  font-size: clamp(34px, 4vw, 52px);
  line-height: 1.22;
  letter-spacing: -0.03em;
}

.reading-reflection {
  border: 0;
}

.reading-notice {
  border: 0;
  background: transparent;
}

.today-body > * + * {
  border-top: 1px solid var(--line);
}
```

Keep the existing body-copy, kicker, reflection typography, notice-icon, and context-color rules. Keep `.evidence-drawer` globally unchanged; its placement inside `.today-reading` supplies the approved width without affecting Chart or Pattern evidence.

Inside the existing `@media (max-width: 700px)` block, place these Today overrides after the generic `.page-header h1` rule:

```css
.today-page__header h1 {
  font-size: clamp(34px, 10vw, 40px);
}

.today-reading {
  margin-top: 34px;
}

.reading-block,
.reading-reflection,
.reading-notice {
  padding-block: 24px;
}

.reading-block--primary_theme,
.reading-block--safety_fallback {
  padding-top: 4px;
  padding-bottom: 34px;
}

.reading-block--primary_theme::before,
.reading-block--safety_fallback::before {
  width: 28px;
  height: 3px;
  margin-bottom: 18px;
}

.reading-paragraph--lede {
  font-size: clamp(28px, 8.2vw, 34px);
  line-height: 1.3;
}
```

- [ ] **Step 5: Run the focused Today suite and verify the change**

Run:

```powershell
npm test --workspace apps/web -- TodayView.test.tsx
```

Expected: PASS, including all loading, fallback, preference, retry, unauthorized, evidence, date-formatting, and heading tests.

- [ ] **Step 6: Run the complete web test suite**

Run:

```powershell
npm test --workspace apps/web
```

Expected: PASS with no regressions in App, onboarding, chart-wheel, authentication, or Today tests.

---

### Task 2: Verify the approved composition and repository gates

**Files:**
- Inspect: `apps/web/src/components/TodayView.tsx`
- Inspect: `apps/web/src/components/TodayView.test.tsx`
- Inspect: `apps/web/src/styles.css`
- Use: `apps/web/.impeccable/harnesses/today-lead-line.js`
- Use: `apps/web/.impeccable/harnesses/today-drawer-focus.js`
- Temporary browser state and named screenshots: `%TEMP%\patternlike-today-lead-line\`; never write browser output under the repository.

**Interfaces:**
- Consumes: the Task 1 DOM/CSS result and the existing local Vite/Playwright mock route harness.
- Produces: focused automated evidence plus desktop and mobile screenshots demonstrating the approved hierarchy; no new production interface.

- [ ] **Step 1: Run static and production-build verification**

Run:

```powershell
npm run typecheck
npm run build --workspace apps/web
```

Expected: both commands exit 0; strict TypeScript accepts the wrapper and Vite produces the web bundle.

- [ ] **Step 2: Run the repository test gate**

Run:

```powershell
npm test
```

Expected: the full calculation, API, contract, OpenAPI, D1, and web suites pass. If the calculation pretest downloads ephemeris data, let that documented prerequisite finish rather than substituting a narrower completion claim.

- [ ] **Step 3: Run the design detector once on the changed targets**

Run:

```powershell
node "C:\Users\htper\.agents\skills\impeccable\scripts\detect.mjs" --json apps/web/src/components/TodayView.tsx apps/web/src/styles.css
```

Expected: no blocking finding in the changed Today implementation. Record advisories separately because they do not change the detector exit code.

- [ ] **Step 4: Capture the bounded desktop/mobile visual round**

Run this complete PowerShell sequence from the repository root. It preflights fixed port `5187`, starts Vite in strict-port mode, places all Playwright CLI state and captures under the exact OS-temp directory `%TEMP%\patternlike-today-lead-line\`, installs normal and fallback mocks in separate named sessions, exercises pointer and keyboard disclosure behavior, and tears both sessions and Vite down in `finally`.

```powershell
$repoRoot = (Resolve-Path ".").Path
$port = 5187
$baseUrl = "http://127.0.0.1:$port"
$artifactRoot = Join-Path ([System.IO.Path]::GetTempPath()) "patternlike-today-lead-line"
$playwrightRoot = Join-Path $artifactRoot "playwright-work"
$mockHarness = Join-Path $repoRoot "apps/web/.impeccable/harnesses/today-lead-line.js"
$drawerHarness = Join-Path $repoRoot "apps/web/.impeccable/harnesses/today-drawer-focus.js"
$normalSession = "today-lead-line-normal"
$fallbackSession = "today-lead-line-fallback"
$normalDesktop = Join-Path $artifactRoot "normal-desktop-closed-1440x1000.png"
$normalDrawer = Join-Path $artifactRoot "normal-desktop-drawer-open-focused-1440x1000.png"
$normalMobile = Join-Path $artifactRoot "normal-mobile-drawer-open-390x844.png"
$fallbackDesktop = Join-Path $artifactRoot "fallback-desktop-closed-1440x1000.png"
$fallbackMobile = Join-Path $artifactRoot "fallback-mobile-closed-390x844.png"
$viteStdout = Join-Path $artifactRoot "vite.stdout.log"
$viteStderr = Join-Path $artifactRoot "vite.stderr.log"
$viteProcess = $null

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is already in use; stop that listener before running this gate."
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$artifactFullPath = [System.IO.Path]::GetFullPath($artifactRoot).TrimEnd("\")
$playwrightFullPath = [System.IO.Path]::GetFullPath($playwrightRoot)
if (-not $playwrightFullPath.StartsWith(
    $artifactFullPath + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw "Refusing to clean Playwright state outside $artifactFullPath"
}
if (Test-Path -LiteralPath $playwrightRoot) {
  Remove-Item -LiteralPath $playwrightRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $playwrightRoot | Out-Null

@(
  $normalDesktop,
  $normalDrawer,
  $normalMobile,
  $fallbackDesktop,
  $fallbackMobile,
  $viteStdout,
  $viteStderr
) | ForEach-Object {
  if (Test-Path -LiteralPath $_) {
    Remove-Item -LiteralPath $_ -Force
  }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$viteEntry = (Resolve-Path "node_modules/vite/bin/vite.js").Path
$webRoot = (Resolve-Path "apps/web").Path

function Invoke-TodayPlaywright {
  param([string[]]$Arguments)

  & $npx "playwright-cli" @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "playwright-cli failed: $($Arguments -join ' ')"
  }
}

try {
  $viteProcess = Start-Process `
    -FilePath $node `
    -ArgumentList @($viteEntry, "--host", "127.0.0.1", "--port", "$port", "--strictPort") `
    -WorkingDirectory $webRoot `
    -RedirectStandardOutput $viteStdout `
    -RedirectStandardError $viteStderr `
    -WindowStyle Hidden `
    -PassThru

  $ready = $false
  $deadline = (Get-Date).AddSeconds(30)
  while (-not $ready -and (Get-Date) -lt $deadline) {
    if ($viteProcess.HasExited) {
      throw "Vite exited early. Inspect $viteStderr"
    }
    try {
      $response = Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing -TimeoutSec 2
      $ready = $response.StatusCode -eq 200
    } catch {
      $ready = $false
    }
    if (-not $ready) {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) {
    throw "Vite did not become ready within 30 seconds. Inspect $viteStderr"
  }

  Push-Location $playwrightRoot
  try {
    Invoke-TodayPlaywright @("install")

    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "open",
      "about:blank?today=normal-$port"
    )
    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "run-code",
      "--filename",
      $mockHarness
    )
    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "screenshot",
      "--filename",
      $normalDesktop
    )
    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "run-code",
      "--filename",
      $drawerHarness
    )
    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "screenshot",
      "--filename",
      $normalDrawer
    )
    Invoke-TodayPlaywright @("-s=$normalSession", "resize", "390", "844")
    Invoke-TodayPlaywright @(
      "-s=$normalSession",
      "screenshot",
      "--filename",
      $normalMobile
    )

    Invoke-TodayPlaywright @(
      "-s=$fallbackSession",
      "open",
      "about:blank?today=fallback-$port"
    )
    Invoke-TodayPlaywright @(
      "-s=$fallbackSession",
      "run-code",
      "--filename",
      $mockHarness
    )
    Invoke-TodayPlaywright @(
      "-s=$fallbackSession",
      "screenshot",
      "--filename",
      $fallbackDesktop
    )
    Invoke-TodayPlaywright @("-s=$fallbackSession", "resize", "390", "844")
    Invoke-TodayPlaywright @(
      "-s=$fallbackSession",
      "screenshot",
      "--filename",
      $fallbackMobile
    )
  } finally {
    Pop-Location
  }

  @(
    $normalDesktop,
    $normalDrawer,
    $normalMobile,
    $fallbackDesktop,
    $fallbackMobile
  ) | ForEach-Object {
    $capture = Get-Item -LiteralPath $_ -ErrorAction Stop
    if ($capture.Length -lt 1000) {
      throw "Capture is unexpectedly small: $($capture.FullName)"
    }
    $capture | Select-Object FullName, Length, LastWriteTime
  }
} finally {
  if (Test-Path -LiteralPath $playwrightRoot) {
    Push-Location $playwrightRoot
    try {
      & $npx "playwright-cli" "-s=$normalSession" close 2>$null | Out-Null
      & $npx "playwright-cli" "-s=$fallbackSession" close 2>$null | Out-Null
    } finally {
      Pop-Location
    }
  }

  if ($null -ne $viteProcess -and -not $viteProcess.HasExited) {
    Stop-Process -Id $viteProcess.Id -Force
    Wait-Process -Id $viteProcess.Id -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $playwrightRoot) {
    Remove-Item -LiteralPath $playwrightRoot -Recurse -Force
  }
}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is still listening after teardown."
}
```

Expected named captures:

- `%TEMP%\patternlike-today-lead-line\normal-desktop-closed-1440x1000.png`
- `%TEMP%\patternlike-today-lead-line\normal-desktop-drawer-open-focused-1440x1000.png`
- `%TEMP%\patternlike-today-lead-line\normal-mobile-drawer-open-390x844.png`
- `%TEMP%\patternlike-today-lead-line\fallback-desktop-closed-1440x1000.png`
- `%TEMP%\patternlike-today-lead-line\fallback-mobile-closed-390x844.png`

The normal interaction harness must return `{ open: true, focused: true, evidenceLoaded: true }` after a pointer-open, keyboard-close, and keyboard-reopen sequence. The two fallback captures must visibly contain the one-paragraph `safety_fallback` reading and its reviewed-general-reflection note; they are not duplicates of the normal reading.

Inspect both together against the approved comp and confirm:

- the lead paragraph, not the date, owns the first viewport;
- the short coral rule introduces normal and fallback ledes;
- supporting copy, reflection, uncertainty, and context form one continuous column;
- uncertainty/context are flat annotations rather than floating cards;
- `Why this reading?` matches the reading measure;
- no text, panel, or navigation item overflows at 390px;
- focus, open/close state, and fixed mobile navigation remain legible.

If the first visual round exposes a material mismatch, batch corrections only in the three Task 1 files, rerun the focused test/build, and capture one final desktop/mobile round. Do not start a third polishing loop.

- [ ] **Step 5: Close the evidence gate and preserve the worktree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only approved Impeccable artifacts, this plan, and the three scoped Task 1 files appear. The Step 4 `finally` block has closed both named browser sessions, stopped the exact Vite process, removed OS-temp Playwright working state, and left the five named screenshots plus Vite logs under `%TEMP%\patternlike-today-lead-line\`. No `output/playwright/` directory or other browser output appears in the repository. Do not stage or commit.
