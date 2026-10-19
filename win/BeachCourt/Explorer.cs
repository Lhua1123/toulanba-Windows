using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace BeachCourt;

/// 桌面图标：读选中项、摆图标位置。桌面是虚拟列表（LVM_GETITEMTEXT 取不到名字），
/// 所以用 UI Automation 读选中项的名字与位置；摆位置仍走 SysListView32。
static class Explorer
{
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

    static IntPtr DesktopList()
    {
        var progman = Native.FindWindow("Progman", null);
        var defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (defView == IntPtr.Zero)
        {
            Native.EnumWindows((h, _) => {
                var dv = Native.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (dv != IntPtr.Zero) { defView = dv; return false; }
                return true;
            }, IntPtr.Zero);
        }
        return Native.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
    }

    static bool Send(IntPtr list, uint msg, IntPtr wParam, IntPtr lParam, out int result)
    {
        IntPtr r;
        bool ok = Native.SendMessageTimeout(list, msg, wParam, lParam, Native.SMTO_ABORTIFHUNG, 150, out r) != IntPtr.Zero;
        result = r.ToInt32();
        return ok;
    }

    public static int IconSize => Math.Max(Native.GetSystemMetrics(Native.SM_CXICON), 16);

    public static bool SelectByName(string name)
    {
        var list = DesktopList();
        if (list == IntPtr.Zero) return false;
        try
        {
            var root = AutomationElement.FromHandle(list);
            var cond = new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true);
            foreach (AutomationElement item in root.FindAll(TreeScope.Children, cond))
            {
                if (!string.Equals(item.Current.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
                ((SelectionItemPattern)item.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
                return true;
            }
        }
        catch (Exception ex) { App.Log("SelectByName: " + ex.Message); }
        return false;
    }

    public static List<(string Path, int X, int Y)> Selection()
    {
        var result = new List<(string, int, int)>();
        var list = DesktopList();
        App.Log("Sel: list=" + list);
        if (list == IntPtr.Zero) return result;

        try
        {
            var root = AutomationElement.FromHandle(list);
            var cond = new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true);
            var items = root.FindAll(TreeScope.Children, cond);
            App.Log("Sel: uia items=" + items.Count);
            foreach (AutomationElement item in items)
            {
                var sip = (SelectionItemPattern)item.GetCurrentPattern(SelectionItemPattern.Pattern);
                if (!sip.Current.IsSelected) continue;
                string name = item.Current.Name;
                var rect = item.Current.BoundingRectangle;
                App.Log("Sel: uia name=" + (name ?? "<null>"));
                if (string.IsNullOrEmpty(name)) continue;
                var full = Path.Combine(Paths.Desktop, name);
                if (!File.Exists(full) && !Directory.Exists(full)) continue;
                result.Add((full, (int)(rect.X + rect.Width / 2), (int)(rect.Y + rect.Height / 2)));
            }
        }
        catch (Exception ex) { App.Log("Sel: uia err " + ex.Message); }

        App.Log("Sel: matched=" + result.Count);
        return result;
    }

    public static void Place(IReadOnlyList<(string Name, int X, int Y)> items)
    {
        var list = DesktopList();
        if (list == IntPtr.Zero) return;
        int icon = IconSize;
        foreach (var (name, x, y) in items)
        {
            int idx = IndexOf(list, name);
            if (idx < 0) continue;
            var pt = new POINT { X = x - icon / 2, Y = y - icon / 2 };
            ScreenToClient(list, ref pt);
            var packed = (IntPtr)(((pt.Y & 0xFFFF) << 16) | (pt.X & 0xFFFF));
            Send(list, Native.LVM_SETITEMPOSITION, new IntPtr(idx), packed, out _);
        }
    }

    static int IndexOf(IntPtr list, string name)
    {
        try
        {
            var root = AutomationElement.FromHandle(list);
            var cond = new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true);
            var items = root.FindAll(TreeScope.Children, cond);
            for (int i = 0; i < items.Count; i++)
            {
                if (string.Equals(items[i].Current.Name, name, StringComparison.OrdinalIgnoreCase))
                    return i;
            }
        }
        catch (Exception ex) { App.Log("IndexOf: " + ex.Message); }
        return -1;
    }
}
