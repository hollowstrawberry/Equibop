/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import dbus from "@homebridge/dbus-native";
import {
    app,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    dialog,
    Menu,
    MenuItemConstructorOptions,
    nativeTheme,
    screen,
    session,
    systemPreferences,
    Tray
} from "electron";
import { rm } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { ICON_PATH } from "shared/paths";
import { isTruthy } from "shared/utils/guards";
import { once } from "shared/utils/once";
import type { SettingsStore } from "shared/utils/SettingsStore";

import { createAboutWindow } from "./about";
import { initArRPC } from "./arrpc";
import {
    BrowserUserAgent,
    DATA_DIR,
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    MessageBoxChoice,
    MIN_HEIGHT,
    MIN_WIDTH,
    VENCORD_DIR
} from "./constants";
import { Settings, State, VencordSettings } from "./settings";
import { setTrayIcon } from "./tray";
import { addOneTaskSplash, addSplashLog, getSplash } from "./utils/detailedLog";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { applyDeckKeyboardFix, askToApplySteamLayout, isDeckGameMode } from "./utils/steamOS";
import { downloadVencordAsar, ensureVencordFiles } from "./utils/vencordLoader";

let isQuitting = false;
export let tray: Tray;

applyDeckKeyboardFix();

app.on("before-quit", () => {
    isQuitting = true;
});

export let mainWin: BrowserWindow;
export let splash: BrowserWindow;

function makeSettingsListenerHelpers<O extends object>(o: SettingsStore<O>) {
    const listeners = new Map<(data: any) => void, PropertyKey>();

    const addListener: typeof o.addChangeListener = (path, cb) => {
        listeners.set(cb, path);
        o.addChangeListener(path, cb);
    };
    const removeAllListeners = () => {
        for (const [listener, path] of listeners) {
            o.removeChangeListener(path as any, listener);
        }

        listeners.clear();
    };

    return [addListener, removeAllListeners] as const;
}

const [addSettingsListener, removeSettingsListeners] = makeSettingsListenerHelpers(Settings);
const [addVencordSettingsListener, removeVencordSettingsListeners] = makeSettingsListenerHelpers(VencordSettings);

function initTray(win: BrowserWindow) {
    const onTrayClick = () => {
        if (Settings.store.clickTrayToShowHide && win.isVisible()) win.hide();
        else win.show();
    };
    const trayMenu = Menu.buildFromTemplate([
        {
            label: "Open",
            click() {
                win.show();
            }
        },
        {
            label: "About",
            click: createAboutWindow
        },
        {
            label: "Repair Equicord",
            async click() {
                await downloadVencordAsar();
                app.relaunch();
                app.quit();
            }
        },
        {
            label: "Reset Equibop",
            async click() {
                await clearData(win);
            }
        },
        {
            type: "separator"
        },
        {
            label: "Restart",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        {
            label: "Quit",
            click() {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray = new Tray(ICON_PATH);
    setTrayIcon("icon");
    tray.setToolTip("Equibop");
    tray.setContextMenu(trayMenu);
    tray.on("click", onTrayClick);
}

async function clearData(win: BrowserWindow) {
    const { response } = await dialog.showMessageBox(win, {
        message: "Are you sure you want to reset Equibop?",
        detail: "This will log you out, clear caches and reset all your settings!\n\nEquibop will automatically restart after this operation.",
        buttons: ["Yes", "No"],
        cancelId: MessageBoxChoice.Cancel,
        defaultId: MessageBoxChoice.Default,
        type: "warning"
    });

    if (response === MessageBoxChoice.Cancel) return;

    win.close();

    await win.webContents.session.clearStorageData();
    await win.webContents.session.clearCache();
    await win.webContents.session.clearCodeCaches({});
    await rm(DATA_DIR, { force: true, recursive: true });

    app.relaunch();
    app.quit();
}

type MenuItemList = Array<MenuItemConstructorOptions | false>;

function initMenuBar(win: BrowserWindow) {
    const isWindows = process.platform === "win32";
    const isDarwin = process.platform === "darwin";
    const wantCtrlQ = !isWindows || VencordSettings.store.winCtrlQ;

    const subMenu = [
        {
            label: "About Equibop",
            click: createAboutWindow
        },
        {
            label: "Force Update Equicord",
            async click() {
                await downloadVencordAsar();
                app.relaunch();
                app.quit();
            },
            toolTip: "Equibop will automatically restart after this operation"
        },
        {
            label: "Reset Equibop",
            async click() {
                await clearData(win);
            },
            toolTip: "Equibop will automatically restart after this operation"
        },
        {
            label: "Relaunch",
            accelerator: "CmdOrCtrl+Shift+R",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        ...(!isDarwin
            ? []
            : ([
                  {
                      type: "separator"
                  },
                  {
                      label: "Settings",
                      accelerator: "CmdOrCtrl+,",
                      async click() {
                          mainWin.webContents.executeJavaScript(
                              "Vencord.Webpack.Common.SettingsRouter.open('My Account')"
                          );
                      }
                  },
                  {
                      type: "separator"
                  },
                  {
                      role: "hide"
                  },
                  {
                      role: "hideOthers"
                  },
                  {
                      role: "unhide"
                  },
                  {
                      type: "separator"
                  }
              ] satisfies MenuItemList)),
        {
            label: "Quit",
            accelerator: wantCtrlQ ? "CmdOrCtrl+Q" : void 0,
            visible: !isWindows,
            role: "quit",
            click() {
                app.quit();
            }
        },
        isWindows && {
            label: "Quit",
            accelerator: "Alt+F4",
            role: "quit",
            click() {
                app.quit();
            }
        },
        // See https://github.com/electron/electron/issues/14742 and https://github.com/electron/electron/issues/5256
        {
            label: "Zoom in (hidden, hack for Qwertz and others)",
            accelerator: "CmdOrCtrl+=",
            role: "zoomIn",
            visible: false
        }
    ] satisfies MenuItemList;

    const menu = Menu.buildFromTemplate([
        {
            label: "Equibop",
            role: "appMenu",
            submenu: subMenu.filter(isTruthy)
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" }
    ]);

    Menu.setApplicationMenu(menu);
}

function getWindowBoundsOptions(): BrowserWindowConstructorOptions {
    // We want the default window behaivour to apply in game mode since it expects everything to be fullscreen and maximized.
    if (isDeckGameMode) return {};

    const { x, y, width, height } = State.store.windowBounds ?? {};

    const options = {
        width: width ?? DEFAULT_WIDTH,
        height: height ?? DEFAULT_HEIGHT
    } as BrowserWindowConstructorOptions;

    const storedDisplay = screen.getAllDisplays().find(display => display.id === State.store.displayid);

    if (x != null && y != null && storedDisplay) {
        options.x = x;
        options.y = y;
    }

    if (!Settings.store.disableMinSize) {
        options.minWidth = MIN_WIDTH;
        options.minHeight = MIN_HEIGHT;
    }

    return options;
}

function getDarwinOptions(): BrowserWindowConstructorOptions {
    const options = {
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 10, y: 10 }
    } as BrowserWindowConstructorOptions;

    const { splashTheming, splashBackground } = Settings.store;
    const { macosTranslucency } = VencordSettings.store;

    if (macosTranslucency) {
        options.vibrancy = "sidebar";
        options.backgroundColor = "#ffffff00";
    } else {
        if (splashTheming) {
            options.backgroundColor = splashBackground;
        } else {
            options.backgroundColor = nativeTheme.shouldUseDarkColors ? "#313338" : "#ffffff";
        }
    }

    return options;
}

function initWindowBoundsListeners(win: BrowserWindow) {
    const saveState = () => {
        State.store.maximized = win.isMaximized();
        State.store.minimized = win.isMinimized();
    };

    win.on("maximize", saveState);
    win.on("minimize", saveState);
    win.on("unmaximize", saveState);

    const saveBounds = () => {
        State.store.windowBounds = win.getBounds();
        State.store.displayid = screen.getDisplayMatching(State.store.windowBounds).id;
    };

    win.on("resize", saveBounds);
    win.on("move", saveBounds);
}

function initSettingsListeners(win: BrowserWindow) {
    addSettingsListener("tray", enable => {
        if (enable) initTray(win);
        else tray?.destroy();
    });
    addSettingsListener("disableMinSize", disable => {
        if (disable) {
            // 0 no work
            win.setMinimumSize(1, 1);
        } else {
            win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);

            const { width, height } = win.getBounds();
            win.setBounds({
                width: Math.max(width, MIN_WIDTH),
                height: Math.max(height, MIN_HEIGHT)
            });
        }
    });

    addVencordSettingsListener("macosTranslucency", enabled => {
        if (enabled) {
            win.setVibrancy("sidebar");
            win.setBackgroundColor("#ffffff00");
        } else {
            win.setVibrancy(null);
            win.setBackgroundColor("#ffffff");
        }
    });

    addSettingsListener("enableMenu", enabled => {
        win.setAutoHideMenuBar(enabled ?? false);
    });

    addSettingsListener("spellCheckLanguages", languages => initSpellCheckLanguages(win, languages));
}

async function initSpellCheckLanguages(win: BrowserWindow, languages?: string[]) {
    languages ??= await win.webContents.executeJavaScript("[...new Set(navigator.languages)]").catch(() => []);
    if (!languages) return;

    const ses = session.defaultSession;

    const available = ses.availableSpellCheckerLanguages;
    const applicable = languages.filter(l => available.includes(l)).slice(0, 5);
    if (applicable.length) ses.setSpellCheckerLanguages(applicable);
}

function initSpellCheck(win: BrowserWindow) {
    win.webContents.on("context-menu", (_, data) => {
        win.webContents.send(IpcEvents.SPELLCHECK_RESULT, data.misspelledWord, data.dictionarySuggestions);
    });

    initSpellCheckLanguages(win, Settings.store.spellCheckLanguages);
}

function createMainWindow(splash: BrowserWindow) {
    // Clear up previous settings listeners
    removeSettingsListeners();
    removeVencordSettingsListeners();

    addSplashLog("Removed listeners");

    const { staticTitle, transparencyOption, enableMenu, customTitleBar } = Settings.store;

    const { frameless, transparent } = VencordSettings.store;

    const noFrame = frameless === true || customTitleBar === true;

    const win = (mainWin = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            sandbox: false,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js"),
            spellcheck: true,
            ...(Settings.store.middleClickAutoscroll && { enableBlinkFeatures: 'MiddleClickAutoscroll' }),
            // disable renderer backgrounding to prevent the app from unloading when in the background
            backgroundThrottling: false
        },
        icon: ICON_PATH,
        frame: !noFrame,
        ...(transparent && {
            transparent: true,
            backgroundColor: "#00000000"
        }),
        ...(transparencyOption &&
            transparencyOption !== "none" && {
                backgroundColor: "#00000000",
                backgroundMaterial: transparencyOption
            }),
        // Fix transparencyOption for custom discord titlebar
        ...(customTitleBar &&
            transparencyOption &&
            transparencyOption !== "none" && {
                transparent: true
            }),
        ...(staticTitle && { title: "Equibop" }),
        ...(process.platform === "darwin" && getDarwinOptions()),
        ...getWindowBoundsOptions(),
        autoHideMenuBar: enableMenu
    }));
    win.setMenuBarVisibility(false);

    if (process.platform === "darwin" && customTitleBar) win.setWindowButtonVisibility(false);

    win.on("close", e => {
        const useTray = !isDeckGameMode && Settings.store.minimizeToTray !== false && Settings.store.tray !== false;
        if (isQuitting || (process.platform !== "darwin" && !useTray)) return;

        e.preventDefault();

        if (process.platform === "darwin") app.hide();
        else win.hide();

        return false;
    });

    if (Settings.store.staticTitle) win.on("page-title-updated", e => e.preventDefault());
    else if (Settings.store.appBadge)
        mainWin.webContents.on("page-title-updated", (_, title) => {
            mainWin.setTitle(title.replace(/^\(\d+\)\s*|•\s/, ""));
        });
    addSplashLog("Initialized Main Window params");

    initWindowBoundsListeners(win);
    if (!isDeckGameMode && (Settings.store.tray ?? true) && process.platform !== "darwin") initTray(win);
    initMenuBar(win);
    makeLinksOpenExternally(win);
    initSettingsListeners(win);
    initSpellCheck(win);

    addSplashLog("Initialized Main Window utils");

    win.webContents.setUserAgent(BrowserUserAgent);
    addSplashLog("UserAgent set");

    const subdomain =
        Settings.store.discordBranch === "canary" || Settings.store.discordBranch === "ptb"
            ? `${Settings.store.discordBranch}.`
            : "";

    addSplashLog(`Loading discord web`);
    win.loadURL(`https://${subdomain}discord.com/app`);

    return win;
}

const runVencordMain = once(() => require(VENCORD_DIR));

export async function createWindows() {
    const startMinimized = process.argv.includes("--start-minimized");
    splash = getSplash();
    // SteamOS letterboxes and scales it terribly, so just full screen it
    if (isDeckGameMode) {
        splash.setFullScreen(true);
        addOneTaskSplash();
        addSplashLog("Set Fullscreen (Deck GameMode)");
    }

    addSplashLog("Checking Equicord files");
    await ensureVencordFiles();

    addSplashLog("Running main Equicord files");
    runVencordMain();

    addSplashLog("Initializing Main Window");
    mainWin = createMainWindow(splash);

    mainWin.webContents.on("did-finish-load", () => {
        if (!startMinimized) {
            addOneTaskSplash();
            addSplashLog("Showing main window");
            mainWin!.show();
            if (State.store.maximized && !isDeckGameMode) mainWin!.maximize();
        }

        if (isDeckGameMode) {
            addOneTaskSplash();
            addSplashLog("Deck GameMode, Setting fullscreen");
            // always use entire display
            mainWin!.setFullScreen(true);
            askToApplySteamLayout(mainWin);
        }

        mainWin.once("show", () => {
            if (State.store.maximized && !mainWin!.isMaximized() && !isDeckGameMode) {
                addOneTaskSplash();
                addSplashLog("Maximizing main window");
                mainWin!.maximize();
            }
        });

        if (splash) {
            addSplashLog("Closing splash window");
            // delay on purpose just to show it completed everything :3
            // wish there was an easier way to make it fade out smoothly
            setTimeout(() => {
                splash.destroy();
            }, 1000);
        }
    });

    initArRPC();
}

export function getAccentColor(): Promise<string> {
    if (process.platform === "linux") {
        return new Promise((resolve, reject) => {
            const sessionBus = dbus.sessionBus();
            sessionBus
                .getService("org.freedesktop.portal.Desktop")
                .getInterface(
                    "/org/freedesktop/portal/desktop",
                    "org.freedesktop.portal.Settings",
                    function (err, settings) {
                        if (err) {
                            resolve("");
                            return;
                        }
                        settings.Read("org.freedesktop.appearance", "accent-color", function (err, result) {
                            if (err) {
                                resolve("");
                                return;
                            }
                            const [r, g, b] = result[1][0][1][0];
                            const r255 = Math.round(r * 255);
                            const g255 = Math.round(g * 255);
                            const b255 = Math.round(b * 255);

                            const toHex = (value: number) => value.toString(16).padStart(2, "0");
                            const hexColor = `#${toHex(r255)}${toHex(g255)}${toHex(b255)}`;
                            resolve(hexColor);
                        });
                    }
                );
        });
    } else {
        return Promise.resolve(`#${systemPreferences.getAccentColor?.() || ""}`);
    }
}
