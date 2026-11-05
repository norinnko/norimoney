/** 表示用フォーマット関数。 */

/** 円表記（例: 123456 → "¥123,456"）。 */
export function yen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

/** 分 → "H時間M分"（例: 450 → "7時間30分"）。 */
export function hoursLabel(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** 分 → 小数時間（例: 450 → 7.5）。 */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** "YYYY-MM-DD" → "M/D(曜)"。 */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(y, m - 1, d).getDay()
  ];
  return `${m}/${d}(${wd})`;
}

/** "HH:MM:SS" or "HH:MM" → "HH:MM"。 */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}
