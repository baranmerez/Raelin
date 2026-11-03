import { useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { type AlignMode, alignItems } from "../commands/align";
import { useMcpStatus } from "../mcp/connection";
import { shapeSize } from "../model/factory";
import { penColors, toneOrder, tones } from "../model/tones";
import type {
  ArrowHead,
  BoardItem,
  ConnectorType,
  EdgeItem,
  FlowShape,
  FlowStyle,
  TextSize,
  ToneName,
} from "../model/types";
import { isDesktop } from "../platform/storage";
import { mapItems, useBoardStore } from "../state/boardStore";
import { Icon, type IconName } from "../ui/Icon";

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

const alignModes: { id: AlignMode; icon: IconName; label: string }[] = [
  { id: "left", icon: "alignLeft", label: "Sola hizala" },
  { id: "center", icon: "alignCenter", label: "Yatayda ortala" },
  { id: "right", icon: "alignRight", label: "Sağa hizala" },
  { id: "top", icon: "alignTop", label: "Üste hizala" },
  { id: "middle", icon: "alignMiddle", label: "Dikeyde ortala" },
  { id: "bottom", icon: "alignBottom", label: "Alta hizala" },
  { id: "distributeH", icon: "distributeH", label: "Yatay aralıkları eşitle" },
  { id: "distributeV", icon: "distributeV", label: "Dikey aralıkları eşitle" },
];

const shapes: { id: FlowShape; label: string }[] = [
  { id: "terminal", label: "Başlangıç" },
  { id: "process", label: "Adım" },
  { id: "decision", label: "Karar" },
  { id: "ellipse", label: "Elips" },
  { id: "io", label: "Girdi/çıktı" },
  { id: "document", label: "Belge" },
  { id: "database", label: "Veritabanı" },
  { id: "cloud", label: "Bulut" },
  { id: "actor", label: "Aktör" },
];

const textSizes: { id: TextSize; label: string }[] = [
  { id: "s", label: "Küçük" },
  { id: "m", label: "Orta" },
  { id: "l", label: "Büyük" },
];

const arrowHeads: { id: ArrowHead; label: string }[] = [
  { id: "end", label: "Tek uç" },
  { id: "both", label: "Çift uç" },
  { id: "none", label: "Çizgi" },
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
  /** Selected nodes that can be aligned (everything but edges and strokes). */
  alignCount: number;
  tone: ToneName | null;
  flowCount: number;
  shape: FlowShape | "mixed" | null;
  edgeCount: number;
  edgeStyle: EdgeItem["style"] | "mixed" | null;
  textCount: number;
  textSize: TextSize | "mixed" | null;
  arrowCount: number;
  arrowHead: ArrowHead | "mixed" | null;
  arrowDashed: boolean | "mixed" | null;
  arrowColor: string | "mixed" | null;
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
    alignCount: 0,
    tone: null,
    flowCount: 0,
    shape: null,
    edgeCount: 0,
    edgeStyle: null,
    textCount: 0,
    textSize: null,
    arrowCount: 0,
    arrowHead: null,
    arrowDashed: null,
    arrowColor: null,
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
    summary.alignCount++;
    if (item.kind === "arrow") {
      summary.arrowCount++;
      summary.arrowHead = merge(summary.arrowHead, item.head);
      summary.arrowDashed = merge(summary.arrowDashed, item.dashed);
      summary.arrowColor = merge(summary.arrowColor, item.color);
      continue;
    }
    if (item.kind === "image") continue;
    summary.tonableCount++;
    summary.tone ??= item.tone;
    if (item.kind === "flowNode") {
      summary.flowCount++;
      summary.shape = merge(summary.shape, item.shape);
    } else if (item.kind === "text") {
      summary.textCount++;
      summary.textSize = merge(summary.textSize, item.size);
    }
  }
  return summary;
}

function McpChip() {
  const clients = useMcpStatus(useShallow((s) => Object.values(s.clients)));
  if (!isDesktop) return null;
  const connected = clients.length > 0;
  return (
    <div className={`mcp-chip${connected ? " is-on" : ""}`} role="status">
      <span className="mcp-dot" aria-hidden="true" />
      {connected ? `MCP bağlı · ${[...new Set(clients)].join(", ")}` : "MCP bekliyor"}
    </div>
  );
}

export function RightPanel() {
  const summary = useBoardStore(useShallow(summarize));
  const tool = useBoardStore((s) => s.tool);
  const penColor = useBoardStore((s) => s.penColor);
  const penSize = useBoardStore((s) => s.penSize);
  const setPen = useBoardStore((s) => s.setPen);
  const commit = useBoardStore((s) => s.commit);
  const { getNode } = useReactFlow();
  if (!summary) return null;

  const currentTone = summary.tone;

  const applyToSelection = (fn: (item: BoardItem) => BoardItem) => {
    const selected = new Set(useBoardStore.getState().selectedIds);
    commit((b) => mapItems(b, (item) => (selected.has(item.id) ? fn(item) : item)));
  };

  const setTone = (tone: ToneName) =>
    applyToSelection((item) => ("tone" in item && item.tone !== tone ? { ...item, tone } : item));

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

  const align = (mode: AlignMode) => {
    const selected = new Set(useBoardStore.getState().selectedIds);
    // Notes grow with their text, so the canvas knows their real height.
    commit((b) =>
      alignItems(b, selected, mode, (item) => {
        const m = getNode(item.id)?.measured;
        return m?.width && m.height ? { width: m.width, height: m.height } : undefined;
      }),
    );
  };

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
        {summary.alignCount > 1 && (
          <motion.section
            key="align"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Hizala</h3>
            <div className="align-grid">
              {alignModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="align-button"
                  onClick={() => align(m.id)}
                  disabled={m.id.startsWith("distribute") && summary.alignCount < 3}
                  aria-label={m.label}
                  title={m.label}
                >
                  <Icon name={m.icon} size={18} />
                </button>
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
            <div className="segmented shape-grid">
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
        {summary.textCount > 0 && (
          <motion.section
            key="text"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Metin boyutu</h3>
            <div className="segmented">
              {textSizes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={summary.textSize === s.id ? "is-active" : ""}
                  onClick={() =>
                    applyToSelection((item) =>
                      item.kind === "text" && item.size !== s.id ? { ...item, size: s.id } : item,
                    )
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </motion.section>
        )}
        {summary.arrowCount > 0 && (
          <motion.section
            key="arrow"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="field-label">Ok</h3>
            <div className="segmented">
              {arrowHeads.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={summary.arrowHead === h.id ? "is-active" : ""}
                  onClick={() =>
                    applyToSelection((item) =>
                      item.kind === "arrow" && item.head !== h.id ? { ...item, head: h.id } : item,
                    )
                  }
                >
                  {h.label}
                </button>
              ))}
            </div>
            <div className="segmented">
              {[false, true].map((dashed) => (
                <button
                  key={String(dashed)}
                  type="button"
                  className={summary.arrowDashed === dashed ? "is-active" : ""}
                  onClick={() =>
                    applyToSelection((item) =>
                      item.kind === "arrow" && item.dashed !== dashed ? { ...item, dashed } : item,
                    )
                  }
                >
                  {dashed ? "Kesikli" : "Düz"}
                </button>
              ))}
            </div>
            <div className="swatches">
              {penColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch round${summary.arrowColor === color ? " is-active" : ""}`}
                  style={{ background: color, borderColor: color }}
                  onClick={() =>
                    applyToSelection((item) =>
                      item.kind === "arrow" && item.color !== color ? { ...item, color } : item,
                    )
                  }
                  aria-label={`Ok rengi ${color}`}
                />
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

      <McpChip />

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
          <li>
            <kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>V</kbd> / <kbd>D</kbd> kopyala, yapıştır, çoğalt
          </li>
          <li>
            <kbd>E</kbd> silgi · sekmede çift tık: yeniden adlandır
          </li>
          <li>
            <kbd>T</kbd> metin · <kbd>L</kbd> ok (sürükle) · <kbd>K</kbd> kontrol listesi
          </li>
          <li>
            <kbd>U</kbd> bağlantı kartı · <kbd>B</kbd> tablo
          </li>
        </ul>
      </section>
    </aside>
  );
}
