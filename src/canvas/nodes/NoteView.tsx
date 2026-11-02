import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Node, NodeProps } from "@xyflow/react";
import { useEffect, useRef } from "react";
import type { NoteItem } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";

export type NoteRfNode = Node<{ item: NoteItem }, "note">;

export function NoteView({ data, selected }: NodeProps<NoteRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
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
    onFocus: () => beginGesture(),
    onBlur: () => endGesture(),
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON();
      lastEmitted.current = json;
      live((b) => patchItem<NoteItem>(b, item.id, { content: json }));
    },
  });

  // Board-level undo/redo replaces content; mirror it into the editor without echoing back.
  useEffect(() => {
    if (!editor || item.content === lastEmitted.current) return;
    lastEmitted.current = item.content;
    editor.commands.setContent(item.content, { emitUpdate: false });
  }, [editor, item.content]);

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
      <EditorContent editor={editor} className="note-body nodrag nopan nowheel" />
      <SideHandles />
    </div>
  );
}
