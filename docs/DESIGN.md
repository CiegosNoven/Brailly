# Brailly design decisions

Direction from the user: retain the sage palette, cut explanatory copy, show the real page and Jev calls, and make the hardware recognizable by model. Apply the installed anti-slop skills during implementation.

Reading this as a working web reader for a hackathon demo, using a quiet instrument-like interface. Energy 1, rhythm 2, motion 1. Pin transitions and the temporary request spinner communicate state changes; no decorative looping motion.

- Sage stays because the user explicitly chose these colors. Darker text improves legibility without changing the palette.
- Analyze holds the expandable Jev card, URL input and source viewer. Read holds the named device and retained reading output. Both tabs share a reading queue on the right; it stacks below on mobile. Switching tabs preserves the source iframe and reading position.
- Geist provides readable interface labels; small monospaced figures align token counts and endpoint names. The hardware has its own physical labels.
- Spacing separates controls from the content they operate on. There is no marketing hero, FAQ, or feature-card section.
- Borders contain scrollable source and result panes. Shadows belong to the physical device preview and dialog, where depth has a purpose.
- Arrows indicate paging or a link opening elsewhere. Speaker, code and browser-panel icons name their controls.
- The device preview contains real text-derived dots. One simulation label distinguishes it from a physical connection; compatibility details live in a dialog.
- The user requested a search-like logo. An original lens enclosing a Braille B accompanies the corrected Brailly wordmark. The extension action uses a puzzle icon.
- One Analyze page action loads and classifies. Jev scores the snapshot in one batch; all pending rows become ranked together when the response arrives. Token details expand on demand. The tabs organize the same reader rather than changing its behavior.

The skill's setup wizard and extra approval steps are unnecessary here: the user explicitly requested installation, application during the ongoing work, the palette, the simplified layout and named hardware simulation. Existing code predates this skill; current changes use source patches and normal formatting.
