import { describe, expect, it } from "vitest";
import { bytes, clock, highlight, realtime, took, when } from "./format";

describe("format", () => {
  it("bytes", () => {
    expect(bytes(1_620_000_000)).toBe("1.6 GB");
    expect(bytes(145_000_000)).toBe("145 MB");
    expect(bytes(4_200_000)).toBe("4.2 MB");
    expect(bytes(900)).toBe("900 B");
  });

  it("clock", () => {
    expect(clock(7.9)).toBe("0:07");
    expect(clock(724)).toBe("12:04");
    expect(clock(3725)).toBe("1:02:05");
  });

  it("took / realtime", () => {
    expect(took(48)).toBe("48 s");
    expect(took(192)).toBe("3 min 12 s");
    expect(realtime(600, 60)).toBe("10.0×");
    expect(realtime(600, 0)).toBe("—");
  });

  it("when", () => {
    const now = new Date(2026, 9, 29, 15, 0).getTime();
    expect(when(new Date(2026, 9, 29, 9, 5).getTime(), now)).toMatch(/^Today/);
    expect(when(new Date(2026, 9, 28, 9, 5).getTime(), now)).toMatch(/^Yesterday/);
  });

  it("highlight", () => {
    expect(highlight("The Fox and the fox", ["fox"])).toEqual([
      { text: "The ", hit: false },
      { text: "Fox", hit: true },
      { text: " and the ", hit: false },
      { text: "fox", hit: true },
    ]);
    expect(highlight("a.b", ["."])).toEqual([{ text: "a", hit: false }, { text: ".", hit: true }, { text: "b", hit: false }]);
  });
});
