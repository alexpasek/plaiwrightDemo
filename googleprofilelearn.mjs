import { chromium } from "playwright";
import { spawn } from "child_process";

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const randomDelay = (min = 1000, max = 3000) =>
    Math.floor(Math.random() * (max - min) + min);

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

const getRandomItems = (arr, count) =>
    arr.sort(() => 0.5 - Math.random()).slice(0, count);

async function simulateMouseMovement(page, times = 10) {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const { width, height } = viewport;
    for (let i = 0; i < times; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        await page.mouse.move(x, y, { steps: 4 });
        await wait(randomDelay(300, 800));
    }
}

async function slowScroll(page, steps = 10) {
    for (let i = 0; i < steps; i++) {
        const direction = Math.random() > 0.5 ? 1 : -1;
        await page.mouse.wheel(
            0,
            direction * Math.floor(Math.random() * 200 + 100)
        );
        await wait(randomDelay(500, 1200));
    }
}

async function acceptCookies(page) {
    const selectors = [
        'button:has-text("accept")',
        'button:has-text("agree")',
        'button:has-text("consent")',
        'button:has-text("OK")',
        'div:has-text("Not now")',
        'button:has-text("Got it")',
        '[aria-label*="accept"]',
        '[aria-label*="consent"]',
        '[id*="cookie"] button',
        '[class*="cookie"] button',
        'button[title*="Accept"]',
    ];

    for (const selector of selectors) {
        try {
            const buttons = await page.$$(selector);
            for (const btn of buttons) {
                const visible = await btn.isVisible().catch(() => false);
                if (visible) {
                    await btn.click({ timeout: 1500 }).catch(() => {});
                    console.log("✅ Clicked cookie/consent button:", selector);
                    return;
                }
            }
        } catch {}
    }
}

async function randomClicks(page) {
    const selectors = ["button", "a", "img", '[role="button"]'];
    for (const selector of selectors) {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
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
}

async function stopAutoplayVideo(page) {
    try {
        await page.evaluate(() => {
            const videos = document.querySelectorAll("video");
            videos.forEach((v) => {
                if (typeof v.pause === "function") v.pause();
                v.muted = true;
            });
        });

        const closeBtns = await page.$$(
            'button[aria-label*="Close"], .close, .overlay-close'
        );
        for (const btn of closeBtns) {
            try {
                await btn.click({ timeout: 1000 });
                console.log("🎬 Closed video overlay");
                break;
            } catch {}
        }
    } catch {
        console.warn("⚠️ Failed stopping autoplay video");
    }
}

async function visitSiteInNewTab(context, url) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const timeout = 35000;
    const timer = setTimeout(() => {
        console.warn(`⏱️ Timeout visiting ${url}, closing tab.`);
        page.close().catch(() => {});
    }, timeout);

    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await wait(randomDelay(2000, 4000));
        await acceptCookies(page);
        await simulateMouseMovement(page);
        await slowScroll(page, 8);
        await stopAutoplayVideo(page);
        await randomClicks(page);
        await wait(randomDelay(4000, 8000));
    } catch (err) {
        console.error(`❌ Error visiting ${url}:`, err.message);
    } finally {
        clearTimeout(timer);
        await page.close().catch(() => {});
    }
}

async function simulateGoogleSearch(page, searchQuery) {
    await page.goto("https://www.google.com/?hl=en", {
        waitUntil: "domcontentloaded",
    });
    await wait(2500);

    const consentBtn = await page.$(
        "button:has-text('I agree'), button:has-text('Accept all')"
    );
    if (consentBtn) {
        await consentBtn.click().catch(() => {});
        await wait(1500);
    }

    let input;
    try {
        input = await page.getByRole("combobox", {
            name: "Search",
            timeout: 5000,
        });
    } catch {
        console.warn("Search input not found, skipping.");
        return;
    }

    const isDisabled = await input.evaluate((el) => el.disabled);
    if (isDisabled) {
        console.warn("Search input is disabled, skipping.");
        return;
    }

    const box = await input.boundingBox();
    if (!box) {
        console.warn("Search input has no bounding box, skipping.");
        return;
    }

    await input.click({ clickCount: 3, force: true });
    await input.focus();
    await page.keyboard.press("Backspace");

    for (const char of searchQuery) {
        await page.keyboard.type(char);
        await wait(randomDelay(100, 300));
    }

    await wait(randomDelay(500, 1200));
    await page.keyboard.press("Enter");

    await page.waitForTimeout(3000);
    await page.mouse.wheel(0, 200);
    await wait(1000);

    const results = await page.$$("a h3");
    if (results.length > 0) {
        const chosen = results[Math.floor(Math.random() * results.length)];
        try {
            await chosen.click();
            console.log(`🖱️ Clicked search result for "${searchQuery}"`);
            await wait(randomDelay(6000, 10000));
        } catch {
            console.warn(`⚠️ Couldn't click result for: ${searchQuery}`);
        }
    } else {
        console.warn(`⚠️ No search results found for "${searchQuery}"`);
    }
}

(async() => {
    const chromePath =
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const userDataDir =
        "/Users/alex/Library/Application Support/Google/Chrome/Profile 2";

    const chromeProcess = spawn(chromePath, [
        "--remote-debugging-port=9222",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
    ]);

    if (chromeProcess.stdout) {
        chromeProcess.stdout.on("data", (data) =>
            console.log(`Chrome: ${data.toString()}`)
        );
    }

    if (chromeProcess.stderr) {
        chromeProcess.stderr.on("data", (data) =>
            console.error(`Chrome error: ${data.toString()}`)
        );
    }

    await wait(4000);

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

    console.log("✅ All tasks complete. Closing browser.");
    await browser.close();
    chromeProcess.kill();
})().catch(console.error);