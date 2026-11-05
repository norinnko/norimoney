/**
 * database.types.ts — Supabase スキーマに対応する手書き型。
 * schema.sql を変更したらここも更新する（将来 supabase gen types に置き換えても良い）。
 */

export interface SettingsRow {
  user_id: string;
  wall_limit: number;
  wall_kind: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  user_id: string;
  name: string;
  hourly_wage: number;
  night_rate: number;
  transport_per_day: number;
  closing_day: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface ShiftRow {
  id: string;
  user_id: string;
  job_id: string | null;
  work_date: string; // "YYYY-MM-DD"
  start_at: string; // "HH:MM:SS"
  end_at: string; // "HH:MM:SS"
  break_minutes: number;
  wage_override: number | null;
  is_confirmed: boolean;
  memo: string | null;
  created_at: string;
}

export type ExpenseSource = "manual" | "ocr" | "csv";

export interface ExpenseRow {
  id: string;
  user_id: string;
  spent_on: string; // "YYYY-MM-DD"
  amount: number;
  category: string;
  store: string | null;
  pay_method: string | null;
  source: ExpenseSource;
  memo: string | null;
  created_at: string;
}
