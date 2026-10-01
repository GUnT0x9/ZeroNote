import { z } from "zod";
import * as Y from "yjs";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
// Allow JSON/base64 and WebSocket framing; decoded documents still use 5 MiB.
export const MAX_TRANSPORT_BYTES = MAX_DOCUMENT_BYTES * 2;
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const CHALLENGE_LIFETIME_MS = 60_000;
export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const Roles = ["editor", "commenter", "viewer"] as const;
export const RoleSchema = z.enum(Roles);
export type Role = z.infer<typeof RoleSchema> | "owner";
export const IdSchema = z.uuid();
export const NameSchema = z.string().trim().min(1).max(160);
export const PublicKeySchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(20).max(100),
    y: z.string().min(20).max(100),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).optional(),
  })
  .strict();
export const RegisterDeviceSchema = z
  .object({ id: IdSchema, name: NameSchema, publicKey: PublicKeySchema })
  .strict();
export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  ownerIdentityId: IdSchema,
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
export const CreateWorkspaceSchema = WorkspaceSchema.extend({
  recoveryHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const PageSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  parentId: IdSchema.nullable(),
  kind: z.enum(["document", "database"]),
  title: z.string().max(500),
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  isInbox: z.boolean().default(false),
});
export type Page = z.infer<typeof PageSchema>;
export const PageOperationSchema = z
  .object({
    operationId: IdSchema,
    workspaceId: IdSchema,
    pageId: IdSchema,
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(["create", "move", "trash", "restore"]),
    page: PageSchema.optional(),
    parentId: IdSchema.nullable().optional(),
  })
  .strict();
export type PageOperation = z.infer<typeof PageOperationSchema>;
export const InviteSchema = z
  .object({
    pageId: IdSchema,
    role: RoleSchema,
    includeDescendants: z.boolean().default(false),
  })
  .strict();
export const CommentInputSchema = z
  .object({
    id: IdSchema,
    pageId: IdSchema,
    parentId: IdSchema.nullable().default(null),
    body: z.string().trim().min(1).max(10000),
  })
  .strict();
export type CommentInput = z.infer<typeof CommentInputSchema>;
export const CommentSchema = CommentInputSchema.extend({
  identityId: IdSchema,
  authorName: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export type PageComment = z.infer<typeof CommentSchema>;
export const IdentitySchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: z.string(),
});
export type Identity = z.infer<typeof IdentitySchema>;
export const MetadataSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  pages: z.array(PageSchema),
  identities: z.array(IdentitySchema.extend({ workspaceId: IdSchema })),
  roles: z.record(z.string(), z.enum(["owner", ...Roles])),
});
export type Metadata = z.infer<typeof MetadataSchema>;
export const CommitSchema = z
  .object({
    operationId: IdSchema,
    update: z.string().max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 4),
  })
  .strict();
export const RecoverySchema = z
  .object({ key: z.string().trim().min(20).max(200) })
  .strict();
export const TaskStatuses = ["todo", "in_progress", "done"] as const;
export const TaskPriorities = ["low", "medium", "high"] as const;
export const DateOnlySchema = z
  .string()
  .refine(isValidDateOnly, "Invalid calendar date");
export const TaskRowSchema = z.object({
  id: IdSchema,
  title: z.string().max(500),
  status: z.enum(TaskStatuses),
  assigneeId: IdSchema.nullable(),
  dueDate: DateOnlySchema.nullable(),
  priority: z.enum(TaskPriorities),
  deleted: z.boolean(),
});
export type TaskRow = z.infer<typeof TaskRowSchema>;
export const ExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.string(),
    name: NameSchema,
    pages: z
      .array(
        z
          .object({
            id: IdSchema,
            parentId: IdSchema.nullable(),
            kind: z.enum(["document", "database"]),
            title: z.string().max(500),
            isInbox: z.boolean(),
            document: z
              .string()
              .max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 4),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type WorkspaceExport = z.infer<typeof ExportSchema>;

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function canEdit(role: Role | undefined): boolean {
  return role === "owner" || role === "editor";
}
export function canComment(role: Role | undefined): boolean {
  return canEdit(role) || role === "commenter";
}
export function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export function base64ToBytes(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid Base64");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function createRecoveryKey(): string {
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return `ZN1-${value.match(/.{8}/g)?.join("-")}`;
}
export function normalizeRecoveryKey(value: string): string {
  return value.trim().toUpperCase();
}
export function replaceSharedText(text: Y.Text, value: string): void {
  const current = text.toString();
  let start = 0;
  while (
    start < current.length &&
    start < value.length &&
    current[start] === value[start]
  )
    start++;
  let suffix = 0;
  while (
    suffix < current.length - start &&
    suffix < value.length - start &&
    current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++;
  const update = () => {
    text.delete(start, current.length - start - suffix);
    text.insert(start, value.slice(start, value.length - suffix));
  };
  if (text.doc) text.doc.transact(update);
  else update();
}
export function createTaskRow(
  document: Y.Doc,
  title: string,
  id: string = crypto.randomUUID(),
): string {
  const row = new Y.Map<unknown>();
  document.transact(() => {
    document.getMap<Y.Map<unknown>>("tasks").set(id, row);
    row.set("title", new Y.Text(title));
    row.set("status", "todo");
    row.set("assigneeId", null);
    row.set("dueDate", null);
    row.set("priority", "medium");
    row.set("deleted", false);
  });
  return id;
}
export function getTaskRows(document: Y.Doc): TaskRow[] {
  return Array.from(document.getMap<Y.Map<unknown>>("tasks").entries()).flatMap(
    ([id, row]) => {
      if (!(row instanceof Y.Map)) return [];
      const title = row.get("title");
      const parsed = TaskRowSchema.safeParse({
        id,
        title: title instanceof Y.Text ? title.toString() : "",
        status: row.get("status"),
        assigneeId: row.get("assigneeId"),
        dueDate: row.get("dueDate"),
        priority: row.get("priority"),
        deleted: row.get("deleted"),
      });
      return parsed.success && !parsed.data.deleted ? [parsed.data] : [];
    },
  );
}
export function updateTaskField(
  document: Y.Doc,
  id: string,
  field: Exclude<keyof TaskRow, "id" | "title">,
  value: unknown,
): void {
  const row = document.getMap<Y.Map<unknown>>("tasks").get(id);
  if (!row) throw new Error("Task not found");
  const candidate = getTaskRows(document).find((task) => task.id === id);
  TaskRowSchema.parse({ ...candidate, [field]: value });
  row.set(field, value);
}
export function getDocumentProjection(document: Y.Doc): {
  title: string;
  text: string;
  references: string[];
} {
  const references = new Set<string>();
  const read = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText): string => {
    if (node instanceof Y.XmlText)
      return node.toString().replace(/<[^>]+>/g, "");
    if (node instanceof Y.XmlElement) {
      const ref = node.getAttribute("pageId");
      if (typeof ref === "string") references.add(ref);
    }
    return node
      .toArray()
      .map((child) => (child instanceof Y.XmlHook ? "" : read(child)))
      .join(" ");
  };
  const title = document.getText("title").toString();
  const content = [
    read(document.getXmlFragment("content")),
    ...getTaskRows(document).map((row) =>
      read(document.getXmlFragment(`task:${row.id}`)),
    ),
  ].join(" ");
  return {
    title,
    text: [
      title,
      content,
      ...getTaskRows(document).map((row) => row.title),
    ].join(" "),
    references: [...references],
  };
}
export function wouldCreateCycle(
  pageId: string,
  parentId: string | null,
  pages: Pick<Page, "id" | "parentId">[],
): boolean {
  const parents = new Map(pages.map((page) => [page.id, page.parentId]));
  const visited = new Set<string>();
  let current = parentId;
  while (current) {
    if (current === pageId || visited.has(current)) return true;
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}
export function safeLinkHref(value: string): string | null {
  try {
    const url = new URL(value, "https://zeronote.invalid");
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}
export function updatesHaveSameSnapshot(
  first: Uint8Array,
  second: Uint8Array,
): boolean {
  const left = new Y.Doc({ gc: false }),
    right = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(left, first);
    Y.applyUpdate(right, second);
    return Y.equalSnapshots(Y.snapshot(left), Y.snapshot(right));
  } finally {
    left.destroy();
    right.destroy();
  }
}

export const BETA_WORKSPACE_LIMIT = 3;
export const AUTO_SNAPSHOT_DAYS = 7;
export const MANUAL_SNAPSHOT_LIMIT = 3;
export const STORAGE_WARNING_BYTES = 200 * 1024 * 1024;
export const STORAGE_LIMIT_BYTES = 300 * 1024 * 1024;
export const BetaStatusSchema = z.object({
  required: z.boolean(),
  approved: z.boolean(),
  workspaceCount: z.number().int().nonnegative(),
  workspaceLimit: z.number().int(),
});
export type BetaStatus = z.infer<typeof BetaStatusSchema>;
export const BetaRedeemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^ZNB1-[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const SnapshotInputSchema = z
  .object({
    operationId: IdSchema,
    name: z.string().trim().max(160).default(""),
  })
  .strict();
export const RestoreSnapshotSchema = z
  .object({ operationId: IdSchema })
  .strict();
export const SnapshotSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  kind: z.enum(["manual", "automatic"]),
  name: z.string(),
  schemaVersion: z.literal(1),
  createdAt: z.string(),
});
export type DocumentSnapshot = z.infer<typeof SnapshotSchema>;
export const SnapshotDetailSchema = SnapshotSchema.extend({
  update: z.string(),
});

/** Copy visible state into fresh CRDT identities; never merge historical state into the original. */
export function cloneDocumentContent(
  source: Y.Doc,
  oldPageId: string,
  newPageId: string,
): Y.Doc {
  const target = new Y.Doc({ gc: false });
  const copyFragment = (name: string) => {
    const copyNode = (
      node: Y.XmlElement | Y.XmlText,
    ): Y.XmlElement | Y.XmlText => {
      if (node instanceof Y.XmlText) {
        const text = new Y.XmlText();
        text.applyDelta(node.toDelta());
        return text;
      }
      const element = new Y.XmlElement(node.nodeName);
      for (const [key, value] of Object.entries(node.getAttributes()))
        if (typeof value === "string")
          element.setAttribute(
            key,
            ["pageId", "databaseId"].includes(key) && value === oldPageId
              ? newPageId
              : value,
          );
      element.insert(
        0,
        node
          .toArray()
          .flatMap((child) =>
            child instanceof Y.XmlHook ? [] : [copyNode(child)],
          ),
      );
      return element;
    };
    target.getXmlFragment(name).insert(
      0,
      source
        .getXmlFragment(name)
        .toArray()
        .flatMap((child) =>
          child instanceof Y.XmlHook ? [] : [copyNode(child)],
        ),
    );
  };
  target.getText("title").insert(0, source.getText("title").toString());
  copyFragment("content");
  for (const row of getTaskRows(source)) {
    createTaskRow(target, row.title, row.id);
    const map = target.getMap<Y.Map<unknown>>("tasks").get(row.id)!;
    for (const field of [
      "status",
      "assigneeId",
      "dueDate",
      "priority",
    ] as const)
      map.set(field, row[field]);
    copyFragment(`task:${row.id}`);
  }
  return target;
}
