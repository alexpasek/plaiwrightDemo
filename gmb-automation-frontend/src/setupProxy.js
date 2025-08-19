/* Proxy API requests in dev to the backend at http://localhost:4000 */
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function(app) {
    app.use(
        [
            "/health",
            "/version",
            "/profiles",
            "/generate-post-by-profile",
            "/post-now",
            "/post-now-all",
            "/scheduler",
            "/posts",
        ],
        createProxyMiddleware({
            target: "http://localhost:4000",
            changeOrigin: true,
        })
    );
};