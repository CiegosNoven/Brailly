import { useState } from "react";
import {
  CaretLeft,
  CaretRight,
  SkipBack,
  SkipForward,
  ArrowUUpLeft,
} from "@phosphor-icons/react";
import "./hardware.css";

type Props = {
  dots: number[];
  cells: number;
  line: string;
  page: number;
  pages: number;
  interrupted: boolean;
  onLeft: () => void;
  onRight: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onResume?: () => void;
  onCells: (cells: number) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  canPanLeft?: boolean;
  canPanRight?: boolean;
};
const models = {
  "20": {
    name: "Brailliant BI 20X",
    maker: "HumanWare",
    cells: 20,
    family: "brailliant",
  },
  "40": {
    name: "Brailliant BI 40X",
    maker: "HumanWare",
    cells: 40,
    family: "brailliant",
  },
  "40-focus": {
    name: "Focus 40 Blue",
    maker: "Freedom Scientific",
    cells: 40,
    family: "focus",
  },
  "80": {
    name: "Focus 80 Blue",
    maker: "Freedom Scientific",
    cells: 80,
    family: "focus",
  },
} as const;
type ModelKey = keyof typeof models;

export default function BrailleDevice(p: Props) {
  const [chosen, setChosen] = useState<ModelKey>("40");
  const [inspected, setInspected] = useState<number | null>(null);
  const key =
    models[chosen].cells === p.cells ? chosen : (String(p.cells) as ModelKey);
  const model = models[key] || models["40"];
  const selectedDots =
    inspected === null
      ? []
      : Array.from({ length: 8 }, (_, bit) => bit + 1).filter(
          (dot) => (p.dots[inspected] ?? 0) & (1 << (dot - 1)),
        );
  return (
    <div className="hw-workspace">
      <div className="hw-toolbar">
        <label className="hw-model-select">
          <span className="sr-only">Display cells</span>
          <select
            aria-label="Display cells"
            value={key}
            onChange={(e) => {
              const next = e.target.value as ModelKey;
              setChosen(next);
              setInspected(null);
              p.onCells(models[next].cells);
            }}
          >
            {Object.entries(models).map(([value, item]) => (
              <option key={value} value={value}>
                {item.name} · {item.cells} cells
              </option>
            ))}
          </select>
        </label>
        <span className="hw-simulation">
          Simulation{" "}
          <span
            className="hw-pagination"
            aria-label={`Braille page ${p.page} of ${p.pages}`}
          >
            {p.page} / {p.pages}
          </span>
        </span>
      </div>
      <div className="hw-stage">
        <div
          className="hw-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${model.name} display`}
        >
          <div
            className={`hw-device hw-${model.family} hw-size-${p.cells}${p.interrupted ? " hw-update" : ""}`}
          >
            <span className="hw-screw hw-screw-left" aria-hidden="true" />
            <span className="hw-screw hw-screw-right" aria-hidden="true" />
            <div className="hw-nameplate">
              <strong>{model.name}</strong>
              <span>{model.maker}</span>
            </div>
            <div className="hw-keyboard" aria-hidden="true">
              {[7, 3, 2, 1].map((n) => (
                <span className={`hw-perkins hw-key-${n}`} key={n}>
                  <i />
                </span>
              ))}
              <span className="hw-keyboard-gap" />
              {[4, 5, 6, 8].map((n) => (
                <span className={`hw-perkins hw-key-${n}`} key={n}>
                  <i />
                </span>
              ))}
            </div>
            <div className="hw-display-row">
              <button
                className="hw-side-control"
                onClick={p.onLeft}
                disabled={p.canPanLeft === false}
                aria-label="Pan Braille left"
                title="Pan left"
              >
                <CaretLeft size={18} weight="bold" />
                <span />
              </button>
              <div
                className="hw-cell-rail"
                style={{
                  gridTemplateColumns: `repeat(${p.cells}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: p.cells }, (_, index) => (
                  <div
                    className={`physical-cell hw-cell${inspected === index ? " hw-inspected" : ""}`}
                    key={index}
                  >
                    <button
                      className="hw-routing-key"
                      aria-label={`Inspect Braille cell ${index + 1}`}
                      aria-pressed={inspected === index}
                      title={`Cell ${index + 1}`}
                      onClick={() =>
                        setInspected(inspected === index ? null : index)
                      }
                      tabIndex={
                        inspected === null
                          ? index === 0
                            ? 0
                            : -1
                          : inspected === index
                            ? 0
                            : -1
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                          return;
                        e.preventDefault();
                        const next = Math.max(
                          0,
                          Math.min(
                            p.cells - 1,
                            index + (e.key === "ArrowRight" ? 1 : -1),
                          ),
                        );
                        setInspected(next);
                        (
                          e.currentTarget.parentElement?.parentElement?.children[
                            next
                          ]?.querySelector("button") as HTMLButtonElement | null
                        )?.focus();
                      }}
                    >
                      <span />
                    </button>
                    <span className="hw-dots" aria-hidden="true">
                      {[0, 3, 1, 4, 2, 5, 6, 7].map((bit) => (
                        <i
                          className={
                            (p.dots[index] ?? 0) & (1 << bit) ? "raised" : ""
                          }
                          key={bit}
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="hw-side-control"
                onClick={p.onRight}
                disabled={p.canPanRight === false}
                aria-label="Pan Braille right"
                title="Pan right"
              >
                <CaretRight size={18} weight="bold" />
                <span />
              </button>
            </div>
            <div className="hw-thumb-controls">
              <button
                onClick={p.onPrevious}
                disabled={!p.hasPrevious}
                aria-label="Hardware previous block"
                title="Previous block"
              >
                <SkipBack size={16} weight="fill" />
              </button>
              <button
                className="hw-pan"
                onClick={p.onLeft}
                disabled={p.canPanLeft === false}
                aria-label="Hardware previous cells"
                title="Pan left"
              >
                <CaretLeft size={19} weight="bold" />
                <i />
              </button>
              <button
                className="hw-space"
                onClick={p.onResume || p.onRight}
                disabled={!p.onResume && p.canPanRight === false}
                aria-label={
                  p.onResume
                    ? "Hardware resume reading"
                    : "Hardware advance reading"
                }
                title={p.onResume ? "Resume reading" : "Pan right"}
              >
                {p.onResume ? <ArrowUUpLeft size={18} /> : <i />}
              </button>
              <button
                className="hw-pan"
                onClick={p.onRight}
                disabled={p.canPanRight === false}
                aria-label="Hardware next cells"
                title="Pan right"
              >
                <i />
                <CaretRight size={19} weight="bold" />
              </button>
              <button
                onClick={p.onNext}
                disabled={!p.hasNext}
                aria-label="Hardware next block"
                title="Next block"
              >
                <SkipForward size={16} weight="fill" />
              </button>
            </div>
            <div className="hw-front-edge" aria-hidden="true">
              <i />
              <i />
            </div>
          </div>
        </div>
      </div>
      {inspected !== null && (
        <div className="hw-cell-detail" role="status">
          Cell {inspected + 1}:{" "}
          {selectedDots.length ? `dots ${selectedDots.join(", ")}` : "blank"}
          <button onClick={() => setInspected(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
