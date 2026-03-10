import { Server } from "@hocuspocus/server";
import * as Y from "yjs";

const host = process.env.COLLAB_HOST ?? "0.0.0.0";
const port = Number(process.env.COLLAB_PORT ?? "18001");
const apiBaseUrl = (process.env.COLLAB_API_BASE_URL ?? "http://localhost:18000/api/v1").replace(/\/$/, "");
const collabSecret = process.env.COLLAB_SECRET ?? "change-me-collab";
const debounce = Number(process.env.COLLAB_DEBOUNCE_MS ?? "900");
const maxDebounce = Number(process.env.COLLAB_MAX_DEBOUNCE_MS ?? "4000");

function parseDocumentName(documentName) {
  const [workspaceId, taskId] = documentName.split("__");
  if (!workspaceId || !taskId) {
    throw new Error("invalid_document_name");
  }

  return { taskId, workspaceId };
}

async function fetchTaskDocument(workspaceId, taskId, token) {
  const response = await fetch(`${apiBaseUrl}/workspaces/${workspaceId}/tasks/${taskId}/document`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`document_fetch_failed:${response.status}`);
  }

  return response.json();
}

async function persistTaskDocument(workspaceId, taskId, contentMarkdown) {
  const response = await fetch(
    `${apiBaseUrl}/internal/collab/workspaces/${workspaceId}/tasks/${taskId}/document`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Collab-Secret": collabSecret,
      },
      body: JSON.stringify({ content_markdown: contentMarkdown }),
    },
  );

  if (!response.ok) {
    throw new Error(`document_persist_failed:${response.status}`);
  }
}

function createDocument(contentMarkdown) {
  const document = new Y.Doc();
  const text = document.getText("content");
  if (contentMarkdown) {
    text.insert(0, contentMarkdown);
  }
  return document;
}

const server = new Server({
  address: host,
  debounce,
  maxDebounce,
  name: "RootSpread Collab",
  port,
  async onAuthenticate(data) {
    const token = typeof data.token === "string" ? data.token : "";
    if (!token) {
      throw new Error("missing_token");
    }

    const { taskId, workspaceId } = parseDocumentName(data.documentName);
    const snapshot = await fetchTaskDocument(workspaceId, taskId, token);

    return {
      accessToken: token,
      initialContent: snapshot.content_markdown ?? "",
      taskId,
      workspaceId,
    };
  },
  async onLoadDocument(data) {
    return createDocument(data.context.initialContent ?? "");
  },
  async onStoreDocument(data) {
    const text = data.document.getText("content").toString();
    await persistTaskDocument(data.context.workspaceId, data.context.taskId, text);
  },
});

await server.listen();

console.log(`RootSpread Collab listening on ${host}:${port}`);
