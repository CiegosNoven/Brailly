# Brailly · Web to Braille

Open a website, tell Brailly what you need, and let Jev classify the actual DOM into a reading order. Read exact source text with a screen reader, voice, or the simulated Braille display.

**Live demo:** https://brailly-jev.vercel.app

## Run

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY in .env (server only).
npm run dev
```

The demo accepts public website URLs and includes a sample museum website. URL imports are sanitized HTML snapshots; use the Chrome extension for a live rendered DOM. Each captured block gets a real Jev Score (0–3 relevance) and Choice (content, action, navigation, notice or extra). No generated summaries or fabricated AI scores are substituted when the service fails.

## Extension

Download `brailly-extension.zip` from the deployed site, unzip it, and use Chrome → Extensions → Developer mode → Load unpacked. Click Brailly on the website you want to read. It uses active-tab access and opens a side panel. Passwords and input values are excluded; page text is sent to the classifier when requested. It captures the main frame, not cross-origin frames or closed shadow roots.

## Hardware and accessible output

The screen shows a labeled 20/40/80-cell visual simulator. Keyboard controls, exact source text, polite screen-reader output and browser speech work without seeing the walkthrough. The visual dot table is illustrative English, not a certified translation engine.

A real supported display connects through VoiceOver or NVDA; the screen reader owns Braille translation and routing. `hardware/brltty_bridge.py` is an optional local BRLTTY adapter. Vercel cannot access a visitor's USB hardware. No physical hardware validation is claimed.

## Validate and build

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm run build` also packages the Chrome extension. Browser tests clearly use test-only model mocks to exercise deterministic UI behavior; actual Jev calls are verified separately with `scripts/check-live.ts` and never inferred from mock tests.

## Implementation

- `shared/dom.ts`: bounded semantic DOM extraction and reading order.
- `server/page.ts`: public URL fetch, network-address checks, sanitized preview.
- `server/dom-jev.ts`: structured Score and Choice questions, response validation.
- `server/web-api.ts`, `api/index.ts`: server-only credentials and Vercel API.
- `src/App.tsx`: explorer, result inspection, accessible output and simulator.
- `extension/`: active-tab capture and Chrome side panel.
- `src/runtime.ts`: earlier ReadLease scheduler invariants retained for integration.

The prototype captures up to 60 blocks and 800 characters per block, and reports truncation. Server HTML is not the same as the browser accessibility tree. The supplied masterplan was prior planning material; this repository does not claim hackathon eligibility, CodeRabbit review, event submission, physical device testing, or user-validation results.

References: [Jev Score](https://docs.typesafe.ai/primitives/score), [structured questions](https://docs.typesafe.ai/primitives/advanced), [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [VoiceOver Braille](https://support.apple.com/en-au/guide/voiceover/cpvoubradisplays/mac).
