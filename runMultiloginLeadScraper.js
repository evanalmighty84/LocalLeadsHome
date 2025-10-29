// runMultiloginLeadScraper.js
require("dotenv").config();
const { execSync } = require("child_process");
const axios = require("axios");
const { spawn } = require("child_process");

(async () => {
    const TOKEN = process.env.MULTILOGIN_TOKEN;
    const PROFILE_ID = process.env.MULTILOGIN_PROFILE_ID; // put your profile UUID here
    const BASE_URL = "https://launcher.mlx.yt:45001";

    if (!TOKEN || !PROFILE_ID) {
        console.error("❌ Missing MULTILOGIN_TOKEN or MULTILOGIN_PROFILE_ID in .env");
        process.exit(1);
    }

    console.log(`🚀 Starting Multilogin profile ${PROFILE_ID}...`);

    // Step 1 — start profile
    const startUrl = `${BASE_URL}/api/v2/profile/f/default/p/${PROFILE_ID}/start?automation_type=playwright&headless_mode=false`;

    let port;
    try {
        const res = await axios.get(startUrl, {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: "application/json",
            },
            timeout: 30000,
        });

        if (res.data?.data?.port) {
            port = res.data.data.port;
            console.log(`✅ Profile started on port ${port}`);
        } else {
            console.error("❌ Could not parse port from response:", res.data);
            process.exit(1);
        }
    } catch (err) {
        console.error("❌ Failed to start Multilogin profile:", err.message);
        process.exit(1);
    }

    // Step 2 — retrieve websocket
    const versionUrl = `http://127.0.0.1:${port}/json/version`;
    let wsUrl;

    try {
        const { data } = await axios.get(versionUrl, { timeout: 10000 });
        wsUrl = data.webSocketDebuggerUrl;
        if (!wsUrl) throw new Error("Missing webSocketDebuggerUrl in JSON");
        console.log(`🔗 WebSocket URL: ${wsUrl}`);
    } catch (err) {
        console.error("❌ Failed to retrieve WebSocket URL:", err.message);
        process.exit(1);
    }

    // Step 3 — spawn your lead scraper with WS env
    console.log("🧩 Launching getLeadPhones.js with live Multilogin WS...\n");

    const child = spawn("node", ["getLeadPhones.js"], {
        env: { ...process.env, MULTILOGIN_WS: wsUrl },
        stdio: "inherit",
    });

    child.on("close", (code) => {
        console.log(`✅ getLeadPhones.js exited with code ${code}`);
        process.exit(code);
    });
})();
