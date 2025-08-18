const cron = require("node-cron");
const path = require("path");
const fs = require("fs");

// local helpers come from index via dependency injection
function makeScheduler({ app, postToGmb, pickNeighbourhood, profilesRef }) {
    let task = null;
    let lastRun = null;
    let lastResult = null;

    function log(msg) {
        console.log("[scheduler]", msg);
    }

    // Run once for a single profile
    async function runOnce(profile) {
        const body = { profileId: profile.profileId }; // auto-generate text + auto-pick photo
        try {
            const result = await postToGmb(body);
            return { ok: true, result };
        } catch (e) {
            let err = e && e.message ? e.message : String(e);
            return { ok: false, error: err };
        }
    }

    // Run all profiles sequentially
    async function runAll() {
        const profiles = profilesRef(); // fresh read from memory (index keeps it updated)
        const report = [];
        for (let i = 0; i < profiles.length; i++) {
            const p = profiles[i];
            log(`Posting for ${p.businessName} (${p.profileId})...`);
            const r = await runOnce(p);
            report.push({
                profileId: p.profileId,
                ok: r.ok,
                error: r.error,
                data: r.result,
            });
        }
        return report;
    }

    // Express endpoints
    app.get("/scheduler/status", (_req, res) => {
        res.json({
            running: !!task,
            schedule: "15 9 * * * (server local time)",
            lastRun,
            lastResult,
        });
    });

    app.post("/scheduler/run-once", async(_req, res) => {
        try {
            const result = await runAll();
            lastRun = new Date().toISOString();
            lastResult = result;
            res.json({ ok: true, result });
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            res.status(500).json({ ok: false, error: msg });
        }
    });

    app.post("/scheduler/enable", (_req, res) => {
        if (task) return res.json({ ok: true, info: "already enabled" });
        // 09:15 daily (server TZ). Set TZ env if needed.
        task = cron.schedule("15 9 * * *", async() => {
            log("Cron fired");
            try {
                const result = await runAll();
                lastRun = new Date().toISOString();
                lastResult = result;
                log("Cron completed");
            } catch (e) {
                log("Cron failed: " + (e && e.message ? e.message : String(e)));
            }
        });
        task.start();
        res.json({ ok: true, enabled: true, schedule: "15 9 * * *" });
    });

    app.post("/scheduler/disable", (_req, res) => {
        if (task) {
            task.stop();
            task = null;
        }
        res.json({ ok: true, enabled: false });
    });
}

module.exports = { makeScheduler };