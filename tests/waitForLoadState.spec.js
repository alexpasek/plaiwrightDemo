const { test, expect } = require('@playwright/test');
test('waiting withn the load state ', async({ page }) => {

    await page.goto("https://freelance-learn-automation.vercel.app/login")

    await page.getByText("New user? Signup").click()

    await page.waitForLoadState("networkidle")
    await page.pause()


    const countHowmanyNumbers = await page.locator("//input[@type='checkbox']").count()

    expect(countHowmanyNumbers).toBe(7)







})