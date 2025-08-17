const { google } = require("googleapis");
const axios = require("axios");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Load saved tokens if available
try {
    const tokens = require("./data/tokens.json");
    oauth2Client.setCredentials(tokens);
} catch (e) {
    console.log("No tokens found yet, start OAuth flow.");
}

/**
 * Helper to call Business Profile API with OAuth2 token
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
 * @param {string} url - Full API URL
 * @param {object} data - Request body
 */
async function callBusinessProfileAPI(method, url, data = {}) {
    const accessToken = (await oauth2Client.getAccessToken()).token;
    return axios({
        method,
        url,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        data,
    });
}

module.exports = { oauth2Client, callBusinessProfileAPI };