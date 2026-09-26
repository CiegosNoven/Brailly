# Brailly verification

Local checks: 25 unit tests and 8 browser tests pass. Production build passes. Browser tests use explicit test-only model responses; live Jev checks are separate.

| Check | Result | Evidence |
| --- | --- | --- |
| Real pages | PASS | TypeSafe Score, Wikipedia Braille and W3C accessibility pages loaded with source styling. A W3C link imported its Components page. |
| Live classification | PASS | Actual Jev responses supplied Score, Choice, latency and input/output token counts. An offer change returned DEFER; an entrance closure returned INTERRUPT. |
| Retained reading | PASS | Browser regression tests cover nonzero line position, interruption, resume and obsolete response rejection. |
| Controls | PASS | Analyze page, keyboard tabs, queue selection, source selection, previous/next block, line panning, model selection, cell inspection, link navigation, dialog dismissal and result export have working handlers; core interactions were exercised in Chrome. |
| Reading queue | PASS | Browser tests check simultaneous pending state for all blocks, ordering from the batch response and queue selection opening Read. Switching tabs preserves the iframe, its mutations and the reading position. |
| Device profiles | PASS | 20/40/40/80 cells match Brailliant BI 20X/40X and Focus 40/80 Blue selections. Cell inspection responds to click and arrow keys. |
| Layout | PASS | Desktop and 390px mobile views show no page overflow. Forty-cell hardware fits a 520px column; eighty-cell hardware scrolls internally. |
| Automated accessibility | PASS | Axe reports no violations in Brailly controls and the hardware dialog. Third-party iframe contents are excluded. This does not replace screen-reader or Braille-reader testing. |
| Honest content | PASS | API usage comes from real responses. One Simulation label identifies the device preview; no physical connection or certification is claimed. |
| Design direction | PASS | User-selected sage palette, larger type, Analyze/Read tabs with a shared queue, original search-and-Braille logo. See DESIGN.md for decisions. |

The extension loaded in a real Chrome profile and captured, recaptured and focused source text. Automation used a temporary localhost permission; the native toolbar permission grant remains unverified. Physical hardware and user validation remain pending.
