import { describe, it, expect } from "vitest";
import {
  parseTimeToMinutes,
  calcShiftPay,
  summarizeShifts,
  validateShift,
  type ShiftInput,
} from "./payroll";

const WAGE = 1000;

/** テスト用のシフト生成ヘルパ。 */
function shift(partial: Partial<ShiftInput> & Pick<ShiftInput, "start" | "end">): ShiftInput {
  return { hourlyWage: WAGE, nightRate: 1.25, breakMinutes: 0, ...partial };
}

describe("parseTimeToMinutes", () => {
  it("HH:MM を分に変換する", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(parseTimeToMinutes("22:00")).toBe(1320);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("秒付き HH:MM:SS も受け付ける（Supabase time 型）", () => {
    expect(parseTimeToMinutes("17:00:00")).toBe(1020);
  });

  it("不正な入力は投げる", () => {
    expect(() => parseTimeToMinutes("25:00")).toThrow();
    expect(() => parseTimeToMinutes("12:60")).toThrow();
    expect(() => parseTimeToMinutes("abc")).toThrow();
  });
});

describe("calcShiftPay — 通常帯のみ", () => {
  it("09:00-17:00 休憩60分は 7時間ぶん", () => {
    const r = calcShiftPay(shift({ start: "09:00", end: "17:00", breakMinutes: 60 }));
    expect(r.grossMinutes).toBe(480);
    expect(r.workedMinutes).toBe(420);
    expect(r.paidNightMinutes).toBe(0);
    expect(r.pay).toBeCloseTo(7000, 6); // 7h × 1000
  });

  it("深夜帯に一切かからなければ割増は発生しない", () => {
    const r = calcShiftPay(shift({ start: "10:00", end: "18:00" }));
    expect(r.paidNightMinutes).toBe(0);
    expect(r.pay).toBeCloseTo(8000, 6);
  });
});

describe("calcShiftPay — 深夜割増", () => {
  it("17:00-23:00 は 22:00-23:00 の1時間が深夜割増", () => {
    const r = calcShiftPay(shift({ start: "17:00", end: "23:00" }));
    expect(r.grossMinutes).toBe(360);
    expect(r.paidNightMinutes).toBe(60);
    expect(r.paidDayMinutes).toBe(300);
    // 5h×1000 + 1h×1000×1.25 = 5000 + 1250
    expect(r.pay).toBeCloseTo(6250, 6);
  });

  it("22:00 ちょうど開始は全時間が深夜（境界の包含）", () => {
    const r = calcShiftPay(shift({ start: "22:00", end: "23:00" }));
    expect(r.paidNightMinutes).toBe(60);
    expect(r.pay).toBeCloseTo(1250, 6);
  });

  it("05:00 ちょうど終了は深夜帯が閉じる（境界の排他）", () => {
    const r = calcShiftPay(shift({ start: "04:00", end: "05:00" }));
    expect(r.paidNightMinutes).toBe(60); // 04:00-05:00 は深夜
    const r2 = calcShiftPay(shift({ start: "05:00", end: "06:00" }));
    expect(r2.paidNightMinutes).toBe(0); // 05:00 以降は通常
  });
});

describe("calcShiftPay — 日またぎ", () => {
  it("22:00-05:00（翌）は7時間すべて深夜割増", () => {
    const r = calcShiftPay(shift({ start: "22:00", end: "05:00" }));
    expect(r.grossMinutes).toBe(420);
    expect(r.paidNightMinutes).toBe(420);
    expect(r.paidDayMinutes).toBe(0);
    expect(r.pay).toBeCloseTo(420 * (1000 / 60) * 1.25, 6); // = 8750
  });

  it("18:00-02:00（翌）は 22:00-02:00 の4時間が深夜", () => {
    const r = calcShiftPay(shift({ start: "18:00", end: "02:00" }));
    expect(r.grossMinutes).toBe(480); // 8h
    expect(r.paidNightMinutes).toBe(240); // 22:00-02:00
    expect(r.paidDayMinutes).toBe(240); // 18:00-22:00
    // 4h×1000 + 4h×1250 = 4000 + 5000
    expect(r.pay).toBeCloseTo(9000, 6);
  });

  it("23:00-09:00（翌）は 23:00-05:00 の6時間が深夜、05:00-09:00 が通常", () => {
    const r = calcShiftPay(shift({ start: "23:00", end: "09:00" }));
    expect(r.grossMinutes).toBe(600); // 10h
    expect(r.paidNightMinutes).toBe(360); // 23:00-05:00
    expect(r.paidDayMinutes).toBe(240); // 05:00-09:00
    // 4h×1000 + 6h×1250 = 4000 + 7500
    expect(r.pay).toBeCloseTo(11500, 6);
  });
});

describe("calcShiftPay — 休憩の比例控除", () => {
  it("18:00-24:00 に60分休憩は深夜/通常に比例配分される", () => {
    // gross=360(day240/night120), worked=300, ratio=5/6
    // paidDay=200, paidNight=100
    const r = calcShiftPay(shift({ start: "18:00", end: "00:00", breakMinutes: 60 }));
    expect(r.workedMinutes).toBe(300);
    expect(r.paidDayMinutes).toBeCloseTo(200, 6);
    expect(r.paidNightMinutes).toBeCloseTo(100, 6);
    // 200/60×1000 + 100/60×1000×1.25 = 3333.33 + 2083.33
    expect(r.pay).toBeCloseTo((200 + 100 * 1.25) * (1000 / 60), 6);
  });

  it("休憩が深夜帯にかかっても、比例方式なので割増総額が破綻しない", () => {
    // 全時間が深夜のシフトで休憩を取れば、休憩ぶんも深夜から比例で引かれる
    const r = calcShiftPay(shift({ start: "22:00", end: "04:00", breakMinutes: 60 }));
    expect(r.grossMinutes).toBe(360);
    expect(r.workedMinutes).toBe(300);
    expect(r.paidNightMinutes).toBeCloseTo(300, 6);
    expect(r.paidDayMinutes).toBeCloseTo(0, 6);
    expect(r.pay).toBeCloseTo(300 * (1000 / 60) * 1.25, 6); // 6250
  });

  it("paidDay + paidNight は常に workedMinutes に一致する", () => {
    const cases: ShiftInput[] = [
      shift({ start: "17:00", end: "02:00", breakMinutes: 45 }),
      shift({ start: "08:00", end: "22:30", breakMinutes: 90 }),
      shift({ start: "23:15", end: "07:45", breakMinutes: 30 }),
    ];
    for (const c of cases) {
      const r = calcShiftPay(c);
      expect(r.paidDayMinutes + r.paidNightMinutes).toBeCloseTo(r.workedMinutes, 6);
    }
  });
});

describe("calcShiftPay — 異常系", () => {
  it("終了==開始 は0分・支給0", () => {
    const r = calcShiftPay(shift({ start: "09:00", end: "09:00" }));
    expect(r.grossMinutes).toBe(0);
    expect(r.pay).toBe(0);
  });

  it("休憩が勤務時間を超えても支給は負にならない", () => {
    const r = calcShiftPay(shift({ start: "09:00", end: "10:00", breakMinutes: 120 }));
    expect(r.workedMinutes).toBe(0);
    expect(r.pay).toBe(0);
  });

  it("wage_override 相当（時給違い）が反映される", () => {
    const r = calcShiftPay(shift({ start: "09:00", end: "10:00", hourlyWage: 1500 }));
    expect(r.pay).toBeCloseTo(1500, 6);
  });

  it("night_rate を変えると割増額が変わる", () => {
    const r = calcShiftPay(shift({ start: "22:00", end: "23:00", nightRate: 1.5 }));
    expect(r.pay).toBeCloseTo(1500, 6);
  });
});

describe("summarizeShifts", () => {
  it("賃金は合計してから1回だけ丸める", () => {
    // 端数の出るシフトを複数。個別に丸めると誤差が乗るケース。
    const shifts = [
      shift({ start: "18:00", end: "00:00", breakMinutes: 50 }),
      shift({ start: "17:00", end: "23:20", breakMinutes: 40 }),
    ];
    const raw = shifts.reduce((s, x) => s + calcShiftPay(x).pay, 0);
    const sum = summarizeShifts(shifts);
    expect(sum.wageTotal).toBe(Math.round(raw));
  });

  it("交通費は出勤日数（ユニーク日付）ぶん加算する", () => {
    const shifts = [
      shift({ start: "09:00", end: "13:00" }),
      shift({ start: "18:00", end: "22:00" }),
    ];
    // 同じ日に2シフトでも交通費は1日ぶん
    const sum = summarizeShifts(shifts, {
      transportPerDay: 500,
      workDates: ["2026-07-01", "2026-07-01"],
    });
    expect(sum.workDays).toBe(1);
    expect(sum.transportTotal).toBe(500);
    expect(sum.grandTotal).toBe(sum.wageTotal + 500);
  });

  it("複数日なら日数ぶん交通費が乗る", () => {
    const sum = summarizeShifts(
      [shift({ start: "09:00", end: "17:00" }), shift({ start: "09:00", end: "17:00" })],
      { transportPerDay: 400, workDates: ["2026-07-01", "2026-07-02"] },
    );
    expect(sum.workDays).toBe(2);
    expect(sum.transportTotal).toBe(800);
  });

  it("rounding=floor / ceil を選べる", () => {
    const shifts = [shift({ start: "18:00", end: "00:00", breakMinutes: 50 })];
    const raw = calcShiftPay(shifts[0]).pay;
    expect(summarizeShifts(shifts, { rounding: "floor" }).wageTotal).toBe(Math.floor(raw));
    expect(summarizeShifts(shifts, { rounding: "ceil" }).wageTotal).toBe(Math.ceil(raw));
  });

  it("空配列は全て0", () => {
    const sum = summarizeShifts([]);
    expect(sum.wageTotal).toBe(0);
    expect(sum.grandTotal).toBe(0);
    expect(sum.workDays).toBe(0);
  });
});

describe("validateShift", () => {
  it("正常なシフトはエラーなし", () => {
    expect(validateShift({ start: "09:00", end: "17:00", breakMinutes: 60 })).toEqual([]);
  });
  it("日またぎは正常扱い", () => {
    expect(validateShift({ start: "22:00", end: "05:00" })).toEqual([]);
  });
  it("0分勤務を検出", () => {
    expect(validateShift({ start: "09:00", end: "09:00" }).length).toBeGreaterThan(0);
  });
  it("休憩超過を検出", () => {
    const errs = validateShift({ start: "09:00", end: "10:00", breakMinutes: 120 });
    expect(errs.some((e) => e.includes("休憩"))).toBe(true);
  });
  it("不正な時刻を検出", () => {
    expect(validateShift({ start: "99:99", end: "10:00" }).length).toBeGreaterThan(0);
  });
});
