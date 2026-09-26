# Brailly demo

Open [Brailly](https://brailly-jev.vercel.app). Analyze shows the webpage and Jev; Read shows the device. The reading queue remains available in both tabs.

1. Load **Museum demo** and use the task: `Find the opening hours, ticket price, and accessible entrance.` Choose **Analyze page**. Watch the queue move from pending to ranked when the batch response arrives. Expand **Jev** to inspect the endpoint, input/output tokens and request.
2. Open **Read**, select a queue item, pan the Braille line, then select another device profile. The text comes directly from the page; changing the profile changes the available cells.
3. Return to **Analyze**, expand **Test page changes**, then choose **Change offer**. Watch the DOM change and Jev return its decision. The reader should keep its position when Jev defers the promotion.
4. Choose **Close entrance**. Show Jev's new decision, the changed source text on the device, and **Resume reading**. On the verified live run, Jev interrupted for the entrance closure and resumed the saved line. Decisions can vary with task and context.
5. Paste a real public URL. Follow a link in the imported page and classify its contents, or use the Chrome extension on a rendered website. Open request/response details if the judges want to inspect the payload.

**Run demo** performs the offer and entrance changes in sequence. The museum is sample content; its mutations are real, and Jev evaluates them live.

For a JavaScript application, install the extension first. Open the source website, click Brailly, capture and classify. After changing the source page, recapture it when the change notice appears. The extension currently requires this manual refresh.

If Jev returns a service error, the reader keeps the source text and shows the error. Retry when the service is available; don't describe retained text as a new classification.
