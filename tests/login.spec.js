const { test, expect } = require("@playwright/test");
const { clear } = require("console");


test("valid login", async function({ page }) {
    await page.goto('https://login.yahoo.com/account/create?intl=ca&lang=en-US&src=ym&specId=yidregsimplified&done=https%3A%2F%2Fmail.yahoo.com%2F%3F.lang%3Den-CA%26guce_referrer%3DaHR0cHM6Ly93d3cuZ29vZ2xlLmNvbS8%26guce_referrer_sig%3DAQAAAJNdw52F8nIOx8KUauHPvjwPpLht8ApLbCdYvrysLMf1FNhC56Q0CHOarQD-9YCgBc7HxvraDCFpxVdbfSjSL3GCKovGXWheBb73YiktFVtb_HXXXETiisN3ErSBQWhgc2OXzI3rYWu5SzzAo8YgMcxD6IOp52MzVcA1_vWfISFh&altreg=1')
    await page
        .locator("//input[@id='usernamereg-firstName']")
        .type("admin", { delay: 2000 });
    await page
        .locator("//input[@id='usernamereg-firstName']")
        .type("admin123", {
            delay: 1000
        });
    await page.locator("//input[@id='usernamereg-userId']").type('webtoronto22 ');
    await page.locator("//button[@id='reg-submit-button']").click()

    expect(page).toHaveURL(/fail/)
})