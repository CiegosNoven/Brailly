import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";
import { toBraille } from "./braille";

// Decorative ordered dither drawn with real 8-dot Braille cells.
// Each cell is a 2×4 pin grid; a drifting density field raises pins against a
// per-pin threshold, one row carries a message as a refreshable display would,
// and pointer movement leaves a wake whose size follows the pointer's speed.

// Unicode Braille bit for each pin, listed column-major: dots 1,2,3,7 then 4,5,6,8.
const PINS = [
  { col: 0, row: 0, bit: 0x01 },
  { col: 0, row: 1, bit: 0x02 },
  { col: 0, row: 2, bit: 0x04 },
  { col: 0, row: 3, bit: 0x40 },
  { col: 1, row: 0, bit: 0x08 },
  { col: 1, row: 1, bit: 0x10 },
  { col: 1, row: 2, bit: 0x20 },
  { col: 1, row: 3, bit: 0x80 },
];
// 2×4 ordered-dither thresholds, same order as PINS.
const THRESHOLDS = [0, 4, 2, 6, 3, 7, 1, 5].map((v) => (v + 0.5) / 8);
const FPS = 24;
const WAKE_MS = 1100;
const STORAGE_KEY = "brailly-motion";

type Splat = { x: number; y: number; vx: number; vy: number; strength: number; radius: number; born: number };

function readMotionPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    /* storage unavailable */
  }
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Props = { message: string; className?: string };

export default function BrailleField({ message, className = "" }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(readMotionPreference);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const signal = toBraille(message + "   ");
    const splats: Splat[] = [];
    const lastPointer = { x: 0, y: 0, t: 0 };
    let width = 0,
      height = 0,
      raf = 0,
      last = 0,
      time = 0,
      visible = true;

    const draw = (t: number, now: number) => {
      const style = getComputedStyle(el);
      const on = style.getPropertyValue("--pin-on").trim() || "#1f1422";
      const off = style.getPropertyValue("--pin-off").trim() || "#1f142218";
      const hot = style.getPropertyValue("--pin-signal").trim() || "#a3155f";
      const wakeColor = style.getPropertyValue("--pin-wake").trim() || hot;
      const pinX = 5,
        pinY = 4.2,
        cellW = 14,
        cellH = 22,
        radius = 1.2;
      const cols = Math.ceil(width / cellW) + 1,
        rows = Math.ceil(height / cellH);
      const signalRow = Math.max(0, Math.floor(rows * 0.62));
      const shift = Math.floor(t * 2.2);
      for (let i = splats.length - 1; i >= 0; i--)
        if (now - splats[i].born > WAKE_MS) splats.splice(i, 1);
      ctx.clearRect(0, 0, width, height);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x0 = c * cellW + 3,
            y0 = r * cellH + 4;
          let mask = 0,
            wake = 0;
          if (r === signalRow) {
            mask = signal[(c + shift) % signal.length] ?? 0;
          } else {
            // Two swells travelling in different directions never trough together,
            // so the field always keeps mid-tones on any width.
            const X = x0 / 90,
              Y = y0 / 38;
            const a = Math.sin(X * 0.9 - t * 0.35 + Math.sin(Y * 0.8 + t * 0.2) * 1.6);
            const b = Math.cos(Y * 0.9 + X * 0.45 - t * 0.28);
            const ripple = Math.sin(X * 2.7 + Y * 1.3 - t * 0.7);
            let density = 0.5 + 0.26 * a + 0.16 * b + 0.07 * ripple;
            for (const s of splats) {
              const age = now - s.born,
                life = 1 - age / WAKE_MS;
              const sx = s.x + s.vx * age * 0.12,
                sy = s.y + s.vy * age * 0.12;
              const d = Math.hypot(x0 - sx, (y0 - sy) * 1.3);
              if (d < s.radius) wake += s.strength * life * (1 - d / s.radius);
            }
            density += wake;
            PINS.forEach((pin, i) => {
              if (density > THRESHOLDS[i]) mask |= pin.bit;
            });
          }
          const raisedColor = r === signalRow ? hot : wake > 0.22 ? wakeColor : on;
          for (const pin of PINS) {
            const raised = (mask & pin.bit) !== 0;
            ctx.fillStyle = raised ? raisedColor : off;
            ctx.beginPath();
            ctx.arc(
              x0 + pin.col * pinX,
              y0 + pin.row * pinY,
              raised ? radius + 0.35 : radius * 0.7,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
      el.dataset.frame = String(Math.round(t * FPS));
    };

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(time, performance.now());
    };

    const loop = (now: number) => {
      raf = 0;
      if (!playing || !visible || document.hidden) return;
      if (now - last >= 1000 / FPS) {
        time += last ? Math.min(now - last, 100) / 1000 : 0;
        last = now;
        draw(time, now);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && playing && visible && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    };

    const resizer = new ResizeObserver(resize);
    resizer.observe(el);
    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    watcher.observe(el);
    const onVisibility = () => start();
    document.addEventListener("visibilitychange", onVisibility);
    const host = el.parentElement;
    // Paused means no motion at all, including the pointer wake.
    const move = (e: PointerEvent) => {
      if (!playing) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left,
        y = e.clientY - rect.top,
        now = performance.now();
      const dt = now - lastPointer.t;
      if (lastPointer.t && dt < 120) {
        const vx = (x - lastPointer.x) / Math.max(dt, 8),
          vy = (y - lastPointer.y) / Math.max(dt, 8);
        const speed = Math.hypot(vx, vy); // px per ms
        splats.push({
          x,
          y,
          vx,
          vy,
          strength: Math.min(0.95, 0.2 + speed * 0.45),
          radius: 36 + Math.min(150, speed * 85),
          born: now,
        });
        if (splats.length > 48) splats.shift();
      }
      lastPointer.x = x;
      lastPointer.y = y;
      lastPointer.t = now;
    };
    host?.addEventListener("pointermove", move);
    resize();
    start();
    return () => {
      cancelAnimationFrame(raf);
      resizer.disconnect();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host?.removeEventListener("pointermove", move);
    };
  }, [message, playing]);

  function toggle() {
    const next = !playing;
    setPlaying(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <div className={"braille-field " + className}>
      <canvas ref={canvas} aria-hidden="true" data-playing={playing} />
      <button type="button" className="motion-toggle" onClick={toggle}>
        {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
        {playing ? "Pause animation" : "Play animation"}
      </button>
    </div>
  );
}
