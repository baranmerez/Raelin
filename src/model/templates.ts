import { makeChecklist, makeEdge, makeFlowNode, makeNote, makeRegion } from "./factory";
import type { BoardItem, NodeItem, RegionItem, ToneName } from "./types";

/**
 * Ready-made starting points. Builders are pure apart from fresh ids: they return new
 * items around a center point, so the UI and AI clients can insert them in one step.
 */
export type TemplateId = "mindMap" | "kanban" | "swimlane";

export const templateList: { id: TemplateId; label: string }[] = [
  { id: "mindMap", label: "Zihin haritası" },
  { id: "kanban", label: "Kanban" },
  { id: "swimlane", label: "Kulvarlı akış" },
];

function region(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  tone: ToneName,
): RegionItem {
  return { ...makeRegion(0, 0, title, tone), x, y, width, height };
}

/** Top-left placement for a node built around (0, 0). */
function at<T extends NodeItem>(item: T, x: number, y: number): T {
  return { ...item, x, y };
}

function mindMap(cx: number, cy: number): BoardItem[] {
  const center = makeFlowNode("ellipse", cx, cy, "Ana fikir", "lilac");
  const branches = [
    { dx: -340, dy: -120, text: "Hedefler", tone: "peach" as const, from: "l", to: "r" },
    { dx: -340, dy: 120, text: "Riskler", tone: "butter" as const, from: "l", to: "r" },
    { dx: 340, dy: -120, text: "Fikirler", tone: "sage" as const, from: "r", to: "l" },
    { dx: 340, dy: 120, text: "Sorular", tone: "periwinkle" as const, from: "r", to: "l" },
  ];
  const items: BoardItem[] = [center];
  for (const b of branches) {
    const node = makeFlowNode("process", cx + b.dx, cy + b.dy, b.text, b.tone);
    items.push(node, makeEdge(center.id, node.id, { sourceHandle: b.from, targetHandle: b.to }));
  }
  return items;
}

function kanban(cx: number, cy: number): BoardItem[] {
  const width = 340;
  const height = 520;
  const gap = 32;
  const left = cx - (width * 3 + gap * 2) / 2;
  const top = cy - height / 2;
  const columns = [
    { title: "Yapılacak", tone: "peach" as const },
    { title: "Yapılıyor", tone: "butter" as const },
    { title: "Bitti", tone: "sage" as const },
  ];
  const items: BoardItem[] = [];
  columns.forEach((column, i) => {
    const r = region(left + i * (width + gap), top, width, height, column.title, column.tone);
    items.push(r);
    const x = r.x + 30;
    const y = r.y + 96;
    if (i === 0) {
      items.push(
        at(makeNote(0, 0, "Yeni fikir", ["Ayrıntıları yaz"]), x, y),
        at(
          makeChecklist(0, 0, "Hazırlık", [
            { text: "Gereksinimleri topla" },
            { text: "Taslak çiz" },
          ]),
          x,
          y + 150,
        ),
      );
    } else if (i === 1) {
      items.push(at(makeNote(0, 0, "Devam eden iş", ["Kimde olduğunu yaz"]), x, y));
    } else {
      items.push(
        at(
          makeChecklist(0, 0, "Tamamlanan", [
            { text: "İlk sürüm", done: true },
            { text: "Gözden geçirme", done: true },
          ]),
          x,
          y,
        ),
      );
    }
  });
  return items;
}

function swimlane(cx: number, cy: number): BoardItem[] {
  const width = 1180;
  const height = 280;
  const gap = 24;
  const left = cx - width / 2;
  const top = cy - (height * 3 + gap * 2) / 2;
  const lanes = [
    { title: "Kullanıcı", tone: "lilac" as const },
    { title: "Sistem", tone: "periwinkle" as const },
    { title: "Destek", tone: "sage" as const },
  ].map((lane, i) => region(left, top + i * (height + gap), width, height, lane.title, lane.tone));
  const mid = (lane: number) => lanes[lane].y + height / 2 + 28;
  const start = makeFlowNode("terminal", left + 280, mid(0), "Başla");
  const request = makeFlowNode("process", left + 600, mid(0), "Talep oluştur");
  const check = makeFlowNode("process", left + 600, mid(1), "Talebi kontrol et");
  const decide = makeFlowNode("decision", left + 920, mid(1), "Uygun mu?");
  const solve = makeFlowNode("process", left + 920, mid(2), "Çözümü uygula");
  const done = makeFlowNode("terminal", left + 600, mid(2), "Bitti");
  return [
    ...lanes,
    start,
    request,
    check,
    decide,
    solve,
    done,
    makeEdge(start.id, request.id, { sourceHandle: "r", targetHandle: "l" }),
    makeEdge(request.id, check.id, { sourceHandle: "b", targetHandle: "t" }),
    makeEdge(check.id, decide.id, { sourceHandle: "r", targetHandle: "l" }),
    makeEdge(decide.id, solve.id, { sourceHandle: "b", targetHandle: "t", label: "evet" }),
    makeEdge(decide.id, request.id, { sourceHandle: "t", targetHandle: "r", label: "hayır" }),
    makeEdge(solve.id, done.id, { sourceHandle: "l", targetHandle: "r" }),
  ];
}

const builders: Record<TemplateId, (cx: number, cy: number) => BoardItem[]> = {
  mindMap,
  kanban,
  swimlane,
};

/** Items of a template centered on (cx, cy), all with fresh ids. */
export function buildTemplate(id: TemplateId, cx: number, cy: number): BoardItem[] {
  return builders[id](cx, cy);
}
