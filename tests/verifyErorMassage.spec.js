const { test, expect } = require('@playwright/test');
test('Verify Erorr Message', async function({ page }) {
    console.log(await page.viewportSize().height);
    console.log(await page.viewportSize().width);
    await page.goto(
        "https://opensource-demo.orangehrmlive.com/web/index.php/auth/login"
    );
    await page.getByPlaceholder("Username").type('Admin');
    await page.getByPlaceholder("Password").type('admin1238');
    await page.locator("//button[normalize-space()='Login']").click();
    const errorMassage = await page.locator(
        "//p[@class='oxd-text oxd-text--p oxd-alert-content-text']"
    ).textContent();
    console.log('erorr massage is ' + errorMassage);
    expect(errorMassage.includes('Invalid')).toBeTruthy();

})