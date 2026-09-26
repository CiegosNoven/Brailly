import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  Waveform as AudioLines,
  Check,
  CaretDown as ChevronDown,
  Code as Code2,
  DownloadSimple as Download,
  Globe,
  Headphones,
  Stack as Layers,
  CircleNotch as LoaderCircle,
  Cursor as MousePointer2,
  SidebarSimple as PanelRight,
  Play,
  ArrowsClockwise as RefreshCw,
  MagnifyingGlass as Search,
  Sliders as Settings2,
  ShieldCheck,
  SpeakerHigh as Volume2,
  SpeakerSlash as VolumeX,
  X,
  PuzzlePiece,
} from "@phosphor-icons/react";
import {
  extractDocument,
  readingOrder,
  type PageSnapshot,
  type Classification,
  type DomBlock,
  type ReadContext,
} from "../shared/dom";
import { toBraille } from "./braille";
import { frameDocument } from "./frame";
import BrailleDevice from "./BrailleDevice";
const extension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
const API = extension ? "https://brailly-jev.vercel.app" : "";
const categoryLabel = {
  CONTENT: "Content",
  ACTION: "Action",
  NAVIGATION: "Navigation",
  NOTICE: "Notice",
  EXTRA: "Extra",
};
export default function App() {
  const [page, setPage] = useState<PageSnapshot | null>(null);
  const [url, setUrl] = useState("");
  const [task, setTask] = useState(
    "Find the opening hours, ticket price, and accessible entrance.",
  );
  const [result, setResult] = useState<Classification | null>(null);
  const [busy, setBusy] = useState<"load" | "rank" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Choose a web page to get started.");
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [cellOffset, setCellOffset] = useState(0);
  const [cells, setCells] = useState(40);
  const [modal, setModal] = useState<"extension" | "hardware" | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reading, setReading] = useState<DomBlock | null>(null);
  const [saved, setSaved] = useState<{
    block: DomBlock;
    offset: number;
    cellOffset: number;
  } | null>(null);
  const [frame, setFrame] = useState<{ html: string; token: string } | null>(
    null,
  );
  const iframe = useRef<HTMLIFrameElement>(null);
  const auto = true;
  const [playing, setPlaying] = useState(false);
  const demoRun = useRef(0);
  const [timeline, setTimeline] = useState<
    {
      id: string;
      decision: string;
      at: string;
      latencyMs: number;
      model: string;
      text: string;
      confidence?: number;
    }[]
  >([]);
  const frameHandler = useRef<(event: MessageEvent) => void>(() => {});
  const session = useRef({ busy: false, pageId: "", timeline: 0 });
  session.current = {
    busy: !!busy,
    pageId: page?.id || "",
    timeline: timeline.length,
  };
  const initialized = useRef(false);
  const navigateRank = useRef(false);
  const [frameReady, setFrameReady] = useState(false);
  const [calls, setCalls] = useState(0);
  const [lastCall, setLastCall] = useState<Classification | null>(null);
  const epoch = useRef(0);
  const output = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    return () => {
      abort.current?.abort();
      speechSynthesis?.cancel();
    };
  }, []);
  function acceptPage(p: PageSnapshot) {
    epoch.current++;
    abort.current?.abort();
    setPage(p);
    setResult(null);
    setFrameReady(false);
    setSelected(p.blocks[0]?.id || "");
    setReading(p.blocks[0] || null);
    setSaved(null);
    if (p.previewHtml && !extension) {
      const token = crypto.randomUUID();
      setFrame({ html: frameDocument(p.previewHtml, p.url, token), token });
    } else setFrame(null);
    setOffset(0);
    setCellOffset(0);
    setChanged(false);
    setError("");
    setStatus(`${p.blocks.length} DOM blocks captured. Ready for Jev.`);
  }
  useEffect(() => {
    if (!extension) return;
    chrome.storage.session
      .get(["snapshot", "captureError", "pageChanged"])
      .then((v) => {
        if (v.snapshot) acceptPage(v.snapshot as PageSnapshot);
        if (v.captureError) setError(String(v.captureError));
        setChanged(!!v.pageChanged);
      });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "session") return;
      if (changes.snapshot?.newValue)
        acceptPage(changes.snapshot.newValue as PageSnapshot);
      if (changes.captureError)
        setError(String(changes.captureError.newValue || ""));
      if (changes.pageChanged) setChanged(!!changes.pageChanged.newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function loadExample(path = "/example.html", classify = false) {
    setBusy("load");
    setError("");
    try {
      const html = await fetch(API + path).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const p = extractDocument(doc, (API || location.origin) + path);
      p.source = "example";
      p.previewHtml = "<!doctype html>" + doc.documentElement.outerHTML;
      navigateRank.current = classify;
      acceptPage(p);
      setUrl(p.url);
      return p;
    } catch {
      setError("Could not load the sample website.");
      return null;
    } finally {
      setBusy(null);
    }
  }
  async function loadUrl(nextUrl?: string) {
    const raw = (nextUrl || url).trim();
    try {
      const local = new URL(raw, location.origin);
      if (
        local.origin === (API || location.origin) &&
        ["/example.html", "/museum-tickets.html"].includes(local.pathname)
      ) {
        void loadExample(local.pathname, !!nextUrl && auto);
        return;
      }
    } catch {}
    setBusy("load");
    setError("");
    epoch.current++;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const token = epoch.current;
    try {
      const response = await fetch(API + "/api/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          url: raw.startsWith("http") ? raw : "https://" + raw,
        }),
      });
      const p = await response.json();
      if (!response.ok) throw new Error(p.error);
      if (epoch.current !== token) return;
      navigateRank.current = !!nextUrl && auto;
      acceptPage(p);
      setUrl(p.url);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function rank(target = page, context?: ReadContext) {
    if (!target) return;
    const token = ++epoch.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy("rank");
    setError("");
    setStatus("Jev is scoring relevance and classifying each DOM block…");
    const goal = task;
    try {
      const { previewHtml, ...payload } = target;
      setCalls((n) => n + 1);
      const r = await fetch(API + "/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ page: payload, task: goal, context }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setLastCall(data);
      if (token !== epoch.current) return;
      setResult(data);
      const order = readingOrder(target, data);
      if (context) {
        const previous = new Map(
          context.previousBlocks.map((b) => [b.id, b.text]),
        );
        const changedBlocks = order.filter(
          (b) => previous.get(b.id) !== b.text,
        );
        const decision = data.transition?.choice || "NONE";
        setTimeline((rows) => [
          {
            id: target.id,
            decision,
            at: new Date().toISOString(),
            latencyMs: data.latencyMs,
            model: data.model,
            text:
              changedBlocks.map((b) => b.text).join(" / ") ||
              "Source blocks removed.",
            confidence: data.transition?.confidence,
          },
          ...rows,
        ]);
        if (decision === "INTERRUPT" && changedBlocks[0]) {
          setSaved(
            (prior) =>
              prior || {
                block: context.current,
                offset: context.offset,
                cellOffset,
              },
          );
          setReading(changedBlocks[0]);
          setSelected(changedBlocks[0].id);
          setOffset(0);
          setCellOffset(0);
          setStatus(
            "Jev interrupted for a relevant update. Resume returns to your saved position.",
          );
        } else
          setStatus(
            `Jev: ${decision}. Your reading position is held; changes remain available.`,
          );
      } else {
        const first = order[0];
        setReading(first || null);
        setSelected(first?.id || "");
        setOffset(0);
        setCellOffset(0);
        setStatus(
          `Jev classified ${data.results.length} DOM blocks in ${data.latencyMs} milliseconds. Reading order is ready.`,
        );
      }
    } catch (e) {
      if (token !== epoch.current) {
        if (context)
          setTimeline((rows) => [
            {
              id: target.id,
              decision: "STALE",
              at: new Date().toISOString(),
              latencyMs: 0,
              model: "Runtime",
              text: "Reading context changed. The obsolete result was dropped; source updates remain available.",
            },
            ...rows,
          ]);
        return;
      }
      if (context)
        setTimeline((rows) => [
          {
            id: target.id,
            decision: "REVIEW",
            at: new Date().toISOString(),
            latencyMs: 0,
            model: "Fallback",
            text: "The model was unavailable. Changes remain available without replacing the retained line.",
          },
          ...rows,
        ]);
      if (e instanceof Error && e.name !== "AbortError") {
        setError(e.message);
        setStatus(
          "Your source text remains available. No AI scores were applied.",
        );
      }
    } finally {
      if (token === epoch.current) setBusy(null);
    }
  }
  useEffect(() => {
    if (!extension && !initialized.current) {
      initialized.current = true;
      void loadExample();
    }
  }, []);
  function updateTask(value: string) {
    epoch.current++;
    abort.current?.abort();
    setBusy(null);
    setTask(value);
    setResult(null);
    setStatus("Task changed. Classify again to get a new reading order.");
  }
  const ordered = page ? readingOrder(page, result) : [];
  const current =
    reading || page?.blocks.find((b) => b.id === selected) || ordered[0];
  const selectedIndex = ordered.findIndex((b) => b.id === current?.id);
  const text = current?.text || "Your selected text will appear here.";
  const chars = Array.from(text);
  const line = chars.slice(offset, offset + cells).join("");
  const allDots = toBraille(line);
  const dots = allDots.slice(cellOffset, cellOffset + cells);
  const ranks = new Map(result?.results.map((r) => [r.id, r]) || []);
  function readBlock(block: DomBlock) {
    epoch.current++;
    abort.current?.abort();
    setBusy(null);
    setReading(block);
    setSaved(null);
    setSelected(block.id);
    setOffset(0);
    setCellOffset(0);
    setStatus(`Reading ${block.role}: ${block.text}`);
    if (speaking) speak(block.text);
  }
  function pan(direction: number) {
    epoch.current++;
    abort.current?.abort();
    setBusy(null);
    setOffset((o) =>
      Math.min(
        Math.max(0, o + direction * cells),
        Math.max(0, Math.floor((chars.length - 1) / cells) * cells),
      ),
    );
    setCellOffset(0);
  }
  function speak(value = text) {
    if (!("speechSynthesis" in window)) {
      setError(
        "This browser does not support speech. The text output works with your screen reader.",
      );
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(utterance);
  }
  function stopSpeech() {
    speechSynthesis.cancel();
    setSpeaking(false);
  }
  async function captureTab() {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "capture" });
    } catch {
      setError("Open a web page and click the Brailly extension icon first.");
    }
  }
  function exportTrace() {
    if (!result) return;
    const blob = new Blob(
      [JSON.stringify({ page, result, timeline }, null, 2)],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    const u = URL.createObjectURL(blob);
    link.href = u;
    link.download = "brailly-dom-classification.json";
    link.click();
    URL.revokeObjectURL(u);
  }
  function resume() {
    if (!saved) return;
    epoch.current++;
    abort.current?.abort();
    setBusy(null);
    setReading(saved.block);
    setSelected(saved.block.id);
    setOffset(saved.offset);
    setCellOffset(saved.cellOffset);
    setSaved(null);
    setStatus(
      "Restored the exact saved block, text offset and Braille cell page.",
    );
  }
  function sendUpdate(kind: string) {
    if (frame)
      iframe.current?.contentWindow?.postMessage(
        { token: frame.token, type: "demo-update", kind },
        "*",
      );
  }
  frameHandler.current = (event: MessageEvent) => {
    if (
      !frame ||
      event.source !== iframe.current?.contentWindow ||
      event.data?.token !== frame.token
    )
      return;
    const m = event.data;
    if (m.type === "select") {
      const candidate = m.block;
      const captured =
        candidate &&
        /^b\d+$/.test(candidate.id) &&
        typeof candidate.text === "string" &&
        candidate.text.length > 0 &&
        candidate.text.length <= 800 &&
        typeof candidate.tag === "string" &&
        candidate.tag.length <= 20 &&
        typeof candidate.role === "string" &&
        candidate.role.length <= 40 &&
        typeof candidate.region === "string" &&
        candidate.region.length <= 40;
      const block =
        pageRef.current?.blocks.find((b) => b.id === m.id) ||
        (captured ? (candidate as DomBlock) : undefined);
      if (block) readBlock(block);
    } else if (m.type === "navigate" && typeof m.url === "string") {
      void loadUrl(m.url);
    } else if (m.type === "snapshot") {
      const previous = pageRef.current;
      const incoming = m.page as PageSnapshot;
      if (!incoming?.blocks?.length) return;
      const next = { ...incoming, previewHtml: previous?.previewHtml };
      if (m.version === 1) {
        setFrameReady(true);
        epoch.current++;
        abort.current?.abort();
        setBusy(null);
        setPage(next);
        setResult(null);
        if (!current || !next.blocks.some((b) => b.id === current.id)) {
          setReading(next.blocks[0]);
          setSelected(next.blocks[0].id);
        }
        setStatus(`${next.blocks.length} rendered DOM blocks ready.`);
        if (navigateRank.current) {
          navigateRank.current = false;
          void rank(next);
        }
        return;
      }
      setPage(next);
      setChanged(false);
      setStatus("DOM changed. Your reading line is held while Jev evaluates.");
      if (previous && current && auto)
        void rank(next, { current, offset, previousBlocks: previous.blocks });
      else {
        setResult(null);
        setTimeline((rows) => [
          {
            id: next.id,
            decision: "PENDING",
            at: new Date().toISOString(),
            latencyMs: 0,
            model: "Runtime",
            text: "The page changed. Classify to evaluate the update.",
          },
          ...rows,
        ]);
      }
    }
  };
  useEffect(() => {
    const listener = (event: MessageEvent) => frameHandler.current(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (frame && current)
      iframe.current?.contentWindow?.postMessage(
        { token: frame.token, type: "highlight", id: current.id },
        "*",
      );
  }, [current?.id, frame]);
  async function playUpdates() {
    if (playing) {
      demoRun.current++;
      setPlaying(false);
      return;
    }
    const run = ++demoRun.current;
    setPlaying(true);
    for (const kind of ["noise", "entrance"]) {
      if (run !== demoRun.current) return;
      const old = session.current.timeline;
      sendUpdate(kind);
      const deadline = Date.now() + 26000;
      while (
        Date.now() < deadline &&
        session.current.timeline === old &&
        run === demoRun.current
      )
        await new Promise((r) => setTimeout(r, 200));
      if (run !== demoRun.current) return;
      if (session.current.timeline === old) break;
      await new Promise((r) => setTimeout(r, 1800));
    }
    if (run === demoRun.current) setPlaying(false);
  }
  useEffect(
    () => () => {
      demoRun.current++;
    },
    [],
  );
  const usage = lastCall?.usage as
    { input_tokens?: number; output_tokens?: number } | undefined;
  const historical =
    current &&
    page?.blocks.find((b) => b.id === current.id)?.text !== current.text;

  async function readPage() {
    if (extension) {
      if (page) await rank();
      else await captureTab();
      return;
    }
    if (page && url.trim() === page.url) await rank();
    else await loadUrl(url);
  }
  return (
    <div className={extension ? "reflow extension-app" : "reflow"}>
      <a className="skip" href="#reading-output">
        Skip to reading output
      </a>
      <header className="header">
        <a className="wordmark" href="/" aria-label="Brailly home">
          <svg className="brand-mark" width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
            <rect x="3" y="3" width="27" height="29" rx="12" fill="none" stroke="currentColor" strokeWidth="3"/>
            <path d="m28 29 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
            <circle cx="12" cy="11" r="2.7" fill="currentColor"/><circle cx="12" cy="18" r="2.7" fill="currentColor"/>
            <g fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="21" cy="11" r="2.1"/><circle cx="21" cy="18" r="2.1"/><circle cx="12" cy="25" r="2.1"/><circle cx="21" cy="25" r="2.1"/></g>
          </svg>brailly
        </a>
        <button
          className="extension-button"
          onClick={() => setModal("extension")}
        >
          <PuzzlePiece size={22} /> Get extension
        </button>
      </header>
      <main>
        <h1 className="page-title">Read the web in Braille.</h1>
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={22} />
            </button>
          </div>
        )}
        {changed && (
          <div className="warning" role="status">
            Page changed. <button onClick={captureTab}>Refresh capture</button>
          </div>
        )}
        <div className="workspace-grid">
          <div className="web-column">
            <details className="jev-details">
              <summary>
                <strong>Jev</strong>
                <span>
                  {lastCall
                    ? lastCall.latencyMs +
                      " ms · " +
                      (
                        (usage?.input_tokens || 0) + (usage?.output_tokens || 0)
                      ).toLocaleString() +
                      " tokens"
                    : "Score + Choice"}
                </span>
                <ChevronDown size={20} />
              </summary>
              <div className="call-destination">
                <code>POST api.typesafe.ai/v1/systemone</code>
                <span>{lastCall?.model || "jev-1.13.0"}</span>
              </div>
              <div className="jev-metrics">
                <div>
                  <span>Input tokens</span>
                  <b>{usage?.input_tokens?.toLocaleString() ?? "N/A"}</b>
                </div>
                <div>
                  <span>Output tokens</span>
                  <b>{usage?.output_tokens?.toLocaleString() ?? "N/A"}</b>
                </div>
                <div>
                  <span>Last response</span>
                  <b>{lastCall ? lastCall.latencyMs + " ms" : "N/A"}</b>
                </div>
                <div>
                  <span>Calls this session</span>
                  <b>{calls}</b>
                </div>
              </div>
              <div className="call-schema">
                {page?.blocks.length || 0}
                {page?.truncated ? " / " + page.totalCandidates : ""} DOM blocks
                → Score 0–3 + Choice
              </div>
              {result && (
                <div className="classification-results">
                  {readingOrder(page!, result)
                    .slice(0, 5)
                    .map((b) => {
                      const r = ranks.get(b.id);
                      if (!r) return null;
                      return (
                        <button key={b.id} onClick={() => readBlock(b)}>
                          <span>{b.text}</span>
                          <b>{r.score.toFixed(1)} / 3</b>
                          <small>{categoryLabel[r.category]}</small>
                        </button>
                      );
                    })}
                </div>
              )}
              {timeline.length > 0 && (
                <div className="decision-trail">
                  {timeline.slice(0, 4).map((row, i) => (
                    <div className="trail-row" key={row.id + "-" + i}>
                      <b className={"transition " + row.decision.toLowerCase()}>
                        {row.decision}
                      </b>
                      <p>{row.text}</p>
                      <span>
                        {row.latencyMs > 0 ? row.latencyMs + " ms" : row.model}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <details className="request-details">
                <summary>Request / response</summary>
                <button onClick={exportTrace} disabled={!result}>
                  <Download size={18} /> Export result
                </button>
                <pre>
                  {JSON.stringify(
                    result
                      ? {
                          request: result.request,
                          response: {
                            model: result.model,
                            usage: result.usage,
                            latencyMs: result.latencyMs,
                            transition: result.transition,
                            results: result.results,
                          },
                        }
                      : page
                        ? { task, dom: page.blocks }
                        : "Read a page to inspect the call.",
                    null,
                    2,
                  )}
                </pre>
              </details>
            </details>
            <section className="input-panel" aria-label="Page and task">
              <div className="input-line">
                <label htmlFor="url">Website</label>
                <input
                  id="url"
                  type="text"
                  placeholder="Paste a website URL"
                  value={url}
                  disabled={extension}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void readPage();
                  }}
                />
                {extension && (
                  <button onClick={captureTab} aria-label="Capture tab">
                    <RefreshCw size={22} />
                  </button>
                )}
              </div>
              <div className="task-line">
                <label htmlFor="goal">Find</label>
                <input
                  id="goal"
                  value={task}
                  maxLength={500}
                  placeholder="What do you want to read?"
                  onChange={(e) => updateTask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void readPage();
                  }}
                />
                <button
                  className="primary"
                  onClick={() => void readPage()}
                  disabled={
                    busy !== null ||
                    task.trim().length < 3 ||
                    !url.trim() ||
                    (!!frame && !frameReady)
                  }
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={20} />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                  {busy === "load"
                    ? "Loading page"
                    : busy === "rank"
                      ? "Jev is reading"
                      : "Read page"}
                </button>
              </div>
            </section>
            {!extension && (
              <div className="under-input">
                <button disabled={!!busy} onClick={() => void loadExample()}>
                  Museum demo
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    updateTask(
                      "Learn how Braille works and how refreshable displays are used.",
                    );
                    void loadUrl("https://en.wikipedia.org/wiki/Braille");
                  }}
                >
                  Wikipedia
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    updateTask(
                      "Understand how to use a Score and interpret its result.",
                    );
                    void loadUrl("https://docs.typesafe.ai/primitives/score");
                  }}
                >
                  Jev docs
                </button>
              </div>
            )}
            {!extension && (
              <section className="source-panel">
                <h2>Web page</h2>
                <div className="browser-frame">
                  <div className="browser-bar">
                    <span>
                      {page ? new URL(page.url).hostname : "Your website"}
                    </span>
                    <button
                      disabled={!page}
                      aria-label="Open original page"
                      onClick={() =>
                        page &&
                        window.open(page.url, "_blank", "noopener,noreferrer")
                      }
                    >
                      <ArrowUpRight size={20} />
                    </button>
                  </div>
                  {frame ? (
                    <iframe
                      data-token={frame.token}
                      ref={iframe}
                      title="Interactive source page"
                      sandbox="allow-scripts"
                      srcDoc={frame.html}
                    />
                  ) : (
                    <div className="empty-source">
                      Paste a website above to open it here.
                    </div>
                  )}
                </div>
                {page?.source === "example" && (
                  <details className="demo-controls">
                    <summary>Test page changes</summary>
                    <div className="live-controls">
                      <button
                        onClick={() => sendUpdate("noise")}
                        disabled={!!busy}
                      >
                        Change offer
                      </button>
                      <button
                        onClick={() => sendUpdate("entrance")}
                        disabled={!!busy}
                      >
                        Close entrance
                      </button>
                      <button
                        onClick={() => sendUpdate("hours")}
                        disabled={!!busy}
                      >
                        Change hours
                      </button>
                      <button
                        onClick={() => void playUpdates()}
                        disabled={!result && !playing}
                      >
                        <Play size={18} />
                        {playing ? "Stop demo" : "Run demo"}
                      </button>
                    </div>
                  </details>
                )}
              </section>
            )}
          </div>
          <div className="device-column">
            <section className="output-section" aria-label="Braille output">
              <div className="output-heading">
                <h2>Braille display</h2>
                <button
                  className="hardware-link"
                  onClick={() => setModal("hardware")}
                >
                  Compatible devices
                </button>
              </div>
              <BrailleDevice
                dots={dots}
                cells={cells}
                line={line}
                page={Math.floor(cellOffset / cells) + 1}
                pages={Math.max(1, Math.ceil(allDots.length / cells))}
                interrupted={!!saved}
                canPanLeft={cellOffset > 0 || offset > 0}
                canPanRight={
                  cellOffset + cells < allDots.length ||
                  offset + cells < chars.length
                }
                onLeft={() =>
                  cellOffset > 0
                    ? setCellOffset(Math.max(0, cellOffset - cells))
                    : pan(-1)
                }
                onRight={() =>
                  cellOffset + cells < allDots.length
                    ? setCellOffset(cellOffset + cells)
                    : pan(1)
                }
                onPrevious={() => {
                  if (ordered[selectedIndex - 1])
                    readBlock(ordered[selectedIndex - 1]);
                }}
                onNext={() => {
                  if (ordered[selectedIndex + 1])
                    readBlock(ordered[selectedIndex + 1]);
                }}
                hasPrevious={selectedIndex > 0}
                hasNext={selectedIndex < ordered.length - 1}
                onResume={saved ? resume : undefined}
                onCells={(value) => {
                  setCells(value);
                  setCellOffset(0);
                }}
              />
            </section>
            <section className="reading-panel">
              <h2>Reading</h2>
              <label className="sr-only" htmlFor="block-picker">
                Reading block
              </label>
              <select
                className="reading-picker"
                id="block-picker"
                value={current?.id || ""}
                onChange={(e) => {
                  const b = page?.blocks.find((b) => b.id === e.target.value);
                  if (b) readBlock(b);
                }}
              >
                {current && !ordered.some((b) => b.id === current.id) && (
                  <option value={current.id}>
                    {current.text.slice(0, 100)}
                  </option>
                )}
                {ordered.map((b, i) => (
                  <option key={b.id} value={b.id}>
                    {i + 1}. {b.text.slice(0, 100)}
                  </option>
                ))}
              </select>
              <div className="text-output">
                <textarea
                  id="reading-output"
                  ref={output}
                  readOnly
                  value={line}
                  aria-label="Stable reading output"
                  aria-live="polite"
                  aria-atomic="true"
                />
                <div className="reader-buttons">
                  <button
                    onClick={() => {
                      if (ordered[selectedIndex - 1])
                        readBlock(ordered[selectedIndex - 1]);
                    }}
                    disabled={selectedIndex <= 0}
                    aria-label="Previous block"
                  >
                    <ArrowLeft size={22} />
                  </button>
                  <span>
                    {selectedIndex < 0
                      ? "Selection"
                      : selectedIndex + 1 + " / " + ordered.length}
                  </span>
                  <button
                    onClick={() => {
                      if (ordered[selectedIndex + 1])
                        readBlock(ordered[selectedIndex + 1]);
                    }}
                    disabled={selectedIndex >= ordered.length - 1}
                    aria-label="Next block"
                  >
                    <ArrowRight size={22} />
                  </button>
                  <button
                    className="listen"
                    disabled={!page}
                    onClick={() => (speaking ? stopSpeech() : speak())}
                  >
                    {speaking ? <VolumeX size={22} /> : <Volume2 size={22} />}{" "}
                    {speaking ? "Stop" : "Listen"}
                  </button>
                </div>
              </div>
              <div className="reading-position">
                <button onClick={() => pan(-1)} disabled={offset === 0}>
                  Previous line
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + cells, chars.length)}
                </span>
                <button
                  onClick={() => pan(1)}
                  disabled={offset + cells >= chars.length}
                >
                  Next line
                </button>
              </div>
              {saved && (
                <button className="resume-button" onClick={resume}>
                  <ArrowLeft size={20} /> Resume reading
                </button>
              )}
              {historical && !saved && (
                <p className="historical-note">
                  Saved text. Select a block for its latest version.
                </p>
              )}
              {extension && current && (
                <button
                  className="source-link"
                  onClick={() =>
                    chrome.runtime.sendMessage({
                      type: "locate",
                      id: current.id,
                      text: current.text,
                    })
                  }
                >
                  Go to source <ArrowUpRight size={18} />
                </button>
              )}
            </section>
          </div>
        </div>
        <div className="live-status sr-only" role="status" aria-live="polite">
          {status}
        </div>
        <footer>
          <span>Brailly · JEVATHON</span>
          <a
            href="https://docs.typesafe.ai/primitives/score"
            target="_blank"
            rel="noreferrer"
          >
            Jev Score <ArrowUpRight size={16} />
          </a>
        </footer>
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
              if (e.key === "Tab") {
                const items =
                  e.currentTarget.querySelectorAll<HTMLElement>("a,button");
                const first = items[0],
                  last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              className="close"
              autoFocus
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              {modal === "extension" ? (
                <PanelRight size={25} />
              ) : (
                <AudioLines size={25} />
              )}
            </span>
            <h2 id="modal-title">
              {modal === "extension"
                ? "Bring Brailly to your browser."
                : "Compatible displays"}
            </h2>
            {modal === "extension" ? (
              <>
                <p>
                  The Chrome extension captures the actual rendered DOM of the
                  tab you choose, then opens Brailly beside it. Classification
                  sends the extracted page text to Jev only when you press the
                  button.
                </p>
                <ol>
                  <li>
                    <a href={API + "/brailly-extension.zip"} download>
                      Download the extension ZIP
                    </a>{" "}
                    and unzip it.
                  </li>
                  <li>
                    Open <code>chrome://extensions</code> and turn on Developer
                    mode.
                  </li>
                  <li>
                    Choose <b>Load unpacked</b> and select the extracted folder.
                  </li>
                  <li>
                    Open a web page and click Brailly. Set your purpose and
                    choose <b>Classify with Jev</b>.
                  </li>
                </ol>
                <p className="note">
                  Active-tab access only. Passwords and input values are
                  excluded. Chrome internal pages, cross-origin frames and
                  closed shadow roots are not captured. The extension is
                  unpacked, not a Chrome Web Store release.
                </p>
              </>
            ) : (
              <>
                <p>
                  Connect by USB or Bluetooth, then focus the reading output
                  with VoiceOver. The screen reader translates text and drives
                  the device.
                </p>
                <div className="compatible-devices">
                  {[
                    "HumanWare Brailliant BI 20X · 20 cells",
                    "HumanWare Brailliant BI 40X · 40 cells",
                    "Freedom Scientific Focus 40 Blue · 40 cells",
                    "Freedom Scientific Focus 80 Blue · 80 cells",
                  ].map((name) => (
                    <a
                      key={name}
                      href="https://support.apple.com/en-au/guide/voiceover/cpvobrailledisplays/mac"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <b>{name}</b>
                      <span>
                        USB / Bluetooth · VoiceOver <ArrowUpRight size={11} />
                      </span>
                    </a>
                  ))}
                </div>
                <p className="note">
                  Cell-count preview only. No physical display connected or
                  tested. Dots use illustrative English Braille; your screen
                  reader handles production translation.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
