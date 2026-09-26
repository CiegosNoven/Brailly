# Braille displays

Brailly previews how its reading text fits on a refreshable display. The selected model identifies the cell-width profile; the on-screen device doesn't establish a USB or Bluetooth connection.

| Display | Cells | VoiceOver connection |
| --- | ---: | --- |
| HumanWare Brailliant BI 20X | 20 | USB or Bluetooth |
| HumanWare Brailliant BI 40X | 40 | USB or Bluetooth |
| Freedom Scientific Focus 40 Blue | 40 | USB or Bluetooth |
| Freedom Scientific Focus 80 Blue | 80 | USB or Bluetooth |

Apple lists these models in its [supported Braille displays](https://support.apple.com/en-au/guide/voiceover/cpvobrailledisplays/mac). That documents VoiceOver compatibility; we haven't tested Brailly with physical hardware.

## Connect through a screen reader

On a Mac, connect a supported display by USB or pair it in VoiceOver Utility under Braille. Enable VoiceOver, open Brailly, and focus **Stable reading output**. VoiceOver controls the translation table, display routing and physical keys. A supported NVDA display can use the same text field on Windows; Brailly doesn't include an NVDA add-on.

The web preview uses an illustrative English dot mapping. A screen reader supplies the real translation, including the user's language and contractions. The app cannot detect a device connection through this path, and live announcements may affect speech and Braille differently depending on reader settings.

## Local BRLTTY adapter

`hardware/brltty_bridge.py` contains an experimental BrlAPI adapter. It connects to a configured local BRLTTY daemon, enters TTY mode, reports the driver and width, then accepts newline-delimited JSON messages such as:

```json
{"type":"write","text":"Museum closes at 3 pm"}
```

Run it with the operating-system Python that provides the `brlapi` binding. Configure BRLTTY for the exact model and verify its own output first. The adapter uses `writeText`, truncates to the display width, and doesn't implement routing keys or contracted translation. The current Brailly reader doesn't call this adapter; the hosted Vercel app cannot drive a visitor's local USB device.

The [BrlAPI manual](https://brltty.app/doc/Manual-BrlAPI/English/BrlAPI.html) documents the connection and TTY requirements.

Before claiming a physical integration, test the full reading flow with a device and a Braille reader: initial text, panning, deferred changes, interruption and resume. Record the device, operating system, screen reader, translation table and observed return position.
