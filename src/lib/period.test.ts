import { describe, it, expect } from "vitest";
import {
  payPeriodFor,
  payPeriodLabel,
  shiftPeriod,
  taxYearRange,
  isWithin,
  daysInMonth,
} from "./period";

describe("daysInMonth", () => {
  it("各月の日数", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29); // 閏年
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("payPeriodFor — 末締め（31）", () => {
  it("暦月と一致する", () => {
    expect(payPeriodFor(31, "2026-07-22")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });
  it("2月は末日にクランプ", () => {
    expect(payPeriodFor(31, "2026-02-10")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
});

describe("payPeriodFor — 15日締め", () => {
  it("締め日より前は当月締め（前月16〜当月15）", () => {
    expect(payPeriodFor(15, "2026-07-10")).toEqual({
      start: "2026-06-16",
      end: "2026-07-15",
    });
  });
  it("締め日ちょうどは当月締めに含む", () => {
    expect(payPeriodFor(15, "2026-07-15")).toEqual({
      start: "2026-06-16",
      end: "2026-07-15",
    });
  });
  it("締め日より後は翌月締め（当月16〜翌月15）", () => {
    expect(payPeriodFor(15, "2026-07-16")).toEqual({
      start: "2026-07-16",
      end: "2026-08-15",
    });
  });
  it("年をまたぐ（12月後半）", () => {
    expect(payPeriodFor(15, "2026-12-20")).toEqual({
      start: "2026-12-16",
      end: "2027-01-15",
    });
  });
});

describe("payPeriodFor — 20日締めで2月をまたぐ", () => {
  it("1月後半は 1/21〜2/20", () => {
    expect(payPeriodFor(20, "2026-01-25")).toEqual({
      start: "2026-01-21",
      end: "2026-02-20",
    });
  });
});

describe("payPeriodLabel", () => {
  it("終了日の月を代表月にする", () => {
    expect(payPeriodLabel(payPeriodFor(15, "2026-07-10"))).toBe("2026年7月分");
    expect(payPeriodLabel(payPeriodFor(31, "2026-07-22"))).toBe("2026年7月分");
  });
});

describe("shiftPeriod", () => {
  it("末締めで前後の月へ移動", () => {
    const cur = payPeriodFor(31, "2026-07-22");
    expect(shiftPeriod(31, cur, 1)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(shiftPeriod(31, cur, -1)).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("15日締めで次の期間へ", () => {
    const cur = payPeriodFor(15, "2026-07-10"); // 6/16〜7/15
    expect(shiftPeriod(15, cur, 1)).toEqual({ start: "2026-07-16", end: "2026-08-15" });
    expect(shiftPeriod(15, cur, -1)).toEqual({ start: "2026-05-16", end: "2026-06-15" });
  });
});

describe("taxYearRange / isWithin", () => {
  it("暦年の範囲", () => {
    expect(taxYearRange(2026)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("境界を含む", () => {
    const r = taxYearRange(2026);
    expect(isWithin("2026-01-01", r)).toBe(true);
    expect(isWithin("2026-12-31", r)).toBe(true);
    expect(isWithin("2025-12-31", r)).toBe(false);
    expect(isWithin("2027-01-01", r)).toBe(false);
  });
});
