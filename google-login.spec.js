const { firefox } = require('playwright');

(async () => {
  const browser = await firefox.launch({
    channel: 'firefox',
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.google.com/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('textbox', { name: 'Email or phone' }).click();
  await page.getByRole('textbox', { name: 'Email or phone' }).fill('webtoronto222gmail.com');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.close();

  // ---------------------
  await context.storageState({ path: 'Glogin.json' });
  await context.close();
  await browser.close();
})();