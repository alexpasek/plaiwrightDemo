const { test, expect } = require("@playwright/test");
test("Valid login", async function({ page }) {

    await page.goto("https://the-internet.herokuapp.com/upload");

    await page.locator("#file-upload").setInputFiles("./Uploads/image.JPG")

    await page.locator("#file-submit").click();


    expect(await page.locator("//h3"))
        .toHaveText("File Uploaded!");

})