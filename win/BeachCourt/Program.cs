using System;
using System.IO;
using System.Windows.Forms;

namespace BeachCourt;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        bool selfTest = Array.IndexOf(args, "--selftest") >= 0;
        if (selfTest)
        {
            Environment.SetEnvironmentVariable("BEACH_HOME", Path.Combine(Path.GetTempPath(), "beachselftest"));
            Environment.SetEnvironmentVariable("BEACH_SELFTEST", "1");
        }

        using var single = new Mutex(true, "BeachCourt.Windows.SingleInstance", out bool created);
        if (!created)
        {
            MessageBox.Show("海边球场已经在运行。\n右下角托盘图标右键可退出，或按 Ctrl+Alt+Q。", "海边球场");
            return;
        }

        ApplicationConfiguration.Initialize();
        var app = new App();
        if (selfTest)
            app.Shown += async (_, _) => { await app.RunSelfTestAsync(); app.Close(); };
        Application.Run(app);
    }
}
