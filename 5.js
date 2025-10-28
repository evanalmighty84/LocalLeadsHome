// 5.js
require("dotenv").config();
const { chromium } = require("playwright");
const { solveTurnstile } = require("./solveTurnstileWith2Captcha");

(async () => {
    const WS = process.env.MULTILOGIN_WS;
    if (!WS) throw new Error("❌ MULTILOGIN_WS not set");

    const browser = await chromium.connectOverCDP(WS);
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.bringToFront();
    console.log("✅ Connected to Multilogin CDP session.");

    const first = process.env.TEST_FIRST || "Ever";
    const last = process.env.TEST_LAST || "Lopez";
    const city = process.env.TEST_CITY || "Yucaipa";
    const queryURL = `https://www.familytreenow.com/search/genealogy/results?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}&citystatezip=${encodeURIComponent(city)}`;

    console.log("🌍 Navigating to:", queryURL);
    await page.goto(queryURL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // --- Detect Datadome ---
    if (page.url().includes("captcha-delivery")) {
        console.warn("🚧 Datadome interstitial detected, trying to solve...");

        const sitekey = await page.evaluate(() => {
            const el = document.querySelector("[data-sitekey]");
            return el ? el.getAttribute("data-sitekey") : null;
        });

        if (sitekey) {
            console.log("🔐 Sitekey:", sitekey);
            const token = await solveTurnstile({
                apiKey: process.env.TWOCAPTCHA_API_KEY,
                sitekey,
                pageurl: page.url(),
                pollInterval: 5000,
                timeout: 180000,
            });

            console.log("✅ Got token:", token?.slice(0, 25) + "...");

            await page.evaluate((tok) => {
                const input = document.createElement("textarea");
                input.name = "cf-turnstile-response";
                input.value = tok;
                input.style.display = "none";
                document.body.appendChild(input);

                const btn = document.querySelector("button[type='submit'], input[type='submit']");
                if (btn) btn.click();
            }, token);

            console.log("🔁 Token submitted — waiting for redirect...");
            await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 });
        } else {
            console.warn("⚠️ No sitekey found; manual CAPTCHA required.");
            return;
        }
    }

    // --- Wait for results ---
    await page.waitForSelector("a.btn-success.detail-link, .recordValue, .recordTitleBox", { timeout: 45000 });
    console.log("✅ FamilyTreeNow results loaded:", page.url());

    await browser.close();
    console.log("✅ Done.");
})();
