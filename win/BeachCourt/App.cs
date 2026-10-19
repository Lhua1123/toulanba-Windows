using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace BeachCourt;

/// 主控。状态机 + 桥 + 真桌面文件集成。Esc 退出。
class App : Form
{
    CourtForm _court;
    readonly WebView2 _view;
    readonly ShellBridge _bridge;
    readonly string _webRoot;
    HotKeys _hotKeys;
    NotifyIcon _tray;
    ContextMenuStrip _trayMenu;
    System.Windows.Forms.Timer _hitTimer;
    InputHooks _inputHooks;
    DateTime _lastNativeMove = DateTime.MinValue;

    readonly List<(double X, double Y, double R)> _ballHits = new();
    Rectangle? _hoopHit;
    Rectangle? _scoreHit;
    bool _holding;
    bool _aiming;
    bool _mouseTaken;
    bool _playActive;

    readonly Dictionary<int, List<(string Path, double X, double Y)>> _pending = new();
    readonly Dictionary<int, List<BallFile>> _balls = new();
    readonly Dictionary<int, DateTime> _ballMade = new();
    int _nextId = 1;

    record BallFile(string Name, string Staged, double X, double Y);

    public App()
    {
        Text = "海边球场（Ctrl+Alt+X 揉纸团 · Ctrl+Alt+Z 撤销 · Ctrl+Alt+Q 退出）";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen.Bounds;
        TopMost = true;
        ShowInTaskbar = false;
        KeyPreview = true;

        // WebView2 自己是透明的，但 WinForms 窗口默认仍会画一层不透明背景。
        // 用色键把这层背景真正挖空，否则沙滩层会被整块白色盖住。
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        AllowTransparency = true;

        _webRoot = FindWebRoot();
        _view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
        Controls.Add(_view);
        _bridge = new ShellBridge(_view);
        _bridge.OnMessage += OnJsMessage;
        CreateTray();

        Load += async (_, _) => await InitAsync();
        FormClosed += (_, _) =>
        {
            _hitTimer?.Dispose();
            _inputHooks?.Dispose();
            _hotKeys?.Dispose();
            _tray.Visible = false;
            _tray.Dispose();
            _trayMenu.Dispose();
            if (_court is { IsDisposed: false }) _court.Close();
            RecoverStaging();
        };
    }

    void CreateTray()
    {
        _trayMenu = new ContextMenuStrip();
        _trayMenu.Items.Add("退出海边球场（Ctrl+Alt+Q）", null, (_, _) => Close());
        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "海边球场 · 右键可退出",
            ContextMenuStrip = _trayMenu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => ShowAppMenu(Cursor.Position);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        _hotKeys = new HotKeys(Handle);
        if (!_hotKeys.CrumpleOk) Log("warn: Ctrl+Alt+X 注册失败");
        if (!_hotKeys.UndoOk) Log("warn: Ctrl+Alt+Z 注册失败");
        if (!_hotKeys.QuitOk) Log("warn: Ctrl+Alt+Q 注册失败");
        else Log("safe exit hotkey ready: Ctrl+Alt+Q");

        _inputHooks = new InputHooks();
        _inputHooks.MouseMove += OnNativeMouseMove;
        _inputHooks.MouseButton += OnNativeMouseButton;
        _inputHooks.Key += OnNativeKey;

        _hitTimer = new System.Windows.Forms.Timer { Interval = 35 };
        _hitTimer.Tick += (_, _) => UpdateMouseMode();
        _hitTimer.Start();
    }

    static bool IsDesktopForeground(IntPtr foreground)
    {
        if (foreground == IntPtr.Zero) return true;
        var name = new System.Text.StringBuilder(256);
        Native.GetClassName(foreground, name, name.Capacity);
        string cls = name.ToString();
        return cls is "Progman" or "WorkerW" or "SHELLDLL_DefView";
    }

    void MakeInteractive(bool focus)
    {
        if (_mouseTaken && Visible) return;
        Show();
        Opacity = 1;
        TopMost = true;
        DesktopLayer.SetClickThrough(Handle, false);
        _mouseTaken = true;
        if (!_inputHooks.Start()) Log("warn: native input hooks failed");
        Log("input mode=interactive");
        if (focus) BeginInvoke(FocusWeb);
    }

    void MakeDesktopLayer()
    {
        if (!Visible && !_mouseTaken) return;
        _inputHooks?.Stop();
        DesktopLayer.SetClickThrough(Handle, true);
        Opacity = 0;
        Hide();
        _mouseTaken = false;
        Log("input mode=desktop-layer");
    }

    void FocusWeb()
    {
        try { Activate(); _bridge.FocusView(); } catch { }
    }

    (int X, int Y) ScreenToWebExact(double sx, double sy)
    {
        var origin = _view.PointToScreen(Point.Empty);
        return ((int)Math.Round((sx - origin.X) / DpiScale), (int)Math.Round((sy - origin.Y) / DpiScale));
    }

    void OnNativeMouseMove(int x, int y)
    {
        if (!_playActive || !_mouseTaken) return;
        var now = DateTime.UtcNow;
        if ((now - _lastNativeMove).TotalMilliseconds < 16) return;
        _lastNativeMove = now;
        var (wx, wy) = ScreenToWebExact(x, y);
        BeginInvoke(() => _bridge.NativePointer("pointermove", wx, wy));
    }

    void OnNativeMouseButton(int x, int y, bool down)
    {
        if (!_playActive || !_mouseTaken) return;
        var (wx, wy) = ScreenToWebExact(x, y);
        BeginInvoke(() => _bridge.NativePointer(down ? "pointerdown" : "pointerup", wx, wy, 0));
    }

    void OnNativeKey(bool down, uint vk, bool ctrl, bool alt, bool shift)
    {
        if (!_playActive || !_mouseTaken) return;
        string key, code;
        switch (vk)
        {
            case 0x20: key = " "; code = "Space"; break;
            case 0x25: key = "ArrowLeft"; code = "ArrowLeft"; break;
            case 0x27: key = "ArrowRight"; code = "ArrowRight"; break;
            case 0x1B: key = "Escape"; code = "Escape"; break;
            default: return;
        }
        BeginInvoke(() => _bridge.NativeKey(down, key, code, ctrl, alt, shift));
    }

    Rectangle WebToScreen(Rectangle r)
    {
        var origin = _view.PointToScreen(Point.Empty);
        return new Rectangle(
            origin.X + (int)Math.Round(r.X * DpiScale),
            origin.Y + (int)Math.Round(r.Y * DpiScale),
            Math.Max(1, (int)Math.Round(r.Width * DpiScale)),
            Math.Max(1, (int)Math.Round(r.Height * DpiScale)));
    }

    Point WebToScreen(int x, int y)
    {
        var origin = _view.PointToScreen(Point.Empty);
        return new Point(origin.X + (int)Math.Round(x * DpiScale), origin.Y + (int)Math.Round(y * DpiScale));
    }

    bool ShouldTakeMouse(Point screen)
    {
        if (_holding || _aiming) return true;
        var origin = _view.PointToScreen(Point.Empty);
        foreach (var c in _ballHits)
        {
            double cx = origin.X + c.X * DpiScale, cy = origin.Y + c.Y * DpiScale, r = c.R * DpiScale;
            double dx = screen.X - cx, dy = screen.Y - cy;
            if (dx * dx + dy * dy <= r * r) return true;
        }
        if (_hoopHit is { } hoop && WebToScreen(hoop).Contains(screen)) return true;
        if (_scoreHit is { } score && WebToScreen(score).Contains(screen)) return true;
        return false;
    }

    void UpdateMouseMode()
    {
        if (!IsHandleCreated || _view.IsDisposed) return;
        IntPtr foreground = Native.GetForegroundWindow();
        Native.GetWindowThreadProcessId(foreground, out uint foregroundPid);
        bool own = foregroundPid == (uint)Environment.ProcessId;
        bool desktop = own || IsDesktopForeground(foreground);

        if (!desktop)
        {
            if (_mouseTaken) _ = _bridge.CallAsync("court.outside()");
            MakeDesktopLayer();
            return;
        }

        // 纸团在场上时整个球场接管输入，保证拖动、空格、方向键都稳定可用。
        if (_playActive || _balls.Count > 0 || _holding || _aiming) MakeInteractive(true);
        else MakeDesktopLayer();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.Escape) { Close(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_HOTKEY)
        {
            int id = m.WParam.ToInt32();
            if (id == HotKeys.IdCrumple) CrumpleSelection();
            else if (id == HotKeys.IdUndo) UndoLast();
            else if (id == HotKeys.IdTime) CycleTime();
            else if (id == HotKeys.IdQuit) Close();
        }
        base.WndProc(ref m);
    }

    static string FindWebRoot()
    {
        var dir = AppContext.BaseDirectory;
        for (int i = 0; i < 10 && !string.IsNullOrEmpty(dir); i++)
        {
            var candidate = Path.Combine(dir, "web");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html")))
                return candidate;
            dir = Path.GetDirectoryName(dir);
        }
        return Path.Combine(AppContext.BaseDirectory, "web");
    }


    async Task InitAsync()
    {
        try
        {
            RecoverStaging();
            if (Environment.GetEnvironmentVariable("BEACH_SELFTEST") == "1")
            {
                Log("selftest UI skipped");
                return;
            }
            _court = new CourtForm(_webRoot);
            _court.Show();
            await _bridge.InitAsync(_webRoot, "https://beachcourt.local/index.html?layer=front",
                Path.Combine(Paths.Support, "webview2-front"));
            Log("front layer loading from " + _webRoot);
            MakeDesktopLayer();
            Log("front is under desktop icons; interactive layer armed");
        }
        catch (Exception ex)
        {
            Log("init failed: " + ex);
            MessageBox.Show("初始化失败：" + ex.Message, "海边球场");
            Close();
        }
    }

    double DpiScale => Math.Max(DeviceDpi, 96) / 96.0;

    (double wx, double wy) ScreenToWeb(double sx, double sy)
    {
        var origin = _view.PointToScreen(Point.Empty);
        double webW = _view.ClientSize.Width / DpiScale;
        double webH = _view.ClientSize.Height / DpiScale;
        double wx = Math.Clamp((sx - origin.X) / DpiScale, 70, Math.Max(webW - 70, 140));
        double wy = Math.Clamp((sy - origin.Y) / DpiScale, 70, Math.Max(webH - 70, 140));
        return (wx, wy);
    }

    static int Int(JsonElement p, string k) => p.TryGetProperty(k, out var v) ? v.GetInt32() : 0;
    static string Str(JsonElement p, string k) => p.TryGetProperty(k, out var v) ? v.GetString() : "";

    void SetTimeAll(string mode)
    {
        _ = _bridge.CallAsync("court.setTime('" + mode + "')");
        if (_court?.Bridge != null) _court.Bridge.CallAsync("court.setTime('" + mode + "')");
    }

    void SetStatsAll(int made, int attempts)
    {
        string js = string.Format("court.setStats({0}, {1})", made, attempts);
        _ = _bridge.CallAsync(js);
        if (_court?.Bridge != null) _court.Bridge.CallAsync(js);
    }

    string _timeMode = "auto";
    void CycleTime()
    {
        var modes = new[] { "auto", "noon", "morning", "dusk", "night" };
        int i = Array.IndexOf(modes, _timeMode);
        _timeMode = modes[(i + 1) % modes.Length];
        Log("time -> " + _timeMode);
        SetTimeAll(_timeMode);
    }

    void OnJsMessage(string type, JsonElement payload)
    {
        switch (type)
        {
            case "ready":
                Log("ready " + (payload.TryGetProperty("layer", out var l) ? l.GetString() : "?"));
                var st = ShotLog.LoadStats();
                SetStatsAll(st.Made, st.Attempts);
                SetTimeAll("auto");
                break;
            case "covered": Stash(Int(payload, "id")); break;
            case "banked": Bank(Int(payload, "id")); break;
            case "unpack": _ = UnfoldAsync(Int(payload, "id"), true); break;
            case "stats":
                int made = Int(payload, "made"), attempts = Int(payload, "attempts");
                ShotLog.SaveStats(made, attempts);
                SetStatsAll(made, attempts);
                break;
            case "openBasket":
                try { Directory.CreateDirectory(Paths.Basket); Process.Start(new ProcessStartInfo { FileName = Paths.Basket, UseShellExecute = true }); }
                catch (Exception ex) { Log("openBasket failed: " + ex.Message); }
                break;
            case "menu":
                Log("menu @ " + payload.ToString());
                ShowAppMenu(WebToScreen(Int(payload, "x"), Int(payload, "y")));
                break;
            case "log": Log("[" + Str(payload, "level") + "] " + Str(payload, "text")); break;
            case "hit": ReadHitRegions(payload); break;
            case "input": Log("web input " + payload.ToString()); break;
            default: Log("js->native [" + type + "] " + payload.ToString()); break;
        }
    }


    void CrumpleSelection()
    {
        var picked = Explorer.Selection();
        if (picked.Count == 0) { Log("桌面无选中文件"); return; } if (picked.Count > 40) { picked = picked.Take(40).ToList(); Log("文件较多，只取前 40 个"); }
        int id = _nextId++;
        int cssSize = (int)Math.Round(Explorer.IconSize / DpiScale);
        _pending[id] = picked.Select(p => (p.Path, (double)p.X, (double)p.Y)).ToList();

        var items = picked.Select(p =>
        {
            var (wx, wy) = ScreenToWeb(p.X, p.Y);
            return new { name = Path.GetFileName(p.Path), src = Thumbnails.DataUrl(p.Path, Explorer.IconSize), x = wx, y = wy };
        }).ToArray();
        Log("crumple #" + id + ": " + picked.Count + " 个文件");
        _ = _bridge.CallAsync("void court.crumple(" + id + ", " + JsonSerializer.Serialize(items) + ", " + cssSize + ")");
        _playActive = true;
        MakeInteractive(true);
    }

    void ReadHitRegions(JsonElement payload)
    {
        _ballHits.Clear();
        if (payload.TryGetProperty("circles", out var circles) && circles.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in circles.EnumerateArray())
            {
                double x = c.TryGetProperty("x", out var x0) ? x0.GetDouble() : 0;
                double y = c.TryGetProperty("y", out var y0) ? y0.GetDouble() : 0;
                double r = c.TryGetProperty("r", out var r0) ? r0.GetDouble() : 32;
                _ballHits.Add((x, y, r));
            }
        }
        _hoopHit = ReadRect(payload, "hoop");
        _scoreHit = ReadRect(payload, "score");
        _holding = payload.TryGetProperty("holding", out var holding) && holding.ValueKind == JsonValueKind.True;
        _aiming = payload.TryGetProperty("aiming", out var aiming) && aiming.ValueKind == JsonValueKind.True;
    }

    static Rectangle? ReadRect(JsonElement payload, string name)
    {
        if (!payload.TryGetProperty(name, out var r) || r.ValueKind != JsonValueKind.Object) return null;
        int x = r.TryGetProperty("x", out var x0) ? x0.GetInt32() : 0;
        int y = r.TryGetProperty("y", out var y0) ? y0.GetInt32() : 0;
        int w = r.TryGetProperty("w", out var w0) ? w0.GetInt32() : 0;
        int h = r.TryGetProperty("h", out var h0) ? h0.GetInt32() : 0;
        return w > 0 && h > 0 ? new Rectangle(x, y, w, h) : null;
    }

    void ShowAppMenu(Point screen)
    {
        var menu = new ContextMenuStrip();
        var time = new ToolStripMenuItem("时段");
        foreach (var (label, mode) in new[] { ("跟随系统", "auto"), ("正午", "noon"), ("早晨", "morning"), ("黄昏", "dusk"), ("夜晚", "night") })
        {
            var item = new ToolStripMenuItem(label) { Checked = _timeMode == mode };
            item.Click += (_, _) => { _timeMode = mode; SetTimeAll(mode); };
            time.DropDownItems.Add(item);
        }
        menu.Items.Add(time);
        menu.Items.Add("打开篮筐文件夹", null, (_, _) => OnJsMessage("openBasket", default));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出海边球场（Ctrl+Alt+Q）", null, (_, _) => Close());
        menu.Closed += (_, _) => menu.Dispose();
        menu.Show(screen);
    }

    void Stash(int id)
    {
        if (!_pending.Remove(id, out var picked)) return;
        string dir = Path.Combine(Paths.Staging, "ball-" + id + "-" + (int)DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        try { Directory.CreateDirectory(dir); }
        catch (Exception ex) { Log("建暂存目录失败: " + ex.Message); return; }
        var files = new List<BallFile>();
        foreach (var (path, x, y) in picked)
        {
            string dest = Path.Combine(dir, Path.GetFileName(path));
            try { File.Move(path, dest); files.Add(new BallFile(Path.GetFileName(path), dest, x, y)); }
            catch (Exception ex) { Log("离桌失败 " + Path.GetFileName(path) + ": " + ex.Message); }
        }
        _balls[id] = files;
        _ballMade[id] = DateTime.Now;
        Log("ball #" + id + ": " + files.Count + " 个文件离桌");
    }

    void Bank(int id)
    {
        // 投进了：直接把文件放回桌面原位，不再存到「篮筐」文件夹
        Log("banked #" + id + ": 投进，直接回桌面");
        _ = UnfoldAsync(id, false);
    }

    async Task UnfoldAsync(int id, bool animate)
    {
        if (!_balls.Remove(id, out var files)) return;
        _ballMade.Remove(id);
        var placed = new List<(string Name, double X, double Y)>();
        foreach (var f in files)
        {
            string dest = FreeURL(Paths.Desktop, f.Name);
            try { File.Move(f.Staged, dest); placed.Add((Path.GetFileName(dest), f.X, f.Y)); }
            catch (Exception ex) { Log("放回失败 " + f.Name + ": " + ex.Message); }
        }
        if (files.Count > 0) RemoveIfEmpty(Path.GetDirectoryName(files[0].Staged));
        RemoveIfEmpty(Paths.Staging);
        Log("unfolded #" + id + ": " + placed.Count + " 个文件回桌面");
        await Task.Delay(350);
        try { Explorer.Place(placed.Select(p => (p.Name, (int)p.X, (int)p.Y)).ToList()); } catch { }
        if (_balls.Count == 0 && _pending.Count == 0)
        {
            _playActive = false;
            MakeDesktopLayer();   // 球场空了才回到桌面图标下面
        }
        if (animate) _ = _bridge.CallAsync("court.restored(" + id + ")");
    }


    void UndoLast()
    {
        int? latestBall = null; DateTime ballDate = DateTime.MinValue;
        foreach (var id in _balls.Keys) { if (_ballMade.TryGetValue(id, out var t) && t > ballDate) { ballDate = t; latestBall = id; } }
        var shots = ShotLog.Load();

        if (shots.Count > 0 && shots[shots.Count - 1].Date > ballDate)
        {
            Log("undo: 放回最后一投");
            var shot = shots[shots.Count - 1];
            shots.RemoveAt(shots.Count - 1);
            ShotLog.Save(shots);
            _ = RestoreShotAsync(shot);
            return;
        }
        if (latestBall != null) { Log("undo: 拆开球 #" + latestBall); _ = UndoBallAsync(latestBall.Value); return; }
        Log("undo: 无可撤销");
    }

    async Task UndoBallAsync(int id)
    {
        try
        {
            var r = await _bridge.CallResultAsync("court.unpackBall(" + id + ")");
            if (r == null || r.Value.ValueKind != JsonValueKind.True) await UnfoldAsync(id, false);
        }
        catch { await UnfoldAsync(id, false); }
        await Task.Delay(3000);
        if (_balls.ContainsKey(id)) await UnfoldAsync(id, false);
    }

    async Task RestoreShotAsync(Shot shot)
    {
        var placed = new List<(string Name, double X, double Y)>();
        foreach (var f in shot.Files)
        {
            if (!File.Exists(f.Path)) continue;
            string dest = FreeURL(Paths.Desktop, f.Name);
            try { File.Move(f.Path, dest); placed.Add((Path.GetFileName(dest), f.X, f.Y)); }
            catch (Exception ex) { Log("放回失败 " + f.Name + ": " + ex.Message); }
        }
        await Task.Delay(350);
        try { Explorer.Place(placed.Select(p => (p.Name, (int)p.X, (int)p.Y)).ToList()); } catch { }
    }

    void RecoverStaging()
    {
        try
        {
            if (!Directory.Exists(Paths.Staging)) return;
            foreach (var dir in Directory.GetDirectories(Paths.Staging))
            {
                foreach (var item in Directory.GetFileSystemEntries(dir))
                {
                    try { File.Move(item, FreeURL(Paths.Desktop, Path.GetFileName(item))); Log("recovered " + Path.GetFileName(item)); }
                    catch (Exception ex) { Log("recovery failed: " + ex.Message); }
                }
                RemoveIfEmpty(dir);
            }
            RemoveIfEmpty(Paths.Staging);
        }
        catch { }
    }


    static string FreeURL(string dir, string name)
    {
        string ext = Path.GetExtension(name), baseName = Path.GetFileNameWithoutExtension(name);
        string candidate = Path.Combine(dir, name);
        int n = 2;
        while (File.Exists(candidate) || Directory.Exists(candidate))
        {
            candidate = Path.Combine(dir, string.IsNullOrEmpty(ext) ? baseName + " " + n : baseName + " " + n + ext);
            n++;
        }
        return candidate;
    }

    static void RemoveIfEmpty(string dir)
    {
        try { if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir) && Directory.GetFileSystemEntries(dir).Length == 0) Directory.Delete(dir); } catch { }
    }


    internal async Task RunSelfTestAsync()
    {
        try
        {
            Directory.CreateDirectory(Paths.Desktop);
            string a = Path.Combine(Paths.Desktop, "自测A.txt");
            string b = Path.Combine(Paths.Desktop, "自测B.txt");
            File.WriteAllText(a, "a");
            File.WriteAllText(b, "b");
            _pending[900] = new List<(string, double, double)> { (a, 100, 100), (b, 100, 200) };
            Stash(900);
            bool stashed = !File.Exists(a) && !File.Exists(b) && _balls.TryGetValue(900, out var staged) && staged.Count == 2;
            Log("selftest stash: " + (stashed ? "ok" : "FAIL"));

            await UnfoldAsync(900, false);
            bool restored = File.Exists(a) && File.Exists(b);
            Log("selftest restore: " + (restored ? "ok" : "FAIL"));

            File.Delete(a);
            File.Delete(b);
            ShotLog.Save(new List<Shot>());
        }
        catch (Exception ex) { Log("selftest error: " + ex.Message); }
    }

    internal static void Log(string s)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Paths.Log));
            File.AppendAllText(Paths.Log, DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + "\n");
        }
        catch { }
    }
}
