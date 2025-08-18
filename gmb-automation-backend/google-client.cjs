// google-client.cjs
const { google } = require("googleapis");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Load saved tokens if available (no optional chaining)
try {
    const tokensPath = path.join(__dirname, "data", "tokens.json");
    if (fs.existsSync(tokensPath)) {
        const raw = fs.readFileSync(tokensPath, "utf8");
        const tokens = JSON.parse(raw);
        oauth2Client.setCredentials(tokens);
    } else {
        console.log("No tokens found yet, start OAuth flow with /auth.");
    }
} catch (e) {
    let msg;
    if (e && e.message) {
        msg = e.message;
    } else {
        msg = String(e);
    }
    console.log("Failed to read tokens.json:", msg);
}

/**
 * Call Google Business APIs with explicit Bearer token.
 * - no optional chaining
 * - explicit checks
 */
async function callBusinessProfileAPI(method, url, data) {
    // Get access token (may be string or object with .token)
    const tokenResp = await oauth2Client.getAccessToken();

    let accessToken = null;
    if (typeof tokenResp === "string") {
        accessToken = tokenResp;
    } else if (tokenResp && typeof tokenResp === "object") {
        if (tokenResp.token && typeof tokenResp.token === "string") {
            accessToken = tokenResp.token;
        }
    }

    if (!accessToken) {
        throw new Error(
            "No access token available. Visit /auth to connect Google."
        );
    }

    // Build headers
    const headers = {};
    headers["Authorization"] = "Bearer " + String(accessToken);

    if (data !== undefined && data !== null) {
        headers["Content-Type"] = "application/json";
    }

    return axios({
        method: method,
        url: url,
        data: data,
        headers: headers,
    });
}

module.exports = { oauth2Client, callBusinessProfileAPI };