# dsh-bili-sessions

在 DSH 界面内列出、删除与清空 billion-context 的会话记录。

billion-context 的会话数据存在 `%USERPROFILE%\.local\share\billion-context\sessions\index.db`
（Windows；其他平台在 XDG 数据目录下），官方只提供 CLI 清理手段，而 CLI 在 agent 会话里会被
DSH 沙箱阻断（`spawn EPERM`）。本插件把清理入口搬进 Host 主进程——Host 不受 agent 沙箱约束。

## 功能

- 列出全部会话（标题、首句、大小、时间、块数、模型）
- 勾选删除单条会话
- 一键清空全部会话
- 默认保护正在使用的会话
- 标题与首句自动对 API key 打码

## 安装

**方式一：插件市场**（推荐）。在 DSH 的「插件 → 插件市场」里搜索 `dsh-bili-sessions` 安装。

**方式二：从源码装**

```bash
git clone https://github.com/lujyang007/dsh-bili-sessions.git
dsh plugin --profile desktop add ./dsh-bili-sessions
```

`--profile` 后面换成你实际使用的 profile 名（桌面端通常是 `desktop`）。

**方式三：在 DSH 里直接指向本地目录**

用 `plugin_manager` 的 `install_bundle`，target 填本仓库的本地路径。

包本身不发布到 npm。

## 使用

侧栏点「上下文缓存清理」，勾选后点「删除选中」（再点一次确认），
或点「清空全部」（同样两击确认）。

## 依赖

- 本机装有 `billion-context`（插件通过它的 CLI 释放引用计数，不自己改数据库）
- DSH >= 0.2.0

## 为什么不用手写 SQL 删

`index.db` 的 `content` 是带引用计数的内容寻址表，`blocks` / `refs` / `conversations`
互相持引用。手写 SQL 删要同步维护五张表的计数，算错一处就会让**别的会话丢内容**。
`bili sessions rm` 已经把这件事做对了（含 media refcount 释放与 vacuum），
所以本插件只负责调度它，不碰数据库。

## 许可

MIT
