import { emptyBoard, makeEdge, makeFlowNode, makeNote, makeRegion } from "./factory";
import { newId } from "./ids";
import type { BoardDoc, StrokeItem, Workspace } from "./types";
import { formatVersion } from "./types";

function squiggle(x: number, y: number): StrokeItem {
  const points: [number, number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    points.push([t * 220 + 8, 30 + Math.sin(t * Math.PI * 3.2) * 18 - t * 14, 0.5]);
  }
  return {
    id: newId("s"),
    kind: "stroke",
    points,
    color: "#3f5f9e",
    size: 5,
    x,
    y,
    width: 240,
    height: 70,
  };
}

function flowBoard(): BoardDoc {
  const board = emptyBoard("Akış & taslak");
  const flowRegion = {
    ...makeRegion(0, 0, "Akış", "lilac"),
    x: -40,
    y: -20,
    width: 600,
    height: 860,
  };
  const sketchRegion = {
    ...makeRegion(0, 0, "Ekran taslağı", "peach"),
    x: 620,
    y: -20,
    width: 560,
    height: 520,
  };

  const idea = makeFlowNode("terminal", 330, 120, "Fikir");
  const scope = makeFlowNode("process", 330, 250, "Kapsamı belirle");
  const ready = makeFlowNode("decision", 330, 420, "Hazır mı?");
  const notes = { ...makeFlowNode("process", 80, 420, "Notları tamamla"), width: 160, height: 84 };
  notes.x = 80 - 80;
  notes.y = 420 - 42;
  const draft = makeFlowNode("process", 330, 600, "İlk taslağı çiz");
  const feedback = makeFlowNode("terminal", 330, 740, "Geri bildirim al");

  const screen = makeNote(900, 230, "Yeni çalışma ekranı", [
    "Çalışma adı alanı",
    "Oluştur düğmesi",
    "Görsel ve kısa açıklama",
    "Üç küçük kart",
  ]);
  screen.tone = "paper";
  screen.width = 340;

  const remember = makeNote(820, 640, "Akılda kalsın", [
    "Önce basit başla",
    "Çiz, bağla, düzenle",
    "Kararları görünür tut",
  ]);
  remember.tone = "peach";

  board.items = [
    flowRegion,
    sketchRegion,
    idea,
    scope,
    ready,
    notes,
    draft,
    feedback,
    screen,
    remember,
    squiggle(900, 800),
    makeEdge(idea.id, scope.id, { sourceHandle: "b", targetHandle: "t" }),
    makeEdge(scope.id, ready.id, { sourceHandle: "b", targetHandle: "t" }),
    makeEdge(ready.id, draft.id, { sourceHandle: "b", targetHandle: "t", label: "Evet" }),
    makeEdge(ready.id, notes.id, { sourceHandle: "l", targetHandle: "b", label: "Hayır" }),
    makeEdge(notes.id, scope.id, { sourceHandle: "t", targetHandle: "l" }),
    makeEdge(draft.id, feedback.id, { sourceHandle: "b", targetHandle: "t" }),
    makeEdge(draft.id, screen.id, { sourceHandle: "r", targetHandle: "l", style: "reference" }),
  ];
  return board;
}

function ideasBoard(): BoardDoc {
  const board = emptyBoard("Fikirler");
  const first = makeNote(0, 0, "Ham fikirler", [
    "Toplantı notlarını tek panoda topla",
    "Akışı çizerken veriyi de yanına koy",
    "Kararın nedenini kaybetme",
  ]);
  first.tone = "lilac";
  const second = makeNote(360, 40, "Sorular", ["Kim kullanacak?", "İlk hangi ekran?"]);
  second.tone = "periwinkle";
  board.items = [first, second];
  return board;
}

function notesBoard(): BoardDoc {
  const board = emptyBoard("Notlar");
  board.items = [makeNote(0, 0, "Serbest not", ["Buraya yaz, sonra akışa bağla"])];
  return board;
}

export function seedWorkspace(): Workspace {
  const boards = [ideasBoard(), flowBoard(), notesBoard()];
  return {
    manifest: {
      formatVersion,
      title: "Ürün fikri",
      boards: boards.map((b) => ({ id: b.id, title: b.title })),
    },
    boards: Object.fromEntries(boards.map((b) => [b.id, b])),
  };
}

/** Mixed board for the pan/zoom budget check (`?stress=1000`). */
export function stressBoard(count: number): BoardDoc {
  const board = emptyBoard(`Stres testi · ${count}`);
  const columns = Math.ceil(Math.sqrt(count));
  const nodeIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * 300;
    const y = row * 220;
    const pick = i % 10;
    if (pick < 6) {
      const node = makeFlowNode(pick < 4 ? "process" : "terminal", x, y, `Adım ${i + 1}`);
      nodeIds.push(node.id);
      board.items.push(node);
    } else if (pick < 8) {
      const node = makeFlowNode("decision", x, y, `Karar ${i + 1}`);
      nodeIds.push(node.id);
      board.items.push(node);
    } else if (pick === 8) {
      board.items.push(makeNote(x, y, `Not ${i + 1}`, ["Birinci madde", "İkinci madde"]));
    } else {
      board.items.push(squiggle(x - 110, y - 30));
    }
  }
  for (let i = 1; i < nodeIds.length; i += 2) {
    board.items.push(makeEdge(nodeIds[i - 1], nodeIds[i]));
  }
  return board;
}
