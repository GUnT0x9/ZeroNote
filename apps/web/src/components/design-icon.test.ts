import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DesignIcon } from "./design-icon";

describe("Figma icon assets", () => {
  it("uses the provided local logo at its intrinsic dimensions", () => {
    const icon = DesignIcon({ name: "logo" });
    const asset = readFileSync(
      new URL("../../public/design-icons/logo.svg", import.meta.url),
      "utf8",
    );
    expect(asset).toMatch(/<svg[^>]+width="24"[^>]+height="24"/);
    expect(icon.props).toMatchObject({
      "aria-hidden": "true",
      className: "design-icon design-icon-logo",
      style: { width: 24, height: 24 },
    });
  });
  it("preserves non-square icon geometry instead of stretching the asset", () => {
    const icon = DesignIcon({ name: "select-chevron" });
    const asset = readFileSync(
      new URL("../../public/design-icons/select-chevron.svg", import.meta.url),
      "utf8",
    );
    expect(asset).toMatch(/<svg[^>]+width="10"[^>]+height="6"/);
    expect(icon.props.style).toEqual({ width: 10, height: 6 });
  });
});
