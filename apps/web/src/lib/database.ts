import Dexie, { type Table } from "dexie";
import type {
  Workspace,
  Page,
  PageOperation,
  Role,
  CommentInput,
  PageComment,
  AttachmentMetadata,
  KnowledgeProjection,
} from "@zeronote/shared";
export interface LocalWorkspace extends Workspace {
  pendingCreation: boolean;
  recoveryHash?: string;
  creationError?: string;
  accessLost?: boolean;
}
export interface LocalPage extends Page {
  role?: Role;
  favorite?: boolean;
  accessLost?: boolean;
}
export interface LocalDocument {
  id: string;
  workspaceId: string;
  update: Uint8Array;
  title: string;
  text: string;
  references: string[];
  tags?: string[];
  knowledge?: KnowledgeProjection;
  generation: number;
  committedGeneration: number;
  state: "saved" | "error" | "preserved";
  error?: string;
  updatedAt: number;
}
export interface LocalDevice {
  id: string;
  name: string;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}
export interface PendingOperation {
  id: string;
  sequence: number;
  payload: PageOperation;
  status: "pending" | "conflict" | "blocked";
  error?: string;
}
export interface PendingComment {
  id: string;
  payload: CommentInput;
  createdAt: string;
  error?: string;
  acknowledged?: boolean;
  errorStatus?: number;
}
export interface Preference {
  id: string;
  value: string;
}
export interface LocalAttachment extends AttachmentMetadata {
  workspaceId: string;
  data: Uint8Array;
  operationId: string;
  status: "pending" | "uploaded" | "preserved";
  error?: string;
}
class LocalDatabase extends Dexie {
  workspaces!: Table<LocalWorkspace, string>;
  pages!: Table<LocalPage, string>;
  documents!: Table<LocalDocument, string>;
  devices!: Table<LocalDevice, string>;
  operations!: Table<PendingOperation, string>;
  pendingComments!: Table<PendingComment, string>;
  comments!: Table<PageComment, string>;
  preferences!: Table<Preference, string>;
  attachments!: Table<LocalAttachment, string>;
  constructor() {
    super("zeronote-alpha");
    this.version(1).stores({
      workspaces: "id",
      pages: "id,workspaceId,parentId",
      documents: "id,workspaceId",
      devices: "id",
      operations: "id,sequence,status",
      pendingComments: "id",
      comments: "id,pageId",
      preferences: "id",
    });
    this.version(2).stores({
      attachments: "id,pageId,workspaceId,status",
    });
  }
}
export const database = new LocalDatabase();
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
}
