/**
 * payroll.ts — 給料計算の純粋関数群
 *
 * 設計方針（AGENTS.md 準拠）:
 *  - UI に一切依存しない。DOM も Supabase も import しない。
 *  - 金額は円単位の integer で扱い、丸めは「月合計で1回だけ」行う。
 *  - 内部計算は分単位の整数演算で厳密に行い、浮動小数のドリフトを避ける。
 *  - 深夜割増: 22:00〜翌05:00 を night_rate 倍（既定 1.25）。
 *  - 日またぎ対応: 終了時刻が開始時刻より小さいなら翌日とみなす。
 *
 * 深夜帯の定義:
 *  「その時刻の minute-of-day が [00:00,05:00) または [22:00,24:00) に入っていれば深夜」
 *  これを絶対時間軸上の帯 [0,300) / [1320,1740) / [2760,3060) との重なりで数える。
 *  1シフトは最長でも24時間なので、この3帯で全ケースを覆える。
 */

const MINUTES_PER_DAY = 1440;
const NIGHT_START = 22 * 60; // 22:00 = 1320
const NIGHT_END = 5 * 60; //   翌05:00 = 300 (minute-of-day)

/** 深夜帯（絶対時間軸上の帯）。start は 0..1439、end は最大 2880 まで動く前提。 */
const NIGHT_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, NIGHT_END], //                     当日 00:00〜05:00
  [NIGHT_START, MINUTES_PER_DAY + NIGHT_END], // 当日 22:00〜翌05:00
  [
    NIGHT_START + MINUTES_PER_DAY,
    2 * MINUTES_PER_DAY + NIGHT_END,
  ], //                                  翌 22:00〜翌々05:00（長時間シフト用）
];

/** 1シフト分の入力。時刻は "HH:MM" もしくは "HH:MM:SS"（Supabase の time 型に対応）。 */
export interface ShiftInput {
  /** 開始時刻 "HH:MM" */
  start: string;
  /** 終了時刻 "HH:MM"。start より小さければ日またぎ。 */
  end: string;
  /** 休憩（分）。既定 0。 */
  breakMinutes?: number;
  /** このシフトに適用する時給（円）。job/override を解決した後の実効時給を渡す。 */
  hourlyWage: number;
  /** 深夜割増率。既定 1.25。 */
  nightRate?: number;
}

/** 1シフト分の計算結果。 */
export interface ShiftPay {
  /** 拘束時間（分）＝ 終了−開始（日またぎ考慮）。 */
  grossMinutes: number;
  /** 休憩（分）。 */
  breakMinutes: number;
  /** 実労働時間（分）＝ grossMinutes − breakMinutes。 */
  workedMinutes: number;
  /** 休憩を比例控除した後の、支払対象の深夜労働分（分・小数あり）。 */
  paidNightMinutes: number;
  /** 休憩を比例控除した後の、支払対象の通常労働分（分・小数あり）。 */
  paidDayMinutes: number;
  /** このシフトの支給額（円・未丸め）。合算後に丸めること。 */
  pay: number;
}

/**
 * "HH:MM" / "HH:MM:SS" を minute-of-day(0..1439) に変換する。
 * 不正な入力は Error を投げる（UI 側は validateShift で事前チェックする想定）。
 */
export function parseTimeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) throw new Error(`時刻の形式が不正です: "${time}"`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new Error(`時刻が範囲外です: "${time}"`);
  return hh * 60 + mm;
}

/** 区間 [aStart,aEnd) と [bStart,bEnd) の重なり（分）。負にはならない。 */
function overlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * 絶対時間軸 [start,end) のうち深夜帯に入る分数を返す。
 * start は 0..1439、end は start より大きい（日またぎ済み）値。
 */
function nightMinutesIn(start: number, end: number): number {
  let total = 0;
  for (const [bStart, bEnd] of NIGHT_BANDS) {
    total += overlap(start, end, bStart, bEnd);
  }
  return total;
}

/**
 * 1シフトの支給額を計算する。
 *
 * 休憩の扱い: 休憩がいつ取られたかは記録しないため、深夜/通常の労働分に
 * 「比例」で控除する（どちらか一方を優遇しない、見込み計算として最も無難な方式）。
 * 端数を出さないため、比例を最後の割り算まで整数で持ち回す:
 *
 *   pay = wage × (rawDay×100 + rawNight×rateBasis) × worked / (gross × 6000)
 *
 * ここで rateBasis = round(nightRate×100)（例: 1.25→125）、6000 = 60(分/時) × 100。
 */
export function calcShiftPay(shift: ShiftInput): ShiftPay {
  const breakMinutes = Math.max(0, Math.round(shift.breakMinutes ?? 0));
  const start = parseTimeToMinutes(shift.start);
  const endRaw = parseTimeToMinutes(shift.end);
  // 終了 < 開始 なら翌日。終了 == 開始 は 0 分（24時間勤務とはみなさない）。
  const end = endRaw < start ? endRaw + MINUTES_PER_DAY : endRaw;

  const grossMinutes = end - start;
  const workedMinutes = Math.max(0, grossMinutes - breakMinutes);

  if (grossMinutes <= 0) {
    return {
      grossMinutes: 0,
      breakMinutes,
      workedMinutes: 0,
      paidNightMinutes: 0,
      paidDayMinutes: 0,
      pay: 0,
    };
  }

  const rawNight = nightMinutesIn(start, end);
  const rawDay = grossMinutes - rawNight;

  // 休憩を比例控除した支払対象の分数（小数あり・表示用）。
  const workedRatio = workedMinutes / grossMinutes;
  const paidNightMinutes = rawNight * workedRatio;
  const paidDayMinutes = rawDay * workedRatio;

  const rateBasis = Math.round((shift.nightRate ?? 1.25) * 100);
  // 分子は整数。realistic な値域（時給≲1万・分≲1440）で Number.MAX_SAFE_INTEGER に収まる。
  const numerator =
    shift.hourlyWage * (rawDay * 100 + rawNight * rateBasis) * workedMinutes;
  const denominator = grossMinutes * 6000;
  const pay = numerator / denominator;

  return {
    grossMinutes,
    breakMinutes,
    workedMinutes,
    paidNightMinutes,
    paidDayMinutes,
    pay,
  };
}

/** 端数処理の方式。見込み計算なので既定は四捨五入。 */
export type RoundingMode = "round" | "floor" | "ceil";

function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === "floor") return Math.floor(value);
  if (mode === "ceil") return Math.ceil(value);
  return Math.round(value);
}

export interface SummaryOptions {
  /** 1日あたり交通費（円）。出勤日数ぶん加算する。 */
  transportPerDay?: number;
  /** 交通費の日数カウント用。各シフトの勤務日（"YYYY-MM-DD"）。省略時は交通費0。 */
  workDates?: string[];
  /** 端数処理方式。既定 "round"。 */
  rounding?: RoundingMode;
}

export interface PayrollSummary {
  /** 総拘束時間（分）。 */
  totalGrossMinutes: number;
  /** 総実労働時間（分）。 */
  totalWorkedMinutes: number;
  /** 支払対象の総深夜労働分（分）。 */
  totalNightMinutes: number;
  /** 賃金合計（交通費を除く・丸め済み）。 */
  wageTotal: number;
  /** 交通費合計。 */
  transportTotal: number;
  /** 出勤日数（ユニークな勤務日数）。 */
  workDays: number;
  /** 支給総額 ＝ wageTotal + transportTotal。 */
  grandTotal: number;
}

/**
 * 複数シフトを合算する。丸めは「賃金の合計」に対して1回だけ適用する。
 * 交通費は出勤日数（ユニーク日付）×transportPerDay で加算する。
 */
export function summarizeShifts(
  shifts: ShiftInput[],
  options: SummaryOptions = {},
): PayrollSummary {
  const rounding = options.rounding ?? "round";
  let totalGrossMinutes = 0;
  let totalWorkedMinutes = 0;
  let totalNightMinutes = 0;
  let rawWageSum = 0; // 未丸めの賃金合計

  for (const shift of shifts) {
    const r = calcShiftPay(shift);
    totalGrossMinutes += r.grossMinutes;
    totalWorkedMinutes += r.workedMinutes;
    totalNightMinutes += r.paidNightMinutes;
    rawWageSum += r.pay;
  }

  const wageTotal = applyRounding(rawWageSum, rounding);

  const uniqueDays = options.workDates
    ? new Set(options.workDates).size
    : 0;
  const transportTotal = (options.transportPerDay ?? 0) * uniqueDays;

  return {
    totalGrossMinutes,
    totalWorkedMinutes,
    totalNightMinutes,
    wageTotal,
    transportTotal,
    workDays: uniqueDays,
    grandTotal: wageTotal + transportTotal,
  };
}

/** UI 事前チェック用。問題があればメッセージ配列を返す（空なら妥当）。 */
export function validateShift(shift: {
  start: string;
  end: string;
  breakMinutes?: number;
}): string[] {
  const errors: string[] = [];
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = parseTimeToMinutes(shift.start);
  } catch {
    errors.push("開始時刻の形式が不正です。");
  }
  try {
    end = parseTimeToMinutes(shift.end);
  } catch {
    errors.push("終了時刻の形式が不正です。");
  }
  if (start !== null && end !== null) {
    const grossMinutes =
      end < start ? end + MINUTES_PER_DAY - start : end - start;
    if (grossMinutes <= 0) {
      errors.push("勤務時間が0分です。開始と終了が同じか、入力を確認してください。");
    }
    const brk = shift.breakMinutes ?? 0;
    if (brk < 0) errors.push("休憩時間が負の値です。");
    if (brk > grossMinutes) {
      errors.push("休憩時間が勤務時間を超えています。");
    }
  }
  return errors;
}
