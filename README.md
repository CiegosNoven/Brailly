# Brailly

Brailly reads webpages in the order that matters for your task. Ask for the accessible entrance to a museum, and Jev ranks the access instructions above the shop promotion. If the entrance closes while you read, Brailly can show the update and save your place.

We built it for JEVATHON SF, with a Braille display simulator, a Chrome extension, and optional visual descriptions and speech.

[Live app](https://brailly-jev.vercel.app/) · [Download extension](https://brailly-jev.vercel.app/brailly-extension.zip) · [Demo walkthrough](docs/DEMO.md) · [Hardware](docs/HARDWARE.md)

## Try the demo

1. Open the [app](https://brailly-jev.vercel.app/), choose **Museum demo**, and ask: `Find the opening hours, ticket price, and accessible entrance.` Click **Analyze page** and expand **Jev** to inspect the real request and response.
2. Open **Read**. Choose a display profile, move through the reading queue, and pan the Braille cells.
3. Choose **Play alert demo**. A fictional station changes its elevator status through an actual DOM mutation. Jev evaluates the update. If it interrupts, **Resume reading** restores the saved position.
4. For visual context, enter `https://brailly-jev.vercel.app/visual-demo.html`, use the same task, and choose **Open with visual context**. Open the map under **Visual details**, select **ElevenLabs**, and choose **Listen to visual detail**.

The museum and station are fictional. Their page changes are real DOM updates, which Jev evaluates live. The app shows service errors if a call fails.

## What Jev does

Brailly sends the reader’s task and source text to Jev. Score rates each block’s relevance from 0 to 3; Choice labels it as content, action, navigation, notice, or extra. Expand the Jev panel to inspect the request, response, token usage, and model latency.

For page changes, Jev compares the old and new content with the task and current reading position:

| Decision | Reader behavior |
| --- | --- |
| `DEFER` | Keeps the current line for unrelated changes or routine refresh noise. |
| `QUEUE_HIGH` | Announces the update through ElevenLabs while keeping the Braille line and position. |
| `INTERRUPT` | Shows the update, plays a short tone, and saves the previous reading position for resume. |
| `NONE` | Retains the line when the change or its relevance is uncertain. |

A request evaluates a batch of blocks. The queue updates when Jev returns that batch.

## Maps and voice

A map can show an accessible route that its image label never describes. Browserbase opens the rendered page, and Jev selects visual candidates for inspection. Stagehand vision describes those candidates; Jev then scores the descriptions against the task. Jev itself accepts text only.

Visual details keeps the generated description, recognized image text, and uncertainty separate from the original page text. You can open a detail without moving your source reading position. Select ElevenLabs or the browser voice and press Listen to hear it. Stop cancels loading or playback.

After a complete visual capture, Browserbase checks again every 30 seconds while the reader stays open. Jev compares the previous and current text and visual observations. **Stop automatic checks** stops further captures; **Resume automatic checks** restarts them. Checks do not overlap. An incomplete capture keeps the current reading and retries later. Each capture uses paid services.

**Update sounds** controls automatic voice alerts and the short tone. Voice alerts use ElevenLabs when configured. If the browser blocks playback, choose **Play audio** or **Play update sound**. A visible notice remains available.

For a visual change demo, capture `https://brailly-jev.vercel.app/visual-watch-demo.html` with the task `I am following the step-free entrance on this museum map. Tell me if the route changes.` The fictional map switches entrances every minute, including in separate browser sessions. The surrounding text stays unchanged. Jev decides what to do; the demo does not force its decision.

Remote visual capture supports configured public HTTPS sites, with up to 12 candidates and two inspections per capture. It has a 45-second work budget and labels incomplete results. It takes fresh remote captures rather than reusing the extension’s signed-in session. CSS backgrounds, iframes, shadow DOM, and animated visuals fall outside its coverage.

## Chrome extension

Download the [extension ZIP](https://brailly-jev.vercel.app/brailly-extension.zip) and unzip it. In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.

Open a website and click Brailly’s toolbar icon. While its side panel is open, the extension automatically analyzes the active page, follows navigation and tab changes, and detects DOM updates. Close the panel to stop following.

Press **Alt + K** to find a captured button, link, or field. Select a result to read it, then press **Enter** on the Braille reading line to activate it. A field receives focus for typing on the original page. Disabled, stale, or removed controls are rejected. The web preview supports links and disclosure controls; use the extension for a website’s scripted buttons and fields. Try [the control demo](https://brailly-jev.vercel.app/controls-demo.html). Reload the extension after installing the updated ZIP.

The extension skips password fields and input values. It captures the main document and up to four supported visible child frames. Browser-internal pages and closed shadow roots are unavailable. We distribute an unpacked build; it isn't in the Chrome Web Store.

## Braille devices

The simulator previews these refreshable Braille displays:

| Model | Cells |
| --- | ---: |
| HumanWare Brailliant BI 20X | 20 |
| HumanWare Brailliant BI 40X | 40 |
| Freedom Scientific Focus 40 Blue | 40 |
| Freedom Scientific Focus 80 Blue | 80 |

We haven't tested physical hardware. The proposed connection uses VoiceOver or NVDA to translate the focused reading output and send it to a supported USB or Bluetooth display. Selecting a simulator profile changes its cell width; it does not connect a device.

The on-screen English dots are illustrative. Our experimental BRLTTY adapter is separate from the current reader. See [hardware details](docs/HARDWARE.md).

## Run locally

Use Node.js 22.x, version 22.18 or newer.

```sh
npm ci
cp .env.example .env
```

Set `TYPESAFE_API_KEY` in `.env`, then start the app:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`.

For visual context and ElevenLabs, also configure:

```dotenv
VISUAL_ENRICHMENT_ENABLED=true
BROWSERBASE_API_KEY=your_browserbase_key
BROWSERBASE_ALLOWED_ORIGINS=https://brailly-jev.vercel.app

ELEVENLABS_TTS_ENABLED=true
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
```

Both integrations default off, and the server holds their keys. Browserbase needs a public HTTPS page to open remotely. See [.env.example](.env.example) for optional project and model settings.

## Cost

At Jev’s [published rate](https://docs.typesafe.ai/models) of US$0.042 per million input tokens, ten analyses of 30,000 tokens each cost US$0.0126. Output tokens are free at that rate.

Actual usage depends on the page and every call it triggers, including visual selection and reanalysis. Browserbase, vision, and ElevenLabs cost extra.

## Build and verify

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The build packages the extension. Regression tests mock provider responses; we run live provider checks separately. See [verification](docs/VERIFICATION.md), [real-site checks](docs/REAL-SITES.md), and [judging evidence](docs/JUDGING.md).

The app uses React, TypeScript, Vite, and Express on Vercel. Set production environment variables before deploying. [vercel.json](vercel.json) includes the Stagehand asset that Browserbase needs.

Brailly captures up to 60 text blocks, with 800 characters per block. The importer strips source scripts and rejects private network destinations. Paid endpoints use per-process throttling; configure provider quotas to control usage across serverless instances.
