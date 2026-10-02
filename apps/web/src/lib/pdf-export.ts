import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as Y from "yjs";
import {
  base64ToBytes,
  readPortableContent,
  portablePlainText,
  getTaskRows,
  getDatabaseProperties,
  readDatabaseValue,
  databaseValueLabel,
  type WorkspaceExport,
  type PortableNode,
  type PortableLinks,
} from "@zeronote/shared";
const WIDTH = 595.28,
  HEIGHT = 841.89,
  MARGIN = 48,
  BODY_SIZE = 11,
  LINE_HEIGHT = 17;
interface PdfWriter {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  top: number;
  supported: Set<number>;
}
function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
function reserveLine(writer: PdfWriter, height: number): void {
  if (writer.top - height < MARGIN) {
    writer.page = writer.pdf.addPage([WIDTH, HEIGHT]);
    writer.top = HEIGHT - MARGIN;
  }
}
function writeText(
  writer: PdfWriter,
  value: string,
  size = BODY_SIZE,
  indent = 0,
): void {
  if (
    [...value.replace(/[\n\r\t]/g, "")].some(
      (char) => !writer.supported.has(char.codePointAt(0)!),
    )
  )
    throw new Error(
      "PDF 폰트가 지원하지 않는 글자가 있습니다. HTML로 Export하면 원문을 보존할 수 있습니다.",
    );
  const height = size === BODY_SIZE ? LINE_HEIGHT : size * 1.5;
  for (const line of wrapText(
    value,
    writer.font,
    size,
    WIDTH - MARGIN * 2 - indent,
  )) {
    reserveLine(writer, height);
    writer.page.drawText(line, {
      x: MARGIN + indent,
      y: writer.top - size,
      font: writer.font,
      size,
      color: rgb(0.15, 0.15, 0.15),
    });
    writer.top -= height;
  }
}
async function writeImage(
  writer: PdfWriter,
  data: Uint8Array,
  mime: string,
): Promise<void> {
  const image =
    mime === "image/png"
      ? await writer.pdf.embedPng(data)
      : await writer.pdf.embedJpg(data);
  const scale = Math.min(
    1,
    (WIDTH - 2 * MARGIN) / image.width,
    (HEIGHT - 2 * MARGIN - LINE_HEIGHT) / image.height,
  );
  const width = image.width * scale,
    height = image.height * scale;
  reserveLine(writer, height + LINE_HEIGHT);
  writer.page.drawImage(image, {
    x: MARGIN,
    y: writer.top - height,
    width,
    height,
  });
  writer.top -= height + LINE_HEIGHT;
}
async function writeNodes(
  writer: PdfWriter,
  nodes: PortableNode[],
  links: PortableLinks,
  input: WorkspaceExport,
  indent = 0,
): Promise<void> {
  for (const node of nodes) {
    if (["bulletList", "orderedList", "taskList"].includes(node.type)) {
      for (const [index, item] of (node.children ?? []).entries()) {
        const prefix =
          node.type === "orderedList"
            ? `${(Number(node.attrs.start) || 1) + index}. `
            : node.type === "taskList"
              ? item.attrs.checked === true
                ? "[x] "
                : "[ ] "
              : "• ";
        const [first, ...rest] = item.children ?? [];
        if (first)
          writeText(
            writer,
            prefix + portablePlainText([first], links).trim(),
            BODY_SIZE,
            indent,
          );
        await writeNodes(writer, rest, links, input, indent + 14);
      }
      writer.top -= 8;
      continue;
    }
    if (
      ["blockquote", "callout", "details", "detailsContent"].includes(node.type)
    ) {
      await writeNodes(writer, node.children ?? [], links, input, indent + 14);
      continue;
    }
    if (node.type === "horizontalRule") {
      reserveLine(writer, 16);
      writer.page.drawLine({
        start: { x: MARGIN, y: writer.top - 8 },
        end: { x: WIDTH - MARGIN, y: writer.top - 8 },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7),
      });
      writer.top -= 16;
      continue;
    }
    if (node.type === "attachment") {
      const file = input.attachments?.find(
        (value) => value.id === node.attrs.attachmentId,
      );
      if (file && ["image/png", "image/jpeg"].includes(file.mime))
        await writeImage(writer, base64ToBytes(file.data), file.mime);
      writeText(
        writer,
        file ? `첨부: ${file.name}` : "첨부 없음",
        BODY_SIZE,
        indent,
      );
    } else {
      const size =
        node.type === "heading"
          ? 22 - Math.min(3, Number(node.attrs.level) || 1) * 3
          : BODY_SIZE;
      writeText(
        writer,
        portablePlainText([node], links).trimEnd(),
        size,
        indent,
      );
    }
    writer.top -= 8;
  }
}
export async function createPagePdf(
  input: WorkspaceExport,
  pageId: string,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const source = input.pages.find((page) => page.id === pageId);
  if (!source) throw new Error("PDF로 Export할 Page가 없습니다.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(source.title);
  pdf.setCreator("ZeroNote");
  pdf.setProducer("ZeroNote");
  const writer: PdfWriter = {
    pdf,
    font,
    page: pdf.addPage([WIDTH, HEIGHT]),
    top: HEIGHT - MARGIN,
    supported: new Set(font.getCharacterSet()),
  };
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, base64ToBytes(source.document));
    const links: PortableLinks = {
      page(id) {
        const page = input.pages.find((value) => value.id === id);
        return page ? { title: page.title, href: "" } : undefined;
      },
      file(id) {
        const file = input.attachments?.find((value) => value.id === id);
        return file
          ? { name: file.name, href: "", mime: file.mime }
          : undefined;
      },
    };
    writeText(writer, source.title, 24);
    writer.top -= 16;
    await writeNodes(
      writer,
      readPortableContent(document.getXmlFragment("content")),
      links,
      input,
    );
    if (source.kind === "database")
      for (const row of getTaskRows(document)) {
        writeText(writer, row.title, 16);
        for (const property of getDatabaseProperties(document).filter(
          (value) => value.id !== "title",
        ))
          writeText(
            writer,
            `${property.name}: ${databaseValueLabel(property, readDatabaseValue(document, row, property))}`,
          );
        await writeNodes(
          writer,
          readPortableContent(document.getXmlFragment(`task:${row.id}`)),
          links,
          input,
        );
        writer.top -= 12;
      }
    return await pdf.save();
  } finally {
    document.destroy();
  }
}
