# Real-site verification

Checked September 26, 2026. These observations describe a bounded capture, not complete support for every element of either website.

| Source | Failure reproduced | Result after the change |
| --- | --- | --- |
| [Achla Deal](https://achladeal.com/en) | Rendered prices lived in nested spans/divs; none appeared in the old capture. Raw HTML was an application shell. | A browser capture included 22 contextual price blocks within the 60-block limit. The Chrome extension delivered a naturally occurring page update automatically. |
| [Dayton emergency waits](https://childrensdayton.org/wait-times/#emergency) | Navigation consumed the capture. Emergency values came from separate public iframe documents. | Fragment prioritization retained campus context; bounded public iframe import included both emergency wait widgets and their source links. Hidden widgets were excluded. |

The full 60-block Achla classification took 680 ms and reported 37,955 input / 5,337 output tokens. The selected contextual fare scored 2.99/3. The full Dayton classification took 1,739 ms and reported 38,683 input / 5,375 output tokens; both captured emergency waits scored 3/3. These are individual observed runs, not latency guarantees. See `artifacts/real-sites-full-classification.json`.

Six additional live Jev calls used controlled mutations on copies of real captured DOM. They were not changes made to or observed on the upstream websites. Countdown and unrelated promotions returned DEFER; a comparison fare change and a published wait-estimate change returned QUEUE_HIGH; a price missing from a bounded capture returned NONE. The original observed values, replay values, model output and usage are separated in `artifacts/real-sites-jev-replays.json`.

Run the replay with a server-side key and a current rendered capture:

```sh
node --import tsx scripts/check-real-sites.ts --achla-html /path/to/rendered-achla.html
```

Browser regression tests exercise updates arriving during a delayed response, stale interruption rejection, cumulative before/after context, visibility and label changes, an emptied page, refreshed HTML and exact retained reading offsets. Model replies in those browser tests are explicitly mocked; the artifacts above contain the separate real calls.

The automatic extension was also exercised in actual Chrome using its shipped manifest. Opening the bundled reader triggered a real Jev call without pressing Analyze: 559 ms, 37,922 input / 5,334 output tokens. Same-tab navigation to Dayton captured both rendered cross-origin emergency widgets and automatically completed another Jev call. A labelled local edit to a widget triggered an automatic update call; it was not a hospital-published estimate. Active-tab switching selected the new source, unsupported browser pages cleared the old snapshot, and closing the reader stopped capture. See `artifacts/extension-automatic.json`. Automation opened the reader in an inactive extension tab; it did not automate Chrome's native toolbar gesture.

The extension follows the active tab while its reader is open. It captures the rendered main document and up to four supported visible direct child frames; merged results retain source-frame context and the 60-block total limit. The URL preview executes no third-party scripts and updates when refreshed; it can import public embedded HTML but cannot reproduce every JavaScript widget. Missing or inaccessible content is reported rather than replaced with example data. Hospital values are published estimates, not medical urgency or treatment advice. Physical Braille hardware remains untested.
