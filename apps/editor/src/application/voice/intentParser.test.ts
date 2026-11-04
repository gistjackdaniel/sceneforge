import { describe, it, expect } from "vitest";
import { ruleBasedParser } from "../../infrastructure/voice/IntentParser/ruleBasedParser";

describe("rule-based intent parser", () => {
  const parser = ruleBasedParser();

  it("parses EN move intent with amount and direction", () => {
    const intent = parser.parse({ text: "Move the chair left 1 meter", locale: "en" });
    expect(intent).toBeTruthy();
    expect(intent?.verb).toBe("move");
    expect(intent?.targetRefs[0]).toContain("chair");
    expect(intent?.params.direction).toContain("left");
    expect(intent?.params.amount).toBe(1);
  });

  it("parses KO move intent with amount and direction", () => {
    const intent = parser.parse({ text: "의자를 왼쪽으로 1미터 이동", locale: "ko" });
    expect(intent).toBeTruthy();
    expect(intent?.verb).toBe("move");
    expect(intent?.targetRefs[0]).toContain("의자");
    expect(intent?.params.direction).toMatch(/왼쪽|left/);
    expect(intent?.params.amount).toBe(1);
  });

  it("parses EN rotate intent", () => {
    const intent = parser.parse({ text: "Rotate it 90 degrees", locale: "en" });
    expect(intent).toBeTruthy();
    expect(intent?.verb).toBe("rotate");
    expect(intent?.targetRefs[0]).toBe("it");
    expect(intent?.params.degrees).toBe(90);
  });

  it("parses KO look-at intent", () => {
    const intent = parser.parse({ text: "카메라가 의자를 봐", locale: "ko" });
    expect(intent).toBeTruthy();
    expect(intent?.verb).toBe("look-at");
  });
});

