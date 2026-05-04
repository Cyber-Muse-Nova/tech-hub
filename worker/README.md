# Tech Hub Worker 部署指南

这是一个套在前端和 GitHub API 之间的 Cloudflare Worker：

- GitHub Token 不再暴露在 HTML 里
- 管理员密码由服务端实际验证（不能再被绕过）
- 公开操作（上传、发帖、评论、留言）继续放开
- 删除/覆盖文件、编辑使用说明 — 强制需要管理员密码
- 公共 JSON 文件的"删除/篡改"在服务端再加一道审查（仅允许新增内容）

## 0. 先把 token 撤掉再生成新的

旧版 `index.html` 里硬编码的 token 已经在 git 历史里被全网索引过了，**强烈建议立刻去 GitHub 把那个 token 撤销**：

GitHub → Settings → Developer settings → Personal access tokens → 找到对应 token → Revoke

然后重新生成一个新的 PAT（fine-grained token），权限：
- Repository access：仅 `Cyber-Muse-Nova/tech-hub`
- Repository permissions → Contents：**Read and write**

把新 token 存到 Worker 的环境变量里（下面第 2 步）。**新 token 不要再放回 HTML。**

## 1. 创建 Worker

1. 登录 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create** → **Worker**
2. 起个名字（决定最终域名 `xxx.workers.dev`），点 **Deploy**（先随便部署一次）
3. 进入这个 Worker → **Edit code** → 把 `worker/index.js` 整个文件内容粘贴进去 → **Save and Deploy**

## 2. 设置环境变量

进入 Worker → **Settings** → **Variables and Secrets**，添加：

| 名字 | 类型 | 值 |
|---|---|---|
| `GITHUB_TOKEN` | **Secret** | 刚刚新生成的 PAT，例如 `github_pat_xxx...` |
| `GITHUB_OWNER` | Text | `Cyber-Muse-Nova` |
| `GITHUB_REPO` | Text | `tech-hub` |
| `ADMIN_PASSWORD_HASH` | Text | 管理员密码的 SHA-256 hex（与 `index.html` 中 `ADMIN_HASH` 同值） |
| `ALLOWED_ORIGIN` | Text | 你的 Pages 域名，比如 `https://tech-hub.pages.dev`；本地调试可以先填 `*` |

> `GITHUB_TOKEN` 一定要选 **Secret**（加密、不可读取）。其它可以用 Text。

保存后再点一次 **Deploy** 让变量生效。

## 3. 把 Worker URL 填进前端

部署完成后顶部会显示 Worker 地址，形如 `https://tech-hub-worker.your-name.workers.dev`。

打开 `index.html`，找到顶部 `WORKER_URL` 常量：

```js
const WORKER_URL = 'https://CHANGE-ME.workers.dev';
```

替换成你的真实 Worker 地址，提交 push。Cloudflare Pages 会自动重新部署前端。

## 4. 验证

部署好之后到你的 `xxx.pages.dev` 站点：

- ✅ 上传文件 / 批量发帖 / 评论 / 留言：正常工作
- ✅ 输入正确管理员密码删除：成功
- ✅ 输入错误密码删除：返回 "需要管理员密码" 错误
- ✅ 浏览器 DevTools → Network：所有请求都打到 Worker，**没有任何 GitHub Token 出现**
- ✅ DevTools → Sources 搜 `ghp_` / `github_pat_`：搜不到任何 token

## 重新生成管理员密码

1. 浏览器 console 跑：
   ```js
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('你的新密码'))
     .then(h => console.log([...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')))
   ```
2. 把输出的 hex 字符串同步更新到：
   - Worker 的 `ADMIN_PASSWORD_HASH` 变量
   - `index.html` 中 `ADMIN_HASH` 常量

两边都要改，因为前端做了一次 fail-fast 检查（密码错误时不发请求），Worker 是真正的防线。

## 免费额度

Cloudflare Workers 免费套餐：
- 10 万次请求 / 天
- 每次请求 10ms CPU
- 对一个小型资源站完全够用

## 常见错误

**`401 需要管理员密码`** — 密码不对，或 `ADMIN_PASSWORD_HASH` 没设置 / 设置错了
**`403 路径未授权`** — 前端尝试写入了 Worker 白名单之外的路径，正常用户不会触发
**`401 修改未通过审核`** — 试图删除 / 修改公共 JSON 但没带管理员密码（正确行为）
**CORS 错误** — `ALLOWED_ORIGIN` 没填对，改成你的实际 Pages 域名或 `*`
