// openWarmProfile.js
// Launches a GoLogin profile locally so you can browse manually to "warm" it.

require("dotenv").config();
const { GoLogin } = require("gologin");

(async () => {
    try {
        const token = process.env.GOLOGIN_TOKEN;
        const profileId = "69005344a11e69ed8098655b"; // 👈 your new profile

        if (!token) throw new Error("❌ Missing GOLOGIN_TOKEN in .env");

        const gl = new GoLogin({
            token,
            profile_id: profileId,
        });

        console.log("🚀 Launching GoLogin browser...");
        const { wsUrl } = await gl.start();

        console.log(`✅ Browser ready. Connect via DevTools:`);
        console.log(`   ${wsUrl}`);
        console.log("\nKeep this terminal open — GoLogin will close when you stop it.");

        // Wait forever so it doesn’t close immediately
        await new Promise(() => {});
    } catch (err) {
        console.error("❌ Error launching profile:", err.message);
    }
})();
