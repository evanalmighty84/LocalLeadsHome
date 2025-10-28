require('dotenv').config();
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { HttpsProxyAgent } = require('https-proxy-agent');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// -------------------- Web Unblocker Proxy --------------------
function buildWebUnblockerProxy() {
    const host = process.env.WEBUNBLOCKER_HOST || 'unblock.oxylabs.io';
    const port = process.env.WEBUNBLOCKER_PORT || 60000;
    const user = process.env.WEBUNBLOCKER_USER; // e.g. evanligon_elSmB
    const pass = encodeURIComponent(process.env.WEBUNBLOCKER_PASS);
    const session = Math.random().toString(36).slice(2, 10);
    return `https://${user}-sessid-${session}:${pass}@${host}:${port}`;
}

// -------------------- Residential Proxy --------------------
function buildResidentialProxy(city = 'los_angeles') {
    const baseUser = 'customer-evanligon_uyII0';
    const pass = encodeURIComponent('Godlovesme25+');
    const host = 'pr.oxylabs.io';
    const port = 7777;
    const session = Math.random().toString(36).slice(2, 10);

    return `http://${baseUser}-cc-us-st-us_california-city-${city.toLowerCase()}-sessid-${session}-sesstime-10:${pass}@${host}:${port}`;
}

// -------------------- Fetch Helpers --------------------
async function fetchViaProxy(url, proxy, isWebUnblocker = false) {
    console.log(`🔧 Using proxy: ${proxy.replace(/:[^@]+@/, ':****@')}`);
    const agent = new HttpsProxyAgent(proxy);

    const headers = {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
    };
    if (isWebUnblocker) {
        headers['X-Oxylabs-Render'] = 'html';
        headers['X-Oxylabs-Geolocation'] = 'US';
    }

    const res = await fetch(url, { agent, headers, timeout: 60000 });
    const text = await res.text();
    console.log(`🌍 ${isWebUnblocker ? 'Web Unblocker' : 'Residential'} HTTP: ${res.status}, HTML length: ${text.length}`);
    console.log('🧾 Body preview:', text.slice(0, 180).replace(/\n/g, ' '));
    return { res, text };
}

// -------------------- Parser --------------------
function parseThatsThem(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.result').each((_, el) => {
        const name = $(el).find('.name').text().trim();
        const address = $(el).find('.address').text().trim().replace(/\s+/g, ' ');
        const phone = $(el).find('.phone').text().trim();
        const email = $(el).find('.email').text().trim();
        if (name) results.push({ name, address, phone, email });
    });

    return results;
}

// -------------------- Main Logic --------------------
async function runThatsThem({ first, last, city, state }) {
    const url = `https://thatsthem.com/name/${encodeURIComponent(first)}-${encodeURIComponent(
        last
    )}/${encodeURIComponent(city)}-${encodeURIComponent(state)}`;

    console.log('🎯 Target:', url);

    // 1️⃣ Try Web Unblocker first
    const wbProxy = buildWebUnblockerProxy();
    try {
        const { res, text } = await fetchViaProxy(url, wbProxy, true);
        if (res.status === 200 && text.includes('<html')) {
            const parsed = parseThatsThem(text);
            if (parsed.length > 0) {
                console.log('✅ Parsed results from Web Unblocker:', parsed.slice(0, 3));
                return;
            }
            if (!/challenge|enable javascript|captcha/i.test(text)) {
                console.log('✅ Web Unblocker HTML looks normal but no .result elements.');
                return;
            }
        }
        console.warn('⚠️ Web Unblocker returned challenge or no data — falling back to Residential...');
    } catch (err) {
        console.error('❌ Web Unblocker failed:', err.message);
    }

    // 2️⃣ Fallback to Residential
    try {
        const rpProxy = buildResidentialProxy(city.replace(/\s+/g, '_'));
        const { res, text } = await fetchViaProxy(url, rpProxy, false);
        const parsed = parseThatsThem(text);
        console.log(`✅ Parsed ${parsed.length} results`);
        console.log(parsed.slice(0, 5));
    } catch (err) {
        console.error('❌ Residential fetch failed:', err.message);
    }
}

// -------------------- Run Test --------------------
if (require.main === module) {
    runThatsThem({
        first: 'Amanda',
        last: 'Terrell',
        city: 'Los Angeles',
        state: 'CA',
    }).catch(console.error);
}
