import cron from "node-cron";
//playwright-extra is wrapper for '@playwright/test
import { chromium } from 'playwright-extra';
//object properties
console.log(Object.keys(chromium))
console.log(Object.keys(cron))

//stealth mode 
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth)
    /* //user agent manul manipulation
        const UserAgent = require("user-agents");
    const MyMacUserAgent = new UserAgent({
        deviceCategory: "desktop",
        platform: 'MacIntel',
        vendor: "Microsoft"
    });
    const browseruseragent = MyMacUserAgent.toString();
    console.log(JSON.stringify(MyMacUserAgent.data, null, 2));
    */



// @ts-check
async function yahoowalk() {
    const browser = await chromium.launch({
        headless: false
    })





    const context = await browser.newContext({
        storageState: "yahoo3.json",
        // userAgent: browseruseragent
    });
    const page = await context.newPage();
    await page.goto('https://ca.yahoo.com/', { waitUntil: "domcontentloaded" });

    await page.getByRole('link', { name: 'Yahoo Home' }).click();
    await page.getByRole('combobox', { name: 'Search query' }).click();
    await page.getByRole('link', { name: 'Check your mail' }).click();
    await page.getByRole('link', { name: 'Yahoo Mail' }).click();
    await page.mouse.wheel(0, 450);
    await page.mouse.move(100, 100);
    await page.mouse.dblclick(200, 100, { button: "right" })
    await page.pause();
    await page.goto('https://ca.yahoo.com/', {
        waitUntil: "domcontentloaded"
    });
    await page.evaluate(() => { window.scrollTo({ top: 100, left: 400, behavior: 'smooth' }) })



    // ---------------------
    await context.storageState({ path: 'yahoo3.json' });
    await context.close();
    await browser.close();
};
yahoowalk();

//install scheduleruning

/*


cron.schedule('* * * * *', async() => {




console.log(`${new Date().toISOString()}, Start yahoo walk`)


// console.log(`[${new Date().toISOString()}] Starting Yahoo walk`);
// await runYahooWalk();
await yahoowalk()
})

*/