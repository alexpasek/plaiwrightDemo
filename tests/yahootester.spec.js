const { chromium } = require('playwright');

(async() => {
    const browser = await chromium.launch({
        headless: false
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://ca.yahoo.com/');
    await page.getByRole('link', { name: 'News', exact: true }).click();
    await page.goto('https://ca.news.yahoo.com/');

    await page.waitForTimeout(5000)



    await page.getByRole('link', { name: 'Man wrongfully convicted of' }).click();

    await page.pause()
    await page.getByRole('link', { name: 'Yahoo News' }).click();

    // ---------------------
    await context.close();
    await browser.close();
})();