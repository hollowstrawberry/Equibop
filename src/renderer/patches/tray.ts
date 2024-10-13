/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Logger } from "@vencord/types/utils";
import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, UserStore } from "@vencord/types/webpack/common";

const voiceActions = findByPropsLazy("isSelfMute");

var isInCall = false;
const logger = new Logger("VesktopTrayIcon");

export function setCurrentTrayIcon() {
    if (isInCall) {
        if (voiceActions.isSelfDeaf()) {
            VesktopNative.tray.setIcon("deafened");
        } else if (voiceActions.isSelfMute()) {
            VesktopNative.tray.setIcon("muted");
        } else {
            VesktopNative.tray.setIcon("idle");
        }
    } else {
        VesktopNative.tray.setIcon("icon");
    }
}

VesktopNative.tray.createIconRequest(async (iconName: string, svgIcon: string = "") => {
    try {
        const svg = svgIcon || (await VesktopNative.tray.getIcon(iconName));

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const img = new Image();
        img.width = 128;
        img.height = 128;
        img.onload = () => {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                const dataURL = canvas.toDataURL("image/png");
                const isSvg = svgIcon !== "";
                VesktopNative.tray.createIconResponse(iconName, dataURL, isSvg, isSvg); // custom if svgIcon is provided
            }
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (error) {
        logger.error("Error: ", error);
    }
});

VesktopNative.tray.addBadgeToIcon(async (iconDataURL: string, badgeDataSVG: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const img = new Image();
    img.width = 128;
    img.height = 128;

    img.onload = () => {
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.drawImage(img, 0, 0);

            const iconImg = new Image();
            iconImg.width = 64;
            iconImg.height = 64;

            iconImg.onload = () => {
                ctx.drawImage(iconImg, 64, 0, 64, 64);
                VesktopNative.tray.returnIconWithBadge(canvas.toDataURL());
            };

            iconImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeDataSVG)}`;
        }
    };

    img.src = iconDataURL;
});

VesktopNative.tray.setCurrentVoiceIcon(() => {
    setCurrentTrayIcon();
});

onceReady.then(() => {
    VesktopNative.tray.generateTrayIcons();
    const userID = UserStore.getCurrentUser().id;

    FluxDispatcher.subscribe("SPEAKING", params => {
        if (params.userId === userID && params.context === "default") {
            if (params.speakingFlags) {
                VesktopNative.tray.setIcon("speaking");
            } else {
                setCurrentTrayIcon();
            }
        }
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", () => {
        if (isInCall) setCurrentTrayIcon();
    });

    FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", () => {
        if (isInCall) setCurrentTrayIcon();
    });

    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", params => {
        if (params.state === "RTC_CONNECTED" && params.context === "default") {
            isInCall = true;
            setCurrentTrayIcon();
        } else if (params.state === "RTC_DISCONNECTED" && params.context === "default") {
            VesktopNative.tray.setIcon("icon");
            isInCall = false;
        }
    });
});
