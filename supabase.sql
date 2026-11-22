-- 阿里云 Supabase：光的折射实验数据表与教师读取权限
-- 可在已有项目中重复执行。不会删除已有 submissions 记录。
-- 重要：学生端 student.js 会写入 request_id；此字段和唯一索引必须存在。

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  created_at timestamptz not null default now(),
  class_name text not null,
  group_name text not null,
  student_code text,
  medium text not null,
  note text,
  measurements jsonb not null,
  constraint measurements_is_array check (jsonb_typeof(measurements) = 'array'),
  constraint measurements_count check (jsonb_array_length(measurements) between 1 and 100),
  constraint class_len check (char_length(class_name) between 1 and 60),
  constraint group_len check (char_length(group_name) between 1 and 60),
  constraint medium_len check (char_length(medium) between 1 and 60)
);

-- 升级已存在的表：补 request_id；给历史数据生成独立编号。
alter table public.submissions
  add column if not exists request_id uuid;

update public.submissions
set request_id = gen_random_uuid()
where request_id is null;

alter table public.submissions
  alter column request_id set default gen_random_uuid();

alter table public.submissions
  alter column request_id set not null;

-- 学生端网络重试时复用 request_id，唯一索引防止重复入库。
create unique index if not exists submissions_request_id_uidx
  on public.submissions(request_id);

create table if not exists public.teacher_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.submissions enable row level security;
alter table public.teacher_allowlist enable row level security;

revoke all on table public.submissions from anon, authenticated;
revoke all on table public.teacher_allowlist from anon, authenticated;
grant insert on table public.submissions to anon, authenticated;
grant select, delete on table public.submissions to authenticated;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_allowlist t
    where t.user_id = auth.uid()
  );
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

drop policy if exists "student insert" on public.submissions;
create policy "student insert"
on public.submissions
for insert
to anon, authenticated
with check (
  jsonb_typeof(measurements) = 'array'
  and jsonb_array_length(measurements) between 1 and 100
);

drop policy if exists "teacher select" on public.submissions;
create policy "teacher select"
on public.submissions
for select
to authenticated
using ((select public.is_teacher()));

drop policy if exists "teacher delete" on public.submissions;
create policy "teacher delete"
on public.submissions
for delete
to authenticated
using ((select public.is_teacher()));

-- teacher_allowlist 不向浏览器开放直接读取/写入。
-- 教师账号加入白名单的操作见 ALIYUN_DATA_VISIBILITY_FIX.md。
