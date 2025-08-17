const { test, expect } = require('@playwright/test');

test('test new knowledge', async({ page }) => {

    await page.goto("https://www.google.com/", {
        waitUntill: " domcontentloaded ",
    });

    let a = [1, 2].map(e => e + 1);
    let b = a;

    console.log(a == b); // true
});