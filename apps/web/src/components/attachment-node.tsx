"use client";
import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { File, Download, RefreshCw } from "lucide-react";
import { loadAttachment } from "@/lib/attachments";
import { errorMessage, database } from "@/lib/database";
import { useLiveValue } from "@/lib/hooks";
import { PdfPreview } from "./pdf-preview";

function AttachmentView({ node, extension }: NodeViewProps) {
  const id =
      typeof node.attrs.attachmentId === "string"
        ? node.attrs.attachmentId
        : "",
    pageId = String(extension.options.pageId ?? "");
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const local = useLiveValue(
    () => database.attachments.get(id),
    [id],
    undefined,
  );
  useEffect(() => {
    let cancelled = false,
      objectUrl = "";
    setError("");
    setUrl("");
    void loadAttachment(id, pageId)
      .then((record) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(record.data)], { type: record.mime }),
        );
        setUrl(objectUrl);
      })
      .catch((problem) => {
        if (!cancelled) setError(errorMessage(problem));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, pageId, retry]);
  const name = local?.name ?? String(node.attrs.name ?? "파일"),
    mime = local?.mime ?? "";
  return (
    <NodeViewWrapper className="attachment-block" contentEditable={false}>
      {url && mime.startsWith("image/") && (
        <img src={url} alt={name} loading="lazy" />
      )}
      {url && mime.startsWith("video/") && (
        <video src={url} controls preload="metadata" aria-label={name} />
      )}
      {url && mime.startsWith("audio/") && (
        <audio src={url} controls preload="metadata" aria-label={name} />
      )}
      {url && mime === "application/pdf" && local && (
        <PdfPreview file={local} />
      )}
      {url && mime === "text/plain" && <TextPreview id={id} />}
      <div className="attachment-caption">
        <File size={15} />
        <span>{name}</span>
        {local && (
          <small>
            {Math.ceil(local.size / 1024)} KiB ·{" "}
            {local.status === "uploaded"
              ? "서버 저장됨"
              : local.status === "preserved"
                ? "로컬 보존"
                : "전송 대기"}
          </small>
        )}
        {url && (
          <a
            href={url}
            download={name}
            className="icon-button"
            aria-label={`${name} 다운로드`}
          >
            <Download size={16} />
          </a>
        )}
      </div>
      {(error || local?.error) && (
        <div className="attachment-error" role="status">
          {error || local?.error}
          <button
            className="icon-button"
            aria-label="파일 다시 불러오기"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
function TextPreview({ id }: { id: string }) {
  const file = useLiveValue(
    () => database.attachments.get(id),
    [id],
    undefined,
  );
  return (
    <details className="attachment-text">
      <summary>텍스트 미리보기</summary>
      <pre>
        {file ? new TextDecoder().decode(file.data.slice(0, 64 * 1024)) : ""}
      </pre>
    </details>
  );
}
export const AttachmentNode = Node.create<{ pageId: string }>({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: "" };
  },
  addAttributes() {
    return { attachmentId: { default: null }, name: { default: "파일" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-attachment-id]",
        getAttrs: (element) => ({
          attachmentId: (element as HTMLElement).getAttribute(
            "data-attachment-id",
          ),
          name: (element as HTMLElement).getAttribute("data-name"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes({
        "data-attachment-id": HTMLAttributes.attachmentId,
        "data-name": HTMLAttributes.name,
      }),
      String(HTMLAttributes.name ?? "파일"),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
