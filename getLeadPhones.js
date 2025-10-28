require("dotenv").config();
const fs = require("fs");
const path = require("path");
const fsp = require("fs/promises");
const pool = require("./db");
const { chromium } = require("playwright");

const {
    pickAndOpenDetail,
    scrapeWirelessDetail,
    scrapeBasicResult,
    scrapePhoneLinks,
} = require("./scrapeHelpers");
const { solveTurnstile } = require("./solveTurnstileWith2Captcha");

(async () => {
    const WS = process.env.MULTILOGIN_WS;
    if (!WS) {
        console.error("❌ MULTILOGIN_WS not set.");
        process.exit(1);
    }

    console.log(`🔌 Connecting to Multilogin CDP: ${WS}`);
    const browser = await chromium.connectOverCDP(WS);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());
    await page.bringToFront();

    console.log("✅ Connected to Multilogin session.\n");

    // --- Pull latest leads ---
    const { rows: leads } = await pool.query(`
      SELECT id, author AS name, city, lead_type
      FROM nextdoor_messages
      ORDER BY timestamp DESC
      LIMIT 5;
  `);
    console.log(`📋 Found ${leads.length} leads.\n`);

    for (const lead of leads) {
        const { id, name, city } = lead;
        const [first, ...rest] = name.split(" ");
        const last = rest.join(" ");
        const target = `https://www.familytreenow.com/search/genealogy/results?first=${encodeURIComponent(
            first
        )}&last=${encodeURIComponent(last)}&citystatezip=${encodeURIComponent(city)}`;

        console.log(`🔍 Searching for ${name} (${city})`);
        await page.evaluate((u) => (window.location.href = u), target);
        await page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 90000,
        }).catch(() => {});
        await page.waitForTimeout(4000);

        // --- Forced navigation: detect RID/detail link ---
        const forcedNav = await page.evaluate(() => {
            try {
                const sel = [
                    'a[href*="/record/"]',
                    'a[href*="/search/people/results?rid="]',
                    'a[href*="rid="]',
                    'a[href*="/search/people/detail"]',
                    "a.btn-success.detail-link",
                ];
                for (const s of sel) {
                    const a = document.querySelector(s);
                    if (a && a.href) return a.href;
                }
                return null;
            } catch (_) {
                return null;
            }
        });

        if (forcedNav) {
            console.log("➡️ Found RID/permalink — navigating to:", forcedNav);
            await page.evaluate((u) => (window.location.href = u), forcedNav);
            await page.waitForNavigation({
                waitUntil: "domcontentloaded",
                timeout: 60000,
            }).catch(() => {});
            await page.waitForTimeout(2000);
        } else {
            console.log("⚠️ No forced link found — trying pickAndOpenDetail()");
            const opened = await pickAndOpenDetail(page, "").catch(() => false);
            if (!opened) {
                console.warn("❌ Could not open detail. Saving basic result...");
                const basic = await scrapeBasicResult(page).catch(() => ({}));
                await fsp.writeFile(
                    `ftn_output_${id}.json`,
                    JSON.stringify({ name, city, result: basic }, null, 2)
                );
                continue;
            }
        }

        // --- Handle captcha if encountered (wait for sitekey injection) ---
        let html = await page.content();
        if (/captcha|turnstile|datadome|Just a moment/i.test(html)) {
            console.warn("🚧 Captcha detected — waiting for possible sitekey...");
            await page.waitForTimeout(5000);

            const sitekey = await page.evaluate(() => {
                const el = document.querySelector(
                    "[data-sitekey], .cf-turnstile, .h-captcha"
                );
                return el ? el.getAttribute("data-sitekey") : null;
            });

            if (sitekey && process.env.TWOCAPTCHA_API_KEY) {
                try {
                    console.log("🔐 Solving Turnstile...");
                    const token = await solveTurnstile({
                        apiKey: process.env.TWOCAPTCHA_API_KEY,
                        sitekey,
                        pageurl: page.url(),
                        pollInterval: 5000,
                        timeout: 180000,
                    });
                    await page.evaluate((tok) => {
                        const t = document.createElement("textarea");
                        t.name = "cf-turnstile-response";
                        t.value = tok;
                        t.style.display = "none";
                        document.body.appendChild(t);
                        const btn =
                            document.querySelector(
                                "button[type='submit'], input[type='submit'], form button"
                            ) || null;
                        if (btn) btn.click();
                    }, token);
                    await page.waitForNavigation({
                        waitUntil: "domcontentloaded",
                        timeout: 90000,
                    }).catch(() => {});
                } catch (e) {
                    console.warn("⚠️ Turnstile solve failed:", e?.message || e);
                }
            } else {
                console.warn("⚠️ No sitekey found; saving HTML and proceeding anyway.");
                try {
                    const ts = Date.now();
                    await fsp.writeFile(
                        `ftn_debug/captcha_${ts}.html`,
                        html,
                        "utf8"
                    ).catch(() => {});
                    await page
                        .screenshot({
                            path: `ftn_debug/captcha_${ts}.png`,
                            fullPage: true,
                        })
                        .catch(() => {});
                } catch (_) {}
            }
            html = await page.content().catch(() => html);
        }

        // --- Scrape phone links immediately after detail navigation ---
        console.log("📞 Checking for phone links...");
        const phones = await scrapePhoneLinks(page).catch(() => []);

        if (phones.length) {
            console.log(`✅ Found ${phones.length} phone links:`);
            console.table(phones);
            await fsp.writeFile(
                `ftn_output_${id}.json`,
                JSON.stringify({ name, city, phones }, null, 2)
            );
            console.log(`💾 Saved fast phone results for ${name} (${city})`);
            continue; // Skip to next lead since phones are done
        }

        // --- Fallback to full detail scrape if no oneno links ---
        console.log("📞 No phone links found — running deeper scrape...");
        const detail = await scrapeWirelessDetail(page).catch(() => ({}));

        if (
            !detail ||
            (!detail.mobile_phones?.length && !detail.phones?.length && !detail.address)
        ) {
            const fallback = await scrapeBasicResult(page).catch(() => ({}));
            Object.assign(detail, fallback);
        }

        await fsp.writeFile(
            `ftn_output_${id}.json`,
            JSON.stringify({ name, city, result: detail }, null, 2)
        );
        console.log(`💾 Saved result for ${name} (${city})`);

        await page.waitForTimeout(2500);
    }

    console.log("✅ Done — all leads processed.");
})();
