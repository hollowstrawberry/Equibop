/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findByCodeLazy } from "@vencord/types/webpack";
import { keybindCallbacks } from "renderer";

import { addPatch } from "./shared";
const toShortcutString = findByCodeLazy('return"gamepad".');

addPatch({
    patches: [
        {
            find: "keybindActionTypes",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\i\.isPlatformEmbedded/g,
                    replace: "true"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\(0,\i\.isDesktop\)\(\)/g,
                    replace: "true"
                },
                {
                    // THIS PATCH IS TEMPORARY
                    // eslint-disable-next-line no-useless-escape
                    match: /\.keybindGroup,\i.card\),children:\[/g,
                    replace: "$&`ID: ${this.props.keybind.id}`,"
                }
            ]
        },
        {
            find: "[kb store] KeybindStore",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /inputEventRegister\((parseInt\(\i\),\i,\i,\i)\);else\{/,
                    replace: "$&$self.registerKeybind($1);return;"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /inputEventUnregister\((parseInt\(\i,10\))\);else/,
                    replace: "$&{$self.unregisterKeybind($1);return;}"
                }
            ]
        }
    ],

    registerKeybind: function (id, shortcut, callback, options) {
        keybindCallbacks[id] = callback;
        VesktopNative.keybind.register(id, toShortcutString(shortcut), options);
    },
    unregisterKeybind: function (id) {
        delete keybindCallbacks[id];
        VesktopNative.keybind.unregister(id);
    }
});
