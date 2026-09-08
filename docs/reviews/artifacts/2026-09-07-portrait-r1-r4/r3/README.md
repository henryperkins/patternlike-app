# R3 spatial comparison — local implementation and verification

Base commit: `6e706741f03253f2807d33380afb529161f3481f`. R3 builds on the existing, uncommitted R1/R2 remediation. The [R3-only patch](r3-only.patch.gz) compares against that starting state; final source hashes are in [source-sha256-final.txt](source-sha256-final.txt). No commit, push, production request or deployment was performed.

Comparison now frames exactly the selected two saved objects in reading order, with chapter names and complete matching-facet prose. Either object's annotation and either reading column retain the exact chapter and paragraph association. Ending comparison restores the originating reader and camera context. Narrow layouts stack the complete readings; native chapter links, Full reading and original-image inspection remain accessible without graphics.

The work also fixes two issues exposed by the new layout: the app's reduced-motion duration was inadvertently animating reader dimensions and clamping restored scroll positions, and enlarged annotations could outgrow their previous placement. Explorer transitions are now disabled under reduced motion. Label resizing triggers projection without moving the camera; labels that cannot fit use their named native links, including visible keyboard focus and exact paragraph return.

The other priorities remain distinct:

- **R1/R2:** sky Back/Forward, selected body, account-route boundaries, initial chapter navigation, pinned reading controls, enlarged text and short landscape were checked again.
- **R4:** comparison preserves the originating camera, assembly, inspection, lighting, roof, object turns and desk choices. General object framing and the broader account close/reopen retention policy remain open.
- **R5:** comparison names and source-bound facet/passage links remain available; labels avoid the objects and controls or defer to native links. The broader single-object identity and facet-feedback work remains open.
- **R6:** complete reading, existing original-image inspection, source passage links and comparison exit remain reachable. General desktop continuation and action discoverability remain open.

| Verification | Result | Receipt |
| --- | --- | --- |
| Web workspace tests, Node 22.23.2 | 51 files / 694 tests passed | [web-test-verified.txt](web-test-verified.txt) |
| Repository TypeScript checks | Passed | [typecheck-verified.txt](typecheck-verified.txt) |
| Web TypeScript and Vite build | Passed; existing large-chunk advisory | [build-verified.txt](build-verified.txt) |
| Comparison preview | 32 checks passed; all six object pairs, exact source links, camera return | [results.json](results.json) |
| R1/R2 browser regression | 44 checks passed | [r1-r2/results.json](r1-r2/results.json) |
| Account fixture | 24 checks passed; pair/history retained and no repeated asset downloads on reopen | [account-results.json](account-results.json) |
| Text enlargement, landscape, normal motion and graphics loss/retry | 24 checks passed; full reading, images and keyboard handoffs included | [edge-results.json](edge-results.json) |
| Final enlarged/focused annotation review | Six scenarios passed, including expanded and normal-motion views | [review-label-final.txt](review-label-final.txt) |
| Final normal-motion keyboard passage loop | Three fresh runs passed with chapter 2's exact second Overview paragraph | [review-label-final-source.txt](review-label-final-source.txt) |
| Source integrity / whitespace | Hashes unchanged after verification; diff check passed | [hash-verification.txt](hash-verification.txt) |

The 124-check browser matrix used the snapshot in [browser-matrix-source-sha256.txt](browser-matrix-source-sha256.txt). One subsequent controller correction makes native focus handoffs scroll immediately, preventing a competing smooth scroll from obscuring focus. The final web suite/build and focused browser reviews above include that correction; the matrix is not represented as a second run on the later snapshot.

The root `npm test` attempt remains **incomplete**. Earlier workspace lanes ran, then the API Worker stalled without a test result and emitted `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending`. The command was bounded to 300 seconds and terminated with exit 143. See [full-test-final.txt](full-test-final.txt). This is not a passing repository suite or merge gate; `ci:local` was not run.

Browser verification used local Chromium with software WebGL at 1440×900, 390×844, 320×844 and 844×390, including doubled text and both motion preferences. Preview objects are the original fictional models. Account requests were intercepted with fictional source/image fixtures and compiled test shapes; they verify account behavior, not production access or artwork quality. No page JavaScript errors were recorded. The local server and browser runs were stopped. Production, Safari and physical-device performance remain unverified.

Screenshots: [desktop comparison](after-1440.png), [phone comparison](after-390.png), [320px comparison](after-320.png), [enlarged text](edge-320-2.png), [account comparison](account-390.png), [short landscape](edge-844-1.png).
