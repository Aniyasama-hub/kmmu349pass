using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class Kunming349Desktop : Form
{
    private const int Port = 8952;
    private const string Origin = "http://127.0.0.1:8952";
    private const string StartPath = "/%E7%BB%83%E4%B9%A0%E5%89%8D%E7%AB%AF/index.html";
    private const string MarkerPath = "/__kunming349__";
    private readonly string projectRoot;
    private readonly string appDataRoot;
    private readonly WebView2 browser;
    private Process serverProcess;
    private bool ownsServer;

    private Kunming349Desktop()
    {
        projectRoot = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        appDataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Kunming349");
        Text = "昆医 349 · 药学综合";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleDimensions = new System.Drawing.SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Width = 1480;
        Height = 960;
        MinimumSize = new System.Drawing.Size(980, 680);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        browser = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(browser);
        Shown += async delegate { await InitializeAsync(); };
        FormClosed += delegate { StopOwnedServer(); };
    }

    [STAThread]
    private static void Main()
    {
        bool firstInstance;
        using (var instance = new System.Threading.Mutex(true, "Local\\Kunming349Desktop_8952", out firstInstance))
        {
            if (!firstInstance)
            {
                MessageBox.Show("昆医 349 已经在运行，请切换到已打开的窗口。", "昆医 349", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            EnablePerMonitorDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Kunming349Desktop());
            GC.KeepAlive(instance);
        }
    }

    private static void EnablePerMonitorDpiAwareness()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
        catch (EntryPointNotFoundException) { }
        catch (DllNotFoundException) { }
        try { if (SetProcessDpiAwareness(2) == 0) return; }
        catch (EntryPointNotFoundException) { }
        catch (DllNotFoundException) { }
        try { SetProcessDPIAware(); }
        catch { }
    }

    [DllImport("user32.dll", EntryPoint = "SetProcessDpiAwarenessContext")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();

    private async Task InitializeAsync()
    {
        try
        {
            Directory.CreateDirectory(appDataRoot);
            Directory.CreateDirectory(Path.Combine(appDataRoot, "WebView2"));
            Directory.CreateDirectory(Path.Combine(appDataRoot, "Profile"));
            await EnsureStudyServerAsync();
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(appDataRoot, "WebView2"));
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.Settings.IsZoomControlEnabled = true;
            browser.CoreWebView2.NavigationStarting += HandleNavigationStarting;
            browser.CoreWebView2.NewWindowRequested += HandleNewWindowRequested;
            browser.CoreWebView2.DownloadStarting += HandleDownloadStarting;
            browser.CoreWebView2.Navigate(Origin + StartPath);
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "无法启动昆医 349：\r\n\r\n" + error.Message +
                "\r\n\r\n请确认已安装 Microsoft Edge WebView2 Runtime，并检查项目文件完整性。",
                "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task EnsureStudyServerAsync()
    {
        string profilePath = Path.Combine(appDataRoot, "Profile", "profile.json");
        string expectedMarker = ProfileMarker(profilePath);
        if (await IsExpectedServerAsync(expectedMarker)) return;
        if (PortIsOccupied()) throw new InvalidOperationException("本机端口 8952 已被其他程序占用。");

        string python = FindPython();
        if (String.IsNullOrEmpty(python)) throw new InvalidOperationException("没有找到 Python 3。请安装 Python 3 后重新启动题库。");
        string scriptPath = Path.Combine(projectRoot, "local_study.py");
        if (!File.Exists(scriptPath)) throw new FileNotFoundException("本地学习服务文件不存在。", scriptPath);

        var info = new ProcessStartInfo
        {
            FileName = python,
            Arguments = Quote(scriptPath) + " --port " + Port + " --profile " + Quote(profilePath) + " --no-browser",
            WorkingDirectory = projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        serverProcess = new Process { StartInfo = info, EnableRaisingEvents = true };
        serverProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { LogServerOutput(e.Data); };
        serverProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { LogServerOutput(e.Data); };
        if (!serverProcess.Start()) throw new InvalidOperationException("本地学习服务没有启动。");
        ownsServer = true;
        serverProcess.BeginOutputReadLine();
        serverProcess.BeginErrorReadLine();

        for (int i = 0; i < 60; i++)
        {
            if (await IsExpectedServerAsync(expectedMarker)) return;
            if (serverProcess.HasExited)
                throw new InvalidOperationException("本地学习服务已退出。日志位置：" + Path.Combine(appDataRoot, "local-study.log"));
            await Task.Delay(250);
        }
        throw new TimeoutException("本地学习服务启动超时。日志位置：" + Path.Combine(appDataRoot, "local-study.log"));
    }

    private static string ProfileMarker(string profilePath)
    {
        string normalized = Path.GetFullPath(profilePath).ToLowerInvariant();
        using (var sha = SHA256.Create())
        {
            string digest = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(normalized)))
                .Replace("-", "").Substring(0, 16).ToLowerInvariant();
            return "Kunming349 profile v2:" + digest;
        }
    }

    private static async Task<bool> IsExpectedServerAsync(string expectedMarker)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Origin + MarkerPath);
            request.Timeout = 350;
            request.ReadWriteTimeout = 350;
            using (var response = (HttpWebResponse)await request.GetResponseAsync())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return response.StatusCode == HttpStatusCode.OK && (await reader.ReadToEndAsync()) == expectedMarker;
        }
        catch { return false; }
    }

    private static bool PortIsOccupied()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Origin + MarkerPath);
            request.Timeout = 400;
            using (var response = (HttpWebResponse)request.GetResponse()) return true;
        }
        catch (WebException error)
        {
            var response = error.Response as HttpWebResponse;
            if (response != null) { response.Dispose(); return true; }
            return false;
        }
        catch { return false; }
    }

    private static string FindPython()
    {
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim('"'), "python.exe");
            if (File.Exists(candidate)) return candidate;
        }
        string launcher = FindOnPath("py.exe");
        if (launcher == null) return null;
        try
        {
            var info = new ProcessStartInfo { FileName = launcher, Arguments = "-3 -c \"import sys;print(sys.executable)\"", UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using (var process = Process.Start(info))
            {
                string result = process.StandardOutput.ReadToEnd().Trim();
                process.WaitForExit(3000);
                if (process.ExitCode == 0 && File.Exists(result)) return result;
            }
        }
        catch { }
        return null;
    }

    private static string FindOnPath(string fileName)
    {
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim('"'), fileName);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    private void HandleNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsLocalUrl(e.Uri)) return;
        e.Cancel = true;
        OpenExternal(e.Uri);
    }

    private void HandleNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (IsLocalUrl(e.Uri)) browser.CoreWebView2.Navigate(e.Uri);
        else OpenExternal(e.Uri);
    }

    private static bool IsLocalUrl(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            uri.Scheme == Uri.UriSchemeHttp && uri.Host == "127.0.0.1" && uri.Port == Port;
    }

    private static void OpenExternal(string value)
    {
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch { }
    }

    private void HandleDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
    {
        using (var dialog = new SaveFileDialog())
        {
            string suggested = Path.GetFileName(e.ResultFilePath);
            dialog.FileName = String.IsNullOrWhiteSpace(suggested) ? "昆医349-学习资料.json" : suggested;
            dialog.Filter = "学习资料 (*.json;*.md;*.txt)|*.json;*.md;*.txt|JSON 文件 (*.json)|*.json|Markdown 文件 (*.md)|*.md|文本文件 (*.txt)|*.txt|所有文件 (*.*)|*.*";
            dialog.AddExtension = true;
            dialog.DefaultExt = Path.GetExtension(dialog.FileName).TrimStart('.');
            if (String.IsNullOrWhiteSpace(dialog.DefaultExt)) dialog.DefaultExt = "json";
            if (dialog.ShowDialog(this) != DialogResult.OK) { e.Cancel = true; return; }
            e.ResultFilePath = dialog.FileName;
            e.Handled = true;
        }
    }

    private void LogServerOutput(string line)
    {
        if (String.IsNullOrWhiteSpace(line)) return;
        try { File.AppendAllText(Path.Combine(appDataRoot, "local-study.log"), line + Environment.NewLine, Encoding.UTF8); }
        catch { }
    }

    private void StopOwnedServer()
    {
        if (!ownsServer || serverProcess == null) return;
        try { if (!serverProcess.HasExited) serverProcess.Kill(); }
        catch { }
        serverProcess.Dispose();
    }
}
