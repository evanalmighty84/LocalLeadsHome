import { chromium } from "playwright";

const ws = "ws://127.0.0.1:62226/devtools/browser/aba718bd-a040-4107-abdf-7808cdc65fbf";
console.log("🔗 Connecting to", ws);

const browser = await chromium.connectOverCDP(ws);
const [page] = browser.contexts()[0].pages();
await page.bringToFront();
console.log("🎯 Connected successfully!");
