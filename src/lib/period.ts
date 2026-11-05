/**
 * period.ts — 締め日ベースの給与期間・年（税年）の範囲を計算する純粋関数。
 *
 * すべて "YYYY-MM-DD"（ローカル日付）で扱い、Date のタイムゾーン揺れを避ける。
 * 締め日 closingDay:
 *   - 31（または月末を超える値）= 末締め。期間は暦月と一致。
 *   - D(1..30) = D 日締め。期間は「前月 D+1 〜 当月 D」。ref がどの期間に入るかで前後する。
 *   - 短い月で D が存在しない場合（例: 2月30日締め）は月末にクランプ。
 */

export interface DateParts {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

export interface DateRange {
  /** 期間開始日 "YYYY-MM-DD"（含む） */
  start: string;
  /** 期間終了日 "YYYY-MM-DD"（含む） */
  end: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" を組み立てる。 */
export function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** "YYYY-MM-DD" をパースする。 */
export function parseISO(s: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`日付の形式が不正です: "${s}"`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** その年月の日数（month は 1..12）。 */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** day をその月に存在する範囲へクランプ（例: 2月の 31 → 28/29）。 */
function clampDay(y: number, m: number, day: number): number {
  return Math.min(day, daysInMonth(y, m));
}

/** 月を加算した {y, m} を返す（m は 1..12）。 */
function addMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const zero = y * 12 + (m - 1) + delta;
  return { y: Math.floor(zero / 12), m: (zero % 12) + 1 };
}

/** 末締め（暦月）扱いにするか。 */
function isMonthEndClosing(closingDay: number): boolean {
  return closingDay >= 31;
}

/**
 * ref が属する給与期間の範囲を返す。
 * 末締めなら ref の暦月。D 日締めなら ref を含む「前月 D+1 〜 当月 D」。
 */
export function payPeriodFor(closingDay: number, refISO: string): DateRange {
  const ref = parseISO(refISO);

  if (isMonthEndClosing(closingDay)) {
    return {
      start: iso(ref.y, ref.m, 1),
      end: iso(ref.y, ref.m, daysInMonth(ref.y, ref.m)),
    };
  }

  // D 日締め: ref.d <= 締め日 なら当月が期間の終わり、そうでなければ翌月が終わり。
  const endMonth =
    ref.d <= clampDay(ref.y, ref.m, closingDay)
      ? { y: ref.y, m: ref.m }
      : addMonth(ref.y, ref.m, 1);
  const startMonthBase = addMonth(endMonth.y, endMonth.m, -1);

  const endDay = clampDay(endMonth.y, endMonth.m, closingDay);
  const startDay = clampDay(startMonthBase.y, startMonthBase.m, closingDay) + 1;
  // startDay が前月の日数+1 になった場合（月末締め相当）は翌日=当月1日へ繰り上げ。
  if (startDay > daysInMonth(startMonthBase.y, startMonthBase.m)) {
    return {
      start: iso(endMonth.y, endMonth.m, 1),
      end: iso(endMonth.y, endMonth.m, endDay),
    };
  }
  return {
    start: iso(startMonthBase.y, startMonthBase.m, startDay),
    end: iso(endMonth.y, endMonth.m, endDay),
  };
}

/**
 * 給与期間のラベル。「その期間の終了日が属する月」を代表月とする。
 * 例: 15日締めで 6/16〜7/15 の期間 → "2026年7月分"。
 */
export function payPeriodLabel(range: DateRange): string {
  const end = parseISO(range.end);
  return `${end.y}年${end.m}月分`;
}

/** 前/次の給与期間へ移動するための、隣接期間の基準日（終了日の翌日/開始日の前日）。 */
export function shiftPeriod(
  closingDay: number,
  range: DateRange,
  direction: 1 | -1,
): DateRange {
  const anchor = direction === 1 ? range.end : range.start;
  const a = parseISO(anchor);
  // 終了日の翌日 or 開始日の前日を Date 計算で安全に求める。
  const dt = new Date(a.y, a.m - 1, a.d + direction);
  const nextISO = iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return payPeriodFor(closingDay, nextISO);
}

/** 税年（暦年）の範囲。年収の壁は 1/1〜12/31 の累計で見る。 */
export function taxYearRange(year: number): DateRange {
  return { start: iso(year, 1, 1), end: iso(year, 12, 31) };
}

/** date が [start, end]（含む）に入るか。文字列比較で判定できる（ISO 8601 の辞書順）。 */
export function isWithin(dateISO: string, range: DateRange): boolean {
  return dateISO >= range.start && dateISO <= range.end;
}
