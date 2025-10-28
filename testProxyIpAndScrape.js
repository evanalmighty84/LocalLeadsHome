// testProxyIpAndScrape.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(process.cwd(), "ftn_debug");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const PROXY_HOST = "proxy-us.residential.oxylabs.io"; // <-- replace
const PROXY_PORT = "7777";                           // <-- replace
const PROXY_USERNAME = "your_oxylabs_username";     // <-- replace
const PROXY_PASSWORD = "your_oxylabs_password";     // <-- replace

if (![PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD].every(Boolean)) {
    console.error("✋ Please populate PROXY_HOST/PORT/USERNAME/PASSWORD at top of file.");
    process.exit(1);
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log("🚀 Launching browser with proxy:", `${PROXY_HOST}:${PROXY_PORT}`);
    const browser = await puppeteer.launch({
        headless: false, // visible so you can watch
        args: [`--proxy-server=${PROXY_HOST}:${PROXY_PORT}`, "--no-sandbox", "--disable-setuid-sandbox"],
        defaultViewport: null,
    });

    const page = await browser.newPage();

    // Authenticate proxy
    await page.authenticate({ username: PROXY_USERNAME, password: PROXY_PASSWORD });
    console.log("🔐 Proxy auth applied");

    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

    // 1) Check external IP via ipify
    try {
        console.log("🔎 Fetching external IP (via proxy) from api.ipify.org...");
        const resp = await page.goto("https://api.ipify.org?format=json", { waitUntil: "networkidle2", timeout: 20000 });
        const body = await resp.text();
        console.log("→ ipify response body:", body);
        try {
            const parsed = JSON.parse(body);
            console.log("✅ IP reported by ipify (through proxy):", parsed.ip);
        } catch (e) {
            console.warn("⚠️ Could not parse ipify JSON:", e.message);
        }
    } catch (err) {
        console.error("❌ ipify fetch failed:", err.message);
    }

    // 2) Now navigate to FamilyTreeNow so you can see what happens
    try {
        console.log("🌐 Navigating to FamilyTreeNow...");
        await page.goto("https://www.familytreenow.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.screenshot({ path: path.join(OUT, "ftn_preview.png"), fullPage: true });
        console.log("📸 Screenshot saved to", path.join(OUT, "ftn_preview.png"));
    } catch (err) {
        console.error("❌ FamilyTreeNow navigation error:", err.message);
    }

    console.log("⏳ Leaving browser open for 8s so you can inspect...");
    await wait(8000);
    await browser.close();
    console.log("✅ Done.");
})();
