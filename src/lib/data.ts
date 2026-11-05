/**
 * data.ts — Supabase へのデータアクセス層。
 * RLS があるので明示的な user_id 絞り込みは必須ではないが、insert 時は user_id を必ず付ける。
 * 全て getSupabase() 経由。UI からはこの層だけを呼ぶ。
 */
import { getSupabase } from "./supabase";
import type {
  SettingsRow,
  JobRow,
  ShiftRow,
  ExpenseRow,
} from "./database.types";
import type { ShiftInput } from "./payroll";

/** 現在ログイン中ユーザーの id を返す（未ログインなら null）。 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

// ---------- settings ----------
export async function getSettings(): Promise<SettingsRow | null> {
  const { data, error } = await getSupabase()
    .from("settings")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data as SettingsRow | null;
}

export async function updateSettings(
  patch: Partial<Omit<SettingsRow, "user_id" | "updated_at">>,
): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new Error("未ログインです。");
  const { error } = await getSupabase()
    .from("settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", uid);
  if (error) throw error;
}

// ---------- jobs ----------
export async function listJobs(): Promise<JobRow[]> {
  const { data, error } = await getSupabase()
    .from("jobs")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

export async function updateJob(
  id: string,
  patch: Partial<Omit<JobRow, "id" | "user_id" | "created_at">>,
): Promise<void> {
  const { error } = await getSupabase().from("jobs").update(patch).eq("id", id);
  if (error) throw error;
}

export async function createJob(
  input: Pick<JobRow, "name"> &
    Partial<Pick<JobRow, "hourly_wage" | "night_rate" | "transport_per_day" | "closing_day" | "sort_order">>,
): Promise<JobRow> {
  const uid = await currentUserId();
  if (!uid) throw new Error("未ログインです。");
  const { data, error } = await getSupabase()
    .from("jobs")
    .insert({ ...input, user_id: uid })
    .select("*")
    .single();
  if (error) throw error;
  return data as JobRow;
}

// ---------- shifts ----------
export async function listShiftsInRange(
  startISO: string,
  endISO: string,
): Promise<ShiftRow[]> {
  const { data, error } = await getSupabase()
    .from("shifts")
    .select("*")
    .gte("work_date", startISO)
    .lte("work_date", endISO)
    .order("work_date", { ascending: false })
    .order("start_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShiftRow[];
}

export type ShiftDraft = {
  job_id: string | null;
  work_date: string;
  start_at: string;
  end_at: string;
  break_minutes: number;
  wage_override: number | null;
  is_confirmed: boolean;
  memo: string | null;
};

export async function createShift(draft: ShiftDraft): Promise<ShiftRow> {
  const uid = await currentUserId();
  if (!uid) throw new Error("未ログインです。");
  const { data, error } = await getSupabase()
    .from("shifts")
    .insert({ ...draft, user_id: uid })
    .select("*")
    .single();
  if (error) throw error;
  return data as ShiftRow;
}

export async function updateShift(
  id: string,
  patch: Partial<ShiftDraft>,
): Promise<void> {
  const { error } = await getSupabase().from("shifts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await getSupabase().from("shifts").delete().eq("id", id);
  if (error) throw error;
}

// ---------- expenses ----------
export async function listExpensesInRange(
  startISO: string,
  endISO: string,
): Promise<ExpenseRow[]> {
  const { data, error } = await getSupabase()
    .from("expenses")
    .select("*")
    .gte("spent_on", startISO)
    .lte("spent_on", endISO)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ExpenseRow[];
}

export type ExpenseDraft = {
  spent_on: string;
  amount: number;
  category: string;
  store: string | null;
  pay_method: string | null;
  memo: string | null;
  source: ExpenseRow["source"];
};

export async function createExpense(draft: ExpenseDraft): Promise<ExpenseRow> {
  const uid = await currentUserId();
  if (!uid) throw new Error("未ログインです。");
  const { data, error } = await getSupabase()
    .from("expenses")
    .insert({ ...draft, user_id: uid })
    .select("*")
    .single();
  if (error) throw error;
  return data as ExpenseRow;
}

export async function updateExpense(
  id: string,
  patch: Partial<ExpenseDraft>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("expenses")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await getSupabase().from("expenses").delete().eq("id", id);
  if (error) throw error;
}

/** CSV インポート等で複数の支出を一括登録する。 */
export async function createExpensesBulk(drafts: ExpenseDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const uid = await currentUserId();
  if (!uid) throw new Error("未ログインです。");
  const rows = drafts.map((d) => ({ ...d, user_id: uid }));
  const { data, error } = await getSupabase()
    .from("expenses")
    .insert(rows)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ---------- 変換ヘルパ ----------
/**
 * ShiftRow を payroll.ts の ShiftInput に変換する。
 * 実効時給 = wage_override ?? その job の hourly_wage。job 未設定なら fallbackWage。
 */
export function toShiftInput(
  row: ShiftRow,
  jobsById: Map<string, JobRow>,
  fallbackWage: number,
): ShiftInput {
  const job = row.job_id ? jobsById.get(row.job_id) : undefined;
  return {
    start: row.start_at,
    end: row.end_at,
    breakMinutes: row.break_minutes,
    hourlyWage: row.wage_override ?? job?.hourly_wage ?? fallbackWage,
    nightRate: job?.night_rate ?? 1.25,
  };
}
