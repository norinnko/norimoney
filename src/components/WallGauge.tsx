"use client";

import { yen } from "@/lib/format";

interface Props {
  /** 今年の累計収入（賃金）。 */
  current: number;
  /** 壁（円）。 */
  limit: number;
  /** 壁の名称（例: "税の扶養(136万)"）。 */
  wallName: string;
}

/** 年収の壁ゲージ。壁までの残り・超過を色で警告する。 */
export function WallGauge({ current, limit, wallName }: Props) {
  const ratio = limit > 0 ? current / limit : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const remaining = limit - current;
  const over = remaining < 0;

  const level = over ? "over" : ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warn" : "ok";
  const barColor = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    danger: "bg-orange-500",
    over: "bg-rose-600",
  }[level];
  const textColor = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-orange-600 dark:text-orange-400",
    over: "text-rose-600 dark:text-rose-400",
  }[level];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          年収の壁 <span className="text-slate-400">/ {wallName}</span>
        </h2>
        <span className={`text-sm font-bold ${textColor}`}>{pct}%</span>
      </div>

      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold tabular-nums">{yen(current)}</div>
          <div className="text-xs text-slate-400">壁: {yen(limit)}</div>
        </div>
        <div className="text-right">
          {over ? (
            <div className={`font-bold ${textColor}`}>
              {yen(-remaining)} 超過
            </div>
          ) : (
            <div className={`font-bold ${textColor}`}>
              あと {yen(remaining)}
            </div>
          )}
          {level === "danger" && !over && (
            <div className="text-xs text-orange-500">壁が近づいています</div>
          )}
        </div>
      </div>
    </section>
  );
}
