using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace BeachCourt;

/// 沙滩海背景层。全屏，挂到桌面图标「下面」（WorkerW），让球场垫在桌面图标背后。
class CourtForm : Form
{
    readonly WebView2 _view;
    public ShellBridge Bridge { get; }

    public CourtForm(string webRoot)
    {
        Text = "BeachCourt-Back";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen.Bounds;
        ShowInTaskbar = false;
        _view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_view);
        Bridge = new ShellBridge(_view);

        Load += async (_, _) =>
        {
            try
            {
                await Bridge.InitAsync(webRoot, "https://beachcourt.local/index.html?layer=back",
                    Path.Combine(Paths.Support, "webview2-back"));
                App.Log("back layer loading");
                bool under = DesktopLayer.AttachUnderDesktop(Handle);
                App.Log("back under desktop = " + under);
            }
            catch (Exception ex) { App.Log("back init failed: " + ex.Message); }
        };
    }
}
