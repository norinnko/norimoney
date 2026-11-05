import { describe, it, expect } from "vitest";
import {
  parseCSV,
  parseAmount,
  parseFlexibleDate,
  mapRowsToExpenses,
  guessMapping,
} from "./csv";

describe("parseCSV", () => {
  it("基本的な行と列", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("クォート内のカンマを保持する", () => {
    expect(parseCSV('日付,店名,金額\n2026/07/22,"コンビニ, 駅前",500')).toEqual([
      ["日付", "店名", "金額"],
      ["2026/07/22", "コンビニ, 駅前", "500"],
    ]);
  });

  it('エスケープされたダブルクォート("")', () => {
    expect(parseCSV('a,"say ""hi""",b')).toEqual([["a", 'say "hi"', "b"]]);
  });

  it("CRLF と CR を扱う", () => {
    expect(parseCSV("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("末尾改行なし・空行除去・BOM除去", () => {
    expect(parseCSV("﻿a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("タブ区切りも指定できる", () => {
    expect(parseCSV("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseAmount", () => {
  it("カンマ・通貨記号・円を除去", () => {
    expect(parseAmount("¥1,234")).toBe(1234);
    expect(parseAmount("1,234円")).toBe(1234);
    expect(parseAmount("500")).toBe(500);
  });
  it("マイナスと括弧はマイナス", () => {
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("(500)")).toBe(-500);
  });
  it("プラス記号・空白を許容", () => {
    expect(parseAmount(" +800 ")).toBe(800);
  });
  it("小数は四捨五入", () => {
    expect(parseAmount("100.4")).toBe(100);
    expect(parseAmount("100.6")).toBe(101);
  });
  it("空・非数値は null", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("---")).toBeNull();
  });
});

describe("parseFlexibleDate", () => {
  it("各種区切り", () => {
    expect(parseFlexibleDate("2026/07/22")).toBe("2026-07-22");
    expect(parseFlexibleDate("2026-7-2")).toBe("2026-07-02");
    expect(parseFlexibleDate("2026.07.22")).toBe("2026-07-22");
    expect(parseFlexibleDate("2026年7月22日")).toBe("2026-07-22");
  });
  it("範囲外・不正は null", () => {
    expect(parseFlexibleDate("2026/13/01")).toBeNull();
    expect(parseFlexibleDate("2026/07/40")).toBeNull();
    expect(parseFlexibleDate("07/22/2026")).toBeNull();
    expect(parseFlexibleDate("なし")).toBeNull();
  });
});

describe("mapRowsToExpenses", () => {
  const rows = [
    ["日付", "金額", "利用先"],
    ["2026/07/22", "1,200", "スーパー"],
    ["2026/07/23", "-500", "返金"], // 金額0以下→スキップ
    ["bad", "300", "日付不正"], // 日付不正→スキップ
    ["2026/07/24", "800", ""], // 店名空→null
  ];

  it("ヘッダーを飛ばし、正の金額のみ取り込む", () => {
    const r = mapRowsToExpenses(
      rows,
      { date: 0, amount: 1, store: 2 },
      { hasHeader: true },
    );
    expect(r.records).toEqual([
      { spent_on: "2026-07-22", amount: 1200, store: "スーパー" },
      { spent_on: "2026-07-24", amount: 800, store: null },
    ]);
    expect(r.skippedNonPositive).toBe(1);
    expect(r.skippedInvalid).toBe(1);
  });

  it("store 列未指定なら store は null", () => {
    const r = mapRowsToExpenses(
      [["2026/07/22", "1000"]],
      { date: 0, amount: 1 },
      { hasHeader: false },
    );
    expect(r.records).toEqual([{ spent_on: "2026-07-22", amount: 1000, store: null }]);
  });
});

describe("guessMapping", () => {
  it("日本語ヘッダーから推定", () => {
    expect(guessMapping(["ご利用日", "ご利用先", "ご利用金額"])).toEqual({
      date: 0,
      amount: 2,
      store: 1,
    });
  });
  it("店名列が無くても date/amount があれば推定できる", () => {
    expect(guessMapping(["取引日", "支払金額"])).toEqual({
      date: 0,
      amount: 1,
      store: undefined,
    });
  });
  it("date/amount が無ければ null", () => {
    expect(guessMapping(["col1", "col2"])).toBeNull();
  });
});
