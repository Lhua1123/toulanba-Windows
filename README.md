# 投篮吧 · 海边球场（Windows）

把 Windows 桌面变成一块海边篮球场。选中桌面上的文件，揉成纸团，瞄准、蓄力、投篮；可以把纸团拆开放回桌面，也可以撤销上一次投掷。

## 直接使用

绿色版不需要安装 .NET、WebView2 或其他依赖：

1. 下载并解压 `BeachCourt-Windows-x64.zip`
2. 双击 `BeachCourt.exe`
3. 允许程序读取桌面文件后开始使用

`Ctrl+Alt+X` 不删除文件；揉纸团时文件暂时放在桌面隐藏目录 `.beach-court`，拆开、退出或异常恢复时自动放回桌面。`Ctrl+Alt+D` 投进后会把文件移入回收站，可以从回收站恢复。

## 操作

| 操作 | 功能 |
|---|---|
| `Ctrl+Alt+X` | 把桌面上选中的文件揉成纸团，投进后回到桌面 |
| `Ctrl+Alt+D` | 把桌面上选中的文件揉成纸团，投进后移入回收站 |
| `Ctrl+Alt+Z` | 撤销/拆开最近一个纸团，可连续按 |
| `Ctrl+Alt+T` | 循环切换时段；第一次手动切换会跳过当前自动场景 |
| `Ctrl+Alt+Q` | 安全退出 |
| 移动鼠标 | 瞄准 |
| 按住/松开 `空格` | 蓄力/投篮 |
| `←` / `→` | 微调投篮方向 |
| `Esc` | 取消蓄力或放下纸团 |
| 拖动纸团 | 换个位置再投 |
| 双击纸团 | 拆开并放回桌面 |

## 场景时间

- 启动后默认使用“跟随系统”，根据电脑时间自动选择早晨、正午、黄昏或夜晚。
- 自动模式大约每 30 秒检查一次时间，并在场景切换时平滑过渡。
- `Ctrl+Alt+T` 手动切换后，本次运行会一直保持手动场景；程序重启后恢复“跟随系统”。
- 双击托盘图标或点击记分牌打开菜单，从“时段”中选择“跟随系统”即可恢复自动模式。

## Windows 架构

- `web/`：跨平台 3D 球场、纸团物理、瞄准和记分牌
- `win/BeachCourt/`：Windows 桌面集成、文件暂存、桌面分层和输入桥
- `win/package-windows.ps1`：生成不依赖安装的 Windows x64 绿色包
- `docs/windows-port-plan.md`：Windows 移植设计和验收标准

沙滩背景画在桌面图标下面；篮筐、纸团、瞄准线和力度条在交互时绘制在上层，只在游戏需要时接收输入。

## 打包绿色版

Windows x64、.NET 8 SDK：

```powershell
powershell -ExecutionPolicy Bypass -File .\win\package-windows.ps1
```

输出：

- `dist/BeachCourt-Windows-x64/`：可直接运行的绿色目录
- `dist/BeachCourt-Windows-x64.zip`：可分发压缩包
- `dist/BeachCourt-Windows-x64.zip.sha256`：校验值

发布包已经包含：

- 自包含 .NET 8 Windows x64 运行时
- 固定版 WebView2 x64 运行时
- 游戏网页资源
- 中文使用说明

## 文件安全

- `Ctrl+Alt+X` 不删除用户文件；`Ctrl+Alt+D` 只移入回收站，不永久删除
- `Ctrl+Alt+X` 的文件只在桌面与 `.beach-court` 暂存目录之间移动；`Ctrl+Alt+D` 投进后进入回收站
- 正常退出和异常退出后都会尝试恢复暂存文件
- 配置、日志和撤销数据放在当前用户的 AppData 目录
