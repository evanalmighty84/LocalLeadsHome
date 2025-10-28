
// runFamilyTreeTerminalAutomation.js
// Used for local testing of FamilyTree scraping logic
// Just run:  node runFamilyTreeTerminalAutomation.js
const { chromium } = require('playwright');
const { runFamilyTreeStealth } = require('./runFamilyTreeStealth');

async function runFamilyTreeTerminalAutomation() {
    // 🧩 Static test parameters
    const first = 'Amanda';
    const last = 'terrell';
    const city = 'San Diego';

    console.log(`🕵️ Running FamilyTreeNow static test for ${first} ${last} (${city})`);

    // --- Local Chrome launch ---
    // --- Cross-platform launch (local vs Railway) ---
    const isHeadless = process.env.HEADLESS !== "0"; // default true
    const useChrome = process.env.USE_CHROME === "1";

    const launchOpts = {
        headless: isHeadless,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1366,768",
            "--ignore-certificate-errors",
            "--disable-gpu",
        ],
    };

    if (useChrome) {
        console.log("🧭 Using system Chrome channel (local dev)");
        launchOpts.channel = "chrome";
    } else {
        console.log("🚫 Forcing Playwright-bundled Chromium (Railway safe)");
    }

    const browser = await chromium.launch(launchOpts);


    try {
        // --- Call the production scraper logic ---
        const result = await runFamilyTreeStealth({ first, last, city, browser });

        console.log('\n✅ FamilyTreeNow result:');
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('❌ FamilyTree test failed:', err);
    } finally {
        await browser.close().catch(() => {});
    }
}

// Allow standalone execution
if (require.main === module) {
    runFamilyTreeTerminalAutomation()
        .then(() => {
            console.log('🎯 FamilyTreeNow automation complete.');
            process.exit(0);
        })
        .catch(err => {
            console.error('💥 Fatal error in FamilyTreeNow automation:', err);
            process.exit(1);
        });
}
