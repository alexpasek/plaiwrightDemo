const { test, expect } = require('@playwright/test');
const dataFromJason = JSON.parse(JSON.stringify(require("../testdata.json")))



test('autologin', async({ page }) => {


    test.describe("Data driven test", function() {

        for (const data of dataFromJason) {
            test("login to profile", async({ page }) => {

                await page.goto(
                    "https://freelance-learn-automation.vercel.app/login"
                );

                await page
                    .getByPlaceholder("Enter Email")
                    .fill(dataFromJason.username);

                await page
                    .locator("//input[@id='password1']")
                    .fill(dataFromJason.password);
                await page.waitForTimeout(5000);






            })

        }



    })



})