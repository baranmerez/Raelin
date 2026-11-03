import type { JSONContent } from "@tiptap/react";

/**
 * Small Markdown subset for note bodies written by AI clients: paragraphs, "#" headings,
 * "-"/"*" bullets, "1." numbered lists, "> " quotes and **bold**, _italic_, `code` inline.
 * Anything else stays as plain text; nothing is interpreted as HTML.
 */
export function markdownToDoc(markdown: string): JSONContent {
  const blocks: JSONContent[] = [];
  let list: { type: "bulletList" | "orderedList"; items: JSONContent[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", content: inline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: list.type, content: list.items });
      list = null;
    }
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? "bulletList" : "orderedList";
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      const text = (bullet ?? ordered)?.[1] ?? "";
      list.items.push({
        type: "listItem",
        content: [{ type: "paragraph", content: inline(text) }],
      });
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1].length) },
        content: inline(heading[2]),
      });
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: inline(quote[1]) }],
      });
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] };
}

function inline(text: string): JSONContent[] | undefined {
  const nodes: JSONContent[] = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: "text", text: text.slice(last, index) });
    const token = match[0];
    const inner = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
    const mark = token.startsWith("**") ? "bold" : token.startsWith("_") ? "italic" : "code";
    nodes.push({ type: "text", text: inner, marks: [{ type: mark }] });
    last = index + token.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  // ProseMirror rejects empty text nodes; an empty paragraph has no content at all.
  const filtered = nodes.filter((n) => n.text);
  return filtered.length > 0 ? filtered : undefined;
}
