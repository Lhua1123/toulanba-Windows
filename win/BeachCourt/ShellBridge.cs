using System;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BeachCourt;

/// WebView2 桥：注入 shim 让 web/ 以为自己在 WKWebView 里，双向转发消息。
class ShellBridge
{
    readonly WebView2 _view;

    /// JS 发来的消息：type + 原始 payload。
    public event Action<string, JsonElement> OnMessage;

    const string Shim = """
        (() => {
          window.webkit = window.webkit || {};
          window.webkit.messageHandlers = window.webkit.messageHandlers || {};
          window.webkit.messageHandlers.court = {
            postMessage: function (m) { window.chrome.webview.postMessage(m); }
          };
          function post(level, text) {
            try { window.webkit.messageHandlers.court.postMessage({ type: 'log', level: level, text: text }); } catch (e) {}
          }
          ['log', 'warn', 'error'].forEach(function (k) {
            var o = console[k].bind(console);
            console[k] = function () { o.apply(null, arguments); post(k, Array.prototype.map.call(arguments, String).join(' ')); };
          });
          addEventListener('error', function (e) { post('error', e.message + ' @ ' + e.filename + ':' + e.lineno); });
          addEventListener('unhandledrejection', function (e) { post('error', 'unhandled: ' + e.reason); });
        })();
        """;

    public ShellBridge(WebView2 view) { _view = view; }

    public async Task InitAsync(string webRoot, string url, string userDataFolder)
    {
        var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
        await _view.EnsureCoreWebView2Async(env);
        var core = _view.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("beachcourt.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Shim);
        core.Settings.IsStatusBarEnabled = false;
        core.WebMessageReceived += (_, e) =>
        {
            try
            {
                using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                if (doc.RootElement.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String)
                    OnMessage?.Invoke(t.GetString()!, doc.RootElement);
            }
            catch { }
        };
        core.Navigate(url);
    }

    public void NativePointer(string type, int x, int y, int button = 0)
    {
        string js = $"court.nativeInput('{type}', {x}, {y}, {button}, '', '', false, false, false)";
        _ = CallAsync(js);
    }

    public void NativeKey(bool down, string key, string code, bool ctrl, bool alt, bool shift)
    {
        string js = $"court.nativeInput('{(down ? "keydown" : "keyup")}', 0, 0, 0, '{key}', '{code}', {(ctrl ? "true" : "false")}, {(alt ? "true" : "false")}, {(shift ? "true" : "false")})";
        _ = CallAsync(js);
    }

    public void FocusView()
    {
        try
        {
            _view.Focus();
            _ = CallAsync("window.focus(); document.body && document.body.focus();");
        }
        catch { }
    }

    public Task<string> CallAsync(string js) => _view.CoreWebView2.ExecuteScriptAsync(js);

    public async Task<JsonElement?> CallResultAsync(string js)
    {
        var json = await _view.CoreWebView2.ExecuteScriptAsync(js);
        if (string.IsNullOrEmpty(json) || json == "null") return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); } catch { return null; }
    }
}
