-- ============================================================================
-- norimoney スキーマ + RLS + トリガー
-- Supabase の SQL Editor にそのまま貼って実行する。
--
-- 設計方針:
--   - 金額は全て integer（円単位）。小数は税計算でバグるため使わない。
--   - 時刻は time で持ち、end_at < start_at なら日またぎと判定（payroll.ts と一致）。
--   - 年収の壁の閾値は年度で変わるため settings.wall_limit に設定値として持つ。
--   - 掛け持ちに備え jobs テーブルを用意。店ごとに時給/交通費/締め日を持てる。
--   - 認可は DB 層(RLS)に置く。アプリにバグがあっても Postgres が弾く。
-- ============================================================================

-- ============ 1. 設定（ユーザー全体で1行） ============
create table settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  wall_limit  integer  not null default 1360000,  -- 年収の壁(円)。初期値=2026年分 税扶養 136万。
  wall_kind   text     not null default 'tax_dependent', -- どのラインを選んだか（UI プリセット用）
  updated_at  timestamptz not null default now()
);

-- ============ 2. バイト先（掛け持ち対応） ============
create table jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null default 'メイン',
  hourly_wage       integer not null default 1100,       -- 基本時給
  night_rate        numeric(3,2) not null default 1.25,  -- 深夜割増率
  transport_per_day integer not null default 0,          -- 1日あたり交通費
  closing_day       smallint not null default 31,        -- 締め日(31=末日)
  is_active         boolean not null default true,
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  -- 複合FK(shifts→jobs)で「同一ユーザーの job しか参照できない」ことを保証するための一意制約。
  unique (id, user_id)
);
create index jobs_user_idx on jobs (user_id, sort_order);

-- ============ 3. シフト ============
create table shifts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  job_id        uuid,                    -- どのバイト先か。削除時は履歴を残すため null 化。
  work_date     date not null,
  start_at      time not null,
  end_at        time not null,           -- end < start なら日またぎ
  break_minutes integer not null default 0 check (break_minutes >= 0),
  wage_override integer,                 -- この日だけ時給が違う場合
  is_confirmed  boolean not null default false, -- 実績確定フラグ（見込み→実績）
  memo          text,
  created_at    timestamptz not null default now(),
  -- 複合FK: shifts.job_id は「同じ user_id が所有する job」しか指せない（越境参照をDBで拒否）。
  foreign key (job_id, user_id) references jobs (id, user_id) on delete set null
);
create index shifts_user_date_idx on shifts (user_id, work_date desc);

-- ============ 4. 支出 ============
create table expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  spent_on    date not null,
  amount      integer not null check (amount >= 0),
  category    text not null default 'other',
  store       text,
  pay_method  text,                      -- cash / paypay / rakuten ...
  source      text not null default 'manual'
              check (source in ('manual','ocr','csv')),
  memo        text,
  created_at  timestamptz not null default now()
);
create index expenses_user_date_idx on expenses (user_id, spent_on desc);

-- ============================================================================
-- RLS（必須）: using=読み取り制御 / with check=書き込み制御。両方書く。
-- ============================================================================
alter table settings enable row level security;
alter table jobs     enable row level security;
alter table shifts   enable row level security;
alter table expenses enable row level security;

create policy "own settings" on settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own jobs" on jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shifts" on shifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own expenses" on expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 新規ユーザーに settings 1行 + 既定の job 1件を自動生成する。
-- ============================================================================
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (user_id) values (new.id);
  insert into public.jobs (user_id, name) values (new.id, 'メイン');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- 適用後の検証（必ず実施）:
--   1. Table Editor で settings/jobs/shifts/expenses 全てに緑の "RLS enabled" が出ているか目視
--   2. アカウントを2つ作り、A でログイン中に B のデータが1件も見えないことを実測
-- ============================================================================
