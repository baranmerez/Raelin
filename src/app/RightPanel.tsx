import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { shapeSize } from "../model/factory";
import { penColors, toneOrder, tones } from "../model/tones";
import type {
  BoardItem,
  ConnectorType,
  EdgeItem,
  FlowShape,
  FlowStyle,
  ToneName,
} from "../model/types";
import { mapItems, useBoardStore } from "../state/boardStore";

const flowStyles: { id: FlowStyle; label: string }[] = [
  { id: "pastel", label: "Pastel" },
  { id: "line", label: "Çizgi" },
  { id: "flat", label: "Düz" },
];

const connectors: { id: ConnectorType; label: string }[] = [
  { id: "elbow", label: "Dirsek" },
  { id: "curve", label: "Eğri" },
  { id: "straight", label: "Düz" },
];

const shapes: { id: FlowShape; label: string }[] = [
  { id: "terminal", label: "Başlangıç" },
  { id: "process", label: "Adım" },
  { id: "decision", label: "Karar" },
];

function StylePreview({ style }: { style: FlowStyle }) {
  const fill = style === "pastel" ? "#fde4dc" : style === "flat" ? "#c9c3cf" : "#ffffff";
  const stroke = style === "pastel" ? "#ec8f7a" : style === "flat" ? "#c9c3cf" : "#2e2838";
  const top = style === "pastel" ? "#e3d3fa" : style === "flat" ? "#c9c3cf" : "#ffffff";
  return (
    <svg viewBox="0 0 40 44" width="40" height="44" aria-hidden="true">
      <rect
        x="8"
        y="2"
        width="24"
        height="10"
        rx="3"
        fill={top}
        stroke={style === "pastel" ? "#a98ae0" : stroke}
        strokeWidth="1.5"
      />
      <path d="M20 12v6" stroke={stroke} strokeWidth="1.5" />
      <path d="M20 18 32 30 20 42 8 30Z" fill={fill} stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

interface PanelSummary {
  flowStyle: FlowStyle;
  connector: ConnectorType;
  tonableCount: number;
  tone: ToneName | null;
  flowCount: number;
  shape: FlowShape | "mixed" | null;
  edgeCount: number;
  edgeStyle: EdgeItem["style"] | "mixed" | null;
}

function merge<T>(current: T | "mixed" | null, value: T): T | "mixed" {
  return current === null || current === value ? value : "mixed";
}

/**
 * Only the primitives the panel shows. With a shallow comparison the panel stays
 * still while nodes are dragged, because positions are not part of the summary.
 */
function summarize(state: ReturnType<typeof useBoardStore.getState>): PanelSummary | null {
  const board = state.workspace.boards[state.activeBoardId];
  if (!board) return null;
  const summary: PanelSummary = {
    flowStyle: board.flowStyle,
    connector: board.connector,
    tonableCount: 0,
    tone: null,
    flowCount: 0,
    shape: null,
    edgeCount: 0,
    edgeStyle: null,
  };
  if (state.selectedIds.length === 0) return summary;
  const selected = new Set(state.selectedIds);
  for (const item of board.items) {
    if (!selected.has(item.id)) continue;
    if (item.kind === "edge") {
      summary.edgeCount++;
      summary.edgeStyle = merge(summary.edgeStyle, item.style);
      continue;
    }
    if (item.kind === "stroke") continue;
    summary.tonableCount++;
    summary.tone ??= item.tone;
    if (item.kind === "flowNode") {
      summary.flowCount++;
      summary.shape = merge(summary.shape, item.shape);
    }
  }
  return summary;
}

export function RightPanel() {
  const summary = useBoardStore(useShallow(summarize));
  const tool = useBoardStore((s) => s.tool);
  const penColor = useBoardStore((s) => s.penColor);
  const penSize = useBoardStore((s) => s.penSize);
  const setPen = useBoardStore((s) => s.setPen);
  const commit = useBoardStore((s) => s.commit);
  if (!summary) return null;

  const currentTone = summary.tone;

  const applyToSelection = (fn: (item: BoardItem) => BoardItem) => {
    const selected = new Set(useBoardStore.getState().selectedIds);
    commit((b) => mapItems(b, (item) => (selected.has(item.id) ? fn(item) : item)));
  };

  const setTone = (tone: ToneName) =>
    applyToSelection((item) =>
      (item.kind === "flowNode" || item.kind === "note" || item.kind === "region") &&
      item.tone !== tone
        ? { ...item, tone }
        : item,
    );

  const setShape = (shape: FlowShape) =>
    applyToSelection((item) => {
      if (item.kind !== "flowNode" || item.shape === shape) return item;
      const size = shapeSize[shape];
      // Keep the visual center in place when the footprint changes.
      return {
        ...item,
        shape,
        x: item.x + (item.width - size.width) / 2,
        y: item.y + (item.height - size.height) / 2,
        ...size,
      };
    });

  return (
    <aside className="right-panel" aria-label="Özellikler">
      <section className="panel-section">
        <h2 className="panel-title">Akış stili</h2>
        <div className="style-cards">
          {flowStyles.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`style-card${summary.flowStyle === s.id ? " is-active" : ""}`}
              onClick={() => commit((b) => (b.flowStyle === s.id ? b : { ...b, flowStyle: s.id }))}
              aria-pressed={summary.flowStyle === s.id}
            >
              <StylePreview style={s.id} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {summary.tonableCount > 0 && (
          <motion.section
            key="tone"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Dolgu rengi</h3>
            <div className="swatches">
              {toneOrder.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  className={`swatch${currentTone === tone ? " is-active" : ""}`}
                  style={{ background: tones[tone].fill, borderColor: tones[tone].border }}
                  onClick={() => setTone(tone)}
                  aria-label={tones[tone].label}
                  title={tones[tone].label}
                />
              ))}
            </div>
          </motion.section>
        )}
        {summary.flowCount > 0 && (
          <motion.section
            key="shape"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Şekil</h3>
            <div className="segmented">
              {shapes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={summary.shape === s.id ? "is-active" : ""}
                  onClick={() => setShape(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </motion.section>
        )}
        {summary.edgeCount > 0 && (
          <motion.section
            key="edge"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Bağlantı anlamı</h3>
            <div className="segmented">
              {(["flow", "reference"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  className={summary.edgeStyle === style ? "is-active" : ""}
                  onClick={() =>
                    applyToSelection((item) =>
                      item.kind === "edge" && item.style !== style ? { ...item, style } : item,
                    )
                  }
                >
                  {style === "flow" ? "Akış" : "Referans"}
                </button>
              ))}
            </div>
            <p className="field-hint">Referans, akış sırası değildir; yalnız ilişkiyi gösterir.</p>
          </motion.section>
        )}
        {tool === "pen" && (
          <motion.section
            key="pen"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Kalem</h3>
            <div className="swatches">
              {penColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch round${penColor === color ? " is-active" : ""}`}
                  style={{ background: color, borderColor: color }}
                  onClick={() => setPen({ color })}
                  aria-label={`Renk ${color}`}
                />
              ))}
            </div>
            <label className="range-field">
              <span>Kalınlık</span>
              <input
                type="range"
                min={2}
                max={16}
                value={penSize}
                onChange={(e) => setPen({ size: Number(e.target.value) })}
              />
              <output>{penSize}px</output>
            </label>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="panel-section">
        <h3 className="field-label">Bağlantı tipi</h3>
        <div className="segmented">
          {connectors.map((c) => (
            <button
              key={c.id}
              type="button"
              className={summary.connector === c.id ? "is-active" : ""}
              onClick={() => commit((b) => (b.connector === c.id ? b : { ...b, connector: c.id }))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <div className="panel-spacer" />

      <section className="panel-section panel-help">
        <h3 className="field-label">Kısayollar</h3>
        <ul>
          <li>
            <kbd>Çift tık</kbd> metni düzenle
          </li>
          <li>
            <kbd>Boşluk</kbd> + sürükle: kaydır
          </li>
          <li>
            <kbd>Ctrl</kbd> + tekerlek: yakınlaş
          </li>
          <li>
            <kbd>Del</kbd> seçimi sil
          </li>
        </ul>
      </section>
    </aside>
  );
}
