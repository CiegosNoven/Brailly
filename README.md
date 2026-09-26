# Brailly

Brailly reads a website's DOM, asks Jev which blocks matter for your task, and sends the original text to a stable reading output. Analyze shows the webpage and API usage. Read shows the Braille device. Both tabs share a ranked reading queue.

[Open Brailly](https://brailly-jev.vercel.app) · [Demo walkthrough](docs/DEMO.md) · [Device connections](docs/HARDWARE.md)

## Run locally

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY in .env.
npm run dev
```

Open `http://127.0.0.1:5173`. The key stays on the server.

## What works

Paste a public URL or open the museum example. Brailly imports sanitized HTML into an interactive iframe; links load the next page. For sites that require JavaScript or a login, the Chrome extension captures the page already rendered in your browser.

Each Jev request includes the task and up to 60 DOM blocks. A [Score](https://docs.typesafe.ai/primitives/score) assigns relevance from 0 to 3; a [Choice](https://docs.typesafe.ai/primitives/advanced) labels each block. On iframe changes, another Choice decides whether to hold the current line, queue an update or interrupt. Resume restores the saved reading position. The interface shows the endpoint, model, latency and input/output token counts reported by Jev.

The museum controls change its actual DOM. Jev decides what to do on every run; there are no replacement scores when the service fails. Browser tests use explicit mocks for repeatable checks, while live calls run separately.

[Real-site verification](docs/REAL-SITES.md) covers rendered Achla travel prices, Dayton emergency wait widgets, controlled DOM changes and actual Jev calls. [Devin handoff](docs/DEVIN-PROMPT.md) records the requirements and regression cases.

## Chrome extension

Download [brailly-extension.zip](https://brailly-jev.vercel.app/brailly-extension.zip), unzip it, then open `chrome://extensions`. Enable Developer mode and choose **Load unpacked**. Select the extracted folder, open a website and click Brailly's toolbar icon.

The extension uses `activeTab` permission and opens a side panel. After capture, it sends updated snapshots as the selected page changes. Updates hold the reading line while Jev evaluates them; bursts share a pending request rather than repeatedly cancelling the active call. **Capture tab** also permits a manual refresh.

Extraction excludes password fields and input values. The extension captures the main document; cross-origin frames and closed shadow roots remain outside its snapshot. The URL importer additionally fetches up to four visible public HTML embeds, with source links and a combined size limit. Use **Refresh source page** to fetch a new snapshot without losing your reading position. The extension is an unpacked build, not a Chrome Web Store release.

## Braille output

Select a named display profile to preview its cell width. The controls pan the dots and move between source blocks. For an actual display, focus the reading output through a supported screen reader; VoiceOver or NVDA handles translation and hardware routing.

No physical device was available for testing. The visual English dot mapping is illustrative, and the optional local BRLTTY adapter isn't wired into the current reader interface. See [hardware details](docs/HARDWARE.md).

## Checks and build

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The build also packages the extension. `scripts/check-live.ts` checks a real Jev request with the server key. [Judging evidence](docs/JUDGING.md) separates verified behavior from work that still needs device testing.

The main implementation lives in `shared/dom.ts`, `server/dom-jev.ts`, `server/page.ts`, `src/App.tsx` and `extension/`. URL fetching rejects private network destinations; the preview strips source scripts and runs its capture bridge in a sandbox. Capture limits are 60 blocks and 800 characters per block, with truncation reported in the snapshot. A DOM snapshot isn't a browser accessibility tree.
