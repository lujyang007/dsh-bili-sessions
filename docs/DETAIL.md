# billion-context 会话清理（dsh-bili-sessions）

## 为什么需要它

billion-context 把每个 DSH 会话的请求、响应、压缩块存在
`%USERPROFILE%\.local\share\billion-context\sessions\index.db` 里，越攒越大。
官方只给了 CLI（`bili sessions rm`），而 CLI 在 agent 会话里跑不起来 ——
DSH 沙箱会切断子进程的 stdio 管道（`spawn EPERM`），也禁止写工作区外的
`C:\Users\...`。所以清理这件事在界面上根本做不到。

这个插件把 CLI 搬到 Host 主进程里跑。Host 不受 agent 沙箱约束，子进程直接
继承宿主权限，于是删除操作可以在 DSH 界面内一键完成。

## 能做什么

侧栏「会话清理」面板：

- **列出全部会话**：标题、首句摘要、占用空间、最后更新时间、块数、模型
- **勾选单条删除**：二次确认后才真正执行
- **一键清空全部**：同样是二次确认
- **保护正在使用的会话**（默认开启）：当前正在对话的那个会话不会被删。
  关掉这个开关才会把它也列入。

标题取 `host_title`（DSH 生成的短标题），其次代理的 `title`，
再次数据库里的首句。三级都拿不到时显示短 ID。

## 怎么用

1. 侧栏点「会话清理」
2. 勾选要删的会话（或直接点「清空全部」）
3. 按钮会变成「确认删除 N 个」——再点一次才执行
4. 删除走官方 `bili sessions rm`，会正确释放 content 引用计数并收缩数据库

确认态 8 秒后自动解除，改动勾选也会解除。避免点了一次走开、回来误点一下就删。

## 实现方式

不自己改 SQLite。`index.db` 的 `content` 是带 refcount 的内容寻址表，
`blocks` / `refs` / `conversations` 各自持有引用 —— 手写 SQL 删必须同时维护
五张表的引用计数，算错一处就会让别的会话丢内容。`bili sessions rm` 已经把
这件事做对了（含 media refcount 释放与 vacuum），插件只负责调度它。

两条数据来源合并：

- `bili sessions ls --json` —— 权威的容量与存储状态
- `GET /__bili/sessions` —— 标题与 `live` 标记（CLI 的 ls 没有这些）
- `index.db` 的 `sessions` 表（只读）—— `host_title` 兜底

## 安全处理

会话首句常常就是用户粘进来的 API key。「接入 Agnes 3.0 Flash 模型」那条
的原始首句就是一把真实密钥。所以标题与首句在返回前统一过一遍打码：

- `sk-` / `ghp_` / `xoxb-` / `hf_` 等常见前缀 → 保留头 6 尾 4
- 32 位以上无分隔随机串 → 同上
- `key=value` 形态 → `keyName=***`

## 限制

- 依赖本机装有 billion-context。没装时面板会明说 CLI 找不到。
- 删除正在使用的会话前应先关掉那个会话，否则代理可能把内容写回去。
- 这是破坏性操作，没有回收站。删了就没了，`--vacuum` 之后无法恢复。
