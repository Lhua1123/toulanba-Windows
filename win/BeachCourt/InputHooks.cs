using System;
using System.Runtime.InteropServices;

namespace BeachCourt;

/// 纸团交互期间的全局输入钩子。WebView2 在透明分层窗口里偶尔收不到鼠标/键盘，
/// 这里把输入转成 JS 事件，保证拖动、瞄准、空格蓄力稳定工作。
sealed class InputHooks : IDisposable
{
    const int WH_MOUSE_LL = 14;
    const int WH_KEYBOARD_LL = 13;
    const int WM_MOUSEMOVE = 0x0200;
    const int WM_LBUTTONDOWN = 0x0201;
    const int WM_LBUTTONUP = 0x0202;
    const int WM_KEYDOWN = 0x0100;
    const int WM_KEYUP = 0x0101;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_SYSKEYUP = 0x0105;

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT
    {
        public POINT Point;
        public uint MouseData, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT
    {
        public uint VkCode, ScanCode, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    readonly HookProc _mouseProc, _keyboardProc;
    IntPtr _mouseHook, _keyboardHook;
    bool _disposed;

    public event Action<int, int> MouseMove;
    public event Action<int, int, bool> MouseButton;
    public event Action<bool, uint, bool, bool, bool> Key;

    public InputHooks()
    {
        _mouseProc = MouseCallback;
        _keyboardProc = KeyboardCallback;
    }

    public bool Start()
    {
        if (_mouseHook == IntPtr.Zero)
            _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, GetModuleHandle(null), 0);
        if (_keyboardHook == IntPtr.Zero)
            _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, GetModuleHandle(null), 0);
        return _mouseHook != IntPtr.Zero && _keyboardHook != IntPtr.Zero;
    }

    public void Stop()
    {
        if (_mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(_mouseHook); _mouseHook = IntPtr.Zero; }
        if (_keyboardHook != IntPtr.Zero) { UnhookWindowsHookEx(_keyboardHook); _keyboardHook = IntPtr.Zero; }
    }

    IntPtr MouseCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (code >= 0)
            {
                var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                int msg = wParam.ToInt32();
                if (msg == WM_MOUSEMOVE) MouseMove?.Invoke(data.Point.X, data.Point.Y);
                else if (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP)
                {
                    MouseButton?.Invoke(data.Point.X, data.Point.Y, msg == WM_LBUTTONDOWN);
                    return (IntPtr)1;
                }
            }
        }
        catch { }
        return CallNextHookEx(_mouseHook, code, wParam, lParam);
    }

    IntPtr KeyboardCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (code >= 0)
            {
                int msg = wParam.ToInt32();
                bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
                if (down || msg is WM_KEYUP or WM_SYSKEYUP)
                {
                    var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                    bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
                    bool alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
                    bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
                    Key?.Invoke(down, data.VkCode, ctrl, alt, shift);
                    if (data.VkCode is 0x20 or 0x25 or 0x27 or 0x1B) return (IntPtr)1;
                }
            }
        }
        catch { }
        return CallNextHookEx(_keyboardHook, code, wParam, lParam);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
}
