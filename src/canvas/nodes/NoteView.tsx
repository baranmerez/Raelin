import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Node, NodeProps } from "@xyflow/react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import type { NoteItem } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";

export type NoteRfNode = Node<{ item: NoteItem }, "note">;

function renderInline(nodes: JSONContent[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    const key = `${i}`;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type !== "text") return <span key={key}>{renderInline(node.content)}</span>;
    let el: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") el = <strong>{el}</strong>;
      else if (mark.type === "italic") el = <em>{el}</em>;
      else if (mark.type === "strike") el = <s>{el}</s>;
      else if (mark.type === "code") el = <code>{el}</code>;
      else if (mark.type === "underline") el = <u>{el}</u>;
    }
    return <span key={key}>{el}</span>;
  });
}

function renderBlocks(nodes: JSONContent[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    const key = `${i}`;
    switch (node.type) {
      case "paragraph":
        return <p key={key}>{node.content ? renderInline(node.content) : <br />}</p>;
      case "heading":
        return <h4 key={key}>{renderInline(node.content)}</h4>;
      case "bulletList":
        return <ul key={key}>{renderBlocks(node.content)}</ul>;
      case "orderedList":
        return <ol key={key}>{renderBlocks(node.content)}</ol>;
      case "listItem":
        return <li key={key}>{renderBlocks(node.content)}</li>;
      case "blockquote":
        return <blockquote key={key}>{renderBlocks(node.content)}</blockquote>;
      case "codeBlock":
        return (
          <pre key={key}>
            <code>{renderInline(node.content)}</code>
          </pre>
        );
      case "horizontalRule":
        return <hr key={key} />;
      default:
        return <div key={key}>{renderBlocks(node.content)}</div>;
    }
  });
}

/** Live editor, mounted only while the note is being edited. */
function NoteEditor({
  item,
  caretAt,
  onDone,
}: {
  item: NoteItem;
  caretAt: { x: number; y: number } | null;
  onDone: () => void;
}) {
  const live = useBoardStore((s) => s.live);
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  const lastEmitted = useRef<JSONContent>(item.content);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    content: item.content,
    editorProps: {
      // Pasted HTML is reduced to the StarterKit schema; scripts and unknown tags are dropped.
      attributes: { class: "note-editor", spellcheck: "false" },
    },
    onCreate: () => beginGesture(),
    onBlur: () => {
      endGesture();
      onDone();
    },
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON();
      lastEmitted.current = json;
      live((b) => patchItem<NoteItem>(b, item.id, { content: json }));
    },
  });

  // Runs after EditorContent has attached the view (child effects run first). The static
  // preview and the editor share layout, so the click point maps to the same text position.
  const placedCaret = useRef(false);
  useEffect(() => {
    if (!editor || placedCaret.current) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      if (editor.isDestroyed) return;
      // EditorContent attaches the view a moment after mount; wait until it is in the page.
      if (!editor.view.dom.isConnected && tries++ < 20) {
        timer = setTimeout(place, 16);
        return;
      }
      placedCaret.current = true;
      const hit = caretAt ? editor.view.posAtCoords({ left: caretAt.x, top: caretAt.y }) : null;
      if (hit) editor.chain().focus().setTextSelection(hit.pos).run();
      else editor.commands.focus("end");
    };
    place();
    return () => clearTimeout(timer);
  }, [editor, caretAt]);

  // Board-level undo/redo replaces content; mirror it into the editor without echoing back.
  useEffect(() => {
    if (!editor || item.content === lastEmitted.current) return;
    lastEmitted.current = item.content;
    editor.commands.setContent(item.content, { emitUpdate: false });
  }, [editor, item.content]);

  return <EditorContent editor={editor} className="note-body nodrag nopan nowheel" />;
}

export const NoteView = memo(function NoteView({ data, selected }: NodeProps<NoteRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const [editing, setEditing] = useState(false);
  const [caretAt, setCaretAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={`note-card${selected ? " is-selected" : ""}`}
      style={{ ...toneStyle(item.tone), width: item.width }}
    >
      <div className="note-header note-drag">
        <span className="note-pin" aria-hidden="true" />
        <InlineText
          className="note-title"
          multiline={false}
          value={item.title}
          onCommit={(title) => commit((b) => patchItem<NoteItem>(b, item.id, { title }))}
        />
      </div>
      {editing ? (
        <NoteEditor item={item} caretAt={caretAt} onDone={() => setEditing(false)} />
      ) : (
        // Static markup keeps hundreds of notes cheap; the editor mounts on first click.
        // biome-ignore lint/a11y/useSemanticElements: block content (lists) cannot live inside <button>
        <div
          className="note-body note-static nodrag nopan"
          role="button"
          tabIndex={0}
          aria-label="Notu düzenle"
          onClick={(e) => {
            setCaretAt({ x: e.clientX, y: e.clientY });
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              setCaretAt(null);
              setEditing(true);
            }
          }}
        >
          <div className="note-editor">{renderBlocks(item.content.content)}</div>
        </div>
      )}
      <SideHandles />
    </div>
  );
});
