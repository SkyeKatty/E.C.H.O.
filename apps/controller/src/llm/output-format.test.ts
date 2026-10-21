import { describe, expect, it } from "vitest";
import { formatLlmOutput } from "./output-format.js";

describe("formatLlmOutput", () => {
  it("replaces em dashes with comma space", () => {
    expect(formatLlmOutput("Hello—world")).toBe("Hello, world");
    expect(formatLlmOutput("a—b—c")).toBe("a, b, c");
  });
});
