# Brailly implementation handoff

Work in the existing Brailly repository. Make the live reading flow dependable on real websites, keep the interface readable, and verify the deployed build. Preserve the product name **Brailly** and the sage palette. Keep the current Analyze and Read tabs with their shared reading queue. Analyze contains the website and expandable Jev activity; Read contains the named Braille device and retained reading. Remove repeated subtitles and explanations from the main view.

## Understand the implementation first

Read `src/App.tsx`, `shared/dom.ts`, `shared/frame-bridge.ts`, `server/page.ts`, `server/embedded-page.ts`, `server/dom-jev.ts`, `server/web-api.ts`, `extension/content.ts`, `extension/background.ts`, and the relevant tests before editing. Check the current branch and working tree before changing files; other work may already implement parts of this handoff.

The URL importer fetches public HTML, sanitizes it and runs a trusted DOM bridge in a sandbox. It does not execute the source website's scripts. The extension captures a rendered browser tab. Neither route should silently pretend that an unavailable cross-origin iframe or a client-rendered widget was captured.

`server/embedded-page.ts` can expand up to four visible public iframe sources through the same private-network protections, under a combined 2 MB limit. It records each source as included or unavailable. This supports the public Dayton widgets without executing third-party scripts or accessing private patient information. Preserve those boundaries and provenance.

Jev is called server-side through `POST https://api.typesafe.ai/v1/systemone`, currently with `jev-1.13.0`. Keep `TYPESAFE_API_KEY` in server environment variables. Never put a key in the bundle, extension, logs, screenshots, git, or a report.

Each captured block gets a Score for task relevance and a Choice for its function. A transition Choice decides `DEFER`, `QUEUE_HIGH`, `INTERRUPT`, or `NONE`. `server/dom-jev.ts` derives literal before/after changes from stable IDs and retained reading context. It compares text, link target, role, tag, region and optional card/location context. Reordering alone is not a content update. A missing block in a bounded capture is not proof that the source deleted or cancelled it.

## Real sites to exercise

- `https://achladeal.com/en`: inspect the rendered travel cards, prices and any countdown. Its raw HTML may contain only an application shell. Use the extension when the URL importer cannot capture the rendered values.
- `https://childrensdayton.org/wait-times/#emergency`: inspect the emergency wait-time content and its exact location labels. The public wait widgets use cross-origin MyChart iframes. Confirm what the permitted capture actually sees. If the embedded values are unavailable, say so and provide an explicit supported route to the widget rather than inventing wait times or substituting sample content.

Do not change a third-party site's data to claim that its real price or wait time changed. A controlled local fixture may exercise a mutation, but identify that evidence as a fixture. Retain the original source text and location context on the reading output.

## Required behavior

1. Keep the full 40-cell hardware profile visible in a 520–1000px column. Use component-width queries; viewport-only breakpoints previously clipped it inside a wide desktop layout. Preserve readable model names and 44px or larger primary controls. Contain the 80-cell display's horizontal scrolling within its panel.
2. Capture stable blocks with their card or location context. Do not let long navigation menus consume the whole 60-block budget. Do not capture password fields or entered form values. Report capture truncation and inaccessible frames accurately.
3. Hold the exact reading block, character offset and Braille cell offset while a request runs or a source update arrives. Coalesce bursts of mutations. Do not let an older response overwrite a newer capture or a reading position the user changed.
4. A routine countdown tick or unrelated promotion should keep the current line. A relevant fare or published hospital wait estimate should enter the update queue. Interrupt only when explicit new source content invalidates an immediately needed action the reader is following, such as the current booking total or accessible entrance instruction. A wait estimate alone is not medical urgency or treatment advice.
5. Keep queued updates discoverable without replacing the line. Resume must restore the saved text and exact offsets after an interruption. Treat removal cautiously: absent-from-capture is different from an explicit cancellation notice.
6. Show the endpoint, actual response model, observed latency, and token usage reported by Jev. Show an unavailable value if the service omits usage. Never estimate tokens while presenting them as measured usage. Scores and decisions must come from the live response; a service error must preserve the reader and show the error.
7. Keep one visible hardware simulation label. Model profiles are HumanWare Brailliant BI 20X/40X and Freedom Scientific Focus 40/80 Blue. USB/Bluetooth integration uses a supported screen reader; the on-screen device does not prove that physical hardware was connected.

## Validation and completion

Run `npm test`, `npm run test:e2e`, and `npm run build`. Keep deterministic browser tests explicitly mocked; record live API checks separately. Add regression checks for reordered blocks, changed link targets, missing blocks under truncation, replaced location context, rapid mutations, selection changes during a pending request, and exact resume. Reject Choice distributions with unknown or missing labels or a selected option that is not highest. Validate confidence as the documented 0–1 value; it is not necessarily the chosen probability.

For the UI, inspect desktop at 1440px and 1728px and mobile at 390px. Exercise the model selector, pan controls, block selection, update queue, hold/resume, URL navigation and extension capture. Check for console errors and horizontal page overflow. In particular, test the device inside 520px, 800px and 900px columns.

Use a bounded live Jev test with the existing server key and report the observed outcomes, not predetermined claims. Four synthetic validation fixtures on September 26, 2026 returned: countdown tick `DEFER`; comparison fare change `QUEUE_HIGH`; published wait estimate change `QUEUE_HIGH`; current checkout total change `INTERRUPT`. These were individual real API calls on labelled synthetic inputs, not evidence that either real website was fully captured. New runs may differ; inspect the task and before/after context if they do.

The reproducible real-source replay check is `npx tsx scripts/check-real-sites.ts --achla-html /path/to/rendered-achla.html`. Supply HTML captured from the rendered website. The script fetches the public Dayton widgets, mutates copies of the actual DOM, and records before/after values, real Jev responses and measured usage in `artifacts/real-sites-jev-replays.json`. Its six cases cover countdown, unrelated promotion, current price, missing price, wait estimate and unrelated hospital content. The 35-to-55-minute case is explicitly a replay; the actual fetched wait is retained separately. All six acceptance checks passed in the recorded run. This is evidence of processing captured source structures, not evidence of six natural upstream events.

Finish with the exact files changed, tests run, evidence for both real sites, any capture boundary that remains, and the current deployed URL. Do not claim a real-site, extension or physical-device check passed unless it was exercised. Do not overwrite unrelated work, force-push, or change deployment credentials.

## Non-goals

Do not redesign the product into a landing page, add fabricated metrics, create medical recommendations, bypass a website's authentication or frame protections, make bookings, buy tickets, or send private page contents to another service. Do not promise certified Braille translation: the visual mapping is illustrative; a real screen reader provides its own translation and hardware routing.

Reference the official [Score](https://docs.typesafe.ai/primitives/score), [Choice](https://docs.typesafe.ai/primitives/choice), and [structured instructions](https://docs.typesafe.ai/primitives/advanced) documentation when changing the Jev contract.
