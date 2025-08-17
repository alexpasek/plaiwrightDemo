`
import { chromium } from "playwright";
import { spawn } from "child_process";

// Utility functions
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const randomDelay = (min = 1000, max = 3000) =>
    Math.floor(Math.random() * (max - min) + min);
const getRandomItems = (arr, count) =>
    arr.sort(() => 0.5 - Math.random()).slice(0, count);

// Data
const searchTerms = [
    "latest news canada",
    "how to make coffee",
    "playwright js automation",
    "weather in toronto",
    "why is the sky blue",
    "best movies 2024",
    "how to learn javascript",
    "crypto market update",
    "restaurants near me",
    "history of ai",
    "canada vs usa economy",
    "fun facts about cats",
];
const allUrls = [
    "https://www.cnn.com",
    "https://www.cbc.ca",
    "https://www.nytimes.com",
    "https://www.bbc.com",
    "https://www.reuters.com",
    "https://www.theguardian.com",
    "https://www.nationalpost.com",
    "https://globalnews.ca",
    "https://www.wsj.com",
    "https://www.aljazeera.com",
];

// Interactions
async function simulateMouseMovement(page, times = 10) {
    const viewport = page.viewportSize();
    if (!viewport) return;
    for (let i = 0; i < times; i++) {
        const x = Math.floor(Math.random() * viewport.width);
        const y = Math.floor(Math.random() * viewport.height);
        await page.mouse.move(x, y, { steps: 4 });
        await wait(randomDelay(300, 800));
    }
}
async function slowScroll(page, steps = 10) {
    for (let i = 0; i < steps; i++) {
        const dir = Math.random() > 0.5 ? 1 : -1;
        await page.mouse.wheel(0, dir * Math.floor(Math.random() * 200 + 100));
        await wait(randomDelay(500, 1200));
    }
}
async function acceptCookies(page) {
    const selectors = [
        'button:has-text("accept")',
        'button:has-text("agree")',
        '[id*="cookie"] button',
        '[class*="cookie"] button',
        '[aria-label*="accept"]',
        '[aria-label*="consent"]',
    ];
    for (const selector of selectors) {
        try {
            const buttons = await page.$$(selector);
            for (const btn of buttons) {
                if (await btn.isVisible()) {
                    await btn.click({ timeout: 1500 }).catch(() => {});
                    console.log("✅ Clicked cookie button");
                    return;
                }
            }
        } catch {}
    }
}
async function randomClicks(page) {
    const selectors = ["button", "a", "img"];
    for (const selector of selectors) {
        const elements = await page.$$(selector);
        const toClick = getRandomItems(elements, Math.min(2, elements.length));
        for (const el of toClick) {
            try {
                const box = await el.boundingBox();
                if (box) {
                    await el.hover();
                    await wait(randomDelay(500, 1200));
                    await el.click({ delay: randomDelay(50, 200) });
                    console.log("🖱️ Clicked random element");
                    await wait(randomDelay(1000, 3000));
                }
            } catch {}
        }
    }
}
async function stopAutoplayVideo(page) {
    try {
        await page.evaluate(() => {
            document.querySelectorAll("video").forEach((v) => {
                if (typeof v.pause === "function") v.pause();
                v.muted = true;
            });
        });
    } catch {}
}

// Visit news site
async function visitSiteInNewTab(context, url) {
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await wait(randomDelay(2000, 4000));
        await acceptCookies(page);
        await simulateMouseMovement(page, 10);
        await slowScroll(page, 8);
        await stopAutoplayVideo(page);
        await randomClicks(page);
        await wait(randomDelay(4000, 8000));
    } catch (err) {
        console.error(`❌
Error visiting $ { url }: `, err.message);
    } finally {
        await page.close().catch(() => {});
    }
}

// Simulate Google search
async function simulateGoogleSearch(page, searchQuery) {
    await page.goto("https://www.google.com/?hl=en", {
        waitUntil: "domcontentloaded",
    });
    await wait(2000);

    const consentBtn = await page.$("button:has-text('Accept all')");
    if (consentBtn) await consentBtn.click().catch(() => {});

    const input = await page.$('textarea[name="q"]');
    if (!input) return;

    await input.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    for (const char of searchQuery) {
        await page.keyboard.type(char);
        await wait(100 + Math.random() * 150);
    }
    await page.keyboard.press("Enter");
    await wait(3000);

    const results = await page.$$("a h3");
    if (results.length > 0) {
        try {
            const chosen = results[Math.floor(Math.random() * results.length)];
            await chosen.waitForElementState("visible", { timeout: 6000 });
            await chosen.click();
            await page.waitForLoadState("domcontentloaded");
            console.log(`🖱️
Clicked search result
for "${searchQuery}"
`);
        } catch (error) {
            console.error(`❌
Error clicking result
for "${searchQuery}"
`);
        }
    } else {
        console.warn(`⚠️
No results
for "${searchQuery}"
`);
    }
}

// Main runner
(async() => {
    const chromePath =
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const userDataDir =
        "/Users/alex/Library/Application Support/Google/Chrome/Profile 2";

    const chromeProcess = spawn(chromePath, [
        "--remote-debugging-port=9222",
        `--user - data - dir = $ { userDataDir }
`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
    ]);

    chromeProcess.stderr.on("data", (data) =>
        console.error("Chrome error:", data.toString())
    );

    await wait(4000); // Give Chrome time to start

    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const searchBatch = getRandomItems(
        searchTerms,
        3 + Math.floor(Math.random() * 3)
    );
    for (const term of searchBatch) {
        await simulateGoogleSearch(page, term);
        await wait(randomDelay(4000, 7000));
    }

    const visitBatch = getRandomItems(allUrls, 3 + Math.floor(Math.random() * 3));
    for (const url of visitBatch) {
        await visitSiteInNewTab(context, url);
    }

    console.log("✅ All tasks done. Closing browser.");
    await browser.close();
    chromeProcess.kill();
})();
`
``