// getRecentNextdoorMessages.js
const pool = require('./db');

(async () => {
    try {
        const query = `
      SELECT 
        id, 
        timestamp, 
        author, 
        location, 
        city, 
        lead_type
      FROM nextdoor_messages
      WHERE city ILIKE ANY(ARRAY[
        '%Yucaipa%', 
        '%Loma Linda%', 
        '%Riverside%', 
        '%Redlands%', 
        '%San Bernardino%', 
        '%Pasadena%', 
        '%Los Angeles%', 
        '%Bakersfield%', 
        '%Plano%', 
        '%Dallas%', 
        '%McKinney%', 
        '%Allen%'
      ])
      ORDER BY timestamp DESC
      LIMIT 5;
    `;

        const { rows } = await pool.query(query);
        console.log('🧾 Last 5 Nextdoor messages (CA or TX cities):');
        console.table(rows);

        process.exit(0);
    } catch (err) {
        console.error('❌ Error fetching nextdoor messages:', err);
        process.exit(1);
    }
})();
