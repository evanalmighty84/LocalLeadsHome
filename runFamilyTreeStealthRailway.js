// runFamilyTreeStealth.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");


const LOG_DIR = path.resolve(process.cwd(), "ftn_debug");
fs.mkdirSync(LOG_DIR, { recursive: true });

const UA =
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
// --- Utility: dismiss cookie banner if present ---

function randomSessionId(length = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function dismissCookiePopup(page) {
    try {
        // Check for any of the known FamilyTreeNow cookie selectors
        const popup = await page.$('div[role="dialog"], div#onetrust-banner-sdk, div:has-text("Essential")');
        if (popup) {
            console.log("🍪 Cookie popup detected — attempting to dismiss...");

            // Try clicking the accept or close buttons
            const buttons = [
                'button:has-text("Accept All")',
                'button:has-text("Accept")',
                'button:has-text("OK")',
                'button:has-text("Continue")',
                'button:has-text("Close")',
                'button[aria-label="Close"]',
            ];

            for (const sel of buttons) {
                const btn = page.locator(sel).first();
                if (await btn.count()) {
                    await btn.click({ delay: 150 });
                    console.log(`✅ Dismissed cookie popup via selector: ${sel}`);
                    await page.waitForTimeout(1000);
                    return true;
                }
            }

            // Fallback: press Escape if modal still visible
            await page.keyboard.press("Escape").catch(() => {});
            console.log("⚙️  Sent ESC to close any modal overlays.");
        }
    } catch (err) {
        console.warn("⚠️ Cookie popup dismiss failed:", err.message);
    }
    return false;
}
// --- Utility: handle Cloudflare Turnstile (captcha) ---
async function handleTurnstile(page) {
    try {
        // Look for the iframe Cloudflare uses
        const turnstile = await page.$('iframe[src*="challenges.cloudflare.com"]');
        if (!turnstile) return false;

        console.log("🧩 Cloudflare Turnstile challenge detected — trying to solve...");

        // Option 1: manual wait (if you want to solve visually)
        // await page.waitForTimeout(20000);  // give yourself 20 s to click

        // Option 2: automated solve via 2Captcha (if API key set)
        const sitekey = await page.evaluate(() => {
            const ifr = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
            return ifr ? new URLSearchParams(ifr.src).get("k") : null;
        });

        if (sitekey && process.env.TWOCAPTCHA_API_KEY) {
            const apiKey = process.env.TWOCAPTCHA_API_KEY;
            const url = page.url();
            console.log("🔑 Solving Turnstile via 2Captcha...");
            const res = await fetch(
                `http://2captcha.com/in.php?key=${apiKey}&method=turnstile&sitekey=${sitekey}&pageurl=${encodeURIComponent(
                    url
                )}&json=1`
            );
            const { request: captchaId } = await res.json();
            let token = null;
            for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 5000));
                const poll = await fetch(
                    `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`
                );
                const json = await poll.json();
                if (json.status === 1) {
                    token = json.request;
                    break;
                }
            }
            if (token) {
                await page.evaluate((tk) => {
                    const cfcb = document.querySelector('input[name="cf-turnstile-response"]');
                    if (cfcb) cfcb.value = tk;
                    const form = cfcb?.closest("form");
                    if (form) form.submit();
                }, token);
                console.log("✅ Turnstile token submitted.");
                await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
                return true;
            }
        }

        console.warn("⚠️ Unable to auto-solve Turnstile; waiting 30 s for manual solve.");
        await page.waitForTimeout(30000);
    } catch (err) {
        console.warn("handleTurnstile() failed:", err.message);
    }
    return false;
}
// ============================================================================
// 1️⃣  PICK & OPEN DETAIL
// ============================================================================
async function pickAndOpenDetail(page) {
    try {

        console.log('🔎 Looking for "View Details" link...');
        await dismissCookiePopup(page);
        await handleTurnstile(page);  // 👈 new


        const detailSelectors = [
            'a:has-text("View Details")',
            'button:has-text("View Details")',
            'a[href*="/record/"]',
            'a[href*="rid="]'
        ];

        let clicked = false;
        let href = null;

        for (const sel of detailSelectors) {
            const el = page.locator(sel).first();
            if (await el.count()) {
                href = await el.getAttribute("href");
                console.log(`➡️ Found detail link (${sel}): ${href || "no href"}`);

                if (href && !href.startsWith("http")) {
                    const base = new URL(page.url());
                    href = base.origin + href;
                }

                try {
                    await el.scrollIntoViewIfNeeded();
                    await el.click({ delay: 200 });
                    clicked = true;
                    break;
                } catch (clickErr) {
                    console.warn(`⚠️ Click failed for ${sel}: ${clickErr.message}`);
                }
            }
        }

        if (!clicked && href) {
            console.log("🌐 Navigating directly to record URL:", href);
            await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
            clicked = true;
        }

        if (!clicked) {
            console.warn("⚠️ Could not find or click any detail link.");
            return false;
        }

        await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2500);

        const isDetail = await page.evaluate(() => {
            const txt = document.body?.innerText || "";
            return /Possible Primary Phone|Current Address|Public Records|Phone Type/i.test(txt);
        });

        if (isDetail) {
            console.log("✅ Reached detail page successfully!");
            return true;
        }

        console.warn("⚠️ Clicked but no detail page detected — maybe Cloudflare intervened.");
        return false;
    } catch (err) {
        console.error("pickAndOpenDetail() failed:", err.message);
        return false;
    }
}

// ============================================================================
// 2️⃣  SCRAPE WIRELESS DETAIL
// ============================================================================
async function scrapeWirelessDetail(page) {
    const out = { mobile_phones: [], phones: [], address: null };

    try {
        const entries = await page.$$eval(".panel-body .col-xs-12.col-md-6", (nodes) =>
            nodes.map((el) => {
                const text = el.innerText.trim();
                const numAnchor = el.querySelector('a[href*="phoneno="]');
                const number = numAnchor ? numAnchor.innerText.trim() : null;
                if (!number) return null;

                const typeMatch = text.match(/\b(Wireless|Landline|Voip)\b/i);
                const type = typeMatch ? typeMatch[1].toLowerCase() : "unknown";
                const lastReported = (text.match(/Last reported\s+([A-Za-z]+\s+\d{4})/) || [])[1] || null;
                const carrier = (text.match(/\b(AT&T|Verizon|T-Mobile|Sprint|Metro|Cricket|Frontier|Southwestern Bell|Time Warner Cable)\b/i) || [])[0] || null;
                const isPrimary = /Possible Primary Phone/i.test(text);

                return { number, type, carrier, lastReported, isPrimary, raw: text };
            }).filter(Boolean)
        );

        for (const r of entries) {
            if (r.type === "wireless") out.mobile_phones.push(r);
            else out.phones.push(r);
        }

        const addrText = await page.evaluate(() => {
            const panel = Array.from(document.querySelectorAll(".panel.panel-primary"))
                .find((p) => p.querySelector(".panel-heading")?.innerText?.match(/Current Address/i));

            if (!panel) return null;
            const link = panel.querySelector("a.linked-record");
            if (!link) return null;

            return link.innerText.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
        });

        if (addrText) {
            out.address = addrText;
            console.log("🏠 Detected address:", addrText);
        } else {
            console.log("⚠️ No address found on page.");
        }

        console.log("📞 Parsed phone records:", out);
    } catch (e) {
        console.warn("scrapeWirelessDetail failed:", e.message);
    }

    return out;
}

// ============================================================================
// 3️⃣  WEB UNBLOCKER FETCH (Axios)
// ============================================================================
async function fetchViaWebUnblocker(url) {
    console.log("🌐 Using Web Unblocker for initial fetch...");

    const proxy = `http://${process.env.WEBUNBLOCKER_USER}:${process.env.WEBUNBLOCKER_PASS}@${process.env.WEBUNBLOCKER_HOST || "unblock.oxylabs.io"}:${process.env.WEBUNBLOCKER_PORT || 60000}`;

    try {
        const res = await axios.get(url, {
            proxy: false,
            httpsAgent: new HttpsProxyAgent(proxy),
            headers: { "User-Agent": UA,    Accept: "text/html,application/xhtml+xml",
                "X-Oxylabs-Render": "javascript" },
            timeout: 45000,
        });
        console.log("✅ Web Unblocker responded, HTML length:", res.data.length);
        return res.data;
    } catch (err) {
        console.error("❌ Web Unblocker fetch failed:", err.message);
        return null;
    }
}

// ============================================================================
// 4️⃣  MAIN FUNCTION
// ============================================================================
async function runFamilyTreeStealth({ first = "", last = "", city = "" } = {}) {
    if (!first || !last || !city) return { ok: false, reason: "missing_params" };

    const target = `https://www.familytreenow.com/search/genealogy/results?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}&citystatezip=${encodeURIComponent(city)},+CA`;
    console.log(`🎯 Target: ${target}`);

    // Step 1 – Fetch search results via Web Unblocker
    const proxyUnblocker = `http://${process.env.WEBUNBLOCKER_USER}:${process.env.WEBUNBLOCKER_PASS}@${process.env.WEBUNBLOCKER_HOST || "unblock.oxylabs.io"}:${process.env.WEBUNBLOCKER_PORT || 60000}`;
// Step 1 – Fetch search results via Web Unblocker
    let searchHTML = await fetchViaWebUnblocker(target);
    if (!searchHTML) {
        console.error("❌ Web Unblocker search failed.");
        return { ok: false, reason: "webunblocker_failed" };
    }


    const $ = cheerio.load(searchHTML);
    const detailPath = $('a[href*="/record/"], a[href*="rid="]').first().attr("href");
    if (!detailPath) {
        console.warn("⚠️ No View Details link found.");
        return { ok: true, via: "webunblocker", data: { summary: "no_detail_link" } };
    }

    const detailURL = detailPath.startsWith("http")
        ? detailPath
        : `https://www.familytreenow.com${detailPath}`;
    console.log("➡️ Found View Details link:", detailURL);

    // Step 2 – Follow link via Residential proxy
    // Step 2 – Follow link via Residential proxy
    const session = randomSessionId();
    const proxyResidential = `http://${process.env.OXYLABS_USER}-zone-custom-region-us-st-${process.env.DEFAULT_PROXY_REGION}-city-${city.toLowerCase()}-sessid-${session}:${process.env.OXYLABS_PASS}@${process.env.OXYLABS_HOST}:${process.env.OXYLABS_PORT}`;

    let detailHTML;
    try {
        console.log("🏠 Fetching details via Oxylabs Residential...");
        const res = await axios.get(detailURL, {
            proxy: false,
            httpsAgent: new HttpsProxyAgent(proxyResidential),
            headers: {
                "User-Agent": UA,
                "Connection": "close",
            },
            timeout: 60000,
            validateStatus: () => true, // don't throw on 502
        });

        if (res.status === 502) {
            console.warn("⚠️ 502 via HTTPS — retrying with HTTP...");
            const httpURL = detailURL.replace("https://", "http://");
            const retry = await axios.get(httpURL, {
                proxy: false,
                httpsAgent: new HttpProxyAgent(proxyResidential),
                headers: {
                    "User-Agent": UA,
                    "Connection": "close",
                },
                timeout: 60000,
            });
            detailHTML = retry.data;
        } else {
            detailHTML = res.data;
        }

        console.log("✅ Residential HTML length:", detailHTML.length);
    } catch (err) {
        console.error("❌ Residential detail fetch failed:", err.message);
        return { ok: false, reason: "residential_failed" };
    }


    // Step 3 – Parse the detail page
    const detail = cheerio.load(detailHTML);
    const address = detail(".panel-primary:contains('Current Address') a.linked-record").first().text().trim() || null;
    const phones = detail(".panel-body a[href*='phoneno=']")
        .map((_, el) => detail(el).text().trim())
        .get();

    console.log("🏠 Address:", address);
    console.log("📞 Phones:", phones);

    return { ok: true, via: "residential", data: { address, phones } };
}

module.exports = { runFamilyTreeStealth };

if (require.main === module) {
    runFamilyTreeStealth({ first: "Jennifer", last: "Brown", city: "Los Angeles" })
        .then((r) => console.log("✅ FamilyTreeNow result:", r))
        .catch((e) => console.error("❌", e));
}
