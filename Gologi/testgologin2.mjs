import GoLogin from "gologin";
import { resolve } from "path";
import { chromium } from "playwright-core";

const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ODNmNDZhNGQzNWEyNDQ1Nzc5NjdjZjAiLCJ0eXBlIjoiZGV2Iiwiand0aWQiOiI2ODNmNGM2ODMzZGI2OTE3MTkyMjM4MjEifQ.s4cpmnkxp5S4FtUv-u--UoLyZoWTl6Tx0PBhzS7OOF8"; // replace
const profileId = "683f561d80052de2611fc29b"; // replace

const GL = new GoLogin({ token, profile_id: profileId });

const run = async() => {
    let browser;
    try {
        const { wsUrl } = await GL.start();
        console.log("✅ WebSocket:", wsUrl);

        browser = await chromium.connectOverCDP(wsUrl);
        const [context] = browser.contexts();
        const page = await context.newPage();

        await page.goto("https://linkedin.com");
        console.log("🌐 Opened LinkedIn");
        await page.goto('https://www.google.com/');

        await page.waitForTimeout(5000);
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        // Try to close Playwright browser connection
        if (browser) {
            await browser.close()
        }

        //add delay 
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Stop GoLogin profile (force close)
        try {
            await GL.stop();
            console.log("🛑 GoLogin profile stopped");
        } catch (e) {
            console.warn("⚠️ GoLogin stop failed:", e);
        }

        console.log("✅ Script finished");
    }
};

run();