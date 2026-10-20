# dsh-plugins

DSH（DeepSeek Harness）插件集合。

## 插件列表

| 目录 | 说明 |
| --- | --- |
| [`dsh-session-delete`](dsh-session-delete) | 从侧栏 `...` 菜单彻底删除任意会话，并在设置页管理已归档会话。 |

## 安装

每个插件目录都是独立的 DSH bundle，可以单独安装：

```sh
dsh plugin --profile <profile> add "git+ssh://git@github.com/AkiraLyu/dsh-plugins.git#path:/<插件目录>"
```

将 `<插件目录>` 替换为上表中的目录名，`<profile>` 替换为目标 DSH 配置。安装方式与使用说明以各插件目录的 README 为准。
