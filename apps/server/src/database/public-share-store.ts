import { CONTENT_WRITE_LOCK_ID } from "./locks";
import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  MAX_PUBLIC_SHARES,
  MAX_PUBLIC_LIFETIME_MS,
  PUBLIC_SESSION_MS,
  BURN_SESSION_MS,
  MAX_PUBLIC_BYTES,
  getLiveAttachmentIds,
  getTaskRows,
  getDatabaseProperties,
  createDatabaseValueReader,
  type Page,
  type PublicShare,
  type OwnedPublicShare,
  type PublicShareInput,
  type PublicOpen,
  type PublicPage,
  type PublicContent,
} from "@zeronote/shared";
import { DomainError } from "../errors";
import { isTrashed } from "../services";
import { env } from "../env";
import {
  createPublicPage,
  type PublicProjectionLinks,
} from "../public-projection";
import { hashPublicPassword, verifyPublicPassword } from "../public-password";
import type { Repository, Executor } from "./repository";

interface ShareRecord extends Omit<
  PublicShare,
  "protected" | "passwordRequired"
> {
  workspaceId: string;
  operationId: string;
  payloadHash: string;
  secretHash: string | null;
  passwordHash: string | null;
  createdAt: string;
  revokedAt: string | null;
  burnedTokenHash: string | null;
}
interface PublishedPage extends Page {
  key: string;
}
interface FrozenContent {
  pages: PublicPage[];
}
interface SessionRecord {
  tokenHash: string;
  frozen: FrozenContent | null;
  frozenFiles: string[];
}
const SHARE_COLUMNS = sql`id,workspace_id AS "workspaceId",operation_id AS "operationId",payload_hash AS "payloadHash",title,mode,secret_hash AS "secretHash",password_hash AS "passwordHash",expires_at::text AS "expiresAt",seo,created_at::text AS "createdAt",revoked_at::text AS "revokedAt",burned_token_hash AS "burnedTokenHash"`;
const MAX_PUBLIC_DATABASE_DEPENDENCIES = 32;
export const publicHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class PublicShareStore {
  constructor(readonly repository: Repository) {}
  private async record(
    id: string,
    executor: Executor,
    lock = false,
  ): Promise<ShareRecord> {
    const [record] = await this.repository.query<ShareRecord>(
      sql`SELECT ${SHARE_COLUMNS} FROM public_shares WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`,
      executor,
    );
    if (
      !record ||
      record.revokedAt ||
      (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now())
    )
      throw new DomainError(410, "공유 링크가 만료되었거나 해제되었습니다.");
    return record;
  }
  private descriptor(record: ShareRecord): PublicShare {
    const protectedLink = !!record.secretHash;
    return {
      id: record.id,
      title: protectedLink ? "공유 문서" : record.title,
      mode: record.mode,
      protected: protectedLink,
      passwordRequired: !!record.passwordHash,
      expiresAt: record.expiresAt
        ? new Date(record.expiresAt).toISOString()
        : null,
      seo: record.seo,
    };
  }
  private async availablePages(
    record: ShareRecord,
    executor: Executor,
  ): Promise<PublishedPage[]> {
    const allPages = await this.repository.query<Page>(
      sql`SELECT id,parent_id AS "parentId",deleted_at::text AS "deletedAt" FROM pages WHERE workspace_id=${record.workspaceId}`,
      executor,
    );
    const selected = await this.repository.query<PublishedPage>(
      sql`SELECT p.id,p.workspace_id AS "workspaceId",p.parent_id AS "parentId",p.kind,p.title,p.deleted_at::text AS "deletedAt",sp.public_key AS key FROM public_share_pages sp JOIN pages p ON p.id=sp.page_id WHERE sp.share_id=${record.id} ORDER BY sp.position`,
      executor,
    );
    return selected.filter((page) => !isTrashed(page, allPages));
  }
  async describe(id: string): Promise<PublicShare> {
    const record = await this.record(id, this.repository.database);
    if (!(await this.availablePages(record, this.repository.database)).length)
      throw new DomainError(410, "공개된 Page가 없습니다.");
    return this.descriptor(record);
  }
  async owned(workspaceId: string): Promise<OwnedPublicShare[]> {
    await this.repository.database.execute(
      sql`DELETE FROM public_sessions s USING public_shares sh WHERE s.share_id=sh.id AND sh.workspace_id=${workspaceId} AND (s.expires_at<=now() OR sh.revoked_at IS NOT NULL OR sh.expires_at<=now())`,
    );
    const records = await this.repository.query<ShareRecord>(
      sql`SELECT ${SHARE_COLUMNS} FROM public_shares WHERE workspace_id=${workspaceId} ORDER BY created_at DESC`,
    );
    return Promise.all(
      records.map(async (record) => ({
        ...this.descriptor(record),
        title: record.title,
        pageIds: (
          await this.repository.query<{ id: string }>(
            sql`SELECT page_id AS id FROM public_share_pages WHERE share_id=${record.id} ORDER BY position`,
          )
        ).map((row) => row.id),
        createdAt: new Date(record.createdAt).toISOString(),
        revokedAt: record.revokedAt
          ? new Date(record.revokedAt).toISOString()
          : null,
        opened: !!record.burnedTokenHash,
      })),
    );
  }
  async create(
    deviceId: string,
    workspaceId: string,
    input: PublicShareInput,
  ): Promise<OwnedPublicShare> {
    const payloadHash = publicHash(JSON.stringify(input));
    const passwordHash = input.password
      ? await hashPublicPassword(input.password)
      : null;
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      const [owner] = await this.repository.query(
        sql`SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=${workspaceId} AND m.device_id=${deviceId} AND m.revoked_at IS NULL AND m.identity_id=w.owner_identity_id`,
        tx,
      );
      if (!owner)
        throw new DomainError(403, "Workspace Owner 권한이 필요합니다.");
      const [prior] = await this.repository.query<ShareRecord>(
        sql`SELECT ${SHARE_COLUMNS} FROM public_shares WHERE operation_id=${input.operationId}`,
        tx,
      );
      if (prior) {
        if (
          prior.workspaceId !== workspaceId ||
          prior.payloadHash !== payloadHash
        )
          throw new DomainError(409, "Operation identifier collision");
        return {
          ...this.descriptor(prior),
          title: prior.title,
          pageIds: input.pageIds,
          createdAt: new Date(prior.createdAt).toISOString(),
          revokedAt: prior.revokedAt
            ? new Date(prior.revokedAt).toISOString()
            : null,
          opened: !!prior.burnedTokenHash,
        };
      }
      if (
        input.expiresAt &&
        (Date.parse(input.expiresAt) <= Date.now() ||
          Date.parse(input.expiresAt) > Date.now() + MAX_PUBLIC_LIFETIME_MS)
      )
        throw new DomainError(400, "만료는 지금부터 90일 이내로 설정해주세요.");
      const [count] = await this.repository.query<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM public_shares WHERE workspace_id=${workspaceId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,
        tx,
      );
      if (Number(count?.count ?? 0) >= MAX_PUBLIC_SHARES)
        throw new DomainError(
          409,
          "공유는 최대 100개입니다. 사용하지 않는 링크를 해제해주세요.",
        );
      const pages = await this.repository.query<Page>(
        sql`SELECT id,parent_id AS "parentId",deleted_at::text AS "deletedAt" FROM pages WHERE workspace_id=${workspaceId}`,
        tx,
      );
      if (
        input.pageIds.some(
          (id) =>
            !pages.some((page) => page.id === id && !isTrashed(page, pages)),
        )
      )
        throw new DomainError(
          400,
          "현재 Workspace의 사용 가능한 Page만 게시할 수 있습니다.",
        );
      await this.repository.documents.assertCapacity(tx);
      const id = crypto.randomUUID();
      const [created] = await this.repository.query<ShareRecord>(
        sql`INSERT INTO public_shares(id,workspace_id,operation_id,payload_hash,title,mode,secret_hash,password_hash,expires_at,seo) VALUES(${id},${workspaceId},${input.operationId},${payloadHash},${input.title},${input.mode},${input.secret ? publicHash(input.secret) : null},${passwordHash},${input.expiresAt},${input.seo}) RETURNING ${SHARE_COLUMNS}`,
        tx,
      );
      for (const [position, pageId] of input.pageIds.entries())
        await tx.execute(
          sql`INSERT INTO public_share_pages(share_id,page_id,public_key,position) VALUES(${id},${pageId},${crypto.randomUUID()},${position})`,
        );
      return {
        ...this.descriptor(created!),
        title: input.title,
        pageIds: input.pageIds,
        createdAt: new Date(created!.createdAt).toISOString(),
        revokedAt: null,
        opened: false,
      };
    });
  }
  async revoke(workspaceId: string, id: string): Promise<{ revoked: true }> {
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      const rows = await this.repository.query(
        sql`UPDATE public_shares SET revoked_at=COALESCE(revoked_at,now()) WHERE id=${id} AND workspace_id=${workspaceId} RETURNING id`,
        tx,
      );
      if (!rows.length)
        throw new DomainError(404, "공유 링크를 찾을 수 없습니다.");
      await tx.execute(sql`DELETE FROM public_sessions WHERE share_id=${id}`);
      return { revoked: true };
    });
  }
  private async session(
    record: ShareRecord,
    token: string | undefined,
    executor: Executor,
  ): Promise<SessionRecord | null> {
    if (!record.secretHash) return null;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new DomainError(401, "공유 링크를 열어주세요.");
    const [session] = await this.repository.query<SessionRecord>(
      sql`SELECT token_hash AS "tokenHash",frozen,frozen_files AS "frozenFiles" FROM public_sessions WHERE share_id=${record.id} AND token_hash=${publicHash(token)} AND expires_at>now()`,
      executor,
    );
    if (
      !session ||
      (record.mode === "burn" && session.tokenHash !== record.burnedTokenHash)
    )
      throw new DomainError(
        401,
        "읽기 시간이 만료되었습니다. 링크를 다시 열어주세요.",
      );
    return session;
  }
  async open(
    id: string,
    input: PublicOpen,
  ): Promise<{ token: string; expires: Date }> {
    const record = await this.record(id, this.repository.database);
    if (!record.secretHash)
      throw new DomainError(400, "이 공개 링크는 바로 읽을 수 있습니다.");
    if (
      (record.secretHash &&
        publicHash(input.secret ?? "") !== record.secretHash) ||
      (record.passwordHash &&
        !(await verifyPublicPassword(
          input.password ?? "",
          record.passwordHash,
        )))
    )
      throw new DomainError(403, "링크 또는 비밀번호가 올바르지 않습니다.");
    const token = createHmac("sha256", env.REALTIME_SECRET)
        .update(`${id}:${input.operationId}:${input.readerSecret}`)
        .digest("hex"),
      tokenHash = publicHash(token);
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      const current = await this.record(id, tx, true);
      const [prior] = await this.repository.query<{
        tokenHash: string;
        expiresAt: string;
      }>(
        sql`SELECT token_hash AS "tokenHash",expires_at::text AS "expiresAt" FROM public_sessions WHERE share_id=${id} AND operation_id=${input.operationId}`,
        tx,
      );
      if (prior) {
        if (prior.tokenHash !== tokenHash)
          throw new DomainError(409, "Operation identifier collision");
        if (Date.parse(prior.expiresAt) <= Date.now())
          throw new DomainError(410, "읽기 시간이 만료되었습니다.");
        return { token, expires: new Date(prior.expiresAt) };
      }
      if (current.mode === "burn" && current.burnedTokenHash)
        throw new DomainError(410, "이미 열린 1회 열람 링크입니다.");
      const pages = await this.availablePages(current, tx);
      if (!pages.length) throw new DomainError(410, "공개된 Page가 없습니다.");
      const expires = new Date(
        Math.min(
          Date.now() +
            (current.mode === "burn" ? BURN_SESSION_MS : PUBLIC_SESSION_MS),
          current.expiresAt ? Date.parse(current.expiresAt) : Infinity,
        ),
      );
      let frozen: FrozenContent | null = null,
        fileIds: string[] = [];
      if (current.mode === "burn") {
        const results = [];
        for (const page of pages)
          results.push(await this.project(current, pages, page, tx));
        frozen = { pages: results.map((result) => result.page) };
        fileIds = [...new Set(results.flatMap((result) => result.fileIds))];
        if (Buffer.byteLength(JSON.stringify(frozen)) > MAX_PUBLIC_BYTES)
          throw new DomainError(
            413,
            "1회 열람 공유의 전체 내용은 5MiB 이하여야 합니다.",
          );
      }
      await this.repository.documents.assertCapacity(tx);
      // Only request-driven cleanup; no queries while the server is idle.
      await tx.execute(
        sql`DELETE FROM public_sessions WHERE share_id=${id} AND expires_at<=now()`,
      );
      await tx.execute(
        sql`INSERT INTO public_sessions(token_hash,share_id,operation_id,expires_at,frozen,frozen_files) VALUES(${tokenHash},${id},${input.operationId},${expires.toISOString()},${frozen ? JSON.stringify(frozen) : null}::jsonb,${`{${fileIds.join(",")}}`}::uuid[])`,
      );
      if (current.mode === "burn")
        await tx.execute(
          sql`UPDATE public_shares SET burned_token_hash=${tokenHash} WHERE id=${id}`,
        );
      return { token, expires };
    });
  }
  async content(
    id: string,
    key: string | undefined,
    token: string | undefined,
  ): Promise<PublicContent> {
    return this.repository.database.transaction(async (tx) => {
      const record = await this.record(id, tx);
      const session = await this.session(record, token, tx);
      const available = await this.availablePages(record, tx);
      let directory: PublicContent["pages"], page: PublicPage;
      if (session?.frozen) {
        const allowedKeys = new Set(available.map((entry) => entry.key));
        const pages = session.frozen.pages.filter((entry) =>
          allowedKeys.has(entry.key),
        );
        directory = pages.map(({ key, title, kind }) => ({ key, title, kind }));
        const selected = key
          ? pages.find((entry) => entry.key === key)
          : pages[0];
        if (!selected)
          throw new DomainError(410, "공개된 Page를 찾을 수 없습니다.");
        page = selected;
      } else {
        directory = available.map(({ key, title, kind }) => ({
          key,
          title,
          kind,
        }));
        const selected = key
          ? available.find((entry) => entry.key === key)
          : available[0];
        if (!selected)
          throw new DomainError(410, "공개된 Page를 찾을 수 없습니다.");
        page = (await this.project(record, available, selected, tx)).page;
      }
      return {
        share: { ...this.descriptor(record), title: record.title },
        pages: directory,
        page,
        canonical: `${env.WEB_ORIGIN}/s/${id}/${page.key}`,
      };
    });
  }
  private async project(
    record: ShareRecord,
    pages: PublishedPage[],
    source: PublishedPage,
    executor: Executor,
  ): Promise<{ page: PublicPage; fileIds: string[] }> {
    const document = new Y.Doc();
    const relatedDocuments = new Map<string, Y.Doc>();
    try {
      for (const state of await this.repository.documents.load(
        source.id,
        executor,
      ))
        Y.applyUpdate(document, state);
      const ids = new Set(getLiveAttachmentIds(document));
      const files = await this.repository.query<{
        id: string;
        name: string;
        mime: string;
      }>(
        sql`SELECT id,name,mime FROM attachments WHERE page_id=${source.id} AND deleted_at IS NULL AND purged_at IS NULL`,
        executor,
      );
      const visibleFiles = files.filter((file) => ids.has(file.id));
      const pageLink = (id: string) => {
        const page = pages.find((entry) => entry.id === id);
        return page
          ? { title: page.title, href: `/s/${record.id}/${page.key}` }
          : undefined;
      };
      const taskLinks = await this.publicTaskLinks(
        document,
        source.id,
        pages,
        executor,
      );
      relatedDocuments.set(source.id, document);
      const fileNames = new Map(
        visibleFiles.map((file) => [`${source.id}:${file.id}`, file.name]),
      );
      await this.loadPublicDatabaseDependencies(
        relatedDocuments,
        fileNames,
        pages,
        executor,
      );
      for (const [id, target] of relatedDocuments)
        taskLinks.set(
          id,
          new Map(getTaskRows(target).map((row) => [row.id, row.title])),
        );
      const reader = createDatabaseValueReader(source.id, document, {
        publicOnly: true,
        database: (id) => relatedDocuments.get(id),
        fileName: (id, fileId) => fileNames.get(`${id}:${fileId}`),
      });
      const links: PublicProjectionLinks = {
        page: pageLink,
        file: (id) => {
          const file = visibleFiles.find((entry) => entry.id === id);
          return file
            ? { ...file, href: `/v1/public/${record.id}/files/${file.id}` }
            : undefined;
        },
        task: (databaseId, rowId) => {
          const page = pageLink(databaseId);
          const title = taskLinks.get(databaseId)?.get(rowId);
          return page && title !== undefined
            ? {
                title: title || "제목 없음",
                href: `${page.href}#row-${encodeURIComponent(rowId)}`,
              }
            : undefined;
        },
        internalPage: (href) => {
          try {
            const url = new URL(href, env.WEB_ORIGIN);
            return url.origin === env.WEB_ORIGIN
              ? pageLink(url.searchParams.get("page") ?? "")
              : undefined;
          } catch {
            return undefined;
          }
        },
      };
      return {
        page: createPublicPage(
          document,
          source.key,
          source.title,
          source.kind,
          links,
          reader,
        ),
        fileIds: visibleFiles.map((file) => file.id),
      };
    } finally {
      for (const target of relatedDocuments.values())
        if (target !== document) target.destroy();
      document.destroy();
    }
  }
  private async loadPublicDatabaseDependencies(
    documents: Map<string, Y.Doc>,
    fileNames: Map<string, string>,
    pages: PublishedPage[],
    executor: Executor,
  ): Promise<void> {
    const published = new Map(
      pages
        .filter((page) => page.kind === "database")
        .map((page) => [page.id, page]),
    );
    const pending = [...documents.values()];
    while (
      pending.length &&
      documents.size <= MAX_PUBLIC_DATABASE_DEPENDENCIES
    ) {
      for (const property of getDatabaseProperties(pending.shift()!)) {
        const id = property.relation?.databaseId;
        if (!id || documents.has(id) || !published.has(id)) continue;
        if (documents.size > MAX_PUBLIC_DATABASE_DEPENDENCIES) break;
        const target = new Y.Doc();
        documents.set(id, target);
        for (const state of await this.repository.documents.load(id, executor))
          Y.applyUpdate(target, state);
        pending.push(target);
        const ids = new Set(getLiveAttachmentIds(target));
        for (const file of await this.repository.query<{
          id: string;
          name: string;
        }>(
          sql`SELECT id,name FROM attachments WHERE page_id=${id} AND deleted_at IS NULL AND purged_at IS NULL`,
          executor,
        ))
          if (ids.has(file.id)) fileNames.set(`${id}:${file.id}`, file.name);
      }
    }
  }
  private async publicTaskLinks(
    document: Y.Doc,
    sourceId: string,
    pages: PublishedPage[],
    executor: Executor,
  ): Promise<Map<string, Map<string, string>>> {
    const ids = new Set<string>();
    const visit = (fragment: Y.XmlFragment | Y.XmlElement) => {
      for (const node of fragment.toArray()) {
        if (!(node instanceof Y.XmlElement)) continue;
        const databaseId = node.getAttribute("databaseId");
        if (node.nodeName === "taskLink" && typeof databaseId === "string")
          ids.add(databaseId);
        visit(node);
      }
    };
    visit(document.getXmlFragment("content"));
    for (const row of getTaskRows(document))
      visit(document.getXmlFragment(`task:${row.id}`));
    const result = new Map<string, Map<string, string>>();
    for (const page of pages.filter(
      (page) => page.kind === "database" && ids.has(page.id),
    )) {
      const target = page.id === sourceId ? document : new Y.Doc();
      try {
        if (target !== document)
          for (const state of await this.repository.documents.load(
            page.id,
            executor,
          ))
            Y.applyUpdate(target, state);
        result.set(
          page.id,
          new Map(getTaskRows(target).map((row) => [row.id, row.title])),
        );
      } finally {
        if (target !== document) target.destroy();
      }
    }
    return result;
  }
  async file(id: string, fileId: string, token: string | undefined) {
    return this.repository.database.transaction(async (tx) => {
      const record = await this.record(id, tx),
        session = await this.session(record, token, tx);
      const file = await this.repository.attachments.get(fileId, tx);
      const pages = await this.availablePages(record, tx);
      if (file.deletedAt || !pages.some((page) => page.id === file.pageId))
        throw new DomainError(404, "공개된 파일이 아닙니다.");
      if (session?.frozen) {
        if (!session.frozenFiles.includes(fileId))
          throw new DomainError(404, "공개된 파일이 아닙니다.");
      } else {
        const document = new Y.Doc();
        try {
          for (const state of await this.repository.documents.load(
            file.pageId,
            tx,
          ))
            Y.applyUpdate(document, state);
          if (!getLiveAttachmentIds(document).includes(fileId))
            throw new DomainError(404, "공개된 파일이 아닙니다.");
        } finally {
          document.destroy();
        }
      }
      return file;
    });
  }
}
