// runFTNPhones.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const LOG_DIR = path.resolve(process.cwd(), 'ftn_debug');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const UA = process.env.USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function dismissCookiePopup(page) {
    try {
        const popup = await page.$('div[role="dialog"], div#onetrust-banner-sdk, div:has-text("Essential")');
        if (!popup) return false;
        const buttons = [
            'button:has-text("Accept All")',
            'button:has-text("Accept")',
            'button:has-text("I Accept")',
            'button:has-text("OK")',
            'button:has-text("Continue")',
            'button:has-text("Close")',
            'button[aria-label="Close"]'
        ];
        for (const sel of buttons) {
            const btn = page.locator(sel).first();
            if (await btn.count()) {
                await btn.click({ delay: 150 }).catch(()=>{});
                await page.waitForTimeout(800);
                return true;
            }
        }
        await page.keyboard.press('Escape').catch(()=>{});
    } catch (e) {
        console.warn('dismissCookiePopup error:', e.message);
    }
    return false;
}

async function waitForTurnstileSolve(page, timeoutMs = 120000) {
    // detect common cloudflare/turnstile indicators and wait for them to disappear
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const html = await page.content();
        const lowered = html.toLowerCase();
        if (!(/turnstile|challenges.cloudflare.com|please enable javascript|verifying your browser|checking your browser/i.test(lowered))) {
            return true; // no challenge detected
        }
        console.log('🧩 Turnstile/CF challenge detected — please solve in the browser window (waiting)...');
        await page.waitForTimeout(3000);
    }
    return false;
}

async function pickAndOpenDetail(page) {
    // Tries a few selectors to find a "View Details" / record link and click
    const selectors = [
        'a:has-text("View Details")',
        'button:has-text("View Details")',
        'a[href*="/record/"]',
        'a[href*="rid="]',
        'a:has-text("View Detail")',
        'a.result-link'
    ];
    for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count()) {
            try {
                const href = await el.getAttribute('href');
                console.log('➡️ Clicking selector', sel, 'href=', href ? href : '(no href)');
                await el.scrollIntoViewIfNeeded();
                await el.click({ delay: 150 });
                await page.waitForTimeout(2000);
                return true;
            } catch (e) {
                console.warn('click failed for', sel, e.message);
            }
        }
    }
    // fallback: click first anchor that looks like a record link
    const record = await page.$('a[href*="/record/"], a[href*="rid="]');
    if (record) {
        try {
            await record.click({ delay: 150 });
            await page.waitForTimeout(1500);
            return true;
        } catch (e) {}
    }
    return false;
}

async function scrapeMobilePhones(page) {
    // returns array of { number, type, carrier, raw }
    try {
        const phones = await page.$$eval('a[href*="phoneno="]', anchors =>
            anchors.map(a => {
                const raw = a.closest ? a.closest('div')?.innerText || a.parentElement?.innerText || a.innerText : a.innerText;
                const number = a.innerText.trim();
                // find type keywords in surrounding text
                const txt = (a.closest ? a.closest('div')?.innerText : a.parentElement?.innerText) || '';
                const typeMatch = txt.match(/\b(Wireless|Mobile|Cell|Landline|Voip|Land Line|Land-Line)\b/i);
                const type = typeMatch ? typeMatch[1].toLowerCase() : null;
                // try carrier
                const carrierMatch = txt.match(/\b(AT&T|Verizon|T-Mobile|Sprint|Metro|Cricket|Frontier|CenturyLink|Charter|Xfinity)\b/i);
                const carrier = carrierMatch ? carrierMatch[0] : null;
                return { number, type, carrier, raw: txt.trim().slice(0, 400) };
            })
        );

        // filter mobile/wireless first; if none, return all phones
        const mobile = phones.filter(p => p.type && /wireless|mobile|cell/i.test(p.type));
        return mobile.length ? mobile : phones;
    } catch (e) {
        console.warn('scrapeMobilePhones error:', e.message);
        return [];
    }
}

async function run({ first='Jennifer', last='Brown', city='Los Angeles' } = {}) {
    if (!first || !last || !city) {
        console.error('Missing params');
        return;
    }

    const target = `https://www.familytreenow.com/search/genealogy/results?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}&citystatezip=${encodeURIComponent(city)},+CA`;
    console.log('🎯 Target:', target);

    // Playwright launch options (visible)
    const proxyServer = process.env.USE_PROXY && process.env.PROXY_SERVER ? process.env.PROXY_SERVER : null;
    const launchOpts = {
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1366,768',
        ]
    };
    if (proxyServer) {
        launchOpts.proxy = { server: proxyServer };
        console.log('🔧 Using browser proxy:', proxyServer.replace(/:[^@]+@/, ':****@'));
    }

    const browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
        await page.waitForTimeout(2500);

        // dismiss cookie if present
        await dismissCookiePopup(page);

        // if Turnstile/CF present, ask user to solve (visible)
        const noChallenge = await waitForTurnstileSolve(page, 60000);
        if (!noChallenge) {
            console.warn('⚠️ Still seeing a JS challenge after wait. You may need to solve it in the opened browser window.');
            // give additional interactive time
            await page.waitForTimeout(45000);
        }

        // Try to open detail
        const opened = await pickAndOpenDetail(page);
        if (!opened) {
            console.warn('⚠️ Could not find or click a detail link on results page. Saving results HTML for inspection.');
            const html = await page.content();
            fs.writeFileSync(path.join(LOG_DIR, 'ftn_search_page.html'), html);
            await browser.close();
            return { ok: false, reason: 'no_detail_link', debug: path.join(LOG_DIR, 'ftn_search_page.html') };
        }

        // Wait for detail to load
        await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(()=>{});
        await page.waitForTimeout(2000);

        // If still a challenge on detail, wait for manual solve
        await waitForTurnstileSolve(page, 60000);

        // Scrape phones
        const mobilePhones = await scrapeMobilePhones(page);

        // save detail html for debugging
        const detailHtml = await page.content();
        fs.writeFileSync(path.join(LOG_DIR, `ftn_detail_${first}_${last}.html`), detailHtml);

        console.log('📞 Mobile phones found:', mobilePhones);
        await browser.close();
        return { ok: true, data: mobilePhones };
    } catch (err) {
        console.error('❌ Error during run:', err.message);
        try { await browser.close(); } catch(_) {}
        return { ok: false, error: err.message };
    }
}

// If run directly
if (require.main === module) {
    // change these as needed
    run({ first: 'Amanda', last: 'Terrell', city: 'Los Angeles' })
        .then(r => console.log('Done:', r))
        .catch(e => console.error(e));
}
