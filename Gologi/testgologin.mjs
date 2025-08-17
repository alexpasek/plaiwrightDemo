import GoLogin from "gologin";
import { chromium } from "playwright-core"; // Must use playwright-core to connectOverCDP

const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ODNmNDZhNGQzNWEyNDQ1Nzc5NjdjZjAiLCJ0eXBlIjoiZGV2Iiwiand0aWQiOiI2ODNmNGM2ODMzZGI2OTE3MTkyMjM4MjEifQ.s4cpmnkxp5S4FtUv-u--UoLyZoWTl6Tx0PBhzS7OOF8"; // 🔒 Replace with your actual GoLogin API token
const profileId = "683f561d80052de2611fc29b"; // 🔒 Replace with your actual GoLogin profile ID

const GL = new GoLogin({
    token,
    profile_id: profileId,
});

const run = async() => {
    try {
        // 🧠 Start GoLogin profile → returns WebSocket endpoint
        const { wsUrl } = await GL.start(); // ✅ Correct structure: use destructuring to get wsUrl
        console.log("✅ WebSocket:", wsUrl);

        // 🎯 Connect Playwright to the GoLogin browser via CDP
        const browser = await chromium.connectOverCDP(wsUrl);

        // 👇 Use an existing context (CDP only exposes default context)
        const [context] = browser.contexts();
        const page = await context.newPage();

        // 🌐 Navigate
        await page.goto("https://linkedin.com");
        console.log("🌐 Opened LinkedIn");

        // Wait and close
        await page.waitForTimeout(5000);
        await browser.close();
        await GL.stop();
        console.log("✅ Done");
    } catch (error) {
        console.error("❌ Error found and direct you to it:", error);
    }
};

run();