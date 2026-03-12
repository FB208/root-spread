"use client";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { markdown } from "@codemirror/lang-markdown";

import { COLLAB_WS_BASE_URL, type TaskTreeNode } from "@/lib/api";

type Collaborator = {
  color: string;
  name: string;
};

type TaskDocumentEditorProps = {
  accessToken: string | null;
  readOnly: boolean;
  task: TaskTreeNode;
  userName: string;
};

const presencePalette = ["#7dd3fc", "#34d399", "#fbbf24", "#fda4af", "#c4b5fd", "#fb7185"];

function presenceColor(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return presencePalette[hash % presencePalette.length] ?? presencePalette[0];
}

export function TaskDocumentEditor({ accessToken, readOnly, task, userName }: TaskDocumentEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [status, setStatus] = useState("connecting");
  const documentName = useMemo(() => `${task.workspace_id}__${task.id}`, [task.id, task.workspace_id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !accessToken || task.id.startsWith("optimistic:")) {
      return;
    }

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      document: ydoc,
      name: documentName,
      token: accessToken,
      url: COLLAB_WS_BASE_URL,
    });
    const ytext = ydoc.getText("content");
    const awareness = provider.awareness;

    if (!awareness) {
      provider.destroy();
      ydoc.destroy();
      return;
    }

    awareness.setLocalStateField("user", {
      color: presenceColor(`${task.id}:${userName}`),
      name: userName,
    });

    const syncExtension = yCollab(ytext, awareness, { undoManager: new Y.UndoManager(ytext) });
    const state = EditorState.create({
      extensions: [
        markdown(),
        syncExtension,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            backgroundColor: "rgba(7, 10, 18, 0.68)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "14px",
            color: "rgba(244,247,255,0.94)",
            fontSize: "13px",
            minHeight: "180px",
          },
          ".cm-content": {
            caretColor: "#7dd3fc",
            minHeight: "180px",
            padding: "12px 14px",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "#7dd3fc",
          },
          ".cm-activeLine": {
            backgroundColor: "rgba(255,255,255,0.03)",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.28)",
          },
          ".cm-focused": {
            outline: "none",
          },
          ".cm-scroller": {
            fontFamily: '"IBM Plex Sans", "Noto Sans SC", sans-serif',
          },
        }),
      ],
    });
    const view = new EditorView({ parent: container, state });

    const updateCollaborators = () => {
      const next = [...awareness.getStates().values()]
        .map((item) => item.user)
        .filter(
          (item): item is Collaborator =>
            Boolean(item) && typeof item.name === "string" && typeof item.color === "string",
        );
      setCollaborators(next);
    };

    updateCollaborators();
    awareness.on("change", updateCollaborators);
    provider.on("status", (event: { status: string }) => {
      setStatus(event.status);
    });

    return () => {
      awareness.off("change", updateCollaborators);
      view.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [accessToken, documentName, readOnly, task.id, task.workspace_id, userName]);

  if (!accessToken || task.id.startsWith("optimistic:")) {
    return (
      <textarea
        className="field-input min-h-24 resize-y"
        defaultValue={task.content_markdown}
        disabled
        readOnly
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-white/42">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/[0.08] px-2 py-0.5">协同编辑</span>
          <span className="rounded-full border border-white/[0.08] px-2 py-0.5">
            {status === "connected" ? "已连接" : status === "connecting" ? "连接中" : "重连中"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {collaborators.map((collaborator) => (
            <span
              key={`${collaborator.name}:${collaborator.color}`}
              className="rounded-full border border-white/[0.08] px-2 py-0.5"
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: collaborator.color }} />
              {collaborator.name}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} />
    </div>
  );
}
