# dsh-session-delete

在 DSH（DeepSeek Harness）中彻底删除会话。入口位于侧栏会话行的 `...` 菜单，确认后永久删除；设置页另提供已归档会话的清点与批量删除。

## 功能

- 任意会话都能从 `...` 菜单彻底删除，不再要求先归档。
- 删除范围：会话 JSONL 日志目录、投影检查点、绑定到该会话的提醒、工作区排序槽位、归档集合与置顶集合中的条目。
- 共享附件按内容寻址、由全部会话共用，不属于单个会话，不会被删除。
- 正在使用中的会话（Host 进程内仍持有）会被拒绝，需要先切换到其他会话。
- 提供 Agent 工具 `delete_sessions`，`ids` 必填，与界面共用同一删除逻辑。
- 设置 → 归档会话：列出已归档会话的标题、路径、创建时间与日志大小，支持单个或全部彻底删除。

## 安装

要求 DSH Web 配置（桌面版或 `dsh web`）。插件为纯 JavaScript，不需要构建。

从本仓库安装：

```sh
dsh plugin --profile desktop add "git+ssh://git@github.com/AkiraLyu/dsh-plugins.git#path:/dsh-session-delete"
```

本地开发时可以直接安装目录：

```sh
dsh plugin --profile desktop add /path/to/dsh-plugins/dsh-session-delete
```

安装后插件在配置中启用。修改 Host 侧代码后，在插件管理中禁用再启用即可重新加载模块；Client 侧代码由页面热更新。

## 使用

1. 在侧栏找到会话，悬停后点击 `...`。
2. 选择「彻底删除」。
3. 在居中的确认框中确认。删除完成后会话从列表消失。

已归档会话默认隐藏，需要把侧栏筛选切到「全部会话（显示已归档）」或「仅已归档」才能看到，也可以直接在设置页的「归档会话」中处理。

## 安全边界

- 删除不可撤销，界面会先显示会话标题和删除范围。
- Host 进程内正在使用的会话会被拒绝，避免删除仍被持有的日志。
- HTTP 路由只接受本地同源页面的 `application/json` 请求，监听地址为本地回环。
- Agent 工具不提供默认批量目标，必须显式给出 `ids`。

## 文件结构

- `index.js`：Host 入口，HTTP 路由与 `delete_sessions` 工具。
- `purge.js`：删除实现，包括日志目录发现、缓存/提醒/工作区清理与删除后校验。
- `client.js`：侧栏菜单项、确认弹窗与设置页。
- `locale/`：插件管理显示用的标题与描述。
