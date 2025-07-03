const { test, expect } = require('@playwright/test');
test("select value from dropdown", async function({ page }) {
    await page.goto("https://freelance-learn-automation.vercel.app/signup");

    await page.locator("#state").selectOption({ label: "Goa" })


    await page.waitForTimeout(5000)
    await page.locator("#state").selectOption({ index: 4 })

})