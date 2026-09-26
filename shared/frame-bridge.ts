import { extractDocument } from "./dom";
import { snapshotSignature } from "./live";
const config = (
  window as unknown as { __BRAILLY: { token: string; url: string } }
).__BRAILLY;
const send = (type: string, data: object = {}) =>
  parent.postMessage(
    { brailly: true, token: config.token, type, ...data },
    "*",
  );
let observer: MutationObserver;
let timer: ReturnType<typeof setTimeout>;
let deadline: ReturnType<typeof setTimeout> | undefined;
let version = 0;
let signature = "";
const capture = () => {
  clearTimeout(timer);
  clearTimeout(deadline);
  deadline = undefined;
  const page = extractDocument(document, config.url, true);
  const next = snapshotSignature(page);
  if (next === signature) return;
  signature = next;
  page.source = ["/example.html", "/museum-tickets.html"].includes(
    new URL(config.url).pathname,
  )
    ? "example"
    : "url";
  send("snapshot", { page, version: ++version });
};
const highlight = (id: string) => {
  let style = document.getElementById("brailly-highlight");
  if (!style) {
    style = document.createElement("style");
    style.id = "brailly-highlight";
    style.setAttribute("data-brailly-ui", "");
    document.head.append(style);
  }
  style.textContent = /^b\d+$/.test(id)
    ? `[data-brailly-id="${id}"]{outline:3px solid #2d5bdb!important;outline-offset:4px!important;background-color:#eaf0ff!important}`
    : "";
};
const selectBlock = (id: string) => {
  const block = extractDocument(document, config.url, true, id).blocks.find(
    (block) => block.id === id,
  );
  if (block) {
    send("select", { id, block });
    highlight(id);
  }
};
const followFragment = (hash: string) => {
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {}
  const target =
    document.getElementById(id) ||
    Array.from(document.getElementsByName(id))[0];
  target?.scrollIntoView();
  const block =
    target?.closest<HTMLElement>("[data-brailly-id]") ||
    Array.from(
      target?.querySelectorAll<HTMLElement>("[data-brailly-id]") || [],
    ).find(
      (node) =>
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== "hidden",
    );
  if (block?.dataset.braillyId) {
    selectBlock(block.dataset.braillyId);
  }
};
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const anchor = target.closest<HTMLElement>("[data-brailly-href],a[href]");
  const block = target.closest<HTMLElement>("[data-brailly-id]");
  if (anchor) {
    event.preventDefault();
    const href =
      anchor.getAttribute("data-brailly-href") || anchor.getAttribute("href");
    if (href?.startsWith("#")) {
      followFragment(href);
      return;
    }
    if (href) {
      try {
        const url = new URL(href, config.url);
        if (
          url.origin === new URL(config.url).origin &&
          url.pathname === new URL(config.url).pathname &&
          url.search === new URL(config.url).search &&
          url.hash
        ) {
          followFragment(url.hash);
          return;
        }
        if (["http:", "https:"].includes(url.protocol))
          send("navigate", { url: url.href });
      } catch {}
    }
  } else if (block) {
    selectBlock(block.dataset.braillyId || "");
  }
});
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.token !== config.token) return;
  const m = event.data;
  if (m.type === "highlight") {
    highlight(m.id);
    return;
  }
  if (m.type === "demo-update") {
    const target = document.querySelector(
      `[data-demo="${m.kind === "entrance" ? "entrance" : m.kind === "hours" ? "hours" : "noise"}"]`,
    );
    if (target) {
      target.textContent =
        m.kind === "entrance"
          ? "Harbor Street entrance is now closed. Step-free access is temporarily through the East Lane entrance."
          : m.kind === "hours"
            ? "The museum now closes at 3 pm today. Last entry is at 2 pm."
            : `Member shop offer refreshed: ${new Date().toLocaleTimeString("en-US")}. Save 10% on art prints.`;
    }
  }
});
const start = () => {
  capture();
  observer = new MutationObserver((mutations) => {
    if (
      !mutations.some(
        (m) =>
          !(
            (m.target.nodeType === Node.ELEMENT_NODE
              ? m.target
              : m.target.parentElement) as HTMLElement
          )?.closest?.("[data-brailly-ui]"),
      )
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(capture, 450);
    if (!deadline) deadline = setTimeout(capture, 1500);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "hidden",
      "aria-hidden",
      "aria-label",
      "aria-labelledby",
      "href",
      "data-brailly-href",
      "role",
      "aria-disabled",
      "disabled",
      "class",
      "style",
    ],
  });
  const hash = new URL(config.url).hash;
  if (hash) {
    try {
      document
        .getElementById(decodeURIComponent(hash.slice(1)))
        ?.scrollIntoView();
    } catch {}
  }
};
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
