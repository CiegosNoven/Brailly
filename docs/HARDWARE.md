# From the simulator to a physical display

## Available now

The on-screen device is a simulation, as requested. It does not claim a physical connection. The scheduler's literal text is shared by the accessible output and optional hardware adapter; the simulated dots are an explanatory preview.

## Mac: VoiceOver

1. Connect a supported USB display or pair a supported Bluetooth display in VoiceOver Utility → Braille → Displays.
2. Enable VoiceOver and open the local demo in a supported browser.
3. Choose **Screen reader output**. Move the VoiceOver cursor to **Stable reading output** if necessary. The screen reader owns the translation table and output routing.
4. Trigger a weather update, security notice, and Resume. Check the actual physical line and the return position. Depending on focus and announcement settings, live regions may affect speech and Braille differently. The browser cannot verify the device's presence or control its entire output.
5. Record display model, OS, browser, screen reader version, translation table, cursor mode, and observed behavior before presenting a physical integration as verified.

Apple's [Braille display settings](https://support.apple.com/en-au/guide/voiceover/cpvoubradisplays/mac) document the supported connection path. On Windows, the same stable field can be explored with NVDA and a supported display; no NVDA add-on is included.

## Linux: direct BRLTTY

This path uses BRLTTY's drivers instead of attempting arbitrary WebUSB writes to an unknown device.

1. Install and configure BRLTTY for the exact model. On Debian/Ubuntu, the relevant packages typically include `brltty` and `python3-brlapi`.
2. Verify BRLTTY itself operates the display, and that your user can authenticate to its local BrlAPI service. Keep the service local. Authentication normally uses the system BrlAPI key and permissions.
3. Start Reflow from a terminal/TTY recognized by BrlAPI. If it cannot infer a TTY in a desktop session, start from a configured terminal with `WINDOWID` or the appropriate `CONTROLVT`; do not guess a device-specific driver protocol.
4. Set `BRLAPI_PYTHON` in `.env` to the Python interpreter that has the system `brlapi` binding, and restart Reflow.
5. In **Hardware**, choose **Try local BRLTTY connection**. A successful connection reports the actual driver and width from BrlAPI. Errors are displayed directly.
6. Read the output, trigger a notice, then Resume. Use the web controls to pan. Disconnect when finished to release the TTY.

The bridge calls `Connection`, `enterTtyMode`, `displaySize`, and `writeText`. `writeText` uses BRLTTY's one-to-one computer-Braille table; contracted translation needs an additional translation layer such as Liblouis. On displays narrower than 40 cells this prototype truncates the text output to the device width; use the screen-reader path for complete device-native panning. Hardware routing keys and multi-line translation are not implemented.

## Device acceptance checklist

- Connection status comes from the device service rather than a UI toggle.
- Verify text and actual raised dots with the intended translation table.
- Confirm a deferred update leaves the physical output stable.
- Confirm a literal critical notice appears and can be fully read.
- Confirm Resume restores the appropriate physical reading position.
- Verify disconnect, driver failure, and unavailable-device behavior.
- Test with Braille readers before making usability claims.

No device was available during development. The direct adapter has an implemented interface and failure path, not a completed hardware validation.

Sources: [BrlAPI manual](https://brltty.app/doc/Manual-BrlAPI/English/BrlAPI.html), [writing text and translation](https://brltty.app/doc/BrlAPIref/group__brlapi__write.html), [Python binding source](https://github.com/brltty/brltty/blob/master/Bindings/Python/brlapi.pyx).
