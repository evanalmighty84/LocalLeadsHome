// solveTurnstileWith2Captcha.js
const axios = require("axios");

const API_IN = "http://2captcha.com/in.php";
const API_RES = "http://2captcha.com/res.php";

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Submit a Turnstile solve request to 2captcha and poll for the answer.
 * @param {Object} opts
 * @param {string} opts.apiKey - 2captcha API key
 * @param {string} opts.sitekey - Turnstile sitekey from the page
 * @param {string} opts.pageurl - URL where widget appears
 * @param {number} [opts.pollInterval=5000] - milliseconds between polls
 * @param {number} [opts.timeout=180000] - overall timeout ms
 * @returns {Promise<string>} - the solved token (cf-turnstile-response)
 */
async function solveTurnstile({ apiKey, sitekey, pageurl, pollInterval = 5000, timeout = 180000 }) {
    if (!apiKey || !sitekey || !pageurl) throw new Error("apiKey, sitekey and pageurl required");

    // 1) Send in.php request
    const params = new URLSearchParams();
    params.append("key", apiKey);
    params.append("method", "turnstile");
    params.append("sitekey", sitekey);
    params.append("pageurl", pageurl);
    // optional: params.append("json", 1); // 2captcha accepts json=1 on some endpoints - but older endpoints reply as text. We'll use text.
    const inRes = await axios.post(API_IN, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
    });

    const inData = (inRes.data || "").toString().trim();
    // expected: OK|<captcha_id>
    if (!inData.startsWith("OK|")) throw new Error("2captcha submit error: " + inData);
    const captchaId = inData.split("|")[1];

    // 2) Poll for result
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await sleep(pollInterval);
        try {
            const res = await axios.get(API_RES, {
                params: { key: apiKey, action: "get", id: captchaId },
                timeout: 15000,
            });
            const txt = (res.data || "").toString().trim();
            if (txt === "CAPCHA_NOT_READY" || txt === "CAPTCHA_NOT_READY") {
                // keep waiting
                continue;
            }
            if (txt.startsWith("OK|")) {
                const token = txt.split("|")[1];
                return token;
            }
            // any other error -> throw
            throw new Error("2captcha error response: " + txt);
        } catch (err) {
            // network or parse problem -> optionally continue
            // if last chance, rethrow; here we continue until timeout
            console.warn("2captcha polling warning:", err.message || err);
        }
    }

    throw new Error("2captcha timed out waiting for solution");
}

module.exports = { solveTurnstile };
