import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { LinkItem } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";
import { Icon } from "../../ui/Icon";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";
import { WidthResizer } from "./WidthResizer";

export type LinkRfNode = Node<{ item: LinkItem }, "link">;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const LinkView = memo(function LinkView({ data, selected }: NodeProps<LinkRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const showToast = useBoardStore((s) => s.showToast);
  const patch = (p: Partial<LinkItem>) => commit((b) => patchItem<LinkItem>(b, item.id, p));

  const copy = () => {
    navigator.clipboard.writeText(item.url).then(
      () => showToast("Bağlantı kopyalandı."),
      () => showToast("Bağlantı kopyalanamadı.", "error"),
    );
  };

  return (
    <div
      className={`board-card link-card${selected ? " is-selected" : ""}`}
      style={{ ...toneStyle(item.tone), width: item.width }}
    >
      <WidthResizer visible={selected} minWidth={200} />
      <div className="link-host">
        <Icon name="link" size={15} />
        <span>{hostOf(item.url)}</span>
        <button
          type="button"
          className="card-icon-button nodrag"
          onClick={copy}
          aria-label="Adresi kopyala"
          title="Adresi kopyala"
        >
          <Icon name="copy" size={15} />
        </button>
      </div>
      <InlineText
        className="card-title"
        multiline={false}
        value={item.title || "Başlıksız bağlantı"}
        onCommit={(title) => patch({ title })}
      />
      {(item.note || selected) && (
        <InlineText
          className={`link-note${item.note ? "" : " is-placeholder"}`}
          value={item.note || "Not ekle"}
          onCommit={(note) => patch({ note: note === "Not ekle" ? "" : note })}
        />
      )}
      {selected && (
        // Invalid addresses are refused by the board invariants with a toast.
        <InlineText
          className="link-url"
          multiline={false}
          value={item.url}
          onCommit={(url) => patch({ url })}
        />
      )}
      <SideHandles />
    </div>
  );
});
