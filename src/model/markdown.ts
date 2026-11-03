import type { JSONContent } from "@tiptap/react";
import { cardHeight } from "./factory";
import type {
  BoardDoc,
  ChecklistItem,
  EdgeItem,
  FlowNodeItem,
  NodeItem,
  RegionItem,
  TableItem,
} from "./types";
import { isEdgeItem, isNodeItem } from "./types";

export const shapeLabel: Record<FlowNodeItem["shape"], string> = {
  terminal: "başlangıç/bitiş",
  process: "adım",
  decision: "karar",
  ellipse: "elips",
  database: "veritabanı",
  document: "belge",
  io: "girdi/çıktı",
  cloud: "bulut",
  actor: "aktör",
};

/** One line of plain text that cannot break a Markdown table or list. */
function cell(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|");
}

export function checklistToMarkdown(item: ChecklistItem): string[] {
  const done = item.items.filter((e) => e.done).length;
  return [
    `### ${cell(item.title || "Kontrol listesi")} (${done}/${item.items.length})`,
    "",
    ...item.items.map((e) => `- [${e.done ? "x" : " "}] ${cell(e.text)}`),
  ];
}

export function tableToMarkdown(item: TableItem): string[] {
  return [
    `### ${cell(item.name || "tablo")}`,
    "",
    "| Kolon | Tür | PK | Boş olabilir | Not |",
    "| --- | --- | --- | --- | --- |",
    ...item.columns.map(
      (c) =>
        `| ${cell(c.name)} | ${cell(c.type)} | ${c.pk ? "✓" : ""} | ${c.nullable ? "evet" : "hayır"} | ${cell(c.note ?? "")} |`,
    ),
  ];
}

function inline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type !== "text") return inline(node.content);
      let text = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `_${text}_`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "strike") text = `~~${text}~~`;
      }
      return text;
    })
    .join("");
}

function blocks(nodes: JSONContent[] | undefined, indent = ""): string[] {
  const lines: string[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph": {
        const text = inline(node.content);
        if (text.trim()) lines.push(`${indent}${text}`);
        break;
      }
      case "heading":
        lines.push(
          `${"#".repeat(Math.min(6, 3 + Number(node.attrs?.level ?? 1)))} ${inline(node.content)}`,
        );
        break;
      case "bulletList":
      case "orderedList":
        (node.content ?? []).forEach((item, index) => {
          const marker = node.type === "orderedList" ? `${index + 1}.` : "-";
          const [first, ...rest] = blocks(item.content, `${indent}  `);
          lines.push(`${indent}${marker} ${(first ?? "").trimStart()}`);
          lines.push(...rest);
        });
        break;
      case "blockquote":
        for (const line of blocks(node.content)) lines.push(`${indent}> ${line}`);
        break;
      case "codeBlock":
        lines.push(
          `${indent}\`\`\``,
          ...inline(node.content)
            .split("\n")
            .map((l) => indent + l),
          `${indent}\`\`\``,
        );
        break;
      case "horizontalRule":
        lines.push(`${indent}---`);
        break;
      default:
        lines.push(...blocks(node.content, indent));
    }
  }
  return lines;
}

export function noteToMarkdown(content: JSONContent): string {
  return blocks(content.content).join("\n");
}

function center(item: NodeItem): { x: number; y: number } {
  const height = "height" in item ? item.height : item.kind === "note" ? 120 : cardHeight(item);
  return { x: item.x + item.width / 2, y: item.y + height / 2 };
}

function inside(region: RegionItem, item: NodeItem): boolean {
  const c = center(item);
  return (
    c.x >= region.x &&
    c.x <= region.x + region.width &&
    c.y >= region.y &&
    c.y <= region.y + region.height
  );
}

function nameOf(item: NodeItem | undefined): string {
  if (!item) return "?";
  if (item.kind === "flowNode") return item.text || "(adsız adım)";
  if (item.kind === "note" || item.kind === "region") return item.title || "(adsız)";
  if (item.kind === "image") return item.alt || "resim";
  if (item.kind === "text") return item.text || "(boş metin)";
  if (item.kind === "checklist" || item.kind === "link") return item.title || "(adsız)";
  if (item.kind === "table") return item.name || "(adsız tablo)";
  if (item.kind === "arrow") return "ok";
  return "serbest çizim";
}

/** Flow steps ordered from entry nodes along flow edges, then any leftovers. */
function orderSteps(steps: FlowNodeItem[], edges: EdgeItem[]): FlowNodeItem[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const flowEdges = edges.filter(
    (e) => e.style === "flow" && byId.has(e.source) && byId.has(e.target),
  );
  const incoming = new Set(flowEdges.map((e) => e.target));
  const queue = steps.filter((s) => !incoming.has(s.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const ordered: FlowNodeItem[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const step = queue.shift() as FlowNodeItem;
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    ordered.push(step);
    for (const edge of flowEdges.filter((e) => e.source === step.id)) {
      const next = byId.get(edge.target);
      if (next && !seen.has(next.id)) queue.push(next);
    }
  }
  for (const step of [...steps].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!seen.has(step.id)) ordered.push(step);
  }
  return ordered;
}

function groupSection(
  title: string | null,
  members: NodeItem[],
  edges: EdgeItem[],
  all: Map<string, NodeItem>,
): string[] {
  const lines: string[] = [];
  if (title) lines.push(`## ${title}`, "");
  const steps = members.filter((m): m is FlowNodeItem => m.kind === "flowNode");
  if (steps.length > 0) {
    lines.push("### Akış", "");
    orderSteps(steps, edges).forEach((step, index) => {
      lines.push(`${index + 1}. **${nameOf(step)}** (${shapeLabel[step.shape]})`);
      for (const edge of edges.filter((e) => e.source === step.id && e.style === "flow")) {
        const label = edge.label ? `${edge.label} → ` : "→ ";
        lines.push(`   - ${label}${nameOf(all.get(edge.target))}`);
      }
    });
    lines.push("");
  }
  for (const note of members.filter((m) => m.kind === "note")) {
    if (note.kind !== "note") continue;
    lines.push(`### ${note.title || "Not"}`, "");
    const body = noteToMarkdown(note.content);
    if (body) lines.push(body, "");
  }
  for (const member of members) {
    if (member.kind === "text" && member.text.trim()) lines.push(member.text, "");
    else if (member.kind === "checklist") lines.push(...checklistToMarkdown(member), "");
    else if (member.kind === "link") {
      const title = cell(member.title || member.url).replace(/[[\]]/g, "\\$&");
      lines.push(
        `- [${title}](<${member.url.replace(/[<>\s]/g, encodeURIComponent)}>)${member.note ? ` — ${cell(member.note)}` : ""}`,
        "",
      );
    }
  }
  for (const image of members) {
    if (image.kind !== "image") continue;
    // The picture itself lives inside the .rli file; Markdown only names it.
    lines.push(`_Resim: ${image.alt || "adsız"}_`, "");
  }
  return lines;
}

export function boardToMarkdown(board: BoardDoc, selectedIds?: ReadonlySet<string>): string {
  const scoped = selectedIds && selectedIds.size > 0;
  const nodes = board.items.filter(isNodeItem).filter((n) => !scoped || selectedIds.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = board.items
    .filter(isEdgeItem)
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  const all = new Map(board.items.filter(isNodeItem).map((n) => [n.id, n]));

  const lines: string[] = [`# ${board.title}`, ""];
  if (scoped) lines.push("_Panonun seçili bölümü._", "");

  const regions = nodes
    .filter((n): n is RegionItem => n.kind === "region")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const content = nodes.filter(
    (n) =>
      n.kind === "flowNode" ||
      n.kind === "note" ||
      n.kind === "image" ||
      n.kind === "text" ||
      n.kind === "checklist" ||
      n.kind === "link",
  );
  const placed = new Set<string>();
  for (const region of regions) {
    const members = content.filter((n) => !placed.has(n.id) && inside(region, n));
    for (const m of members) placed.add(m.id);
    lines.push(...groupSection(region.title || "Bölge", members, edges, all));
  }
  const loose = content.filter((n) => !placed.has(n.id));
  if (loose.length > 0)
    lines.push(...groupSection(regions.length > 0 ? "Bölge dışı" : null, loose, edges, all));

  const tables = nodes
    .filter((n): n is TableItem => n.kind === "table")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const isTable = (id: string) => all.get(id)?.kind === "table";
  const relations = edges.filter((e) => isTable(e.source) && isTable(e.target));
  if (tables.length > 0) {
    lines.push("## Veritabanı", "");
    for (const table of tables) lines.push(...tableToMarkdown(table), "");
    if (relations.length > 0) {
      lines.push("### İlişkiler", "");
      for (const rel of relations) {
        lines.push(
          `- ${cell(nameOf(all.get(rel.source)))} → ${cell(nameOf(all.get(rel.target)))}${rel.label ? ` (${cell(rel.label)})` : ""}`,
        );
      }
      lines.push("");
    }
  }

  const references = edges.filter(
    (e) => e.style === "reference" && !(isTable(e.source) && isTable(e.target)),
  );
  if (references.length > 0) {
    lines.push("## Referanslar", "");
    for (const ref of references) {
      lines.push(
        `- ${nameOf(all.get(ref.source))} ⇢ ${nameOf(all.get(ref.target))}${ref.label ? ` (${ref.label})` : ""}`,
      );
    }
    lines.push("");
  }

  const strokes = nodes.filter((n) => n.kind === "stroke").length;
  if (strokes > 0) lines.push(`_${strokes} serbest çizim metne çevrilmedi._`, "");
  const arrows = nodes.filter((n) => n.kind === "arrow").length;
  if (arrows > 0) lines.push(`_${arrows} serbest ok metne çevrilmedi._`, "");

  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
