# 光的折射 · 在线实验数据采集网站（GitHub Pages 版）

这是一个**纯静态前端 + Supabase 云数据库**的网站。

- 学生：打开 GitHub Pages 网址即可提交真实实验的 `i, r` 数据，无需注册。
- 教师：打开 `teacher.html`，使用 Supabase 教师账号登录，查看/筛选/删除并下载 CSV。
- GitHub Pages 只负责托管网页；数据保存在 Supabase，不需要你自己运行服务器。

## 目录

- `index.html`：学生端
- `teacher.html`：教师端
- `styles.css`：样式
- `student.js`：学生提交逻辑
- `teacher.js`：教师管理逻辑
- `config.js`：填写 Supabase URL 和 anon key
- `supabase.sql`：数据库与权限初始化脚本
- `.nojekyll`：让 GitHub Pages 原样发布静态文件

## 第一步：创建 Supabase 项目

1. 打开 https://supabase.com 并新建一个 project。
2. 进入 **SQL Editor**，复制 `supabase.sql` 的全部内容并运行。
3. 进入 **Authentication -> Users**，新建一个教师账号（邮箱 + 密码）。
4. 新建完成后，复制该教师用户的 UUID。
5. 回到 SQL Editor，运行：

```sql
insert into public.teacher_allowlist(user_id)
values ('这里替换成教师用户UUID');
```

只有加入这个白名单的账号才能读取和删除学生数据。

## 第二步：填写网站配置

在 Supabase 项目的 **Project Settings / API**（或 Connect/API Keys 页面）找到：

- Project URL
- anon / publishable key

打开 `config.js`，替换：

```js
window.APP_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "你的 anon 或 publishable key"
};
```

**不要**把 `service_role` / secret key 放进 GitHub。

## 第三步：上传 GitHub

1. GitHub 新建仓库，例如：`refraction-data`。
2. 把本文件夹里的所有文件上传到仓库根目录。
3. 打开仓库 **Settings -> Pages**。
4. Source 选择 **Deploy from a branch**。
5. Branch 选择 `main`，目录选择 `/ (root)`，保存。
6. 等待 Pages 发布完成。

如果你的 GitHub 用户名是 `zhangsan`，仓库叫 `refraction-data`，通常网址会是：

`https://zhangsan.github.io/refraction-data/`

教师端：

`https://zhangsan.github.io/refraction-data/teacher.html`

## CSV 与分析平台衔接

教师端“下载分析平台 CSV”输出三列：

```csv
数据组,入射角i(°),折射角r(°)
高二3班-第1组-水,10,7.5
高二3班-第1组-水,20,14.9
```

可直接用于前面制作的“光的折射真实实验数据分析平台”。

## 安全说明

- 浏览器里的 `anon/publishable key` 本身就是给公开前端使用的；真正的数据权限由 RLS 控制。
- 学生端只有 INSERT 权限，没有 SELECT 权限，因此学生不能读取全班数据。
- 教师端读取/删除还会检查 `teacher_allowlist`，即使其他人注册了 Supabase 账号，也不能看到数据。
- 不要把 `service_role` 密钥提交到 GitHub。

## 可选优化

若以后公开范围很大，可再加：课堂邀请码、提交时间窗口、重复提交限制、验证码/Turnstile、按班级建立不同活动等。
