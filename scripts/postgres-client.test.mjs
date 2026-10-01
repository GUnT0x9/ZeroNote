import { describe, expect, it } from "vitest";
import {
  getPostgresClientConnection,
  runPostgresClient,
} from "./postgres-client.mjs";

describe("PostgreSQL operator client connection", () => {
  it("keeps TLS settings and removes the password from client arguments", () => {
    const result = getPostgresClientConnection(
      "postgresql://owner:s%3Ae%5Ccret@db.example.com/zeronote?sslmode=require&channel_binding=require",
    );
    expect(result.connectionString).toBe(
      "postgresql://owner@db.example.com/zeronote?sslmode=require&channel_binding=require",
    );
    expect(result.passwordFileContents).toBe("*:*:*:*:s\\:e\\\\cret\n");
  });

  it("supports IPv6 and percent encoded credentials", () => {
    const result = getPostgresClientConnection(
      "postgres://owner:p%40ss@[::1]:55432/zero%20note",
    );
    expect(result.connectionString).toBe(
      "postgres://owner@[::1]:55432/zero%20note",
    );
    expect(result.passwordFileContents).toBe("*:*:*:*:p@ss\n");
  });

  it.each([
    "https://owner:secret@db.example.com/zeronote",
    "postgresql://owner:secret@db.example.com/",
    "postgresql://owner:p%0Ass@db.example.com/zeronote",
    "postgresql://owner:secret@db.example.com/zeronote?password=secret",
    "postgresql://owner:secret@db.example.com/zeronote?sslpassword=secret",
    "postgresql://owner:secret@db.example.com/zeronote#secret",
    "invalid-secret-url",
  ])(
    "rejects invalid or secret-bearing options without echoing the URL",
    (url) => {
      expect(() => getPostgresClientConnection(url)).toThrow(
        "Use a PostgreSQL connection URL with credentials in its authority.",
      );
    },
  );

  it("rejects unsupported programs before launching a process", () => {
    expect(() =>
      runPostgresClient(
        "sh",
        [],
        "postgresql://owner:secret@localhost/zeronote",
      ),
    ).toThrow("Unsupported PostgreSQL client.");
  });
});
