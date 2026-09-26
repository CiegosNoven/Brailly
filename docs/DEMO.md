# A short Brailly demo

Open the local app and choose **Play the demo**. Fixture mode works without an API key or Braille display.

1. **Set the scene:** “This is a simulated refreshable Braille display. The reader is before security, on their way to F18.”
2. **Noise:** “The app's weather keeps changing. The retained reading line stays where it was.”
3. **Notice:** “Checkpoint A stops accepting passengers. That changes this reader's route, so the prepared fixture interrupts. With a configured key, Jev makes this decision live and we show its actual result.”
4. **Resume:** “The exact saved line returns. Updates are still accessible in the queue.”
5. **Context:** “Now the reader is already at the gate. The same notice need not interrupt. The trace shows what the chosen engine actually decided.”
6. **Unscripted:** Enter a custom notice. Without a live key it is retained for review. With a live key the Choice response is validated and applied only if its context is still current.

Optional: Settings → delay decision, trigger a security notice, then change task. Show **Stale · dropped** and find the original event under **Pending updates**.

Close: “Brailly explores which updates deserve to interrupt touch. This demonstration validates scheduler behavior, while tactile use and real-device behavior still need testing.”

The ~15-second automated run can be paused and reset. Export the trace to preserve what actually happened. A live key, physical device, hackathon submission, and user validation are separate from the offline demonstration.
