// leadAlertClient.js
const axios = require('axios');

const PROD_ALERT_URL =
    process.env.LEAD_ALERT_URL ||
    'https://upbeat-spontaneity-production.up.railway.app/server/crm_function/api/smsqueue/alert-lead';

// Normalize industry to what your API expects
function canonIndustry(s = '') {
    const v = s.trim().toLowerCase();
    if (['pool','pool service','pool maintenance'].includes(v)) return 'pool';
    if (['handyman','plumber','plumbing'].includes(v)) return 'handyman';
    if ([
        'housecleaner','house cleaner','house cleaning','maid','cleaner','housekeeping',
        'house-keeper','housekeeper'
    ].includes(v)) return 'housecleaner';
    if (['lawncare','lawn care','landscaping'].includes(v)) return 'lawncare';
    return v || null;
}

/**
 * Posts a lead alert to production.
 * Required (when no lead_id): name, phone, lead_type.  City is strongly recommended or
 * your server may not find any subscribers to alert.
 */
async function postLeadAlert({
                                 name,
                                 phone,
                                 lead_type,
                                 city,                 // strongly recommended
                                 description = null,   // optional
                                 location = null,      // optional
                                 physical_address = null, // optional
                                 message_sent_at = null   // optional
                             }) {
    const payload = {
        name: (name || '').trim(),
        phone: (phone || '').trim(),
        lead_type: canonIndustry(lead_type || ''),
        city: (city || '').trim() || null,
        description,
        location,
        physical_address,
        message_sent_at
    };

    if (!payload.name || !payload.phone || !payload.lead_type) {
        return { ok: false, skipped: true, reason: 'Missing name/phone/lead_type', payload };
    }

    try {
        const { data } = await axios.post(PROD_ALERT_URL, payload, { timeout: 10000 });
        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: err.response?.data || err.message, payload };
    }
}

module.exports = { postLeadAlert, canonIndustry, PROD_ALERT_URL };
