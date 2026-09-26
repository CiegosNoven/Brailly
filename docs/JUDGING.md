# Judging evidence

| Criterion | What to show | Boundary |
| --- | --- | --- |
| Problem relevance | Read a page, change an irrelevant offer, then close the entrance the reader needs. Show the difference in Jev's decision. | The project hasn't completed research with Braille readers. |
| Technical execution | Real DOM extraction, Jev Score and Choice results, API tokens and latency, source text on the display, exact resume. | Browser behavior tests use explicit model mocks; live API checks run separately. |
| Architecture and design | Task plus DOM goes to a server-only Jev call. The reader holds its position while the response arrives and discards obsolete results. | URL imports use sanitized HTML; the extension captures the rendered main document. |
| Production feasibility | Public deployment, private-network URL rejection, sandboxed preview, request validation, input bounds and visible service errors. | Authentication, per-user quotas and physical-device validation remain before a wider release. |
| Clarity and continuation | Show the webpage, Jev request/results and a named device profile in one view. Explain the screen-reader connection path. | The device on screen is a preview, not evidence of a hardware connection. |

## Recorded checks

A live museum run returned initial classification in 453 ms, `DEFER` for the offer change in 255 ms and `INTERRUPT` for the entrance closure in 250 ms. These are individual observed calls, not a benchmark or latency guarantee. The interface displays usage from the latest API response rather than estimating tokens.

Chrome extension verification used a real persistent Chrome profile. Its service worker and bundled reader loaded, and `chrome.sidePanel.open` succeeded. Capture extracted 24 source blocks while excluding an inserted password value. A DOM edit set the change flag; recapture received the edited text, and locating that block focused the original element.

Earlier automation used a temporary localhost permission. The current extension requests HTTP/S website access to follow the active tab while its reader is open. Browser automation exercises the real extension runtime; the native toolbar click remains a separate manual step. No physical display test occurred.

The repository retains earlier scheduler tests and experimental BRLTTY code, but the judging walkthrough is the current DOM reader described in [DEMO.md](DEMO.md). Event submission, external review and eligibility are separate checks; this document makes no claim that they occurred.
