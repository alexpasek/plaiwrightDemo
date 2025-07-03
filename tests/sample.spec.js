const { test, expect } = require("@playwright/test");


test('My first test', async function({ page }) {
    expect(12).toBe(12)
});


test('My Second test', async function({ page }) {
    expect(100).toBe(1)
});
test("My Third test", async function({ page }) {
    expect(2.0).toBe(2.0)
});
test.skip("My forthd test", async function({ page }) {
    expect('rostyslab bondaruk').toContain('bondaruk')
});