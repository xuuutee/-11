# PaperPure v3 部署指南

## 架构
- **前端 + Functions**：Netlify
- **数据库**：Supabase（卡密、配置、API Key、日志）

---

## 第一步：创建 Supabase 数据库

1. 注册/登录 [supabase.com](https://supabase.com)
2. 新建项目（记住数据库密码）
3. 进入项目 → 左侧 **SQL Editor** → 点 **New query**
4. 把 `supabase_setup.sql` 里的内容全部粘贴进去，点 **Run**
5. 看到 "Success" 即完成

### 获取 Supabase 密钥
- 进入项目 → **Project Settings** → **API**
- 复制 `Project URL` → 这是 `SUPABASE_URL`
- 复制 `service_role` 下的 secret key → 这是 `SUPABASE_SERVICE_KEY`
  （注意是 service_role，不是 anon key）

---

## 第二步：部署到 Netlify

1. 解压 `paperpure_v3.zip` 得到 `paperpure3` 文件夹
2. 登录 [app.netlify.com](https://app.netlify.com)
3. 把 `paperpure3` 文件夹**直接拖拽**到 Netlify 部署区域

### 配置环境变量
部署完成后，进入 **Project configuration → Environment variables**，添加：

| Key                    | Value                        |
|------------------------|------------------------------|
| `SUPABASE_URL`         | 你的 Supabase Project URL    |
| `SUPABASE_SERVICE_KEY` | 你的 service_role secret key |
| `ADMIN_SECRET`         | 随机字符串（如：abc123xyz456）|

添加完环境变量后，**重新部署一次**（Deploys → Trigger deploy）。

---

## 第三步：初始化管理员账号

默认账号：
- 用户名：`admin`
- 密码：`admin123`

**登录后台后立即修改密码！**
- 访问：`你的域名/admin/`
- 登录后进入 **账号安全** 修改密码

---

## 第四步：配置 Kimi API Key

1. 登录管理后台 → **网站配置**
2. 在 "Kimi API Key" 输入框输入你的 API Key（以 `sk-` 开头）
3. 点 **保存**
4. 状态变为绿色 ✅ 即成功

API Key 存储在 Supabase 数据库，**永久有效，不会因为 Netlify 冷启动丢失**。

---

## 环境变量汇总

| 变量名                 | 说明                                    | 必填 |
|------------------------|-----------------------------------------|------|
| `SUPABASE_URL`         | Supabase 项目 URL                       | ✅   |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key               | ✅   |
| `ADMIN_SECRET`         | Token 签名密钥（任意随机字符串）         | 推荐 |
| `ADMIN_USER`           | 管理员用户名（默认 admin）               | 可选 |
| `ADMIN_PASS`           | 管理员密码（优先于数据库配置）           | 可选 |
