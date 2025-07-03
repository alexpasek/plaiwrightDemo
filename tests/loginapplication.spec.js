const { test, expect } = require("@playwright/test");
const LoginPage = require("../pages/loginPage.js");
const HomePage = require("../pages/homepage.js");




test("Login to application ", async({ page }) => {

    await page.goto("https://freelance-learn-automation.vercel.app/login");


    const loginPage = new LoginPage(page)

    await loginPage.loginnToApplication();




    const homePage = new HomePage(page)
    await homePage.logOutFromApplication()
})