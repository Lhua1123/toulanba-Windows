# 「投篮吧 · 海边球场」Windows 移植方案

> 状态：**待实施** · 编写于 2026-10-15
> 工作副本：`D:\01.Lwq\01.Lwq\toulanba-Windows`
> 用法：从上往下按「第 6 节 · 分阶段实施」做，每阶段有验收标准，达标再进下一阶段。

---

## 0. 目标与验收标准

### 目标

把 Mac 版「海边球场」搬到 Windows 10/11：桌面上框选文件 → 揉成纸团 → 移动指针瞄准 → 按住空格蓄力 → 松手投篮 → 进了就把文件收进「篮筐」文件夹，`Ctrl+Alt+Z` 可放回原图标位置。

### 验收标准（A1–A8 全部满足即视为完成）

| # | 标准 | 验证方式 |
|---|---|---|
| A1 | 桌面框选若干文件，按 `Ctrl+Alt+X`，它们被揉成纸团浮到手上 | 手工 |
| A2 | 纸团可拖动、指针瞄准、按住空格出蓄力弧线、松手投篮，进/不进手感接近 Mac 版 | 手工对比 |
| A3 | 进球后文件移到 `文档\篮筐\<日期>\`，桌面上消失 | 看文件夹 |
| A4 | `Ctrl+Alt+Z` 能把进球文件放回桌面**原图标位置** | 手工，连续撤销多次 |
| A5 | 沙滩/海/球场画在**桌面图标下面**，图标仍可点选、可框选 | 手工（最难一项） |
| A6 | 纸团、篮板、记分牌画在图标**上面**；只在这些区域吃鼠标，图标下仍可点击 | 手工 |
| A7 | 强杀进程后重启，暂存文件自动放回桌面 | 任务管理器结束进程 |
| A8 | 全程**不删除任何文件** | 代码走查 + 手工 |

---

## 1. 现状盘点

| 目录 | 内容 | 行数 | Windows 要做什么 |
|---|---|---|---|
| `web/` | 3D 球场、纸团物理、瞄准蓄力、记分牌、时段（three.js） | 约 2200 行自研 | **不改**（或只加一个 5 行 shim，见 5.2） |
| `mac/BeachCourt.swift` | 系统集成壳 | 880 | **全部重写** |
| `mac/build.sh` `Info.plist` | Mac 打包 | 40 | 由 Windows 打包替代 |
| `web/js/desktop.js` | 浏览器里的模拟桌面 | 287 | **保留**，阶段 1 直接用它开发和验收 |

**结论**：游戏本体已经跨平台，移植 = 重写系统集成壳。这是整个项目的好消息，也是工作量估计的基础。

### 1.1 Mac 壳到底干了什么

1. **两层窗口**：`court`（沙滩海球场）压在访达图标**下面一层**；`overlay`（篮板、纸团）压在图标**上面一层**，且默认不吃鼠标，只在命中区域内吃。
2. **读访达选中项**（AppleScript）→ 拿到文件路径 + 图标在桌面上的坐标。
3. **搬文件**：暂存到 `~/Desktop/.beach-court/`；进球后移到 `~/Documents/篮筐/<日期>/`；用 AppleScript 放回并还原图标位置。
4. **缩略图**：QuickLookThumbnailing 生成 PNG data URL 交给 JS 画假图标。
5. **全局热键**：⌃⌥X 揉纸团、⌃⌥Z 撤销；CGEventTap 听双指捏合。
6. **托盘菜单**：时段切换、放回、清零、退出。
7. **跑 web/**：WKWebView 加载 `web/index.html?layer=back|front`，双向消息桥。

---

## 2. 技术选型

**推荐：C# (.NET 8) + WinForms + WebView2**

理由：本项目 Windows 侧的难点全在 COM/PInvoke 桌面集成（读 Explorer 选中、摆图标位置、WorkerW 分层），.NET 的 COM interop 和 P/Invoke 最顺手；WinForms 直接持有 HWND，做分层/穿透比 WPF 省事（WPF 的 `AllowsTransparency` 大窗口性能差）；WebView2 是微软一等公民的 Chromium 控件。

备选（如你更熟别的栈，可以换，不影响方案其余部分）：

| 方案 | 优点 | 代价 |
|---|---|---|
| Tauri v2 (Rust) | 体积小（约 10MB） | COM interop 要写不少 unsafe |
| Electron | 出原型最快 | 体积约 150MB；分层穿透靠 `setIgnoreMouseEvents` |
| Python + pywebview | 脚本化快 | 打包、COM 互操作都别扭 |

**运行时依赖**：WebView2 Evergreen Runtime（Win11 自带，Win10 大多已装；缺失时安装包里带 `MicrosoftEdgeWebView2RuntimeInstaller.exe`）。

---

## 3. 目录结构

```
toulanba-Windows/
├── mac/                    # 原样保留，作为行为参照，不改
├── web/                    # 游戏本体，基本不动
├── docs/
│   ├── windows-port-plan.md   # 本文档
│   └── *.jpg                  # 原有截图
└── win/                    # ★ 新增
    ├── BeachCourt.sln
    └── BeachCourt/
        ├── BeachCourt.csproj
        ├── Program.cs          # 入口、单实例、崩溃钩子
        ├── App.cs              # 主控：对应 Swift 的 App 类，消息分发 + 状态机
        ├── Paths.cs            # 路径（含 BEACH_HOME 覆盖）
        ├── ShotLog.cs          # shots.json / stats.json
        ├── ShellBridge.cs      # WebView2 封装 + JS 桥
        ├── DesktopLayer.cs     # ★ WorkerW 分层（最大难点）
        ├── Explorer.cs         # COM 读选中项 / 摆图标位置
        ├── Thumbnails.cs       # IShellItemImageFactory
        ├── HotKey.cs           # RegisterHotKey
        ├── Tray.cs             # 托盘 + 菜单
        └── Native.cs           # P/Invoke 声明
```

---

## 4. 架构

### 4.1 窗口模型（照搬 Mac 的两层设计）

```
屏幕 Z 序（从底到顶）
  壁纸
  ┌─ court 层（back）  沙滩/海/球场/棕榈/记分牌底座   ← SetParent 到 WorkerW，画在图标下面
  桌面图标（SysListView32）
  ┌─ overlay 层（front）篮板/篮筐/纸团/假图标/命中区  ← WS_EX_LAYERED|TRANSPARENT 置顶
  普通应用窗口
  ┌─ 任务栏 / 托盘
```

两层各是一个 WebView2 控件，加载同一个 `index.html`，靠 `?layer=back` / `?layer=front` 区分渲染内容（`web/index.html` 已内建这套 CSS 分流，无需改）。

### 4.2 状态机（在 `App.cs`）

```
idle ──Ctrl+Alt+X──▶ staging(搬文件) ──covered──▶ crumpled(纸团在手)
                                                      │ 空格蓄力 / 松手
                                                      ▼
                                              in-flight ──banked──▶ scored(文件进篮筐)
                                                      │
                                                      └─unpack──▶ idle(文件回桌面)
```

`shots.json` 记录每次 `scored` 的文件与原坐标，供 `Ctrl+Alt+Z` 回滚。

### 4.3 文件安全模型（照搬，100% 可移植）

| 动作 | 文件去向 | 可逆性 |
|---|---|---|
| 揉纸团 | `桌面\.beach-court\<name>`（隐藏） | 双击纸团 / Ctrl+Alt+Z / 退出时放回 |
| 进球 | `文档\篮筐\<yyyy-MM-dd>\<name>` | Ctrl+Alt+Z 按 shots.json 放回原位 |
| 崩溃 | 留在 `.beach-court` | **下次启动自动放回桌面** |

`shots.json` / `stats.json` 放 `%APPDATA%\BeachCourt\`；日志放 `%LOCALAPPDATA%\BeachCourt\BeachCourt.log`。

---

## 5. 关键设计点

### 5.1 桌面分层 ★ 唯一有真实技术风险的部分

**目标**：`court` 层画在桌面图标**下面**。

**做法**（Wallpaper Engine / Lively Wallpaper 同款）：

```csharp
// DesktopLayer.cs
[DllImport("user32.dll", SetLastError = true)]
static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

[DllImport("user32.dll")]
static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam,
    uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

[DllImport("user32.dll")]
static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

[DllImport("user32.dll", SetLastError = true)]
static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

// 1) 让 Progman 分裂出承载壁纸的 WorkerW
SendMessageTimeout(FindWindow("Progman", null), 0x052C, IntPtr.Zero, IntPtr.Zero, 0x0, 1000, out _);

// 2) 枚举顶层窗口，找到承载壁纸的那个 WorkerW
//    判据：带 SHELLDLL_DefView 的是图标层（Progman 或某个 WorkerW），
//          它旁边那个不带 SHELLDLL_DefView 的 WorkerW 就是壁纸层
//    实践上常见写法是找「带 SHELLDLL_DefView 的窗口的下一个 WorkerW」
IntPtr workerW = FindWorkerWBehindIcons();

// 3) 把 court 窗口挂上去
SetParent(courtHwnd, workerW);
```

**必须先做的验证（阶段 3 第一步）**：写一个 10 行的最小窗口，只画一块红色，确认能挂到图标下面。Win10 与 Win11 22H2+ 的 WorkerW 行为不同，**先验通再写别的**。

**overlay 层**（图标上面、选择性吃鼠标）：

```csharp
// 置顶 + 分层 + 默认穿透
var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
SetWindowLong(hwnd, GWL_EXSTYLE, ex);
SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, w, h, SWP_NOACTIVATE);

// JS 通过 hit 消息报告命中区后：指针在命中区内 → 摘掉 WS_EX_TRANSPARENT 开始吃鼠标
void UpdateMousePassThrough(bool wantMouse)
{
    var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
    ex = wantMouse ? (ex & ~WS_EX_TRANSPARENT) : (ex | WS_EX_TRANSPARENT);
    SetWindowLong(hwnd, GWL_EXSTYLE, ex);
}
```

**注意**：WebView2 内部有自己的输入处理，穿透状态下鼠标事件不会进到浏览器；所以 Mac 那套「原生转发指针给 JS」的设计在 Windows 上同样必要（见 5.2 的 `court.pointer`）。

**回退方案**（若 WorkerW 在目标系统上不可靠）：两层都做成置顶层，`court` 层接受「盖住部分图标」的观感损失。代码结构不用改，只换 `DesktopLayer.Attach()` 的实现。

### 5.2 JS ↔ 原生 桥

**好消息：协议已经定义好，照着实现即可。**

Mac 用 `window.webkit.messageHandlers.court`；WebView2 用 `window.chrome.webview`。**不改 web/ 代码**，从原生注入一个 shim（`AddScriptToExecuteOnDocumentCreated`，必须在模块执行前）：

```js
// 注入的 shim —— 让 web/ 以为自己还在 WKWebView 里
window.webkit = window.webkit || {};
window.webkit.messageHandlers = window.webkit.messageHandlers || {};
window.webkit.messageHandlers.court = {
  postMessage: (m) => window.chrome.webview.postMessage(m),
};
```

原生侧再注入 Mac 的 `consoleBridge`（把 `console.log` 和未捕获异常转成 `log` 消息）。

另注意 `index.html` 用 `<script type="module">`，**不要用 `file://` 加载**（ES module 会撞 CORS），用虚拟主机：

```csharp
coreWebView2.SetVirtualHostNameToFolderMapping(
    "beachcourt.local", webFolder, CoreWebView2HostResourceAccessKind.Allow);
coreWebView2.Navigate("https://beachcourt.local/index.html?layer=front");
```

#### JS → 原生（`post({type, ...})`）

| type | 载荷 | 含义 | 原生要做什么 |
|---|---|---|---|
| `ready` | `layer` | 该层就绪 | front 就绪时回灌 `court.setStats(made, attempts)` |
| `log` | `level, text` | console 转发 / JS 异常 | 写日志 |
| `hit` | `circles[], hoop{x,y,w,h}, score{...}, holding, aiming` | 纸团命中圆、篮板/记分牌矩形、状态 | 更新穿透判定；`aiming`/`holding` 变化时切换鼠标接管 |
| `covered` | `id` | 假图标已盖住真图标 | **现在可以搬文件了**（`stash`） |
| `banked` | `id` | 球进了 | 暂存文件移到 `篮筐\<日期>\`，记 `shots.json` |
| `unpack` | `id` | 纸团拆开 | 文件放回桌面原位 |
| `openBasket` | — | 点了篮板 | 打开 `文档\篮筐\` |
| `menu` | `x, y` | 点了记分牌 | 在该位置弹托盘菜单 |
| `stats` | `made, attempts` | 记分变化 | 持久化 `stats.json` |

#### 原生 → JS（`court.*`）

| 方法 | 参数 | 作用 |
|---|---|---|
| `crumple(id, items, iconSize)` | `items: [{name, src(dataURL), x, y}]` | 揉纸团动画；`x,y` 是图标中心（窗口点） |
| `setStats(made, attempts)` | | 回灌记分牌 |
| `unpackBall(id)` | 返回 `bool` | 撤销场上纸团；返回是否在这里拆开的 |
| `fromHoop(id, items, iconSize)` | | 从篮筐放回，图标从篮圈飞出 |
| `restored(id)` | | 文件已回桌面，淡出假图标 |
| `pointer(x, y)` | | 穿透期间转发指针给瞄准器 |
| `outside()` | | 指针离开球场 |
| `setTime(mode, instant)` | `noon / morning / dusk / night / auto` | 时段 |
| `pause(on)` | | 有窗口盖住桌面时暂停壁纸层 |
| `ids()` | 返回 `number[]` | 场上纸团 id |
| `snap()` | 返回 `dataURL` | 调试截图 |

### 5.3 读资源管理器选中项

AppleScript「tell Finder」的等价物是 COM。用 **IShellWindows** 找到桌面那个 shell 窗口，再拿 **IFolderView**：

```csharp
// Explorer.cs 骨架
var shellWindows = (IShellWindows)new ShellWindows();
for (int i = 0; i < shellWindows.Count; i++)
{
    var window = shellWindows.Item(i);
    if (window == null) continue;

    // 通过 IServiceProvider 取 SID_STopLevelBrowser → IShellBrowser
    var browser = (IShellBrowser)((IServiceProvider)window).QueryService(
        ref SID_STopLevelBrowser, ref IID_IShellBrowser);
    browser.QueryActiveShellView(out var view);

    var folderView = (IFolderView)view;
    // folderView.ItemCount(SVGIO_SELECTION)
    // folderView.GetItem(i, SVGIO_SELECTION, out pidl)
    // → IShellItem.GetDisplayName(SIGDN_FILESYSPATH) 得到完整路径
    // → folderView.GetItemPosition(pidl, out var pt) 得到图标中心（客户区坐标）
}
```

补充：
- 图标中心坐标要从客户区换算到屏幕/窗口坐标，再考虑 DPI。
- 也可以走「找 `SysListView32` + `LVM_GETITEMCOUNT` / `LVM_GETNEXTITEM(LVNI_SELECTED)` + `LVM_GETITEMTEXT`」的纯 Win32 路线，更糙但更稳，**若 COM 路线卡住就换这条**。

### 5.4 搬文件 + 摆图标位置

```csharp
// 句柄 = FindWindowEx(FindWindowEx(workerW, 0, "SHELLDLL_DefView", null), 0, "SysListView32", null)
[DllImport("user32.dll")]
static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

const uint LVM_GETITEMPOSITION = 0x1010;
const uint LVM_SETITEMPOSITION = 0x1011;   // lParam = MAKELPARAM(x, y)
```

**限制（与 Mac 版一致，必须写进 README）**：桌面必须是「查看 → 自动排列图标」**关闭**、自由排列；开了自动排列/对齐网格，系统会把图标改回去。

搬文件用普通 `File.Move`，同名冲突时生成 `name 2.ext`（照抄 Mac 的 `freeURL` 逻辑）。

### 5.5 缩略图

```csharp
// Thumbnails.cs
SHCreateItemFromParsingName(path, IntPtr.Zero, ref IID_IShellItem, out var item);
((IShellItemImageFactory)item).GetImage(new SIZE(128, 128), SIIGBF_ICONONLY, out var hbitmap);
// hbitmap → PNG data URL 交给 court.crumple 的 src
```

拿不到缩略图时退回 `SHGetFileInfo` 的图标句柄，再退回通用文件图标。

**注意缩放因子**：`items` 的 `x,y` 是 CSS 点，而 `iconSize` 要按 `DPI/96` 折算，否则高 DPI 下假图标会偏位。

### 5.6 热键 / 托盘 / 菜单

| Mac | Windows | 说明 |
|---|---|---|
| ⌃⌥X | `RegisterHotKey(hwnd, 1, MOD_CONTROL\|MOD_ALT, 'X')` | 揉纸团 |
| ⌃⌥Z | `RegisterHotKey(..., 'Z')` | 撤销 |
| 双指捏合 | **无对应物** | 改为菜单项「揉成纸团」+ 桌面右键；或改成别的全局键 |
| NSStatusItem | `NotifyIcon` 托盘 | 点记分牌弹同一菜单 |
| 菜单 | `ContextMenuStrip` | 时段（自动/正午/早晨/黄昏/夜晚）、全部放回、记分牌清零、打开篮筐、退出 |

注意：`Ctrl+Alt+X` 等热键是全局的，若被别的程序占用 `RegisterHotKey` 会失败——**失败要写日志并提示**，别静默（Mac 版就是这么做的）。

### 5.7 启动与崩溃恢复

启动顺序：

1. 检查 `%APPDATA%\BeachCourt\shots.json` + `桌面\.beach-court\` 是否有残留 → 有则把文件放回桌面（A7）。
2. 建两层窗口、挂 WebView2、注入 shim、导航到 `?layer=back` / `?layer=front`。
3. `DesktopLayer.Attach()` 挂 WorkerW。
4. 注册热键、托盘。
5. front 层发 `ready` → 回灌 stats。

退出 / 异常：把 `.beach-court` 里所有文件放回桌面（照抄 Mac 版退出逻辑）。`shots.json` 里未撤销的**不要动**（那些文件已经在篮筐里，属于用户已投进的结果）。

---

## 6. 分阶段实施

> 每阶段做完**必须过验收标准**再进下一阶段。宁可阶段 1 慢一点，也不要跳过它直接碰系统集成。

### 阶段 0 · 环境准备（约 30 分钟）

- [ ] 装 .NET 8 SDK、WebView2 Runtime
- [ ] `dotnet new winforms -n BeachCourt` 建 `win/` 工程
- [ ] 引 NuGet 包 `Microsoft.Web.WebView2`
- [ ] 写 `Paths.cs`（含 `BEACH_HOME` 环境变量覆盖，便于自测不碰真桌面）

**验收**：能 F5 跑起一个空窗体。

### 阶段 1 · 壳跑通，能投进一个球（1–2 天）

先**只用 `web/js/desktop.js` 的模拟桌面**，不碰真桌面。

- [ ] 两层窗体（可先都放顶层），各挂一个 WebView2，用虚拟主机加载 `web/`
- [ ] 注入 shim + consoleBridge；实现 `post` 到 C# 的消息分发骨架
- [ ] 实现 `court.*` 全部方法（此时 `crumple` 可以喂模拟数据）
- [ ] `?layer=front` 上空格蓄力、投篮、进球全链路跑通

**验收**：

- 浏览器 demo 里能做的，这个壳里都能做（A2）
- 点记分牌能弹出菜单、能切时段（`setTime`）
- JS 的 console/异常出现在 `BeachCourt.log` 里

### 阶段 2 · 真桌面集成（3–5 天）

- [ ] `Explorer.cs`：读桌面选中项（路径 + 图标坐标）——**先单独写个按钮打印出来验证**
- [ ] `Thumbnails.cs`：出缩略图 data URL
- [ ] `Ctrl+Alt+X` → `crumple(id, items, size)` → 收到 `covered` 后 `File.Move` 到 `.beach-court`
- [ ] `banked` → 移到 `篮筐\<日期>\` + 写 `shots.json`
- [ ] `unpack` / `Ctrl+Alt+Z` → `File.Move` 回桌面 + `LVM_SETITEMPOSITION` 还原
- [ ] `openBasket`、托盘菜单全部接通

**验收**：A1、A3、A4、A8 全过（此阶段可以先不追求 A5/A6 的分层效果）。

### 阶段 3 · 分层与穿透（2–3 天）

- [ ] **先做 10 行最小验证**：红色窗口能不能挂到桌面图标下面（Win10 / Win11 各测一次）
- [ ] `DesktopLayer.Attach()` 接上 court 层
- [ ] overlay 层 `hit` 消息驱动穿透切换（A6）
- [ ] 穿透期间 `court.pointer()` 转发指针，`outside()` 收尾
- [ ] 有窗口盖住桌面时 `court.pause(true)`（省电）

**验收**：A5、A6 过。

### 阶段 4 · 收尾（1–2 天）

- [ ] 崩溃恢复（A7）
- [ ] 高 DPI 下坐标/缩略图对齐检查
- [ ] 打包：`dotnet publish -c Release -r win-x64 --self-contained` + 可选 WebView2 引导安装
- [ ] README 加 Windows 章节（含「桌面须自由排列」「热键可能被占用」「双指捏合不可用」三处差异）

**验收**：A1–A8 全过，在另一台机器上装上能跑。

**总计约 8–12 个工作日。**

---

## 7. 与 Mac 版的行为差异（要写进 README）

| 项 | Mac | Windows | 影响 |
|---|---|---|---|
| 图标上下分层 | 精确插在图标下/上两层 | WorkerW 壁纸层 + 置顶穿透层，中间隔着任务栏等 | 观感接近，非像素级还原 |
| 双指捏合 | 揉纸团 | **不可用**（无全局 magnify 手势） | 改用菜单项 / 右键 / 其他热键 |
| 快捷键 | ⌃⌥X / ⌃⌥Z | `Ctrl+Alt+X` / `Ctrl+Alt+Z` | 一致 |
| 空格 = 快速查看 | 只在纸团在手时接管 | Windows 无对应「快速查看」，空格行为取决于当前焦点应用 | 建议只在纸团在手时拦截空格 |
| 图标放回原位 | 访达记录的图标位置 | `LVM_SETITEMPOSITION` | 两者都要求桌面自由排列 |
| 授权 | 要「控制访达」「输入监控」权限 | **一般无需特殊授权** | 比 Mac 省事 |
| 显示器 | 只支持主显示器 | 同样先只支持主显示器 | 后续可扩展 |
| 运行时 | 系统自带 WKWebView | 需 WebView2 Runtime | 安装包要带引导 |

---

## 8. 风险与回退

| 风险 | 概率 | 影响 | 回退 |
|---|---|---|---|
| **WorkerW 分层在 Win11 上不稳定** | 中 | A5 不达标 | 改为两层都置顶，接受盖住部分图标（只改 `DesktopLayer.Attach`） |
| COM 读桌面选中项在「桌面整理」类软件存在时失效 | 中 | A1 失效 | 退到 `SysListView32` + `LVM_GETITEMTEXT` 纯 Win32 路线 |
| `Ctrl+Alt+X` 被占用 | 低 | 快捷键不可用 | 启动时检测、提示、允许改键（至少菜单里有等效项） |
| WebView2 未安装 | 低 | 启动失败 | 安装包带 Evergreen 引导安装；启动时检测并提示 |
| 高 DPI 下假图标与真图标错位 | 中 | 观感 | `iconSize` 与 `x,y` 统一按 DPI 折算；阶段 4 专项检查 |
| 桌面开了自动排列 | 高（用户侧） | A4 失败 | 启动时检测并提示（Mac 版同样有此限制） |

---

## 9. 开工前先做的三件事

1. **跑一遍浏览器 demo**，建立手感基准：

   ```
   cd web
   python -m http.server 8893
   ```

   打开 http://localhost:8893 投几个球。

2. **读 `mac/BeachCourt.swift` 的 `App` 类**（约 250 行起），对照 4.2 状态机看 `crumpleSelection` / `stash` / `bank` / `unfold` 四个方法——这是要照抄的业务逻辑。

3. **写 WorkerW 最小验证**（阶段 3 的前置）：不写完整应用，只验证「红色窗口能挂到图标下面」。这一条通了，整个方案就没有硬阻塞了。
