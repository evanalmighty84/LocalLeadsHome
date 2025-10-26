// runFamilyTreeTerminalAutomation.js
// Used for local testing of FamilyTree scraping logic
// Just run:  node runFamilyTreeTerminalAutomation.js
const { chromium } = require('playwright');
const { runFamilyTreeStealth } = require('./runFamilyTreeStealth');

async function runFamilyTreeTerminalAutomation() {
    // 🧩 Static test parameters
    const first = 'kimberly';
    const last = 'james';
    const city = 'pasadena';

    console.log(`🕵️ Running FamilyTreeNow static test for ${first} ${last} (${city})`);

    // --- Local Chrome launch ---
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // use your installed Chrome.app
        args: [
            '--disable-blink-features=AutomationControlled',
            '--window-size=1366,768',
        ],
    });

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
