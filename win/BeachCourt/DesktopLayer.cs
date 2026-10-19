using System;
using System.Runtime.InteropServices;
using System.Text;

namespace BeachCourt;

/// 桌面分层。把背景窗口挂到桌面图标下面的 WorkerW 层。
/// Windows 11 的 WorkerW 结构与 Windows 10 不完全一致，因此这里不依赖单一窗口顺序。
static class DesktopLayer
{
    const uint WM_SPAWN_WORKERW = 0x052C;

    static bool IsClass(IntPtr hwnd, string className)
    {
        if (hwnd == IntPtr.Zero) return false;
        var name = new StringBuilder(256);
        Native.GetClassName(hwnd, name, name.Capacity);
        return string.Equals(name.ToString(), className, StringComparison.Ordinal);
    }

    static bool HasDesktopView(IntPtr hwnd)
    {
        return hwnd != IntPtr.Zero &&
               Native.FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero;
    }

    /// 找到承载壁纸的 WorkerW（桌面图标层的下一层）。
    static IntPtr WallpaperWorker()
    {
        var progman = Native.FindWindow("Progman", null);
        if (progman != IntPtr.Zero)
        {
            Native.SendMessageTimeout(progman, WM_SPAWN_WORKERW, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_NORMAL, 1000, out _);
        }

        // Win10/部分 Win11：图标视图在 Progman 中，Progman 后面的 WorkerW 是壁纸层。
        if (HasDesktopView(progman))
        {
            var next = Native.FindWindowEx(IntPtr.Zero, progman, "WorkerW", null);
            if (next != IntPtr.Zero && !HasDesktopView(next)) return next;
        }

        // Win11 可能把 SHELLDLL_DefView 放到 WorkerW 中。
        // 只选可见、全屏且不承载桌面图标的 WorkerW，避免误选零尺寸隐藏窗口。
        IntPtr best = IntPtr.Zero;
        bool bestFullscreen = false;
        int screenWidth = Native.GetSystemMetrics(0);
        int screenHeight = Native.GetSystemMetrics(1);
        Native.EnumWindows((top, _) =>
        {
            if (!IsClass(top, "WorkerW") || HasDesktopView(top) || !Native.IsWindowVisible(top)) return true;
            if (!Native.GetWindowRect(top, out var rect)) return true;
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0) return true;

            bool fullscreen = width >= screenWidth - 2 && height >= screenHeight - 2;
            if (best == IntPtr.Zero || (fullscreen && !bestFullscreen))
            {
                best = top;
                bestFullscreen = fullscreen;
            }
            return !bestFullscreen;
        }, IntPtr.Zero);
        return best;
    }

    /// 把窗口挂到桌面图标下面。返回是否真正挂载成功。
    public static bool AttachUnderDesktop(IntPtr hwnd)
    {
        var worker = WallpaperWorker();
        App.Log("desktop worker=" + worker);
        if (worker == IntPtr.Zero) return false;

        Native.SetLastError(0);
        Native.SetParent(hwnd, worker);
        int error = Marshal.GetLastWin32Error();
        var parent = Native.GetParent(hwnd);
        bool attached = parent == worker || (parent == IntPtr.Zero && error == 0);
        App.Log("SetParent under desktop: " + attached + " (parent=" + parent + ", error=" + error + ")");
        if (!attached) return false;

        // SetParent 后放到 WorkerW 内部顶层；整个 WorkerW 仍在桌面图标下面。
        Native.SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
            0x0001 | 0x0002 | 0x0010 | 0x0040); // HWND_TOP + NOSIZE|NOMOVE|NOACTIVATE|SHOWWINDOW
        return true;
    }

    public static void DetachToTopmost(IntPtr hwnd, System.Drawing.Rectangle bounds)
    {
        Native.SetParent(hwnd, IntPtr.Zero);
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            0x0004);
    }

    public static void SetClickThrough(IntPtr hwnd, bool on)
    {
        int ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
        if (on) ex |= Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED | Native.WS_EX_NOACTIVATE;
        else ex = (ex & ~(Native.WS_EX_TRANSPARENT | Native.WS_EX_NOACTIVATE)) | Native.WS_EX_LAYERED;
        Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, ex);
        Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
            0x0001 | 0x0002 | 0x0020);
    }
}
