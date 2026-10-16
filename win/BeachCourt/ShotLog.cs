using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace BeachCourt;

/// 桌面上一个图标的落点：图标中心（窗口点）。
record ShotFile(string Name, string Path, double X, double Y);

/// 一次投进：它的文件、去处、原位。
record Shot(DateTime Date, List<ShotFile> Files);

static class ShotLog
{
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static List<Shot> Load()
    {
        try
        {
            if (!File.Exists(Paths.Shots)) return [];
            return JsonSerializer.Deserialize<List<Shot>>(File.ReadAllText(Paths.Shots)) ?? [];
        }
        catch { return []; }
    }

    public static void Save(List<Shot> shots)
    {
        Directory.CreateDirectory(Paths.Support);
        File.WriteAllText(Paths.Shots, JsonSerializer.Serialize(shots, Json));
    }

    public static (int Made, int Attempts) LoadStats()
    {
        try
        {
            if (!File.Exists(Paths.Stats)) return (0, 0);
            var d = JsonSerializer.Deserialize<StatsDoc>(File.ReadAllText(Paths.Stats));
            return (d?.Made ?? 0, d?.Attempts ?? 0);
        }
        catch { return (0, 0); }
    }

    public static void SaveStats(int made, int attempts)
    {
        Directory.CreateDirectory(Paths.Support);
        File.WriteAllText(Paths.Stats, JsonSerializer.Serialize(new StatsDoc { Made = made, Attempts = attempts }, Json));
    }

    class StatsDoc { public int Made { get; set; } public int Attempts { get; set; } }
}
