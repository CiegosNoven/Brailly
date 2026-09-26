# Brailly: your web, in reading order

**We let blind people read web content seamlessly.**

## Problem

**43 million people are blind, and that number is expected to reach 61 million by 2050** ([The Lancet Global Health, 2021](https://www.thelancet.com/journals/langlo/article/PIIS2214-109X(20)30425-3/fulltext)). At least 2.2 billion people live with some kind of vision impairment ([WHO](https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment)).

**The web isn't built for them.** In 2026, WebAIM scanned the home pages of the top one million websites ([WebAIM Million 2026](https://webaim.org/projects/million/)):

- **95.9%** had accessibility failures, with **56 errors per page** on average.
- **82.7%** use ARIA, the code that tells screen readers what each part of a page is. Pages with ARIA had *more* errors than pages without it: 59 against 42 on average.
- **51%** have form fields with no label, and **46%** have links with no text. A screen reader can't say what those are.

These are only the errors an automated scan can find. WebAIM notes that not every failure can be detected this way, so the real picture is worse.

Sighted people skim. They glance at a page and find what they need in a second. People who use a screen reader or a refreshable Braille display read in sequence. A Braille display shows one line of 20 to 80 characters at a time. On a typical website, menus, banners and marketing copy come long before the thing you actually came for.

Screen readers let you jump by headings and landmarks. As the numbers above show, that only works as well as the page was built. It also doesn't know what you're looking for.

Live pages make it harder. Prices, wait times, countdowns and notices keep changing. On a single Braille line, every interruption replaces the line you were reading. Whether a change is worth an interruption depends on what you're trying to do, and the page doesn't know that either.

**Brailly starts from the reader's goal.** You say what you need. Brailly puts the page in that order and decides which live changes deserve your attention. It never rewrites a word of the page.

**The most important text comes first, almost as soon as the page opens.** Jev ranks the whole page in one fast call, usually in under a second. You don't wait for a model to write anything, and you don't dig through menus to find what you came for.

## Tech stack

```
Web page → extract DOM blocks → Jev (Score + Choice) → validated reading queue → Braille · screen reader
```

**Jev (`jev-1.13.0`, TypeSafe System One API)** makes every decision, one call per page snapshot:

- **Score (0–3), once per block:** how useful is this block for the reader's goal? The levels are *Unrelated*, *Background*, *Useful* and *Directly needed*.
- **Choice, once per block:** is it *Content*, an *Action*, *Navigation*, a *Notice* or *Extra*?
- **Choice for page changes:** when the page changes, the same call also gets the before and after text and the reader's exact position. Jev then picks one of four actions:
  - **DEFER:** keep reading.
  - **QUEUE_HIGH:** add it to the queue for later.
  - **INTERRUPT:** show it now.
  - **NONE:** not sure, flag it for review.

**Fast and cheap.**

- **Speed:** in our recorded runs, one call ranked a whole page in 0.3 to 1.7 seconds. Six of seven runs took under a second.
- **Cost:** Jev charges $0.042 per million input tokens, and output tokens are free ([TypeSafe models](https://docs.typesafe.ai/models)). At that price, ranking a typical page costs about **$0.0013, roughly an eighth of a cent**. One dollar covers about **800 pages**.
- **Live pages:** each time Brailly checks a change, that's one more call at a similar price.

**Code handles what code does best.** Routine countdown ticks are filtered out before they reach Jev. Low-confidence answers become "uncertain". Every response is checked with Zod before it's used:

- probabilities must add up to 1,
- each score must match its own probability distribution,
- each chosen label must have the highest probability,
- every block must be answered.

If any check fails, the whole result is rejected. Brailly never shows partial or made-up scores, and a failed call leaves the reader on the original page.

**The reader keeps their place.** While Jev is working, the current line stays put. If Jev interrupts, Brailly saves the exact position, and **Resume reading** goes back to it. Answers that arrive after the page or the task has moved on are thrown away.

**Stack:**

- **Frontend:** React 19, TypeScript and Vite.
- **Server:** Express 5, deployed as a Vercel function. The API key never leaves the server.
- **Page capture:** the same DOM extraction code runs in the browser, on the server (with linkedom) and in the extension.
- **Chrome extension:** Manifest V3 with `activeTab` and a side panel, built with esbuild. It follows the page you're on and sends changes as they happen. It never captures passwords or anything typed into forms.
- **Braille output:**
  - on-screen previews of real displays: Brailliant BI 20X and 40X, and Focus 40 and 80 Blue,
  - a stable text output that VoiceOver or NVDA can send to a physical display.
- **Safety:**
  - public URLs only, with private networks blocked,
  - the imported page is cleaned and shown in a sandbox,
  - rate limiting,
  - at most 60 blocks per page and 800 characters per block.
- **Tests:** 43 unit tests and 14 browser tests. The browser tests use a mocked model and are labeled as such. Real Jev calls are checked with separate scripts.

## Live demo

**https://brailly-jev.vercel.app**

1. **Analyze tab:** open an example link or paste any public URL.
2. Type what you're looking for in **Find**, then click **Analyze page**. The reading queue fills with every block, ranked by Jev for your goal. Open the **Jev** card to see the speed, the token counts and the full request and response.
3. **Read tab:** pick a queue item and read it on the Braille display preview. Pan across the line, move between blocks, or switch to a different display model.
4. **Live pages:** click **Get extension** and install it, then open a site that changes while you read. Brailly holds your line, shows Jev's decision for each change, and brings you back with **Resume reading**.

In our recorded runs on real sites, Jev classified a full 60-block page in 0.7 to 1.7 seconds. We tested on a live flight-deals site and a hospital's emergency wait times. These are individual runs, not a benchmark.

The Braille display on screen is a preview. Physical displays connect through VoiceOver or NVDA.

## Code

**https://github.com/CiegosNoven/Brailly**

| Where | What it does |
|---|---|
| `shared/dom.ts` | Pulls readable blocks out of any page and builds the reading order |
| `shared/live.ts` | Detects what changed between snapshots and filters routine countdown ticks |
| `server/dom-jev.ts` | Builds the Jev request and validates every answer |
| `server/page.ts`, `server/embedded-page.ts` | Safe public-page import and sanitized preview |
| `server/web-api.ts`, `api/index.ts` | The API, locally and on Vercel |
| `src/App.tsx`, `src/ReadingQueue.tsx`, `src/BrailleDevice.tsx` | Analyze and Read tabs, reading queue, Braille display |
| `extension/` | Chrome extension: capture and live updates |

Run it locally:

```sh
npm install
cp .env.example .env   # add TYPESAFE_API_KEY
npm run dev
```

Run the tests:

```sh
npm test
npm run test:e2e
```
