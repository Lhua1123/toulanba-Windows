using System;
using System.Windows.Forms;

namespace BeachCourt;

sealed class HotKeys : IDisposable
{
    public const int IdCrumple = 1, IdUndo = 2, IdTime = 3, IdQuit = 4, IdRecycleCrumple = 5;

    readonly IntPtr _hwnd;
    public readonly bool CrumpleOk, UndoOk, TimeOk, QuitOk, RecycleCrumpleOk;

    public HotKeys(IntPtr hwnd)
    {
        _hwnd = hwnd;
        uint mod = Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT;
        CrumpleOk = Native.RegisterHotKey(hwnd, IdCrumple, mod, (uint)Keys.X);
        UndoOk = Native.RegisterHotKey(hwnd, IdUndo, mod, (uint)Keys.Z);
        TimeOk = Native.RegisterHotKey(hwnd, IdTime, mod, (uint)Keys.T);
        QuitOk = Native.RegisterHotKey(hwnd, IdQuit, mod, (uint)Keys.Q);
        RecycleCrumpleOk = Native.RegisterHotKey(hwnd, IdRecycleCrumple, mod, (uint)Keys.D);
    }

    public void Dispose()
    {
        if (CrumpleOk) Native.UnregisterHotKey(_hwnd, IdCrumple);
        if (UndoOk) Native.UnregisterHotKey(_hwnd, IdUndo);
        if (TimeOk) Native.UnregisterHotKey(_hwnd, IdTime);
        if (QuitOk) Native.UnregisterHotKey(_hwnd, IdQuit);
        if (RecycleCrumpleOk) Native.UnregisterHotKey(_hwnd, IdRecycleCrumple);
    }
}
