# Output error classification review

Verdict: **PASS — no findings.**

The correction cleanly preserves `ioError`'s default input classification (`source_missing`, exit 1) while allowing output call sites to select `io_failed`, exit 2. Every publication boundary in the reviewed path now selects the output classification: opening/creating the snapshots parent, opening the reserved snapshot directory, reopening it for identity observation, and opening/writing each output file. The direct snapshot-directory `mkdirSync` failure already returns `io_failed`, exit 2. The initial `allowAbsent` probe remains appropriate because ENOENT there means the requested capture ID is available, rather than that publication failed.

The four regressions exercise ENOENT during output-parent open, reserved-directory open, identity observation, and file write. Together with the reported red-to-green evidence and the final 69/69 focused suite, they cover the classification change at each affected context. Missing input/source behavior is unchanged because those reads retain the helper default or their existing definition/tooling-specific codes.

Normal successful capture behavior is unaffected: the only helper change executes after a caught ENOENT, and the output call-site changes only pass an error-classification argument. The existing successful capture/verify coverage remained green in the reported 69-test run. Per review scope, I did not repeat tests because inspection found no concrete suspicion requiring it.
