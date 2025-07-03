const { test, expect } = require("@playwright/test");
test("sworking with tabs", async({ browser }) => {

    const context = await browser.newContext();
    const page = await context.newPage()

    await page.goto("https://freelance-learn-automation.vercel.app/login");


    const [newPage] = await Promise.all([
        context.waitForEvent("page"),
        page.locator("(//*[name()='svg'][@id='Layer_1'])[3]").click(),
    ]);
    await newPage.locator("").fill("rostyslav bondaruk")



});