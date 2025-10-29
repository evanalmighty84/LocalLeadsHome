// mlx_runner_railway.js
// Usage (Railway): set MULTILOGIN_TOKEN and PROFILE_ID in env, start -> node mlx_runner_railway.js
//
// Dependencies: axios, playwright, dotenv (optional for local dev)
// Ensure Playwright chromium is installed in build (postinstall or build step)

require('dotenv').config();
if (process.env.MULTILOGIN_WS) {
    console.log("🌐 Connecting to existing Multilogin WebSocket:", process.env.MULTILOGIN_WS);
    const { chromium } = require('playwright');

    (async () => {
        try {
            const browser = await chromium.connectOverCDP(process.env.MULTILOGIN_WS);
            const context = browser.contexts().length ? browser.contexts()[0] : await browser.newContext();
            const page = await context.newPage();
            await page.goto('https://example.com');
            console.log('✅ Page title:', await page.title());
            await browser.close();
        } catch (err) {
            console.error('❌ Failed to connect via WebSocket:', err.message);
        }
    })();

    return;
}

const axios = require('axios');
const { chromium } = require('playwright');

const PROFILE_ID = process.env.PROFILE_ID;
const TOKEN = process.env.MULTILOGIN_TOKEN;
if (!PROFILE_ID || !TOKEN) {
    console.error('ERROR: set MULTILOGIN_TOKEN and PROFILE_ID env vars');
    process.exit(1);
}

// Candidate endpoints - we'll try each until one responds
const START_HOSTS = [
    'https://api.multiloginapp.com/api/v2/profile/start',
    'https://launcher.multiloginapp.com/api/v2/profile/start',
    'https://api.multilogin.com/api/v2/profile/start'
];

// Corresponding status endpoints (pattern)
const STATUS_HOSTS = [
    'https://api.multiloginapp.com/api/v2/profile',
    'https://launcher.multiloginapp.com/api/v2/profile',
    'https://api.multilogin.com/api/v2/profile'
];

const POST_BODY = {
    profileId: PROFILE_ID,
    automation: 'playwright', // use "playwright" or "puppeteer" per your automation
    headless_mode: true
};

async function tryStartOnHost(startUrl) {
    const token = process.env.MULTILOGIN_TOKEN;
    const profile = process.env.PROFILE_ID;


    console.log(`POST -> ${startUrl}`);
    console.log(
        "🔍 MULTILOGIN_TOKEN preview:",
        token ? token.slice(0, 20) + "..." + token.slice(-10) : "❌ missing"
    );
    console.log("🔍 MULTILOGIN_PROFILE_ID:", profile || "❌ missing");
    console.log(
        "🧾 Authorization header:",
        `Bearer ${token ? token.slice(0, 15) + "..." : "❌ missing"}`
    );

    const POST_BODY = { profileId: profile, automation: "playwright", headless_mode: true };

    try {
        const res = await axios.post(startUrl, POST_BODY, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            timeout: 20000,
        });
        console.log("✅ Start returned HTTP", res.status);
        return res.data;
    } catch (err) {
        if (err.response) {
            console.warn(`🚨 Start HTTP ${err.response.status} from ${startUrl}`);
            console.warn("Response body:", err.response.data);
            return { __error: true, httpStatus: err.response.status, body: err.response.data };
        }
        console.warn(`⚠️ Start request error for ${startUrl}:`, err.code || err.message);
        return null;
    }
}
console.log("🧾 Authorization header:", `Bearer ${process.env.MULTILOGIN_TOKEN ? process.env.MULTILOGIN_TOKEN.slice(0,15) + '...' : '❌ missing'}`);

async function pollForWebSocket(statusBase, profileId, maxAttempts = 15, intervalMs = 2000) {
    const statusUrl = `${statusBase}/${profileId}/status`;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await axios.get(statusUrl, {
                headers: { Authorization: `Bearer ${TOKEN}` },
                timeout: 10000
            });
            const data = res.data;
            // try common locations for ws/url fields
            const possible =
                data.webSocketDebuggerUrl ||
                (data.data && (data.data.webSocketDebuggerUrl || data.data.debuggerUrl)) ||
                (data.result && (data.result.webSocketDebuggerUrl || data.result.debuggerUrl)) ||
                (data.instance && (data.instance.debuggerUrl || data.instance.webSocketDebuggerUrl)) ||
                (data.debuggerUrl || null);

            if (possible) {
                console.log(`Found debugger URL from ${statusUrl}`);
                return possible;
            }
            console.log(`[poll ${i + 1}/${maxAttempts}] no ws url yet; status response keys: ${Object.keys(data).join(', ')}`);
        } catch (err) {
            if (err.response) {
                console.warn(`[poll ${i + 1}/${maxAttempts}] HTTP ${err.response.status} from ${statusUrl}`);
            } else {
                console.warn(`[poll ${i + 1}/${maxAttempts}] request err:`, err.code || err.message);
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

async function main() {
    console.log('Starting Multilogin profile:', PROFILE_ID);

    // 1) Try POST start on each host
    let startResp = null;
    let usedStartHost = null;
    for (const host of START_HOSTS) {
        startResp = await tryStartOnHost(host);
        usedStartHost = host;
        if (startResp && !startResp.__error) {
            // Posted successfully (200) - check for immediate ws
            break;
        }
        // if explicit 401/403 returned, still break so we can show error details
        if (startResp && startResp.__error && [401,403].includes(startResp.httpStatus)) break;
    }

    if (!startResp) {
        console.error('Failed to POST start on all known hosts. Check network/DNS or token.');
        process.exit(2);
    }

    // If start returned an HTTP error payload, show and exit
    if (startResp.__error) {
        console.error('Start endpoint returned HTTP', startResp.httpStatus);
        console.error('Body:', JSON.stringify(startResp.body, null, 2));
        if (startResp.httpStatus === 401) {
            console.error('401: token invalid or expired. Regenerate token in Multilogin Cloud UI.');
        }
        process.exit(3);
    }

    // 2) Try to extract WS from start response
    console.log('Start response (truncated):', JSON.stringify(startResp).slice(0, 800));
    const possWs =
        startResp.webSocketDebuggerUrl ||
        (startResp.data && (startResp.data.webSocketDebuggerUrl || startResp.data.debuggerUrl)) ||
        (startResp.result && (startResp.result.webSocketDebuggerUrl || startResp.result.debuggerUrl)) ||
        (startResp.instance && (startResp.instance.debuggerUrl || startResp.instance.webSocketDebuggerUrl)) ||
        startResp.debuggerUrl ||
        null;

    let wsUrl = possWs;

    // 3) If no immediate ws, poll status endpoints for the profile
    if (!wsUrl) {
        console.log('No webSocketDebuggerUrl in start response — polling status endpoints for the profile...');
        for (const base of STATUS_HOSTS) {
            const maybe = await pollForWebSocket(base, PROFILE_ID, 20, 2000);
            if (maybe) {
                wsUrl = maybe;
                break;
            }
        }
    }

    if (!wsUrl) {
        console.error('Could not obtain webSocket/CDP URL after polling. Dumping start response and exiting.');
        console.error(JSON.stringify(startResp, null, 2));
        process.exit(4);
    }

    console.log('Found CDP/WebSocket URL:', wsUrl);

    // 4) Connect Playwright via CDP and run a simple task
    let browser;
    try {
        console.log('Connecting Playwright to remote CDP...');
        browser = await chromium.connectOverCDP(wsUrl, { timeout: 30000 });
        // Use existing context or create new one
        const context = browser.contexts().length ? browser.contexts()[0] : await browser.newContext();
        const page = await context.newPage();

        console.log('Navigating to https://example.com ...');
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('Title:', await page.title());
        // TODO: replace below with your actual scraping function
        // await runMyScrape(page);

        await page.close();
        await context.close();

        try {
            await browser.close();
        } catch (e) {
            // ignore
        }

        console.log('Automation finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error connecting to CDP or running automation:', err && (err.message || err));
        try { if (browser) await browser.close(); } catch (e) {}
        process.exit(5);
    }
}

main();
