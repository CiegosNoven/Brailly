import type { VisualCandidate } from "./visual.js";
export type VisualInventory = {
  candidates: VisualCandidate[];
  totalCandidates: number;
  hidden: number;
  truncated: boolean;
};
// Serialized into the remote browser. Keep every helper inside this function.
export function extractVisualDocument(
  doc: Document,
  rendered = true,
): VisualInventory {
  const normalize = (s: string | null | undefined, max = 800) =>
    (s || "").replace(/\s+/g, " ").trim().slice(0, max);
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++)
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  };
  const nodes = Array.from(
    doc.querySelectorAll<HTMLElement>('img,canvas,svg,[role="img"]'),
  ).filter(
    (n) =>
      !n.closest("script,style,template,[data-brailly-ui]") &&
      !n.parentElement?.closest('svg,[role="img"],picture img'),
  );
  const used = new Set<string>();
  let next =
    nodes.reduce(
      (m, n) =>
        Math.max(
          m,
          Number(n.getAttribute("data-brailly-visual-id")?.slice(1)) || 0,
        ),
      0,
    ) + 1;
  const candidates: VisualCandidate[] = [];
  for (const node of nodes) {
    let candidateId = node.getAttribute("data-brailly-visual-id") || "";
    if (!/^v\d+$/.test(candidateId) || used.has(candidateId))
      candidateId = `v${next++}`;
    used.add(candidateId);
    node.setAttribute("data-brailly-visual-id", candidateId);
    const tag = node.tagName.toLowerCase();
    const kind =
      tag === "img"
        ? "img"
        : tag === "canvas"
          ? "canvas"
          : tag === "svg"
            ? "svg"
            : "role-img";
    const altStatus =
      kind === "img"
        ? node.hasAttribute("alt")
          ? node.getAttribute("alt") === ""
            ? "empty"
            : "present"
          : "missing"
        : "not-applicable";
    const sourceAltText =
      kind === "img" && node.hasAttribute("alt")
        ? normalize(node.getAttribute("alt"))
        : null;
    const title = normalize(
      node.getAttribute("title") ||
        (kind === "svg" ? node.querySelector("title")?.textContent : ""),
      300,
    );
    const labelled = node
      .getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent || "")
      .join(" ");
    const accessibleName = normalize(
      labelled || node.getAttribute("aria-label") || sourceAltText || title,
    );
    const caption = normalize(
      node.closest("figure")?.querySelector("figcaption")?.textContent,
    );
    const cleanContext = (element: Element | null) => {
      if (!element) return "";
      const copy = element.cloneNode(true) as Element;
      copy
        .querySelectorAll(
          'script,style,noscript,template,[hidden],[aria-hidden="true"],input,textarea,select',
        )
        .forEach((n) => n.remove());
      return normalize(copy.textContent);
    };
    let card: Element | null = null;
    for (let p = node.parentElement; p && p !== doc.body; p = p.parentElement) {
      if (
        (p.matches(
          'article,[role="listitem"],[data-deal-id],[data-product-id]',
        ) ||
          Array.from(p.classList).some((c) =>
            /(?:^|[-_])(card|location)(?:$|[-_])/i.test(c),
          )) &&
        p.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')
      ) {
        card = p;
        break;
      }
    }
    const section =
      card || node.closest("section,article,main,figure") || node.parentElement;
    let heading = "";
    for (const h of Array.from(
      section?.querySelectorAll("h1,h2,h3,h4,h5,h6") || [],
    )) {
      if ((h.compareDocumentPosition(node) & 4) !== 0)
        heading = normalize(h.textContent, 500);
    }
    const nearbyHeading =
      heading ||
      normalize(
        card?.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')?.textContent,
        500,
      );
    const context = node.closest("figure") || card || node.parentElement;
    const nearbyText = cleanContext(context);
    const interactive = node.closest('a,button,[role="button"],[role="link"]');
    const control = interactive
      ? {
          role: normalize(
            interactive.getAttribute("role") ||
              interactive.tagName.toLowerCase(),
            40,
          ),
          text: normalize(
            interactive.getAttribute("aria-label") || interactive.textContent,
            300,
          ),
        }
      : null;
    let hidden = false;
    for (
      let parent: Element | null = node;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent.hasAttribute("hidden") ||
        parent.hasAttribute("inert") ||
        parent.getAttribute("aria-hidden") === "true" ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
          parent.getAttribute("style") || "",
        )
      )
        hidden = true;
      if (rendered && doc.defaultView?.getComputedStyle) {
        const s = doc.defaultView.getComputedStyle(parent);
        if (
          s.display === "none" ||
          s.visibility === "hidden" ||
          s.opacity === "0"
        )
          hidden = true;
      }
    }
    const box =
      typeof node.getBoundingClientRect === "function"
        ? node.getBoundingClientRect()
        : {
            width: Number(node.getAttribute("width")) || 0,
            height: Number(node.getAttribute("height")) || 0,
            x: 0,
            y: 0,
          };
    if (rendered && (!box.width || !box.height)) hidden = true;
    const width = Math.max(0, Math.round(box.width)),
      height = Math.max(0, Math.round(box.height));
    const asset =
      kind === "img"
        ? (node as unknown as HTMLImageElement).currentSrc ||
          node.getAttribute("src") ||
          ""
        : kind === "svg"
          ? node.outerHTML
          : "";
    let pixels = "";
    if (kind === "canvas") {
      try {
        pixels = (node as unknown as HTMLCanvasElement).toDataURL();
        if (pixels.length > 4_000_000) pixels = "unverifiable";
      } catch {
        pixels = "unverifiable";
      }
    }
    const signature = hash(
      JSON.stringify({
        kind,
        altStatus,
        sourceAltText,
        title,
        accessibleName,
        caption,
        nearbyHeading,
        nearbyText,
        control,
        width,
        height,
        hidden,
        asset,
        pixels,
      }),
    );
    candidates.push({
      candidateId,
      kind,
      altStatus,
      sourceAltText,
      title,
      caption,
      accessibleName,
      nearbyHeading,
      nearbyText,
      control,
      width,
      height,
      x: Math.round(box.x + (doc.defaultView?.scrollX || 0)),
      y: Math.round(box.y + (doc.defaultView?.scrollY || 0)),
      hidden,
      locator: `[data-brailly-visual-id="${candidateId}"]`,
      signature: (pixels === "unverifiable" ? "unverifiable-" : "") + signature,
      asset: kind === "img" ? asset.slice(0, 2048) : "",
    });
  }
  // Include visible content first, while retaining hidden/empty/missing distinctions.
  const included = [
    ...candidates.filter((c) => !c.hidden),
    ...candidates.filter((c) => c.hidden),
  ].slice(0, 12);
  return {
    candidates: included,
    totalCandidates: candidates.length,
    hidden: candidates.filter((c) => c.hidden).length,
    truncated: candidates.length > included.length,
  };
}
