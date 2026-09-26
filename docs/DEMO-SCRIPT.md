# Brailly demo script

## Problem

We let blind people read web content seamlessly.

Forty-three million people are blind, and the web isn't built for them. This year, almost ninety-six percent of the top million home pages failed automated accessibility checks. Most use ARIA, the code meant for screen readers, and those pages have more errors, not fewer.

Also, if you read with a Braille display, you get one line at a time. Usually, that line is a menu or an ad, not what you came for. And live pages keep changing. Every update replaces the line you were reading.

## Tech stack

Brailly is a React web app, plus a Chrome extension. It sends every heading, paragraph, link and button to Jev in one call, with your goal. Jev scores each block from zero to three and labels what it is. When the page changes, Jev also decides: wait, queue it, or interrupt. We check every answer before using it. Ranking a whole page costs about an eighth of a cent, so one dollar covers around eight hundred pages.

## Live demo

I open one of our example links, type what I'm looking for, and press Analyze page. Within a second, my reading queue starts with what I asked for. These are the site's own words, never rewritten.

The Read tab shows a preview of a forty-cell Braille display. I can pan the line or jump to the next block.

Now a live page, through the extension. Countdown ticks are filtered out, so my line stays put. When something that matters for my task changes, Brailly saves my place, shows me the change, and brings me back.

## Code

The code is on GitHub. One server file builds the Jev request and checks every answer. Fifty-seven automated tests cover it.

Your goal decides the order, and your place is always saved. That's Brailly.
