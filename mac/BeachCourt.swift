// Beach Court — turns the Mac desktop into a beach basketball court.
//
// Two windows host the web layers (../web):
//   court   — just under the Finder icons: sand, sea, court
//   overlay — just over the Finder icons: hoop and paper balls. Clicks pass through it except
//             on a ball or the backboard, and it takes the keyboard only while a ball is in hand.
// A pinch on the desktop (or the menu-bar item) crumples the selected desktop files into a ball.
// While they're a ball the files wait in a hidden folder on the Desktop; when the ball goes in
// they move to ~/Documents/篮筐/<date>; unfolding a ball puts them back where they were.
// Nothing is ever deleted, and quitting returns every ball's files to the Desktop.

import AppKit
import WebKit
import QuickLookThumbnailing
import Carbon.HIToolbox

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/BeachCourt.log")

func log(_ s: String) {
    let line = "\(Date().formatted(.iso8601)) \(s)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.write(to: logURL, atomically: true, encoding: .utf8) }
}

// MARK: - Files

let env = ProcessInfo.processInfo.environment

enum Paths {
    // BEACH_HOME points everything at a scratch folder (used by the self-test)
    static let home = env["BEACH_HOME"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.homeDirectoryForCurrentUser
    static let desktop = home.appendingPathComponent("Desktop", isDirectory: true)
    static let staging = desktop.appendingPathComponent(".beach-court", isDirectory: true)   // hidden, so Finder doesn't show it
    static let basket = home.appendingPathComponent("Documents/篮筐", isDirectory: true)
    static let shots = home.appendingPathComponent("Library/Application Support/BeachCourt/shots.json")
    static let stats = home.appendingPathComponent("Library/Application Support/BeachCourt/stats.json")
}

/// Every made shot, newest last: where each file is now and where its icon sat on the desktop.
struct Shot: Codable {
    struct File: Codable { let name: String; let path: String; let x: Double; let y: Double }
    let date: Date
    var files: [File]
}

enum ShotLog {
    static func load() -> [Shot] { (try? JSONDecoder().decode([Shot].self, from: Data(contentsOf: Paths.shots))) ?? [] }
    static func save(_ shots: [Shot]) {
        try? FileManager.default.createDirectory(at: Paths.shots.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(shots) { try? data.write(to: Paths.shots, options: .atomic) }
    }
}

func jsonString(_ object: Any) -> String? {
    (try? JSONSerialization.data(withJSONObject: object)).flatMap { String(data: $0, encoding: .utf8) }
}

/// A system-wide shortcut (Carbon hot key: works while other apps are in front, needs no permission).
final class HotKey {
    private static var actions: [UInt32: () -> Void] = [:]
    private var ref: EventHotKeyRef?

    init(id: UInt32, keyCode: Int, modifiers: Int, action: @escaping () -> Void) {
        if HotKey.actions.isEmpty {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
                var key = EventHotKeyID()
                GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                  MemoryLayout<EventHotKeyID>.size, nil, &key)
                DispatchQueue.main.async { HotKey.actions[key.id]?() }
                return noErr
            }, 1, &spec, nil, nil)
        }
        HotKey.actions[id] = action
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), EventHotKeyID(signature: OSType(0x4243_5254), id: id),
                                         GetApplicationEventTarget(), 0, &ref)
        if status != noErr { log("shortcut \(id) not registered (\(status)) — another app may already use it") }
    }
}

/// `name` in `dir`, or "name 2", "name 3"… if it's taken.
func freeURL(in dir: URL, for name: String) -> URL {
    let ext = (name as NSString).pathExtension, base = (name as NSString).deletingPathExtension
    var url = dir.appendingPathComponent(name), n = 2
    while FileManager.default.fileExists(atPath: url.path) {
        url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
        n += 1
    }
    return url
}

func removeIfEmpty(_ dir: URL) {
    if (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?.isEmpty == true { try? FileManager.default.removeItem(at: dir) }
}

struct BallFile {
    let name: String
    let staged: URL
    let position: CGPoint   // Finder desktop position: icon centre, from the top-left of the main screen
}

// MARK: - Finder

enum Finder {
    @discardableResult
    static func run(_ source: String) -> NSAppleEventDescriptor? {
        if env["BEACH_NO_FINDER"] != nil || env["BEACH_SELFTEST"] != nil { return nil }
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error { log("AppleScript: \(error)") }
        return result
    }

    static func quote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    /// The selected items that sit on the desktop, with their icon positions.
    static func desktopSelection() -> [(url: URL, position: CGPoint)] {
        let text = run("""
        tell application "Finder"
            set out to ""
            repeat with f in (get selection)
                try
                    set p to desktop position of f
                    set out to out & (POSIX path of (f as alias)) & tab & (item 1 of p) & tab & (item 2 of p) & linefeed
                end try
            end repeat
            return out
        end tell
        """)?.stringValue ?? ""
        return text.split(separator: "\n").compactMap { line in
            let parts = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard parts.count == 3, let x = Double(parts[1]), let y = Double(parts[2]) else { return nil }
            var path = String(parts[0])
            if path.count > 1 && path.hasSuffix("/") { path.removeLast() }
            let url = URL(fileURLWithPath: path)
            // only real files in ~/Desktop — never disks or anything else Finder shows there
            guard url.deletingLastPathComponent().standardizedFileURL.path == Paths.desktop.standardizedFileURL.path,
                  url.lastPathComponent != Paths.staging.lastPathComponent else { return nil }
            return (url, CGPoint(x: x, y: y))
        }
    }

    /// Put desktop items (by file name) back at given positions.
    static func place(_ items: [(name: String, position: CGPoint)]) {
        guard !items.isEmpty else { return }
        let lines = items.map { "try\nset desktop position of item \(quote($0.name)) of desktop to {\(Int($0.position.x)), \(Int($0.position.y))}\nend try" }
        run("tell application \"Finder\"\n\(lines.joined(separator: "\n"))\nend tell")
    }

    static var iconSize: Int {
        let d = UserDefaults(suiteName: "com.apple.finder")?.dictionary(forKey: "DesktopViewSettings")
        return ((d?["IconViewSettings"] as? [String: Any])?["iconSize"] as? Int) ?? 64
    }
}

// MARK: - Icons

enum Icons {
    /// What Finder shows for each file (its preview when it has one), as PNG data URLs.
    static func dataURLs(for urls: [URL], size: CGFloat, done: @escaping ([String]) -> Void) {
        let scale = NSScreen.screens.first?.backingScaleFactor ?? 2
        var images = [NSImage?](repeating: nil, count: urls.count)
        var finished = [Bool](repeating: false, count: urls.count)
        let state = DispatchQueue(label: "icons")
        let group = DispatchGroup()
        for (i, url) in urls.enumerated() {
            group.enter()
            let finish: (NSImage?) -> Void = { img in
                state.sync {
                    guard !finished[i] else { return }
                    finished[i] = true
                    images[i] = img
                    group.leave()
                }
            }
            let req = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: size, height: size), scale: scale, representationTypes: [.icon, .thumbnail])
            req.iconMode = true
            QLThumbnailGenerator.shared.generateBestRepresentation(for: req) { rep, _ in finish(rep?.nsImage) }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { finish(nil) }
        }
        group.notify(queue: .main) {
            done(zip(urls, images).map { url, img in png(img ?? NSWorkspace.shared.icon(forFile: url.path), size: size, scale: scale) })
        }
    }

    static func png(_ image: NSImage, size: CGFloat, scale: CGFloat) -> String {
        let px = Int(size * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return "" }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let s = image.size, k = min(CGFloat(px) / max(1, s.width), CGFloat(px) / max(1, s.height))
        let w = s.width * k, h = s.height * k
        image.draw(in: NSRect(x: (CGFloat(px) - w) / 2, y: (CGFloat(px) - h) / 2, width: w, height: h))
        NSGraphicsContext.restoreGraphicsState()
        return "data:image/png;base64," + (rep.representation(using: .png, properties: [:])?.base64EncodedString() ?? "")
    }
}

// MARK: - Web views

/// Serves ../web from the app bundle as court://app/…
final class WebFiles: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css",
                     "png": "image/png", "svg": "image/svg+xml", "json": "application/json"]
        let headers = ["Content-Type": types[file.pathExtension.lowercased()] ?? "application/octet-stream", "Content-Length": "\(data.count)",
                       "Cache-Control": "no-store"]   // the files change while the app runs; never reuse a copy
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class CourtWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class OverlayPanel: NSPanel {
    var wantsKey = false
    override var canBecomeKey: Bool { wantsKey }
    override var canBecomeMain: Bool { false }
}

let consoleBridge = """
(() => {
  const post = (level, text) => { try { window.webkit.messageHandlers.court.postMessage({ type: 'log', level, text }); } catch (e) {} };
  for (const k of ['log', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { o(...a); post(k, a.map(String).join(' ')); }; }
  addEventListener('error', (e) => post('error', e.message + ' @ ' + e.filename + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => post('error', 'unhandled: ' + e.reason));
})();
"""

// MARK: - App

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate, WKScriptMessageHandler {
    var court: NSWindow!
    var overlay: OverlayPanel!
    var courtView: CourtWebView!
    var overlayView: CourtWebView!
    var status: NSStatusItem!
    var toggleItem: NSMenuItem!
    var undoItem: NSMenuItem!
    var undoAllItem: NSMenuItem!
    var pinchItem: NSMenuItem!
    var webWatch: FSEventStreamRef?
    var reloadPending = false
    var reloads = 0
    var debugQuery = ""

    func page(_ layer: String) -> URL { URL(string: "court://app/index.html?layer=\(layer)&time=\(timeMode)\(debugQuery)&v=\(reloads)")! }

    // time of day: noon is the original look; auto follows the clock
    static let times: [(title: String, mode: String)] = [("正午（原版）", "noon"), ("早晨", "morning"), ("黄昏", "dusk"), ("夜晚", "night"), ("跟随时间", "auto")]
    var timeMode = UserDefaults.standard.string(forKey: "timeOfDay") ?? "auto"   // follow the clock unless a time was picked
    var timeItems: [NSMenuItem] = []
    var hotKeys: [HotKey] = []
    var pinchTap: CFMachPort?

    var pending: [Int: [(url: URL, position: CGPoint)]] = [:]   // shown as a ball, files not moved yet
    var balls: [Int: [BallFile]] = [:]
    var ballMade: [Int: Date] = [:]   // so ⌃⌥Z can undo whichever happened last
    var nextID = 1

    // where the overlay should take the mouse (window points, top-left origin)
    var circles: [(x: CGFloat, y: CGFloat, r: CGFloat)] = []
    var board = CGRect.zero
    var scoreRect = CGRect.zero
    var holding = false
    var aiming = false
    var lastPointer = CGPoint(x: -1, y: -1)
    var pinch: CGFloat = 0
    var pinchFired = false
    var sawPinch = false

    var screen: NSScreen { NSScreen.screens[0] }
    let iconLevel = Int(CGWindowLevelForKey(.desktopIconWindow))

    func applicationDidFinishLaunching(_ note: Notification) {
        log("launch")
        if env["BEACH_SELFTEST"] != nil && env["BEACH_HOME"] != nil { selfTest(); return }
        recoverStaging()
        // Built inside the project (beach-court/mac/build/海边球场.app)? Then use beach-court/web directly and
        // reload when it changes, so changes to the court need neither a rebuild nor a re-sign.
        let project = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web")
        let live = FileManager.default.fileExists(atPath: project.appendingPathComponent("index.html").path)
        let web = live ? project : Bundle.main.resourceURL!.appendingPathComponent("web")
        log("court files: \(web.path) · time of day: \(timeMode)")
        debugQuery = ProcessInfo.processInfo.environment["BEACH_DEBUG"] != nil ? "&debug" : ""

        courtView = makeWebView(root: web, transparent: false)
        court = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        configure(court, level: iconLevel - 1)
        court.ignoresMouseEvents = true
        court.backgroundColor = NSColor(red: 0.91, green: 0.81, blue: 0.63, alpha: 1)
        court.contentView = courtView

        overlayView = makeWebView(root: web, transparent: true)
        overlay = OverlayPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        configure(overlay, level: iconLevel + 1)
        overlay.isOpaque = false
        overlay.backgroundColor = .clear
        overlay.hasShadow = false
        overlay.ignoresMouseEvents = true
        overlay.becomesKeyOnlyIfNeeded = false
        overlay.hidesOnDeactivate = false
        overlay.contentView = overlayView

        courtView.load(URLRequest(url: page("back")))
        overlayView.load(URLRequest(url: page("front")))
        if live { watchWeb(web) }
        court.orderFrontRegardless()
        overlay.orderFrontRegardless()

        buildMenu()
        watchInput()
        Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.court.setFrame(self.screen.frame, display: true)
            self.overlay.setFrame(self.screen.frame, display: true)
        }
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: court, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.js(self.courtView, "window.court?.pause(\(!self.court.occlusionState.contains(.visible)))")
        }
        if let prefix = ProcessInfo.processInfo.environment["BEACH_SNAPSHOT"] { snapshot(to: prefix) }
    }

    /// Debug: save what each layer renders, without needing screen recording.
    func snapshot(to prefix: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            for (view, name) in [(self.courtView!, "back"), (self.overlayView!, "front")] {
                view.evaluateJavaScript("court.snap()") { result, err in
                    guard let url = result as? String, let comma = url.firstIndex(of: ","),
                          let png = Data(base64Encoded: String(url[url.index(after: comma)...])) else {
                        log("snapshot \(name) failed: \(String(describing: err))"); return
                    }
                    try? png.write(to: URL(fileURLWithPath: "\(prefix)-\(name).png"))
                    log("snapshot \(name) saved")
                }
            }
        }
    }

    // opening the app again (e.g. double-clicking it in Finder) shows the menu at the pointer
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        status.menu?.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        return false
    }

    func applicationWillTerminate(_ note: Notification) {
        for id in Array(balls.keys) { unfold(id, animate: false, quitting: true) }
        log("quit")
    }

    func configure(_ w: NSWindow, level: Int) {
        w.level = NSWindow.Level(rawValue: level)
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        w.isReleasedWhenClosed = false
        w.animationBehavior = .none
    }

    func makeWebView(root: URL, transparent: Bool) -> CourtWebView {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(WebFiles(root: root), forURLScheme: "court")
        cfg.userContentController.add(self, name: "court")
        cfg.userContentController.addUserScript(WKUserScript(source: consoleBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .nonPersistent()
        let v = CourtWebView(frame: screen.frame, configuration: cfg)
        v.isInspectable = true
        if transparent { v.setValue(false, forKey: "drawsBackground") }
        return v
    }

    func js(_ view: WKWebView?, _ code: String) {
        view?.evaluateJavaScript(code) { _, error in if let error { log("js error: \(error.localizedDescription) in \(code.prefix(80))") } }
    }

    // MARK: menu bar

    func buildMenu() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "basketball", accessibilityDescription: "海边球场")
        let menu = NSMenu()
        let crumpleItem = NSMenuItem(title: "把选中的桌面文件揉成纸团", action: #selector(crumpleSelection), keyEquivalent: "x")
        crumpleItem.keyEquivalentModifierMask = [.control, .option]
        menu.addItem(crumpleItem)
        menu.addItem(NSMenuItem(title: "打开篮筐", action: #selector(openBasket), keyEquivalent: ""))
        undoItem = NSMenuItem(title: "把上一个纸团放回桌面", action: #selector(undoLast), keyEquivalent: "z")
        undoItem.keyEquivalentModifierMask = [.control, .option]
        menu.addItem(undoItem)
        undoAllItem = NSMenuItem(title: "把篮筐里的全部放回桌面", action: #selector(restoreAllShots), keyEquivalent: "")
        menu.addItem(undoAllItem)
        menu.addItem(.separator())
        let timeMenu = NSMenu()
        for t in App.times {
            let item = NSMenuItem(title: t.title, action: #selector(chooseTime(_:)), keyEquivalent: "")
            item.representedObject = t.mode
            item.target = self
            item.state = t.mode == timeMode ? .on : .off
            timeMenu.addItem(item)
            timeItems.append(item)
        }
        let timeItem = NSMenuItem(title: "时段", action: nil, keyEquivalent: "")
        timeItem.submenu = timeMenu
        menu.addItem(timeItem)
        menu.addItem(NSMenuItem(title: "记分牌清零", action: #selector(resetStats), keyEquivalent: ""))
        pinchItem = NSMenuItem(title: "开启双指捏合（需要「输入监控」）…", action: #selector(openInputMonitoring), keyEquivalent: "")
        menu.addItem(pinchItem)
        menu.addItem(.separator())
        toggleItem = NSMenuItem(title: "收起球场", action: #selector(toggleCourt), keyEquivalent: "")
        menu.addItem(toggleItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出（纸团里的文件会回到桌面）", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        menu.autoenablesItems = false
        menu.delegate = self
        status.menu = menu
        // ⌃⌥X: crumple the selected desktop files; ⌃⌥Z: put the last shot back (press again for the one before)
        hotKeys.append(HotKey(id: 1, keyCode: kVK_ANSI_Z, modifiers: controlKey | optionKey) { [weak self] in self?.undoLast() })
        hotKeys.append(HotKey(id: 2, keyCode: kVK_ANSI_X, modifiers: controlKey | optionKey) { [weak self] in
            log("crumple via ⌃⌥X"); self?.crumpleSelection()
        })
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        pinchItem.isHidden = CGPreflightListenEventAccess()
        let shots = ShotLog.load()
        let all = shots.reduce(0) { $0 + $1.files.count }
        switch nextUndo(shots) {
        case .ball(let id): undoItem.title = "把场上的纸团拆开放回（\(balls[id]?.count ?? 0) 个文件）"; undoItem.isEnabled = true
        case .shot(let n): undoItem.title = "把上一球放回桌面（\(n) 个文件）"; undoItem.isEnabled = true
        case .none: undoItem.title = "把上一个纸团放回桌面"; undoItem.isEnabled = false
        }
        undoAllItem.title = all > 0 ? "把篮筐里的全部放回桌面（\(all) 个文件）" : "把篮筐里的全部放回桌面"
        undoAllItem.isEnabled = all > 0
    }

    @objc func toggleCourt() {
        if court.isVisible {
            court.orderOut(nil); overlay.orderOut(nil); toggleItem.title = "摆出球场"
        } else {
            court.orderFrontRegardless(); overlay.orderFrontRegardless(); toggleItem.title = "收起球场"
        }
    }

    @objc func quit() { NSApp.terminate(nil) }

    @objc func chooseTime(_ item: NSMenuItem) {
        guard let mode = item.representedObject as? String else { return }
        timeMode = mode
        UserDefaults.standard.set(mode, forKey: "timeOfDay")
        for i in timeItems { i.state = (i.representedObject as? String) == mode ? .on : .off }
        for view in [courtView, overlayView] { js(view, "court.setTime('\(mode)')") }
        log("time of day: \(mode)")
    }

    @objc func openInputMonitoring() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!)
    }

    // MARK: live court files

    func watchWeb(_ dir: URL) {
        var ctx = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            Unmanaged<App>.fromOpaque(info).takeUnretainedValue().webChanged()
        }
        guard let stream = FSEventStreamCreate(nil, callback, &ctx, [dir.path] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
                                               0.3, FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents)) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        webWatch = stream
    }

    func webChanged() {
        guard !reloadPending else { return }
        reloadPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            self.reloadPending = false
            // a reloaded court forgets its balls, so their files go back to the desktop first
            for id in Array(self.balls.keys) { self.unfold(id, animate: false) }
            self.pending.removeAll()
            self.setAiming(false)
            log("court files changed — reloading")
            // drop WebKit's cached scripts, then open the pages afresh so every module is read from disk
            self.reloads += 1
            let caches: Set<String> = [WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeDiskCache]
            for (view, layer) in [(self.courtView!, "back"), (self.overlayView!, "front")] {
                view.configuration.websiteDataStore.removeData(ofTypes: caches, modifiedSince: .distantPast) {
                    view.load(URLRequest(url: self.page(layer)))
                }
            }
        }
    }

    // MARK: scoreboard numbers (made / attempts), kept across launches

    func loadStats() -> (made: Int, attempts: Int) {
        guard let data = try? Data(contentsOf: Paths.stats),
              let d = try? JSONSerialization.jsonObject(with: data) as? [String: Int] else { return (0, 0) }
        return (d["made"] ?? 0, d["attempts"] ?? 0)
    }

    func saveStats(made: Int, attempts: Int) {
        try? FileManager.default.createDirectory(at: Paths.stats.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: ["made": made, "attempts": attempts]) { try? data.write(to: Paths.stats, options: .atomic) }
    }

    @objc func resetStats() {
        saveStats(made: 0, attempts: 0)
        js(overlayView, "court.setStats(0, 0)")
    }

    @objc func openBasket() {
        try? FileManager.default.createDirectory(at: Paths.basket, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Paths.basket)
    }

    // MARK: input

    func watchInput() {
        // a click anywhere else puts the ball in hand down
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.aiming else { return }
            self.js(self.overlayView, "court.outside()")
        }
        // Pinch on the desktop crumples the selection. Other apps' trackpad gestures only reach
        // us through an event tap, which needs Input Monitoring permission once.
        let mask: CGEventMask = (1 << 29) | (1 << 30)   // gesture, magnify
        let callback: CGEventTapCallBack = { _, type, event, info in
            guard let info else { return Unmanaged.passUnretained(event) }
            let app = Unmanaged<App>.fromOpaque(info).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = app.pinchTap { CGEvent.tapEnable(tap: tap, enable: true) }
            } else if let e = NSEvent(cgEvent: event), e.type == .magnify {
                DispatchQueue.main.async { app.pinched(e) }
            }
            return Unmanaged.passUnretained(event)
        }
        pinchTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                     eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque())
        if let tap = pinchTap {
            CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            let granted = CGPreflightListenEventAccess()
            log("pinch: listening (input monitoring \(granted ? "granted" : "not granted — asking"))")
            // ask once; after that the menu has a shortcut to the setting
            if !granted && !UserDefaults.standard.bool(forKey: "askedInputMonitoring") {
                UserDefaults.standard.set(true, forKey: "askedInputMonitoring")
                CGRequestListenEventAccess()
            }
        } else {
            log("pinch: needs Input Monitoring — asking")
            CGRequestListenEventAccess()
        }
    }

    func pinched(_ e: NSEvent) {
        if !sawPinch { sawPinch = true; log("pinch events are arriving") }
        if e.phase.contains(.began) { pinch = 0; pinchFired = false }
        pinch += e.magnification
        if !pinchFired && pinch < -0.22 {
            pinchFired = true
            let onDesktop = pointerOnDesktop()
            log("pinch in (pointer on desktop: \(onDesktop))")
            if onDesktop { crumpleSelection() }
        }
        if e.phase.contains(.ended) || e.phase.contains(.cancelled) { pinch = 0; pinchFired = false }
    }

    /// Finder is in front and no window is under the pointer.
    func pointerOnDesktop() -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder" else { return false }
        let m = NSEvent.mouseLocation
        let p = CGPoint(x: m.x, y: screen.frame.maxY - m.y)
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let dock = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first?.processIdentifier
        for w in windows {
            // the Dock keeps a transparent full-screen window; it doesn't hide the desktop
            if let dock, (w[kCGWindowOwnerPID as String] as? Int32) == dock { continue }
            guard let layer = w[kCGWindowLayer as String] as? Int, layer >= 0,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: b) else { continue }
            if rect.contains(p) { return false }
        }
        return true
    }

    func tick() {
        let m = NSEvent.mouseLocation, f = screen.frame
        let p = CGPoint(x: m.x - f.minX, y: f.maxY - m.y)
        let over = holding || board.contains(p) || scoreRect.contains(p) || circles.contains { hypot(p.x - $0.x, p.y - $0.y) < $0.r }
        if overlay.ignoresMouseEvents == over { overlay.ignoresMouseEvents = !over }
        if aiming && p != lastPointer {
            lastPointer = p
            js(overlayView, "court.pointer(\(Int(p.x)),\(Int(p.y)))")
        }
    }

    func setAiming(_ on: Bool) {
        guard on != aiming else { return }
        aiming = on
        if on {
            overlay.wantsKey = true
            overlay.makeKeyAndOrderFront(nil)
            overlay.makeFirstResponder(overlayView)
        } else {
            // hand the keyboard back to Finder: Space is Quick Look again
            overlay.wantsKey = false
            if overlay.isKeyWindow { overlay.orderOut(nil); overlay.orderFrontRegardless() }
        }
    }

    // MARK: messages from the web layers

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let num = { (v: Any?) -> CGFloat in CGFloat((v as? NSNumber)?.doubleValue ?? 0) }
        let id = (body["id"] as? NSNumber)?.intValue ?? 0
        switch type {
        case "log":
            log("web \(body["level"] ?? ""): \(body["text"] ?? "")")
        case "hit":
            circles = (body["circles"] as? [[String: Any]] ?? []).map { (num($0["x"]), num($0["y"]), num($0["r"])) }
            if let h = body["hoop"] as? [String: Any] { board = CGRect(x: num(h["x"]), y: num(h["y"]), width: num(h["w"]), height: num(h["h"])) }
            if let h = body["score"] as? [String: Any] { scoreRect = CGRect(x: num(h["x"]), y: num(h["y"]), width: num(h["w"]), height: num(h["h"])) }
            holding = body["holding"] as? Bool ?? false
            setAiming(body["aiming"] as? Bool ?? false)
        case "covered": stash(id)
        case "banked": bank(id)
        case "unpack": unfold(id, animate: true)
        case "openBasket": openBasket()
        case "menu":
            // the scoreboard was clicked: the menu-bar menu, right there (the icon may be hidden behind the notch)
            let at = overlayView.convert(NSPoint(x: num(body["x"]), y: overlay.frame.height - num(body["y"])), from: nil)
            NSApp.activate()
            status.menu?.popUp(positioning: nil, at: at, in: overlayView)
        case "stats":
            saveStats(made: (body["made"] as? NSNumber)?.intValue ?? 0, attempts: (body["attempts"] as? NSNumber)?.intValue ?? 0)
        case "ready" where body["layer"] as? String == "front":
            let s = loadStats()
            js(overlayView, "court.setStats(\(s.made), \(s.attempts))")
        default: break
        }
    }

    // MARK: crumple → ball → basket

    @objc func crumpleSelection() {
        let picked = Finder.desktopSelection()
        guard !picked.isEmpty else { log("nothing selected on the desktop"); return }
        let id = nextID
        nextID += 1
        pending[id] = picked
        let size = CGFloat(Finder.iconSize)
        log("crumple #\(id): \(picked.map { "\($0.url.lastPathComponent)@\(Int($0.position.x)),\(Int($0.position.y))" }.joined(separator: " "))")
        Icons.dataURLs(for: picked.map(\.url), size: size) { srcs in
            let items: [[String: Any]] = zip(picked, srcs).map { pick, src in
                ["name": FileManager.default.displayName(atPath: pick.url.path), "src": src, "x": pick.position.x, "y": pick.position.y]
            }
            guard let json = jsonString(items) else { return }
            self.js(self.overlayView, "void court.crumple(\(id), \(json), \(Int(size)))")
        }
    }

    /// The ball now covers the icons: move its files off the desktop.
    func stash(_ id: Int) {
        guard let picked = pending.removeValue(forKey: id) else { return }
        let dir = Paths.staging.appendingPathComponent("ball-\(id)-\(Int(Date().timeIntervalSince1970))", isDirectory: true)
        do { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        catch { log("can't create \(dir.path): \(error)"); return }
        var files: [BallFile] = []
        for pick in picked {
            let dest = dir.appendingPathComponent(pick.url.lastPathComponent)
            do {
                try FileManager.default.moveItem(at: pick.url, to: dest)
                files.append(BallFile(name: pick.url.lastPathComponent, staged: dest, position: pick.position))
            } catch { log("can't move \(pick.url.lastPathComponent): \(error.localizedDescription)") }
        }
        balls[id] = files
        ballMade[id] = Date()
        log("ball #\(id): \(files.count) file(s) off the desktop")
    }

    /// The ball went in: its files go into the basket folder.
    func bank(_ id: Int) {
        guard let files = balls.removeValue(forKey: id) else { return }
        let day = Paths.basket.appendingPathComponent(Date().formatted(.iso8601.year().month().day()), isDirectory: true)
        try? FileManager.default.createDirectory(at: day, withIntermediateDirectories: true)
        var shot = Shot(date: Date(), files: [])
        for f in files {
            let dest = freeURL(in: day, for: f.name)
            do {
                try FileManager.default.moveItem(at: f.staged, to: dest)
                shot.files.append(.init(name: f.name, path: dest.path, x: f.position.x, y: f.position.y))
            } catch { log("can't bank \(f.name): \(error.localizedDescription)") }
        }
        if let dir = files.first?.staged.deletingLastPathComponent() { removeIfEmpty(dir) }
        removeIfEmpty(Paths.staging)
        if !shot.files.isEmpty { ShotLog.save(ShotLog.load() + [shot]) }
        log("banked #\(id): \(shot.files.count) files → \(day.path)")
    }

    // MARK: putting things back

    enum Undo { case ball(Int), shot(Int), none }

    /// The newest of: a ball still in play, or the last shot that went in.
    func nextUndo(_ shots: [Shot]) -> Undo {
        let ball = balls.keys.max { (ballMade[$0] ?? .distantPast) < (ballMade[$1] ?? .distantPast) }
        let ballDate = ball.flatMap { ballMade[$0] } ?? .distantPast
        if let last = shots.last, last.date > ballDate { return .shot(last.files.count) }
        if let ball { return .ball(ball) }
        return .none
    }

    /// ⌃⌥Z: undo the last crumple — unfold it if it's still on the court, take it out of the basket if it went in.
    @objc func undoLast() {
        switch nextUndo(ShotLog.load()) {
        case .ball(let id):
            log("undo: unfold ball #\(id)")
            guard let view = overlayView else { unfold(id, animate: false); return }
            // the court animates it and reports back; if it doesn't know the ball, put the files back directly
            view.evaluateJavaScript("court.unpackBall(\(id))") { result, _ in
                if (result as? Bool) != true { self.unfold(id, animate: false) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if self.balls[id] != nil { self.unfold(id, animate: false) } }
        case .shot:
            log("undo: put back the last shot")
            restoreLastShot()
        case .none:
            NSSound.beep()
        }
    }

    @objc func restoreLastShot() {
        var shots = ShotLog.load()
        guard let last = shots.popLast() else { NSSound.beep(); return }
        ShotLog.save(shots)
        restore(last.files)
    }

    @objc func restoreAllShots() {
        let shots = ShotLog.load()
        guard !shots.isEmpty else { NSSound.beep(); return }
        ShotLog.save([])
        restore(shots.flatMap(\.files))
    }

    /// The files fly back out of the hoop and land where their icons were.
    func restore(_ files: [Shot.File]) {
        let fm = FileManager.default
        let here = files.filter { fm.fileExists(atPath: $0.path) }
        if here.count < files.count { log("\(files.count - here.count) file(s) no longer in the basket, skipped") }
        guard !here.isEmpty else { NSSound.beep(); return }
        let id = nextID
        nextID += 1
        let size = CGFloat(Finder.iconSize)
        Icons.dataURLs(for: here.map { URL(fileURLWithPath: $0.path) }, size: size) { srcs in
            let items: [[String: Any]] = zip(here, srcs).map { f, src in
                ["name": fm.displayName(atPath: f.path), "src": src, "x": f.x, "y": f.y]
            }
            if let json = jsonString(items) { self.js(self.overlayView, "court.fromHoop(\(id), \(json), \(Int(size)))") }
            // the real files land as the copies arrive
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                var placed: [(name: String, position: CGPoint)] = []
                for f in here {
                    let src = URL(fileURLWithPath: f.path), dest = freeURL(in: Paths.desktop, for: f.name)
                    do { try fm.moveItem(at: src, to: dest); placed.append((dest.lastPathComponent, CGPoint(x: f.x, y: f.y))) }
                    catch { log("can't put back \(f.name): \(error.localizedDescription)") }
                    removeIfEmpty(src.deletingLastPathComponent())
                }
                log("put back \(placed.count) file(s)")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    Finder.place(placed)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.js(self.overlayView, "court.restored(\(id))") }
                }
            }
        }
    }

    /// BEACH_SELFTEST with BEACH_HOME=<scratch folder>, on scratch files only: a shot that goes in,
    /// then a ball that stays on the court; ⌃⌥Z twice must undo the ball first, then the shot.
    func selfTest() {
        let fm = FileManager.default
        try? fm.createDirectory(at: Paths.desktop, withIntermediateDirectories: true)
        let a = Paths.desktop.appendingPathComponent("测试 A.txt"), b = Paths.desktop.appendingPathComponent("测试文件夹")
        let c = Paths.desktop.appendingPathComponent("测试 C.txt")
        try? "a".write(to: a, atomically: true, encoding: .utf8)
        try? "c".write(to: c, atomically: true, encoding: .utf8)
        try? fm.createDirectory(at: b, withIntermediateDirectories: true)
        var ok = true
        func check(_ cond: Bool, _ what: String) { log("selftest \(cond ? "ok  " : "FAIL") \(what)"); ok = ok && cond }
        pending[900] = [(a, CGPoint(x: 1300, y: 200)), (b, CGPoint(x: 1300, y: 310))]
        stash(900)
        check(!fm.fileExists(atPath: a.path) && !fm.fileExists(atPath: b.path), "files left the desktop")
        bank(900)
        let shots = ShotLog.load()
        check(shots.count == 1 && shots[0].files.count == 2, "shot recorded")
        check(shots.first?.files.allSatisfy { fm.fileExists(atPath: $0.path) } == true, "files are in the basket")
        pending[901] = [(c, CGPoint(x: 1200, y: 420))]
        stash(901)
        check(!fm.fileExists(atPath: c.path) && balls[901] != nil, "missed ball holds its file")
        undoLast()
        check(fm.fileExists(atPath: c.path) && balls.isEmpty, "first ⌃⌥Z unfolds the ball on the court")
        check(!fm.fileExists(atPath: a.path) && ShotLog.load().count == 1, "…and leaves the made shot alone")
        undoLast()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            check(fm.fileExists(atPath: a.path) && fm.fileExists(atPath: b.path), "second ⌃⌥Z puts the shot back")
            check(ShotLog.load().isEmpty, "shot log emptied")
            check((try? fm.contentsOfDirectory(atPath: Paths.staging.path)) == nil, "no staging left")
            log("selftest \(ok ? "PASSED" : "FAILED")")
            NSApp.terminate(nil)
        }
    }

    /// The ball was unfolded: files go back to the desktop, where they were.
    func unfold(_ id: Int, animate: Bool, quitting: Bool = false) {
        guard let files = balls.removeValue(forKey: id) else { return }
        ballMade[id] = nil
        var placed: [(name: String, position: CGPoint)] = []
        for f in files {
            let dest = freeURL(in: Paths.desktop, for: f.name)
            do { try FileManager.default.moveItem(at: f.staged, to: dest); placed.append((dest.lastPathComponent, f.position)) }
            catch { log("can't return \(f.name): \(error.localizedDescription)") }
        }
        if let dir = files.first?.staged.deletingLastPathComponent() { removeIfEmpty(dir) }
        removeIfEmpty(Paths.staging)
        log("unfolded #\(id): \(placed.count) file(s) back on the desktop")
        // Finder needs a moment to notice the files before they can be placed
        if quitting { Thread.sleep(forTimeInterval: 0.5); Finder.place(placed); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            Finder.place(placed)
            if animate { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.js(self.overlayView, "court.restored(\(id))") } }
        }
    }

    /// Anything left in the hidden folder (the app was killed mid-game) goes back to the desktop.
    func recoverStaging() {
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(at: Paths.staging, includingPropertiesForKeys: nil) else { return }
        for dir in dirs {
            for item in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] {
                do { try fm.moveItem(at: item, to: freeURL(in: Paths.desktop, for: item.lastPathComponent)); log("recovered \(item.lastPathComponent)") }
                catch { log("can't recover \(item.lastPathComponent): \(error.localizedDescription)") }
            }
            removeIfEmpty(dir)
        }
        removeIfEmpty(Paths.staging)
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
// a plain `kill` quits normally too, so balls in play still go back to the desktop
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()
app.run()
