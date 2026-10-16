using System;

namespace BeachCourt;

/// 桌面分层。把窗口挂到桌面图标「下面」（WorkerW 壁纸层），或「上面」（置顶+可穿透）。
/// 这是让球场真正铺到桌面上的关键。
static class DesktopLayer
{
    const uint WM_SPAWN_WORKERW = 0x052C;   // 让 Progman 分裂出承载壁纸的 WorkerW

    /// 找到承载壁纸的那个 WorkerW（桌面图标层的「下一层」）。
    static IntPtr WallpaperWorker()
    {
        var progman = Native.FindWindow("Progman", null);
        Native.SendMessageTimeout(progman, WM_SPAWN_WORKERW, IntPtr.Zero, IntPtr.Zero,
            Native.SMTO_NORMAL, 1000, out _);

        IntPtr worker = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            // 图标层是「带 SHELLDLL_DefView 的顶层窗口」；它的下一个 WorkerW 就是壁纸层
            var shellView = Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (shellView != IntPtr.Zero)
            {
                worker = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return worker;
    }

    /// 把窗口挂到桌面图标「下面」。返回是否成功。
    public static bool AttachUnderDesktop(IntPtr hwnd)
    {
        var worker = WallpaperWorker();
        App.Log("desktop worker=" + worker);
        if (worker == IntPtr.Zero) return false;
        var prev = Native.SetParent(hwnd, worker);
        App.Log("SetParent under desktop: " + (prev != IntPtr.Zero));
        return true;
    }

    /// 从 WorkerW 摘回普通顶层窗口，供纸团接收鼠标和键盘。
    public static void DetachToTopmost(IntPtr hwnd, System.Drawing.Rectangle bounds)
    {
        Native.SetParent(hwnd, IntPtr.Zero);
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            0x0004);   // SHOWWINDOW
    }

    /// 置顶 + 透明穿透（鼠标落到桌面图标）。on=true 时穿透，false 时本窗口接管鼠标。
    public static void SetClickThrough(IntPtr hwnd, bool on)
    {
        int ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
        if (on) ex |= Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED | Native.WS_EX_NOACTIVATE;
        else ex = (ex & ~(Native.WS_EX_TRANSPARENT | Native.WS_EX_NOACTIVATE)) | Native.WS_EX_LAYERED;
        Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, ex);
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
            0x0001 | 0x0002 | 0x0020);   // NOSIZE|NOMOVE|NOACTIVATE
    }
}
