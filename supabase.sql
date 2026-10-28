-- 在 Supabase Dashboard -> SQL Editor 中完整运行本文件。
-- 作用：创建学生提交表、教师白名单、RLS 权限。

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
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
    select 1 from public.teacher_allowlist t
    where t.user_id = auth.uid()
  );
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

-- 允许学生/访客提交，但不允许读取任何人的数据。
drop policy if exists "student insert" on public.submissions;
create policy "student insert"
on public.submissions
for insert
to anon, authenticated
with check (
  jsonb_typeof(measurements) = 'array'
  and jsonb_array_length(measurements) between 1 and 100
);

-- 只有 teacher_allowlist 中的账号可以查看和删除。
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

-- teacher_allowlist 本身不给浏览器直接读取权限。
