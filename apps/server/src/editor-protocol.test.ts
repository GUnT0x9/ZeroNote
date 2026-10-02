import { expect, it } from "vitest";
import { requestEditorProtocol } from "./editor-protocol";

it("reads current client versions and treats absent headers as legacy", () => {
  expect(requestEditorProtocol({ headers: {} })).toBe(1);
  expect(
    requestEditorProtocol({
      headers: { "x-zeronote-editor-protocol": "2" },
    }),
  ).toBe(2);
});
it("rejects malformed, unsupported and repeated protocol headers", () => {
  for (const value of ["999", "2.5", "invalid", ["1", "2"]])
    expect(() =>
      requestEditorProtocol({
        headers: { "x-zeronote-editor-protocol": value },
      }),
    ).toThrow();
});
