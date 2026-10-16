using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace BeachCourt;

/// 文件图标 → PNG data URL。先用关联图标，够验证用；后续可升级成缩略图预览。
static class Thumbnails
{
    public static string DataUrl(string path, int size)
    {
        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon == null) return Blank(size);
            using var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.DrawIcon(icon, new Rectangle(0, 0, size, size));
            }
            return ToDataUrl(bmp);
        }
        catch { return Blank(size); }
    }

    static string Blank(int size)
    {
        using var b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        return ToDataUrl(b);
    }

    static string ToDataUrl(Bitmap bmp)
    {
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
    }
}
