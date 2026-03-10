-- PaperPure v3 Supabase 初始化 SQL
-- 在 Supabase 控制台 SQL Editor 里执行这段脚本

-- 1. 卡密表
create table if not exists cards (
  card_key      text primary key,
  remaining_times integer not null default 10,
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

-- 2. 配置表（key-value）
create table if not exists config (
  key   text primary key,
  value text not null default ''
);

-- 3. 使用日志
create table if not exists logs (
  id         bigserial primary key,
  card_key   text,
  char_count integer,
  ip         text,
  type       text default 'card',
  created_at timestamptz not null default now()
);

-- 4. IP 免费次数
create table if not exists ip_usage (
  ip    text primary key,
  count integer not null default 0
);

-- 5. 关闭 RLS（使用 service_role key，无需 RLS）
alter table cards    disable row level security;
alter table config   disable row level security;
alter table logs     disable row level security;
alter table ip_usage disable row level security;

-- 6. 插入默认配置
insert into config (key, value) values
  ('free_enabled',  'true'),
  ('free_limit',    '1'),
  ('notice',        ''),
  ('kimi_api_key',  ''),
  ('admin_user',    'admin'),
  ('admin_password','admin123')
on conflict (key) do nothing;
