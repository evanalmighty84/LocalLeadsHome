// Usage:  MULTILOGIN_TOKEN="eyJ..." node multilogin-connect.js

import axios from "axios";
import { chromium } from "playwright";

const PROFILE_ID = "f9cd752c-addb-4aac-a69f-27a3c62bdafb";
const FOLDER_ID = "default";
const LAUNCHER = "https://launcher.mlx.yt:45001";

async function main() {
    const token = process.env.MULTILOGIN_TOKEN;
    if (!token) {
        console.error("❌  Missing MULTILOGIN_TOKEN in env");
        process.exit(1);
    }

    console.log("🚀  Starting Multilogin profile...");
    const startUrl = `${LAUNCHER}/api/v2/profile/f/${FOLDER_ID}/p/${PROFILE_ID}/start?automation_type=playwright&headless_mode=false`;

    let port;
    try {
        const res = await axios.get(startUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            timeout: 20000,
        });
        port = res.data?.data?.port;
        if (!port) throw new Error("No port returned in response");
        console.log("✅  Profile started on port", port);
    } catch (err) {
        console.error("❌  Failed to start profile:", err.response?.data || err.message);
        process.exit(1);
    }

    // get websocket debugger url
    let wsEndpoint;
    try {
        const verRes = await axios.get(`http://127.0.0.1:${port}/json/version`);
        wsEndpoint = verRes.data?.webSocketDebuggerUrl;
        if (!wsEndpoint) throw new Error("No webSocketDebuggerUrl in /json/version");
        console.log("🔗  WebSocket:", wsEndpoint);
    } catch (err) {
        console.error("❌  Could not get /json/version:", err.message);
        process.exit(1);
    }

    // connect Playwright
    try {
        console.log("🎭  Connecting Playwright...");
        const browser = await chromium.connectOverCDP(wsEndpoint);
        const [page] = browser.contexts()[0].pages();
        await page.bringToFront();
        console.log("🎯  Connected successfully!");
        console.log("Now controlling the live Multilogin browser session.");

        // keep process open so you can interact
        process.stdin.resume();
    } catch (err) {
        console.error("❌  Playwright connection failed:", err.message);
        process.exit(1);
    }
}

main();
