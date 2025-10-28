// scrapeHelpers.js
const fs = require("fs");

/**
 * Clicks the first visible result link ("View Details") or data-rid element.
 * Returns true if it successfully opened a detail page.
 */
async function pickAndOpenDetail(page, contextLabel = "") {
    try {
        const selectors = [
            'a[href*="/record/"]',
            'a.btn-success.detail-link',
            'a[href*="rid="]',
            '[data-detail-url]',
        ];

        for (const sel of selectors) {
            const link = await page.$(sel);
            if (link) {
                console.log(`🖱️ [${contextLabel}] Clicking result link: ${sel}`);
                await link.click({ delay: 200 });
                await page.waitForTimeout(2000);
                // Wait for DOM swap or navigation
                await Promise.race([
                    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
                    page.waitForSelector(".recordTitleBox, .phones, .recordValue", { timeout: 15000 }),
                ]).catch(() => {});
                return true;
            }
        }
        console.warn(`⚠️ [${contextLabel}] No clickable result found.`);
        return false;
    } catch (e) {
        console.warn(`⚠️ pickAndOpenDetail error: ${e.message}`);
        return false;
    }
}

/**
 * Extracts visible text from result page (fallback mode)
 */
async function scrapeBasicResult(page) {
    try {
        const body = await page.evaluate(() => document.body.innerText || "");
        const phoneMatch = body.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g);
        const emailMatch = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
        const addressMatch = body.match(/\d{1,5}\s[\w\s.,]+(Street|St|Ave|Avenue|Rd|Road|Blvd|Drive|Dr|Ln|Lane)/i);

        return {
            phone: phoneMatch ? [...new Set(phoneMatch)] : [],
            email: emailMatch ? [...new Set(emailMatch)] : [],
            physical_address: addressMatch ? addressMatch[0] : null,
        };
    } catch (e) {
        console.warn("⚠️ scrapeBasicResult error:", e.message);
        return {};
    }
}

/**
 * Extracts detailed phone/address data from FamilyTreeNow detail view.
 */
async function scrapeWirelessDetail(page) {
    try {
        return await page.evaluate(() => {
            const result = {
                mobile_phones: [],
                phones: [],
                address: null,
            };

            // Phone parsing
            document.querySelectorAll(".phones .value, a[href*='phoneno=']").forEach((el) => {
                const num = el.textContent.trim();
                if (num && !result.phones.includes(num)) result.phones.push(num);
            });

            // Address parsing
            const addrEl = document.querySelector(".address .value, .currentAddress .value");
            if (addrEl) result.address = addrEl.textContent.trim();

            // Email parsing if present
            const emails = Array.from(document.querySelectorAll("a[href^='mailto:']")).map((a) => a.textContent.trim());
            if (emails.length) result.emails = emails;

            return result;
        });
    } catch (e) {
        console.warn("⚠️ scrapeWirelessDetail error:", e.message);
        return {};
    }
}
/**
 * scrapePhoneLinks
 * Extracts phone numbers & their hrefs from FamilyTreeNow detail pages.
 * Works exactly like your RID link logic — fast, simple DOM scan.
 */
async function scrapePhoneLinks(page) {
    try {
        const phones = await page.evaluate(() => {
            const results = [];
            document.querySelectorAll('a[href*="oneno="]').forEach(a => {
                const number = (a.textContent || '').trim();
                const href = a.href;
                const type =
                    a.closest('.col-md-6, .col-xs-12')?.querySelector('.smaller')
                        ?.textContent?.trim() || null;
                if (number) results.push({ number, href, type });
            });
            return results;
        });

        // Deduplicate & normalize
        const seen = new Set();
        const clean = [];
        for (const p of phones) {
            const digits = p.number.replace(/[^\d]/g, "");
            if (!digits || seen.has(digits)) continue;
            seen.add(digits);
            clean.push({
                number: p.number,
                href: p.href,
                type: p.type || null,
            });
        }

        console.log(`📞 scrapePhoneLinks found ${clean.length} phones`);
        return clean;
    } catch (e) {
        console.warn("⚠️ scrapePhoneLinks error:", e.message);
        return [];
    }
}

module.exports = {
    pickAndOpenDetail,
    scrapeBasicResult,
    scrapeWirelessDetail,
    scrapePhoneLinks, // ← add it to your export list
};


module.exports = {
    pickAndOpenDetail,
    scrapeBasicResult,
    scrapeWirelessDetail,
    scrapePhoneLinks
};
