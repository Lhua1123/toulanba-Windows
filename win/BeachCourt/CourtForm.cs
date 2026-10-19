using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace BeachCourt;

/// 沙滩海背景层。全屏，挂到桌面图标下面的 WorkerW，让球场垫在桌面图标背后。
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
                if (!under)
                {
                    // 挂不到图标下面时，宁可没有沙滩背景，也不能遮住桌面。
                    Visible = false;
                    App.Log("back layer unavailable; hidden to preserve desktop icons");
                }
            }
            catch (Exception ex)
            {
                App.Log("back init failed: " + ex.Message);
                Visible = false;
            }
        };
    }
}
