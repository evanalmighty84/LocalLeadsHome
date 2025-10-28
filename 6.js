// 6.js — CLI-driven FamilyTreeNow detail scraper (Multilogin + dynamic URL)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const scrapeDetailsComponent = require("./scrapeHelpers");

(async () => {
    const WS = process.env.MULTILOGIN_WS;
    if (!WS) {
        console.error("❌ MULTILOGIN_WS not set.");
        process.exit(1);
    }

    // --- Accept CLI argument or env var for target URL ---
    const targetURL =
        process.argv[2] ||
        process.env.TARGET_URL ||
        "https://www.familytreenow.com/search/genealogy/results?first=Jennifer&last=Brown&citystatezip=Los%20Angeles,+CA";

    console.log(`🎯 Target URL: ${targetURL}`);

    const browser = await chromium.connectOverCDP(WS);
    console.log("✅ Connected to Multilogin CDP session.");

// --- ensure we use the newest or FamilyTreeNow tab ---
    const context = browser.contexts()[0];
    let pages = context.pages();

    if (pages.length > 1) {
        // pick the last opened FamilyTreeNow tab if present
        const ftnPage = pages.reverse().find(p => /familytreenow\.com/i.test(p.url()));
        if (ftnPage) {
            console.log("🧭 Switching to FamilyTreeNow tab:", ftnPage.url());
            page = ftnPage;
        } else {
            console.log("🪄 Creating new tab for FamilyTreeNow...");
            page = await context.newPage();
        }
    } else {
        page = pages[0];
    }

    await page.bringToFront();


    // --- If page isn't already on FamilyTreeNow, navigate directly ---
    // --- Use the existing FamilyTreeNow tab and edit the search form instead of new navigation ---
    if (/familytreenow\.com/.test(page.url())) {
        console.log("🧭 Editing existing FamilyTreeNow search...");

        const params = new URL(targetURL).searchParams;
        const first = params.get("first") || "";
        const last = params.get("last") || "";
        const city = params.get("citystatezip") || params.get("CityStateZip") || "";

        // 1️⃣ Click "Edit Search" to reveal the form
        try {
            await page.waitForSelector("a.btn-search.editCriteria", { timeout: 15000 });
            await page.click("a.btn-search.editCriteria");
            console.log("✏️ Opened Edit Search form.");
        } catch {
            console.warn("⚠️ Edit Search button not found, proceeding to check form visibility.");
        }

        // 2️⃣ Fill in new values
        await page.waitForSelector("#First", { timeout: 15000 });
        await page.fill("#First", first);
        await page.fill("#Last", last);
        await page.fill("#CityStateZip", city);

        console.log(`🔤 Filled search: ${first} ${last} in ${city}`);

        // 3️⃣ Submit the search form
        console.log("🔁 Submitting search in-page (no network-level navigation)...");
        await page.evaluate(() => {
            const btn = document.querySelector("button.search-button");
            if (btn) btn.click();
        });
        await page.waitForFunction(
            () => document.querySelectorAll("a.btn-success.detail-link").length > 0,
            { timeout: 45000 }
        ).catch(() => console.warn("⚠️ No results detected after submit — continuing."));
        console.log("✅ Search results appear ready.");


        console.log("🔁 Search submitted, waiting for results...");
    } else {
        console.log("🌎 Navigating fresh to FamilyTreeNow results...");
        await page.goto(targetURL, { waitUntil: "domcontentloaded", timeout: 60000 });
    }


    let currentURL = page.url();
    console.log("📍 Current page:", currentURL);

    // --- Handle Spokeo redirect recovery ---
    if (/spokeo\.com/.test(currentURL)) {
        console.log("⚠️ Detected Spokeo redirect — redirecting in-page to FamilyTreeNow...");
        await page.evaluate((url) => (window.location.href = url), targetURL);
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 });
        currentURL = page.url();
    }

    // --- Wait for results to render ---
    console.log("⏳ Waiting 20s for FamilyTreeNow results...");
    await page.waitForTimeout(20000);

    // --- Find and click first “View Details” ---
    const selector = "a.btn-success.detail-link";
    const detailLink = await page.$(selector);

    if (detailLink) {
        console.log("👆 Found first 'View Details' link — clicking...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }),
            detailLink.click(),
        ]);
        console.log("➡️ Navigated to:", page.url());
    } else {
        console.warn("⚠️ No detail-link found — verify FamilyTreeNow results page loaded.");
    }




    // --- Allow detail page to stabilize ---
    await page.waitForTimeout(8000);

    // --- Extract record info ---
    const recordData = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const collect = (sel) =>
            Array.from(document.querySelectorAll(sel))
                .map((el) => el.textContent.trim())
                .filter(Boolean);

        const name =
            getText("h1") ||
            getText(".recordTitle") ||
            getText(".name") ||
            getText(".header h2") ||
            null;

        const summary = getText(".recordSummary, .summary, .infoBlock");
        const addresses = collect(".address, .pastAddress, li, .adr").filter((t) => /[A-Za-z]/.test(t));
        const relatives = collect(".relatives a, .relative a");
        const phones = collect(".phone, a[href^='tel:']").filter((p) => /\d{3}[-\s]?\d{3}/.test(p));

        return { name, summary, addresses, relatives, phones };
    });

    // --- Extract detailed phone panel ---
    console.log("📞 Parsing detailed phone section...");
    await page.waitForTimeout(2000); // small buffer

    const detailedPhones = await scrapeDetailsComponent(page);
    recordData.detailedPhones = detailedPhones;

    console.log(`✅ Extracted ${detailedPhones.length} phone entries.`);
    console.log(JSON.stringify(recordData, null, 2));

    // --- Save JSON ---
    const outPath = path.join(process.cwd(), "ftn_detail_with_phones.json");
    fs.writeFileSync(
        outPath,
        JSON.stringify(
            { url: page.url(), extractedAt: new Date().toISOString(), ...recordData },
            null,
            2
        ),
        "utf8"
    );

    console.log(`💾 Saved ftn_detail_with_phones.json with ${detailedPhones.length} phone(s).`);
    await browser.close();
    console.log("🔌 Browser closed cleanly.");
})();
