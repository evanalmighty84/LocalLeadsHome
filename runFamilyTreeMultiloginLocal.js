/**
 * runFamilyTreeNowHumanMultilogin.js
 * Warm Multilogin X profile + Oxylabs proxy
 * Humanized typing, cookie dismissal, and autocomplete clicking
 *
 * Usage:
 *   export MULTILOGIN_TOKEN="eyJ..."
 *   export MULTILOGIN_PROFILE_ID="f9cd752c-addb-4aac-a69f-27a3c62bdafb"
 *   export RES_PROXY="http://user:pass@host:port"   # optional
 *   node runFamilyTreeNowHumanMultilogin.js
 */

require("dotenv").config();
const axios = require("axios");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base, variance = 0.3) =>
    Math.round(base + (Math.random() - 0.5) * base * variance);

async function humanType(page, selector, text) {
    const el = await page.waitForSelector(selector, { visible: true, timeout: 15000 });
    await el.click({ clickCount: 3 });
    for (const ch of text) {
        await page.keyboard.type(ch, { delay: jitter(150, 0.6) });
    }
    await wait(jitter(600, 0.4));
}

async function clickAutocomplete(page, partial) {
    try {
        await wait(1200 + Math.random() * 800);
        const options = await page.$$(".ui-menu-item, .pac-item, div[role='option']");
        for (const opt of options) {
            const txt = await page.evaluate((el) => el.innerText || "", opt);
            if (txt.toLowerCase().includes(partial.toLowerCase())) {
                await opt.hover();
                await wait(300);
                await opt.click({ delay: 100 });
                console.log(`📍 Picked autocomplete: ${txt}`);
                return true;
            }
        }
    } catch (err) {
        console.log("⚠️ No autocomplete found:", err.message);
    }
    return false;
}

async function dismissCookies(page) {
    try {
        const btns = await page.$x("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'accept') or contains(., 'got it') or contains(., 'agree') or contains(., 'allow')]");
        if (btns.length) {
            await btns[0].click({ delay: 120 });
            console.log("🍪 Cookie banner dismissed.");
            await wait(800);
        }
    } catch (_) {}
}

async function stopMultiloginProfile(token, profileId, folderId = "default") {
    const LAUNCHER = "https://launcher.mlx.yt:45001";
    const stopUrl = `${LAUNCHER}/api/v2/profile/f/${folderId}/p/${profileId}/stop`;
    try {
        await axios.get(stopUrl, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
        console.log("🛑 Profile stopped via launcher API.");
    } catch (err) {
        console.warn("⚠️ Stop request failed (maybe not running):", err.response?.data || err.message);
    }
}

async function startMultiloginProfile(token, profileId, folderId = "default") {
    const LAUNCHER = "https://launcher.mlx.yt:45001";
    const startUrl = `${LAUNCHER}/api/v2/profile/f/${folderId}/p/${profileId}/start?automation_type=puppeteer&headless_mode=false`;

    try {
        const res = await axios.get(startUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            timeout: 20000,
        });
        const port = res.data?.data?.port;
        if (!port) throw new Error("No port returned in start response");
        return port;
    } catch (err) {
        const body = err.response?.data || err.message || {};
        const code = body?.status?.error_code || body?.status || "";

        if (String(code).toUpperCase().includes("PROFILE_ALREADY_RUNNING") || /already running/i.test(String(body))) {
            console.log("⚠️ Profile already running — attempting to read status for port...");
            try {
                const statusUrl = `${LAUNCHER}/api/v2/profile/f/${folderId}/p/${profileId}/status`;
                const sres = await axios.get(statusUrl, {
                    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                    timeout: 8000,
                });
                const data = sres.data?.data || sres.data || {};
                const port = data?.port || data?.port_number || data?.portNumber || data?.debug_port;
                if (port) {
                    console.log("✅ Found running profile port via status:", port);
                    return port;
                } else {
                    throw new Error("Status missing port");
                }
            } catch (statusErr) {
                console.error("❌ Could not read profile status:", statusErr.response?.data || statusErr.message);
                throw statusErr;
            }
        }
        throw err;
    }
}

async function getWebSocketUrlFromPort(port) {
    const res = await axios.get(`http://127.0.0.1:${port}/json/version`, { timeout: 5000 });
    return res.data?.webSocketDebuggerUrl;
}

(async () => {
    const { MULTILOGIN_TOKEN, MULTILOGIN_PROFILE_ID, RES_PROXY } = process.env;
    if (!MULTILOGIN_TOKEN || !MULTILOGIN_PROFILE_ID) {
        console.error("❌ Missing MULTILOGIN_TOKEN or MULTILOGIN_PROFILE_ID");
        process.exit(1);
    }

    let port;
    try {
        console.log("🚀 Starting Multilogin profile via launcher...");
        port = await startMultiloginProfile(MULTILOGIN_TOKEN, MULTILOGIN_PROFILE_ID);
        console.log(`✅ Profile active on port ${port}`);
    } catch (err) {
        console.error("❌ Could not start or detect profile:", err.message);
        process.exit(1);
    }

    let wsUrl;
    try {
        wsUrl = await getWebSocketUrlFromPort(port);
        console.log("🔗 DevTools WebSocket:", wsUrl);
    } catch (err) {
        console.error("❌ Could not retrieve webSocketDebuggerUrl:", err.message);
        await stopMultiloginProfile(MULTILOGIN_TOKEN, MULTILOGIN_PROFILE_ID);
        process.exit(1);
    }

    const gracefulShutdown = async () => {
        console.log("\n🧯 Caught exit — stopping profile...");
        await stopMultiloginProfile(MULTILOGIN_TOKEN, MULTILOGIN_PROFILE_ID).catch(() => {});
        process.exit(0);
    };
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);

    let browser;
    try {
        browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
        console.log("🧩 Connected to Multilogin browser.");
    } catch (err) {
        console.error("❌ puppeteer.connect failed:", err.message);
        await stopMultiloginProfile(MULTILOGIN_TOKEN, MULTILOGIN_PROFILE_ID);
        process.exit(1);
    }

    // --- Reuse existing tab if possible ---
    let page;
    try {
        const pages = await browser.pages();
        console.log(`ℹ️ Found ${pages.length} page(s) open.`);
        const preferred = pages.find((p) =>
            (p.url() || "").toLowerCase().includes("familytreenow")
        );
        if (preferred) {
            page = preferred;
            console.log("🔎 Reusing FamilyTreeNow tab:", page.url());
        } else if (pages.length) {
            page = pages[0];
            console.log("⚠️ No FamilyTreeNow tab found — reusing first tab:", page.url());
        } else {
            page = await browser.newPage();
            console.log("➕ No tabs open — created new page.");
        }
        await page.bringToFront();
    } catch (err) {
        console.error("❌ Error choosing tab:", err.message);
        page = await browser.newPage();
    }

    // --- Proxy authentication if applicable ---
    if (RES_PROXY) {
        try {
            const parsed = new URL(RES_PROXY);
            if (parsed.username) {
                await page.authenticate({
                    username: decodeURIComponent(parsed.username),
                    password: decodeURIComponent(parsed.password),
                });
                console.log("🌍 Proxy authentication applied.");
            }
        } catch (err) {
            console.warn("⚠️ Could not parse RES_PROXY:", err.message);
        }
    }

    // --- Re-navigation or Edit Search reuse ---
    const currentUrl = (await page.url()) || "";
    if (!currentUrl.toLowerCase().includes("familytreenow")) {
        console.log("🌐 Navigating to FamilyTreeNow...");
        await page.goto("https://www.familytreenow.com/", {
            waitUntil: ["domcontentloaded", "networkidle2"],
            timeout: 90000,
        });
    } else {
        console.log("🌐 Reusing FamilyTreeNow tab:", currentUrl);
        // --- safer "Edit Search" detection (no $x) ---
        const editHandle = await page.evaluateHandle(() => {
            const anchors = Array.from(document.querySelectorAll('a, button'));
            return anchors.find(a =>
                a.innerText &&
                /edit\s*search/i.test(a.innerText)
            ) || null;
        });

        if (editHandle && (await editHandle.asElement())) {
            console.log("🖋️ Clicking 'Edit Search' to reopen form...");
            await (await editHandle.asElement()).click();
            await page.waitForSelector("#First", { timeout: 15000 }).catch(() => {});
        } else {
            console.log("ℹ️ No 'Edit Search' button found — keeping current page.");
        }

    }

    await dismissCookies(page);
    console.log("✅ Page ready.");

    await wait(1500 + Math.random() * 1000);

    // --- Humanized typing + search ---
    await humanType(page, "#First", "Michael");
    await humanType(page, "#Last", "Henderson");
    await humanType(page, "#CityStateZip", "Austin");
    await clickAutocomplete(page, "Austin, TX");

    await wait(1500);

    const searchBtn =
        (await page.$(".search-button")) || (await page.$("button[type='submit']"));
    if (searchBtn) {
        await searchBtn.hover();
        await wait(300);
        await searchBtn.click({ delay: 200 });
        console.log("🔍 Submitted search.");
    } else {
        console.warn("⚠️ Search button not found.");
    }

    await page.waitForNavigation({
        waitUntil: ["domcontentloaded", "networkidle2"],
        timeout: 60000,
    }).catch(() => {});
    console.log("⏳ Waiting for render...");
    await wait(8000);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = `ftn_humanized_${ts}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`📸 Screenshot saved as ${shot}`);

    console.log("⏸ Leaving browser open (Ctrl+C to exit)...");
    await new Promise(() => {});
})();
