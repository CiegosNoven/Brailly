# Brailly demo

Open [Brailly](https://brailly-jev.vercel.app). Analyze shows the webpage and Jev; Read shows the device. The reading queue remains available in both tabs.

1. Load **Museum demo** and use the task: `Find the opening hours, ticket price, and accessible entrance.` Choose **Analyze page**. Watch the queue move from pending to ranked when the batch response arrives. Expand **Jev** to inspect the endpoint, input/output tokens and request.
2. Open **Read**, select a queue item, pan the Braille line, then select another device profile. The text comes directly from the page; changing the profile changes the available cells.
3. Return to **Analyze**, expand **Test page changes**, then choose **Change offer**. Watch the DOM change and Jev return its decision. The reader should keep its position when Jev defers the promotion.
4. Choose **Close entrance**. Show Jev's new decision, the changed source text on the device, and **Resume reading**. On the verified live run, Jev interrupted for the entrance closure and resumed the saved line. Decisions can vary with task and context.
5. Paste a real public URL. Follow a link in the imported page and classify its contents, or use the Chrome extension on a rendered website. Open request/response details if the judges want to inspect the payload.

**Run demo** performs the offer and entrance changes in sequence. The museum is sample content; its mutations are real, and Jev evaluates them live.

For a JavaScript application, install the extension first. Open the source website and click Brailly. Analysis starts automatically. While its panel stays open, switching tabs or navigating captures the new page; page changes also arrive automatically. Close the panel to stop. For an imported HTML page, use **Refresh source page**; it fetches the source again while holding the reading line.

If Jev returns a service error, the reader keeps the source text and shows the error. Retry when the service is available; don't describe retained text as a new classification.

## Visual and voice scene (local implementation)

Use the locally built app for this integration unless the deployment has been updated and its environment configured. The existing production URL is not evidence that new code is deployed.

1. Read [the demo catalogue](use-cases.html). Achla Deal is the first real-site candidate, Dublin Airport the second. The catalogue's recorded observations and expected decisions are not guarantees for a new Browserbase run.
2. Enable the relevant flags in `.env`, configure the server keys and restart `npm run dev`. Keep browser voice selected until deliberately testing ElevenLabs.
3. Serve `public/visual-demo.html` at a public HTTPS URL and add its origin to `BROWSERBASE_ALLOWED_ORIGINS`. Paste that URL and use `Find the opening hours, admission price, and step-free entrance.` Choose **Open with visual context**. A local file path or localhost is not reachable by the remote browser.
4. Once source text appears, select the long opening-hours paragraph. Open **Read**, move to another line and pan Braille cells. Continue reading while the visual job finishes. Late ranking/evidence must retain the line, cells and any accepted reading order.
5. In **Visual details**, inspect Jev's decisions and coverage. The map shows an east entrance via the Garden Lane ramp; the front door has stairs. This route is intentionally absent from the image label. The separate shop banner contains a poster discount. Expectation: the map helps the access task; test actual Jev decisions instead of treating them as fixed.
6. Open the map detail. Show its **Generated visual description**, recognized text, uncertainty and observation time. Select **ElevenLabs** and choose **Listen to visual detail**. Use **Listen to recognized text** for the separately labelled text detected in the image, such as a discount code. Stop during loading or playback, close with Escape, and return to the original line. Nothing should speak when a result arrives or when the dialog closes.
7. Change the task to `Find discounts in the museum shop.` Start a fresh visual capture. The banner may now matter. The scene is a controlled simulation, and its 20% poster offer is not a real promotion.
8. Load the public `visual-only.html` fixture to show an image-only page: source classification and source Listen are disabled, while any generated visual detail is available on demand.

For a real site, record the final URL, task, source text, candidate coverage, result and limitation. A text price, timer or flight status stays in the DOM path; vision is reserved for missing visual information. Achla and Ticketmaster numerical thresholds belong in code, BART needs a known route supplied as context, and Dayton should be presented as attributed logistics. The six catalogue cases do not imply six dedicated integrations or remote live monitoring.

The UI reports separate load, DOM Jev, selection, vision, priority and total durations. A cancelled, timed-out or incomplete capture is partial; do not present it as complete. Use the controlled fixture if a site is unavailable, blocks remote assets, or does not change during the presentation. Verify deployment streaming separately before promising progressive results in Vercel.
