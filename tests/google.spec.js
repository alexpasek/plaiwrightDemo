const { test, expect } = require("@playwright/test");


test.only('Verify google title', async function({ page }) {
    await page.goto('http://google.com')

    await expect(page).toHaveTitle('Gyahoo')
    await page.getByPlaceholder("usernamereg-firstName").type("admin");
});