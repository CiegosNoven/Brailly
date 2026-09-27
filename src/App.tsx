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
import ReadingQueue from "./ReadingQueue";
import PageControls from './PageControls';
import type { ControlResult } from '../shared/page-controls';
import { useSpeech } from "./useSpeech";
import { useVisualCapture } from "./useVisualCapture";
import VisualDetails from "./VisualDetails";
import { ChangeTone, withVisualEvidence } from "./change-feedback";
import type { VisualEvidence, VisualEvent } from "../shared/visual";
import BrailleField from "./BrailleField";
import ChangeDemo, { ELEVATOR_SITE } from "./ChangeDemo";
import {
  snapshotSignature,
  sourceChanges,
  onlyCountdownTicks,
  blockSignature,
} from "../shared/live";
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
  const [activeTab, setActiveTab] = useState<"analyze" | "read">(
    extension ? "read" : "analyze",
  );
  const [page, setPage] = useState<PageSnapshot | null>(null);
  const [url, setUrl] = useState("");
  const [task, setTask] = useState(
    extension
      ? "Read the main content and useful actions on this page. Put unrelated promotions and site navigation later."
      : "Find the opening hours, ticket price, and accessible entrance.",
  );
  const [result, setResult] = useState<Classification | null>(null);
  const [heldVisualOrder, setHeldVisualOrder] = useState<{
    snapshotId: string;
    blocks: DomBlock[];
  } | null>(null);
  const [busy, setBusy] = useState<"load" | "rank" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(
    extension
      ? "Opening the current browser page…"
      : "Choose a web page to get started.",
  );
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [cellOffset, setCellOffset] = useState(0);
  const [cells, setCells] = useState(40);
  const [modal, setModal] = useState<"extension" | "hardware" | null>(null);
  const speech = useSpeech({ apiBase: API });
  const visual = useVisualCapture(API);
  const [watchVisual, setWatchVisual] = useState(false);
  const watchEnabled = useRef(false);
  const watchGeneration = useRef(0);
  const watchRunning = useRef(false);
  const watchBaseline = useRef<PageSnapshot | null>(null);
  const watchTick = useRef<() => void>(() => {});
  const [watchStatus, setWatchStatus] = useState("");
  const [updateAudio, setUpdateAudio] = useState(true);
  const [changeNotice, setChangeNotice] = useState("");
  const [toneBlocked, setToneBlocked] = useState(false);
  const tone = useRef<ChangeTone | null>(null);
  useEffect(() => {
    const sound = new ChangeTone();
    tone.current = sound;
    const unlock = () => { void sound.unlock(); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      sound.close();
    };
  }, []);
  useEffect(() => {
    if (!watchVisual) return;
    const timer = setInterval(() => watchTick.current(), 30_000);
    return () => clearInterval(timer);
  }, [watchVisual]);
  const speaking =
    speech.content?.kind === "source" &&
    (speech.status === "loading" ||
      speech.status === "playing" ||
      speech.needsPlay);
  const [capabilities, setCapabilities] = useState({
    visualEnabled: false,
    visualAllowedOrigins: [] as string[],
    elevenlabsTts: { available: false },
  });
  const pageTaskGeneration = useRef(0);
  const readerInteractionRevision = useRef(0);
  const adoptedVisual = useRef<{
    requestId: string;
    snapshotId: string;
    captureId: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(API + "/api/config", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (value && !controller.signal.aborted)
          setCapabilities({
            visualEnabled: value.visualEnabled === true,
            visualAllowedOrigins: Array.isArray(value.visualAllowedOrigins)
              ? value.visualAllowedOrigins
              : [],
            elevenlabsTts: {
              available: value.elevenlabsTts?.available === true,
            },
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
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
  const alertAutoplay = useRef(false);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const baseline = useRef<PageSnapshot | null>(null);
  const lastObserved = useRef<PageSnapshot | null>(null);
  const refreshingPreview = useRef<{
    token: string;
    page: PageSnapshot;
  } | null>(null);
  const sourceSession = useRef(0);
  const loadGeneration = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const loadingSource = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const pendingUpdate = useRef<PageSnapshot | null>(null);
  const ranking = useRef(false);
  const nextRankAt = useRef(0);
  const updateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processPending = useRef<() => void>(() => {});
  const receiveSnapshot = useRef<
    (snapshot: PageSnapshot, newDocument?: boolean) => void
  >(() => {});
  const extensionSource = useRef<{ revision: number; tabId?: number }>({
    revision: -1,
  });
  const capturedTabId = useRef<number | undefined>(undefined);
  const [updateSummary, setUpdateSummary] = useState("");
  useEffect(() => {
    return () => {
      initialized.current = false;
      abort.current?.abort();
      loadAbort.current?.abort();
      if (updateTimer.current) clearTimeout(updateTimer.current);
      if (alertTimer.current) clearTimeout(alertTimer.current);
      speech.stop();
    };
  }, []);
  function stopAlertPlayback() {
    alertAutoplay.current = false;
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = null;
  }
  function invalidateVisualWork() {
    watchEnabled.current = false;
    watchGeneration.current++;
    setWatchVisual(false);
    watchBaseline.current = null;
    setWatchStatus("");
    setChangeNotice("");
    setToneBlocked(false);
    stopAlertPlayback();
    pageTaskGeneration.current++;
    adoptedVisual.current = null;
    visual.cancel(true);
    speech.stop();
  }
  function acceptPage(p: PageSnapshot) {
    invalidateVisualWork();
    installPage(p);
  }
  // Adopting the first streamed snapshot must not abort its own visual request.
  function adoptVisualSnapshot(
    event: Extract<VisualEvent, { type: "snapshot" }>,
    generation: number,
  ) {
    if (pageTaskGeneration.current !== generation) return;
    adoptedVisual.current = {
      requestId: event.requestId,
      snapshotId: event.snapshotId,
      captureId: event.captureId,
    };
    speech.stop();
    installPage(event.page);
    loadingSource.current = false;
    setStatus(
      `${event.page.blocks.length} source blocks captured. Visual analysis continues without moving your reading.`,
    );
  }
  function installPage(p: PageSnapshot) {
    setHeldVisualOrder(null);
    stopAlertPlayback();
    sourceSession.current++;
    refreshingPreview.current = null;
    setRefreshing(false);
    epoch.current++;
    abort.current?.abort();
    pendingUpdate.current = null;
    ranking.current = false;
    baseline.current = p;
    lastObserved.current = p;
    nextRankAt.current = 0;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    pageRef.current = p;
    setUrl(p.url);
    setUpdateSummary("");
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
    let active = true;
    let port: chrome.runtime.Port | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (!active) return;
      port = chrome.runtime.connect({ name: "brailly-reader" });
      port.onDisconnect.addListener(() => {
        if (active) reconnect = setTimeout(connect, 500);
      });
    };
    connect();
    const acceptStored = (value: Record<string, unknown>) => {
      if (!active) return;
      const revision =
        typeof value.sourceRevision === "number"
          ? value.sourceRevision
          : extensionSource.current.revision;
      if (revision < extensionSource.current.revision) return;
      const tabId =
        typeof value.sourceTabId === "number"
          ? value.sourceTabId
          : extensionSource.current.tabId;
      extensionSource.current = { revision, tabId };
      if (
        value.snapshot === null &&
        ["capturing", "loading", "unavailable", "idle"].includes(
          String(value.captureStatus),
        )
      ) {
        epoch.current++;
        abort.current?.abort();
        ranking.current = false;
        pendingUpdate.current = null;
        if (updateTimer.current) clearTimeout(updateTimer.current);
        pageRef.current = null;
        capturedTabId.current = undefined;
        setPage(null);
        setReading(null);
        setSaved(null);
        setResult(null);
        setUrl("");
        setBusy(null);
        setStatus(
          value.captureStatus === "unavailable"
            ? "This browser page cannot be captured."
            : "Opening the current browser page…",
        );
      }
      if (value.snapshot) {
        const newDocument = tabId !== capturedTabId.current;
        capturedTabId.current = tabId;
        receiveSnapshot.current(value.snapshot as PageSnapshot, newDocument);
      }
      if (value.captureError) setError(String(value.captureError));
      else if ("captureError" in value) setError("");
    };
    chrome.storage.session
      .get([
        "snapshot",
        "captureError",
        "sourceRevision",
        "sourceTabId",
        "captureStatus",
      ])
      .then(acceptStored);
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "session") return;
      acceptStored(
        Object.fromEntries(
          Object.entries(changes).map(([key, change]) => [
            key,
            change.newValue,
          ]),
        ),
      );
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      clearTimeout(reconnect);
      port?.disconnect();
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  async function loadExample(path = "/example.html", classify = false) {
    invalidateVisualWork();
    const generation = ++loadGeneration.current;
    loadingSource.current = true;
    sourceSession.current++;
    pendingUpdate.current = null;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    epoch.current++;
    abort.current?.abort();
    ranking.current = false;
    setBusy("load");
    setError("");
    try {
      const html = await fetch(API + path, { signal: controller.signal }).then(
        (r) => r.text(),
      );
      if (generation !== loadGeneration.current) return null;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const p = extractDocument(doc, (API || location.origin) + path);
      p.source = "example";
      p.previewHtml = "<!doctype html>" + doc.documentElement.outerHTML;
      navigateRank.current = classify;
      acceptPage(p);
      setUrl(p.url);
      return p;
    } catch (error) {
      if (
        generation === loadGeneration.current &&
        !(error instanceof Error && error.name === "AbortError")
      )
        setError("Could not load the sample website.");
      return null;
    } finally {
      if (generation === loadGeneration.current) {
        loadingSource.current = false;
        setBusy(null);
      }
    }
  }
  async function loadUrl(nextUrl?: string) {
    invalidateVisualWork();
    const raw = (nextUrl || url).trim();
    try {
      const local = new URL(raw, location.origin);
      if (
        local.origin === (API || location.origin) &&
        ["/example.html", "/museum-tickets.html", "/access-demo.html"].includes(
          local.pathname,
        )
      ) {
        void loadExample(local.pathname, !!nextUrl && auto);
        return;
      }
    } catch {}
    const generation = ++loadGeneration.current;
    loadingSource.current = true;
    sourceSession.current++;
    ranking.current = false;
    pendingUpdate.current = null;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    loadAbort.current?.abort();
    setBusy("load");
    setError("");
    epoch.current++;
    abort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
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
      if (generation !== loadGeneration.current) return;
      navigateRank.current = !!nextUrl && auto;
      acceptPage(p);
      setUrl(p.url);
    } catch (e) {
      if (
        generation === loadGeneration.current &&
        e instanceof Error &&
        e.name !== "AbortError"
      )
        setError(e.message);
    } finally {
      if (generation === loadGeneration.current) {
        loadingSource.current = false;
        setBusy(null);
      }
    }
  }
  async function rank(target = page, context?: ReadContext) {
    if (
      !target ||
      (!target.blocks.length && !context) ||
      visual.state.rankingPending
    )
      return;
    ranking.current = true;
    nextRankAt.current = Date.now() + 5000;
    const token = ++epoch.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy("rank");
    setError("");
    setStatus("Jev is scoring relevance and classifying each DOM block…");
    const goal = task;
    const readingCellOffset = liveReading.current.cellOffset;
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
      if (
        pageRef.current &&
        snapshotSignature(pageRef.current) !== snapshotSignature(target) &&
        !onlyCountdownTicks(target, pageRef.current)
      )
        return;
      baseline.current = target;
      setHeldVisualOrder(null);
      setResult(data);
      const order = readingOrder(target, data);
      if (context) {
        const previous = new Map(
          context.previousBlocks.map((b) => [b.id, blockSignature(b)]),
        );
        const changedBlocks = order.filter(
          (b) => previous.get(b.id) !== blockSignature(b),
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
              "Previously captured content is no longer in this capture.",
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
                cellOffset: readingCellOffset,
              },
          );
          speech.stop();
          setChangeNotice(`Braille updated: ${changedBlocks[0].text}`);
          if (updateAudio) setToneBlocked(!tone.current?.play());
          setReading(changedBlocks[0]);
          setSelected(changedBlocks[0].id);
          setOffset(0);
          setCellOffset(0);
          setStatus(
            "Jev interrupted for a relevant update. Resume returns to your saved position.",
          );
        } else {
          if (decision === "QUEUE_HIGH" && changedBlocks[0]) {
            const notice = `Page update. ${changedBlocks[0].text}`.slice(0, 800);
            setChangeNotice(notice);
            if (updateAudio && capabilities.elevenlabsTts.available) {
              speech.setProvider("elevenlabs");
              void speech.speak(notice, { kind: "alert", id: target.id });
            }
          }
          setStatus(`Jev: ${decision}. Your reading position is held; changes remain available.`);
        }
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
      if (token === epoch.current) {
        ranking.current = false;
        setBusy(null);
        processPending.current();
      }
    }
  }
  useEffect(() => {
    if (!extension && !initialized.current) {
      initialized.current = true;
      void loadExample();
    }
  }, []);
  function updateTask(value: string) {
    setHeldVisualOrder(null);
    invalidateVisualWork();
    loadingSource.current = false;
    epoch.current++;
    abort.current?.abort();
    ranking.current = false;
    pendingUpdate.current = null;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    setBusy(null);
    setTask(value);
    setResult(null);
    setStatus("Task changed. Classify again to get a new reading order.");
    if (extension && value.trim().length >= 3) {
      nextRankAt.current = 0;
      updateTimer.current = setTimeout(() => {
        baseline.current = null;
        pendingUpdate.current = pageRef.current;
        processPending.current();
      }, 700);
    }
  }
  const ordered = page
    ? heldVisualOrder?.snapshotId === page.id
      ? heldVisualOrder.blocks
      : readingOrder(page, result)
    : [];
  const current =
    reading || page?.blocks.find((b) => b.id === selected) || ordered[0];
  const selectedIndex = ordered.findIndex((b) => b.id === current?.id);
  async function activateControl(block: DomBlock): Promise<ControlResult> {
    const snapshot = pageRef.current;
    const captured = snapshot?.blocks.find(item => item.id === block.id);
    if (!snapshot || !captured || blockSignature(captured) !== blockSignature(block))
      return { ok: false, message: 'This control changed. Select it again from the updated page.' };
    speech.stop();
    if (extension && snapshot.source === 'extension')
      return chrome.runtime.sendMessage({ type: 'activate-control', snapshotId: snapshot.id, id: block.id });
    if (!frame || !iframe.current?.contentWindow)
      return { ok: false, message: 'Use the extension to interact with this page.' };
    const target = iframe.current.contentWindow;
    const token = frame.token;
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const finish = (result: ControlResult) => {
        clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve(result);
      };
      const listener = (event: MessageEvent) => {
        if (event.source === target && event.data?.token === token && event.data.type === 'control-result' && event.data.requestId === requestId)
          finish(event.data.result);
      };
      const timeout = setTimeout(() => finish({ ok: false, message: 'The page did not respond. Capture it again.' }), 5000);
      window.addEventListener('message', listener);
      target.postMessage({ token, requestId, type: 'activate-control', block }, '*');
    });
  }
  const text = current?.text || "";
  const chars = Array.from(text);
  const line = chars.slice(offset, offset + cells).join("");
  const allDots = toBraille(line);
  const dots = allDots.slice(cellOffset, cellOffset + cells);
  const ranks = new Map(result?.results.map((r) => [r.id, r]) || []);
  processPending.current = () => {
    if (ranking.current || !pendingUpdate.current) return;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    const wait = nextRankAt.current - Date.now();
    if (wait > 0) {
      updateTimer.current = setTimeout(() => processPending.current(), wait);
      return;
    }
    const next = pendingUpdate.current;
    pendingUpdate.current = null;
    const previous = baseline.current;
    void rank(
      next,
      previous && current
        ? { current, offset, previousBlocks: previous.blocks }
        : undefined,
    );
  };
  receiveSnapshot.current = (incoming, newDocument = false) => {
    if (loadingSource.current) return;
    const previous = pageRef.current;
    if (newDocument || !previous || incoming.url !== previous.url) {
      acceptPage(incoming);
      if (extension && incoming.blocks.length) {
        baseline.current = null;
        pendingUpdate.current = incoming;
        processPending.current();
      }
      return;
    }
    const observed = lastObserved.current || previous;
    lastObserved.current = incoming;
    if (snapshotSignature(previous) === snapshotSignature(incoming)) return;
    if (onlyCountdownTicks(observed, incoming)) return;
    const next = {
      ...incoming,
      previewHtml: incoming.previewHtml || previous.previewHtml,
    };
    const changes = sourceChanges(previous, next);
    pageRef.current = next;
    setPage(next);
    setChanged(false);
    setUpdateSummary(
      `${changes.changed.length} changed · ${changes.added.length} added · ${changes.removed.length} no longer captured`,
    );
    setStatus("Page changed. Your reading line is held while Jev evaluates.");
    pendingUpdate.current = next;
    processPending.current();
  };
  function cancelReadingRequest() {
    readerInteractionRevision.current++;
    epoch.current++;
    abort.current?.abort();
    ranking.current = false;
    if (
      pageRef.current &&
      baseline.current &&
      snapshotSignature(pageRef.current) !== snapshotSignature(baseline.current)
    )
      pendingUpdate.current = pageRef.current;
    setBusy(null);
    setTimeout(() => processPending.current(), 0);
  }
  function readBlock(block: DomBlock) {
    cancelReadingRequest();
    setReading(block);
    setSaved(null);
    setSelected(block.id);
    setOffset(0);
    setCellOffset(0);
    setStatus(`Reading ${block.role}: ${block.text}`);
    if (speaking) speak(block.text, block);
    else speech.stop();
  }
  function pan(direction: number) {
    cancelReadingRequest();
    setOffset((o) =>
      Math.min(
        Math.max(0, o + direction * cells),
        Math.max(0, Math.floor((chars.length - 1) / cells) * cells),
      ),
    );
    setCellOffset(0);
  }
  function speak(value = text, block = current) {
    if (!block) return;
    readerInteractionRevision.current++;
    void speech.speak(value, {
      kind: "source",
      id: `${pageTaskGeneration.current}:${block.id}:${block.text}`,
    });
  }
  function stopSpeech() {
    speech.stop();
  }
  useEffect(() => {
    const expected = current
      ? `${pageTaskGeneration.current}:${current.id}:${current.text}`
      : "";
    if (speech.content?.kind === "source" && speech.content.id !== expected)
      speech.stop();
  }, [page?.id, current?.id, current?.text, task, speech.content?.id]);
  async function openVisualCapture() {
    if (extension || !capabilities.visualEnabled || task.trim().length < 3)
      return;
    watchEnabled.current = false;
    watchGeneration.current++;
    setWatchVisual(false);
    watchBaseline.current = null;
    setWatchStatus("");
    stopAlertPlayback();
    const generation = ++pageTaskGeneration.current;
    adoptedVisual.current = null;
    loadGeneration.current++;
    loadAbort.current?.abort();
    loadingSource.current = true;
    sourceSession.current++;
    epoch.current++;
    abort.current?.abort();
    ranking.current = false;
    pendingUpdate.current = null;
    if (updateTimer.current) clearTimeout(updateTimer.current);
    speech.stop();
    setBusy(null);
    setError("");
    let interactionAtSnapshot = readerInteractionRevision.current;
    let captured: PageSnapshot | null = null;
    const evidence: VisualEvidence[] = [];
    const raw = url.trim();
    try {
      await visual.start(
        raw.startsWith("http") ? raw : "https://" + raw,
        task,
        (event) => {
          if (generation !== pageTaskGeneration.current) return;
          if (event.type === "snapshot") {
            captured = event.page;
            interactionAtSnapshot = readerInteractionRevision.current;
            adoptVisualSnapshot(event, generation);
            return;
          }
          const adopted = adoptedVisual.current;
          if (
            !adopted ||
            adopted.requestId !== event.requestId ||
            adopted.snapshotId !== event.snapshotId ||
            adopted.captureId !== event.captureId ||
            pageRef.current?.id !== event.snapshotId
          )
            return;
          if (event.type === "dom-ranked" && captured) {
            setResult(event.classification);
            setLastCall(event.classification);
            setCalls((n) => n + 1);
            baseline.current = captured;
            if (readerInteractionRevision.current === interactionAtSnapshot) {
              const first = readingOrder(captured, event.classification)[0];
              setReading(first || null);
              setSelected(first?.id || "");
              setOffset(0);
              setCellOffset(0);
            } else
              setHeldVisualOrder({
                snapshotId: captured.id,
                blocks: captured.blocks,
              });
            setStatus(
              "Jev classified the captured source text. Your reading position is held if you have started reading.",
            );
          } else if (event.type === "visual-evidence") {
            evidence.push(...event.evidence);
            setStatus(
              `${event.evidence.length} visual details available. Open them when you choose.`,
            );
          } else if (event.type === "done") {
            if (captured && event.status === "complete") {
              watchBaseline.current = withVisualEvidence(captured, evidence);
              watchEnabled.current = true;
              setWatchVisual(true);
              setWatchStatus("Checking every 30 seconds");
            }
            setStatus(
              `Visual analysis ${event.status}. Your source text and reading position remain available.`,
            );
          }
        },
      );
    } finally {
      if (generation === pageTaskGeneration.current)
        loadingSource.current = false;
    }
  }
  async function checkVisualChanges() {
    const previous = watchBaseline.current;
    if (!watchEnabled.current || watchRunning.current || visual.state.busy || busy || !previous) return;
    const generation = watchGeneration.current;
    const taskGeneration = pageTaskGeneration.current;
    watchRunning.current = true;
    setWatchStatus("Checking the page and its images…");
    let capture: PageSnapshot | null = null;
    const evidence: VisualEvidence[] = [];
    let complete = false;
    try {
      await visual.start(previous.url, task, event => {
        if (event.type === "snapshot") capture = event.page;
        if (event.type === "visual-evidence") evidence.push(...event.evidence);
        if (event.type === "dom-ranked") {
          setLastCall(event.classification);
          setCalls(n => n + 1);
        }
        if (event.type === "done") complete = event.status === "complete";
      });
      if (!watchEnabled.current || generation !== watchGeneration.current || taskGeneration !== pageTaskGeneration.current) return;
      if (!capture || !complete) {
        setWatchStatus("Check incomplete. Keeping your text; retrying in 30 seconds.");
        return;
      }
      const next = withVisualEvidence(capture, evidence);
      if (snapshotSignature(previous) === snapshotSignature(next)) {
        setWatchStatus("No changes · checking every 30 seconds");
        return;
      }
      const retained = liveReading.current;
      if (!retained.block) return;
      pageRef.current = next;
      setPage(next);
      setChanged(true);
      setWatchStatus("Jev is deciding how to handle the changes…");
      await rank(next, { current: retained.block, offset: retained.offset, previousBlocks: previous.blocks });
      if (generation !== watchGeneration.current || taskGeneration !== pageTaskGeneration.current) return;
      // Advance only after a successful decision; failed or stale requests get another chance.
      if (baseline.current === next) watchBaseline.current = next;
      setWatchStatus("Checking every 30 seconds");
    } finally { watchRunning.current = false; }
  }
  const liveReading = useRef({ block: current, offset, cellOffset });
  liveReading.current = { block: current, offset, cellOffset };
  watchTick.current = () => { void checkVisualChanges(); };
  function toggleVisualWatch() {
    const enabled = !watchEnabled.current;
    watchEnabled.current = enabled;
    setWatchVisual(enabled);
    if (!enabled) {
      watchGeneration.current++;
      if (watchRunning.current) {
        visual.cancel();
        epoch.current++;
        abort.current?.abort();
        ranking.current = false;
        setBusy(null);
      }
    }
    setWatchStatus(enabled ? "Checking every 30 seconds" : "Automatic checks stopped");
  }
  function cancelVisualCapture() {
    watchEnabled.current = false;
    watchGeneration.current++;
    setWatchVisual(false);
    adoptedVisual.current = null;
    loadingSource.current = false;
    visual.cancel();
    setStatus(
      "Visual analysis cancelled. Captured text and details remain available.",
    );
  }
  async function captureTab() {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "capture" });
    } catch {
      setError("Open a web page and click the Brailly extension icon first.");
    }
  }
  async function refreshSource() {
    const source = pageRef.current;
    if (!source || refreshing || source.source === "browserbase") return;
    setRefreshing(true);
    const navigation = source.url;
    const sourceToken = sourceSession.current;
    try {
      const response = await fetch(API + "/api/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: navigation }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      if (
        sourceToken !== sourceSession.current ||
        pageRef.current?.url !== navigation
      )
        return;
      if (next.previewHtml) {
        const token = crypto.randomUUID();
        refreshingPreview.current = { token, page: next };
        setFrame({
          html: frameDocument(next.previewHtml, next.url, token),
          token,
        });
      } else receiveSnapshot.current(next);
      setStatus("Source refreshed. Your reading position is held.");
    } catch (error) {
      if (sourceToken !== sourceSession.current) return;
      setError(
        error instanceof Error
          ? error.message
          : "Could not refresh the source.",
      );
    } finally {
      setRefreshing(false);
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
    speech.stop();
    cancelReadingRequest();
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
  const accessDemo =
    !!page &&
    new URL(page.url).pathname === "/access-demo.html" &&
    page.source === "example";
  async function startAlertDemo() {
    updateTask(
      "I am about to use the street elevator at Harbor station to reach the platform without stairs. Alert me immediately if this route becomes inaccessible. Ignore shop offers.",
    );
    setTimeline([]);
    setActiveTab("read");
    const loaded = await loadExample("/access-demo.html", true);
    if (loaded) alertAutoplay.current = true;
  }
  function openElevatorSite() {
    updateTask(
      "Read the current published elevator accessibility status for each Muni station. Keep station names, status and timestamps together.",
    );
    setActiveTab("analyze");
    void loadUrl(ELEVATOR_SITE);
  }
  useEffect(() => {
    if (
      !accessDemo ||
      !alertAutoplay.current ||
      busy ||
      !frameReady ||
      result?.snapshotId !== page?.id
    )
      return;
    const route = page.blocks.find((block) =>
      block.text.startsWith("Street elevator in service."),
    );
    if (!route) return;
    alertAutoplay.current = false;
    readBlock(route);
    const source = sourceSession.current;
    alertTimer.current = setTimeout(() => {
      if (source === sourceSession.current) sendUpdate("elevator");
    }, 1400);
  }, [accessDemo, busy, frameReady, result, page]);
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
      if (visual.state.busy) return;
      const previous = pageRef.current;
      const incoming = m.page as PageSnapshot;
      if (!Array.isArray(incoming?.blocks)) return;
      const refresh = refreshingPreview.current;
      const next = {
        ...incoming,
        previewHtml:
          refresh?.token === frame.token
            ? refresh.page.previewHtml
            : previous?.previewHtml,
      };
      if (m.version === 1) {
        setFrameReady(true);
        if (refresh?.token === frame.token) {
          refreshingPreview.current = null;
          receiveSnapshot.current(next);
          return;
        }
        epoch.current++;
        abort.current?.abort();
        setBusy(null);
        setPage(next);
        pageRef.current = next;
        baseline.current = next;
        lastObserved.current = next;
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
      receiveSnapshot.current(next);
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
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  const historical =
    current &&
    page?.blocks.find((b) => b.id === current.id)?.text !== current.text;

  async function readPage() {
    if (visual.state.rankingPending || visual.state.busy) return;
    if (extension) {
      if (page) await rank();
      else await captureTab();
      return;
    }
    if (page && url.trim() === page.url) await rank();
    else await loadUrl(url);
  }
  return (
    <div className={extension ? "brailly extension-app" : "brailly"}>
      <a
        className="skip"
        href="#reading-output"
        onClick={(event) => {
          event.preventDefault();
          setActiveTab("read");
          setTimeout(() => output.current?.focus(), 0);
        }}
      >
        Skip to reading output
      </a>
      <header className="header">
        <a className="wordmark" href="/" aria-label="Brailly home">
          <svg
            className="brand-mark"
            width="42"
            height="42"
            viewBox="0 0 42 42"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="27"
              height="29"
              rx="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              d="m28 29 10 10"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="12" cy="11" r="2.7" fill="currentColor" />
            <circle cx="12" cy="18" r="2.7" fill="currentColor" />
            <g fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="21" cy="11" r="2.1" />
              <circle cx="21" cy="18" r="2.1" />
              <circle cx="12" cy="25" r="2.1" />
              <circle cx="21" cy="25" r="2.1" />
            </g>
          </svg>
          brailly
        </a>
        <button
          className="extension-button"
          onClick={() => setModal("extension")}
        >
          <PuzzlePiece size={22} /> Get extension
        </button>
      </header>
      <main>
        <section className="hero" aria-labelledby="page-title">
          <BrailleField message="brailly · the web, within reach · jev decides what matters" />
          <div className="hero-copy">
            <p className="eyebrow">Brailly · Jev System One · Score + Choice</p>
            <div className="page-heading">
              <h1 className="page-title" id="page-title">
                Read the web in Braille.
              </h1>
              {!extension && (
                <button
                  className="alert-demo-button"
                  disabled={!!busy}
                  onClick={() => void startAlertDemo()}
                >
                  <Play size={20} />
                  Play alert demo
                </button>
              )}
            </div>
          </div>
        </section>
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
        <div className="workspace-tabs" role="tablist" aria-label="Workspace">
          {(["analyze", "read"] as const).map((tab, index) => (
            <button
              key={tab}
              id={tab + "-tab"}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={tab + "-panel"}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "analyze"
                    : event.key === "End"
                      ? "read"
                      : index === 0
                        ? "read"
                        : "analyze";
                setActiveTab(next);
                document.getElementById(next + "-tab")?.focus();
              }}
            >
              {tab === "analyze" ? "Analyze" : "Read"}
            </button>
          ))}
        </div>
        <PageControls page={page} current={current} onActivate={activateControl} onChoose={block => {
          readBlock(block);
          setActiveTab('read');
        }} />
        <div
          className={`tab-workspace${accessDemo && activeTab === "read" ? " alert-workspace" : ""}`}
        >
          <div className="tab-content">
            <section
              className="analysis-tab"
              id="analyze-panel"
              role="tabpanel"
              aria-labelledby="analyze-tab"
              hidden={activeTab !== "analyze"}
            >
              <details className="jev-details">
                <summary>
                  <strong>Jev</strong>
                  <span>
                    {lastCall
                      ? lastCall.latencyMs +
                        " ms · " +
                        (
                          (usage?.input_tokens || 0) +
                          (usage?.output_tokens || 0)
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
                  {page?.truncated ? " / " + page.totalCandidates : ""} DOM
                  blocks → Score 0–3 + Choice
                </div>
                {timeline.length > 0 && (
                  <div className="decision-trail">
                    {timeline.slice(0, 4).map((row, i) => (
                      <div className="trail-row" key={row.id + "-" + i}>
                        <b
                          className={"transition " + row.decision.toLowerCase()}
                        >
                          {row.decision}
                        </b>
                        <p>{row.text}</p>
                        <span>
                          {row.latencyMs > 0
                            ? row.latencyMs + " ms"
                            : row.model}
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
                  <pre tabIndex={0} aria-label="Jev request and response">
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
                      visual.state.busy ||
                      (page?.source === "browserbase" &&
                        page.blocks.length === 0 &&
                        url.trim() === page.url) ||
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
                        : "Analyze page"}
                  </button>
                </div>
              </section>
              {!extension && capabilities.visualEnabled && (
                <div className="visual-controls">
                  <button
                    className="subtle"
                    onClick={() => void openVisualCapture()}
                    disabled={
                      !!busy ||
                      visual.state.busy ||
                      task.trim().length < 3 ||
                      !url.trim()
                    }
                  >
                    Open with visual context
                  </button>
                  {visual.state.busy && (
                    <button className="subtle" onClick={cancelVisualCapture}>
                      Cancel visual capture
                    </button>
                  )}
                  {watchBaseline.current && <button className="subtle" onClick={toggleVisualWatch}>
                    {watchVisual ? "Stop automatic checks" : "Resume automatic checks"}
                  </button>}
                  <span className="coverage" role="status">{watchStatus || "Browserbase · public demo sites"}</span>
                  {capabilities.visualAllowedOrigins.length > 0 && (
                    <details>
                      <summary>Supported demo sites</summary>
                      <ul>
                        {capabilities.visualAllowedOrigins.map((origin) => (
                          <li key={origin}>{origin}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              {!extension && (
                <div className="under-input">
                  <button disabled={!!busy} onClick={() => void loadExample()}>
                    Museum demo
                  </button>
                  <button disabled={!!busy} onClick={openElevatorSite}>
                    Muni elevators
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
                        disabled={
                          !page ||
                          refreshing ||
                          visual.state.busy ||
                          page.source === "example" ||
                          page.source === "browserbase"
                        }
                        aria-label="Refresh source page"
                        onClick={() => void refreshSource()}
                      >
                        <RefreshCw
                          size={20}
                          className={refreshing ? "spin" : undefined}
                        />
                      </button>
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
                    {page?.source === "browserbase" ? (
                      <div className="source-block-list">
                        <p className="source-capture-note">
                          Browserbase · new remote capture · {page.capturedAt}
                        </p>
                        {page.blocks.length ? (
                          page.blocks.map((block) => (
                            <button
                              key={block.id}
                              onClick={() => readBlock(block)}
                            >
                              {block.text}
                            </button>
                          ))
                        ) : (
                          <p>
                            No source text blocks. Available descriptions appear
                            in Visual details.
                          </p>
                        )}
                      </div>
                    ) : frame ? (
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
                  {page?.source === "example" && !accessDemo && (
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
            </section>
            <section
              className="read-tab"
              id="read-panel"
              role="tabpanel"
              aria-labelledby="read-tab"
              hidden={activeTab !== "read"}
            >
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
                  onLeft={() => {
                    cancelReadingRequest();
                    if (cellOffset > 0)
                      setCellOffset(Math.max(0, cellOffset - cells));
                    else pan(-1);
                  }}
                  onRight={() => {
                    cancelReadingRequest();
                    if (cellOffset + cells < allDots.length)
                      setCellOffset(cellOffset + cells);
                    else pan(1);
                  }}
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
                    cancelReadingRequest();
                    setCells(value);
                    setCellOffset(0);
                  }}
                />
              </section>
              <section className="reading-panel">
                <h2>Reading</h2>
                {current?.context && (
                  <p id="reading-context">{current.context}</p>
                )}
                <div className="text-output">
                  <textarea
                    id="reading-output"
                    ref={output}
                    readOnly
                    value={line}
                    placeholder="Waiting for a web page."
                    onFocus={() => {
                      readerInteractionRevision.current++;
                    }}
                    aria-label="Stable reading output"
                    aria-describedby={
                      current?.context ? "reading-context" : undefined
                    }
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
                      disabled={!current}
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
                    {chars.length ? offset + 1 : 0}–
                    {Math.min(offset + cells, chars.length)}
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
                    {page?.blocks.some((block) => block.id === current?.id)
                      ? "This text changed. Your saved version stays here until you select the update."
                      : "This item is no longer in the captured page. Your saved text is still here."}
                  </p>
                )}
                {updateSummary && (
                  <p className="historical-note" role="status">
                    {updateSummary}
                  </p>
                )}
                {extension && page?.source === "extension" && current && (
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
            </section>
          </div>
          {accessDemo && activeTab === "read" ? (
            <ChangeDemo
              after={
                page?.blocks.find((block) =>
                  block.text.startsWith("Street elevator "),
                )?.text
              }
              busy={!!busy || !!pendingUpdate.current}
              decision={timeline[0]}
              error={error}
              canResume={!!saved}
              onReplay={() => void startAlertDemo()}
              onRealSite={openElevatorSite}
            />
          ) : (
            <ReadingQueue
              blocks={ordered}
              results={result?.snapshotId === page?.id ? result : null}
              currentId={current?.id}
              busy={busy === "rank" || visual.state.rankingPending}
              pending={!result || result.snapshotId !== page?.id}
              queued={!!pendingUpdate.current}
              retainedOrder={heldVisualOrder?.snapshotId === page?.id}
              onSelect={(block) => {
                readBlock(block);
                setActiveTab("read");
              }}
            />
          )}
        </div>
        <div className="voice-controls">
          <label><input type="checkbox" checked={updateAudio} onChange={event => {
            setUpdateAudio(event.target.checked);
            if (!event.target.checked && speech.content?.kind === "alert") speech.stop();
          }} /> Update sounds</label>
          <label htmlFor="voice-provider">Voice provider</label>
          <select
            id="voice-provider"
            value={speech.provider}
            onChange={(e) =>
              speech.setProvider(e.target.value as "browser" | "elevenlabs")
            }
          >
            <option value="browser">Browser voice</option>
            {capabilities.elevenlabsTts.available && (
              <option value="elevenlabs">ElevenLabs</option>
            )}
          </select>
          {speech.status === "loading" && (
            <span role="status">Preparing audio…</span>
          )}
          {speech.content &&
            (speech.status === "loading" ||
              speech.status === "playing" ||
              speech.needsPlay) && (
              <button className="subtle" onClick={stopSpeech}>
                Stop audio
              </button>
            )}
          {speech.content?.kind !== "visual" && speech.needsPlay && (
            <button className="subtle" onClick={() => void speech.retryPlay()}>
              Play audio
            </button>
          )}
          {speech.content?.kind !== "visual" && speech.error && (
            <div role="alert">
              <p>{speech.error}</p>
              {speech.provider === "elevenlabs" && (
                <button
                  className="subtle"
                  onClick={() => speech.setProvider("browser")}
                >
                  Use browser voice
                </button>
              )}
            </div>
          )}
        </div>
        {changeNotice && <p className="change-notice" role="status">{changeNotice}</p>}
        {toneBlocked && updateAudio && <button className="subtle" onClick={async () => {
          await tone.current?.unlock();
          setToneBlocked(!tone.current?.play());
        }}>Play update sound</button>}
        {!extension && (
          <VisualDetails
            key={visual.state.requestId || "none"}
            state={visual.state}
            speech={speech}
            onInteract={() => {
              readerInteractionRevision.current++;
            }}
          />
        )}
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
                  Open Brailly once. While its panel is open, it follows your
                  active tab, sends captured text to Jev automatically, and
                  keeps the display in sync with page changes.
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
                    Open a web page and click Brailly. Reading starts
                    automatically.
                  </li>
                </ol>
                <p className="note">
                  Website access lets Brailly follow the active tab. Close the
                  panel to stop. Passwords and input values are excluded. Chrome
                  internal pages and closed shadow roots are unavailable.
                  Install as an unpacked extension.
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
