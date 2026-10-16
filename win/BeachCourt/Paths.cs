using System;
using System.IO;

namespace BeachCourt;

/// 文件路径。设了 BEACH_HOME 就把所有东西放进那个临时目录，方便自测不碰真实桌面。
static class Paths
{
    static readonly string _selfTestHome = Environment.GetEnvironmentVariable("BEACH_HOME");
    static readonly bool _selfTest = _selfTestHome is { Length: > 0 };

    public static readonly string Home = _selfTest ? _selfTestHome : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    public static readonly string Desktop = Path.Combine(Home, "Desktop");
    public static readonly string Staging = Path.Combine(Desktop, ".beach-court");   // 隐藏，访达不显示
    public static readonly string Basket = Path.Combine(Home, "Documents", "篮筐");
    public static readonly string Support = _selfTest
        ? Path.Combine(Home, "support")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BeachCourt");
    public static readonly string Shots = Path.Combine(Support, "shots.json");
    public static readonly string Stats = Path.Combine(Support, "stats.json");
    public static readonly string Log = _selfTest
        ? Path.Combine(Home, "BeachCourt.log")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BeachCourt", "BeachCourt.log");
}
