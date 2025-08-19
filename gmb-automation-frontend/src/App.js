import React, { useEffect, useMemo, useState } from "react";
import api from "./lib/api";
import "./App.css";
import BackendBadge from "./components/BackendBadge";

export default function App() {
  const [health, setHealth] = useState(null);
  const [version, setVersion] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState("");
  const [postText, setPostText] = useState("");
  const [schedStatus, setSchedStatus] = useState(null);
  const [schedConfig, setSchedConfig] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.profileId === selectedId),
    [profiles, selectedId]
  );

  function notify(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function bootstrap() {
    try {
      const [h, v, pr, sc, ss] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getVersion().catch(() => null),
        api.getProfiles(),
        api.getSchedulerConfig().catch(() => null),
        api.getSchedulerStatus().catch(() => null),
      ]);
      setHealth(h);
      setVersion(v);
      const list = Array.isArray(pr?.profiles) ? pr.profiles : [];
      setProfiles(list);
      if (list[0]?.profileId) setSelectedId(list[0].profileId);
      setSchedConfig(sc);
      setSchedStatus(ss);
    } catch (e) {
      notify(e.message || "Failed to load");
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function doPreview() {
    if (!selectedId) return notify("Select a profile first");
    setPreview("");
    setPostText("");
    try {
      const r = await api.generatePost(selectedId);
      if (r && r.post) {
        setPreview(r.post);
        setPostText(r.post);
      } else {
        setPreview(JSON.stringify(r, null, 2));
        setPostText("");
      }
    } catch (e) {
      notify(e.message || "Preview failed");
    }
  }

  async function doPostNow() {
    if (!selectedId) return notify("Select a profile first");
    setBusy(true);
    try {
      await api.postNow(selectedId, postText);
      notify("Posted!");
      await refreshHistory();
    } catch (e) {
      notify(e.message || "Post failed");
    } finally {
      setBusy(false);
    }
  }

  async function doPostNowAll() {
    setBusy(true);
    try {
      const r = await api.postNowAll();
      notify(`Posted for ${r.count || 0} profile(s)`);
      await refreshHistory();
    } catch (e) {
      notify(e.message || "Post-all failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    try {
      setSchedStatus(await api.getSchedulerStatus());
    } catch (e) {
      notify(e.message || "Load status failed");
    }
  }

  async function refreshConfig() {
    try {
      setSchedConfig(await api.getSchedulerConfig());
    } catch (e) {
      notify(e.message || "Load config failed");
    }
  }

  async function refreshHistory() {
    try {
      setHist(await api.getPostHistory(selectedId || undefined, 50));
    } catch (e) {
      notify(e.message || "Load history failed");
    }
  }

  async function saveConfig(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const enabled = fd.get("enabled") === "on";
    const defaultTime = String(fd.get("defaultTime") || "10:00");
    const tickSeconds = Number(fd.get("tickSeconds") || 30);

    const perProfileTimes = {};
    profiles.forEach((p) => {
      const v = String(fd.get(`ppt_${p.profileId}`) || "");
      if (/^\d{2}:\d{2}$/.test(v)) perProfileTimes[p.profileId] = v;
    });

    setBusy(true);
    try {
      const cfg = await api.setSchedulerConfig({
        enabled,
        defaultTime,
        tickSeconds,
        perProfileTimes,
      });
      setSchedConfig(cfg.config || cfg);
      notify("Saved config");
      await refreshStatus();
    } catch (e2) {
      notify(e2.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAllNow() {
    setBusy(true);
    try {
      await api.runSchedulerOnce();
      notify("Manual run for all profiles");
      await refreshHistory();
    } catch (e) {
      notify(e.message || "Manual run failed");
    } finally {
      setBusy(false);
    }
  }

  async function runOneNow() {
    if (!selectedId) return notify("Select a profile first");
    setBusy(true);
    try {
      await api.runSchedulerNow(selectedId);
      notify("Manual run for selected");
      await refreshHistory();
    } catch (e) {
      notify(e.message || "Manual run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="bar">
        <div className="wrap row">
          <h1>GMB Automation</h1>
          <BackendBadge />
          <div className="sp" />
          <div className="small">
            <b>{health && health.ok ? "Backend OK" : "Backend DOWN"}</b>
            &nbsp;·&nbsp;v{(version && version.version) || "0.0.0"}
          </div>
        </div>
      </header>

      <main className="wrap" style={{ paddingTop: 16, paddingBottom: 32 }}>
        <div className="grid g3">
          {/* Profiles & actions */}
          <div className="card">
            <h3>Profiles</h3>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {(p.businessName || p.profileId) +
                    (p.city ? " — " + p.city : "")}
                </option>
              ))}
            </select>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn blue" onClick={doPreview}>
                Generate Preview
              </button>
              <button className="btn green" onClick={doPostNow} disabled={busy}>
                Post Now
              </button>
            </div>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 12 }}
              onClick={doPostNowAll}
              disabled={busy}
            >
              Post Now — All Profiles
            </button>
            <p className="muted">
              Tip: you can edit the preview text before posting.
            </p>
          </div>

          {/* Preview / editor */}
          <div className="card">
            <h3>Preview / Edit</h3>
            <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="Generated post will show here. You can edit before posting."
            />
            {preview ? (
              <p className="muted">
                Generated preview loaded. Edits here will be used when posting.
              </p>
            ) : null}
          </div>

          {/* Scheduler status & actions */}
          <div className="card">
            <h3>Scheduler</h3>
            <div className="small">
              <div>
                Enabled:{" "}
                <b>{schedStatus && schedStatus.enabled ? "Yes" : "No"}</b>
              </div>
              <div>
                Default time:{" "}
                <b>{(schedStatus && schedStatus.defaultTime) || "10:00"}</b>
              </div>
              <div>
                Tick: <b>{(schedStatus && schedStatus.tickSeconds) || 30}s</b>
              </div>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Time</th>
                    <th>Last Run</th>
                    <th>Run Today?</th>
                  </tr>
                </thead>
                <tbody>
                  {schedStatus && schedStatus.profiles
                    ? schedStatus.profiles.map((p) => (
                        <tr key={p.profileId}>
                          <td>{p.businessName || p.profileId}</td>
                          <td>{p.scheduledTime}</td>
                          <td>{p.lastRunISODate || "-"}</td>
                          <td>{p.willRunToday ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn gray" onClick={refreshStatus}>
                Refresh
              </button>
              <button
                className="btn indigo"
                onClick={runAllNow}
                disabled={busy}
              >
                Run All Now
              </button>
              <button
                className="btn indigo"
                onClick={runOneNow}
                disabled={!selectedId || busy}
              >
                Run Selected Now
              </button>
            </div>
          </div>
        </div>

        {/* Config + History */}
        <div className="grid g2" style={{ marginTop: 16 }}>
          {/* Config */}
          <div className="card">
            <h3>Scheduler Config</h3>
            <form onSubmit={saveConfig}>
              <label className="row small">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!!(schedConfig && schedConfig.enabled)}
                />
                <span>Enabled</span>
              </label>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="small">Default time (HH:MM)</div>
                  <input
                    name="defaultTime"
                    defaultValue={
                      (schedConfig && schedConfig.defaultTime) || "10:00"
                    }
                  />
                </div>
                <div style={{ width: 140 }}>
                  <div className="small">Tick (seconds)</div>
                  <input
                    name="tickSeconds"
                    defaultValue={
                      (schedConfig && schedConfig.tickSeconds) || 30
                    }
                  />
                </div>
              </div>

              <div className="box">
                <div className="small" style={{ marginBottom: 8 }}>
                  Per-profile times
                </div>
                {profiles.map((p) => (
                  <div
                    key={p.profileId}
                    className="row"
                    style={{ gap: 8, marginBottom: 8 }}
                  >
                    <label className="small label">
                      {p.businessName || p.profileId}
                    </label>
                    <input
                      name={`ppt_${p.profileId}`}
                      placeholder="HH:MM"
                      defaultValue={
                        (schedConfig &&
                          schedConfig.perProfileTimes &&
                          schedConfig.perProfileTimes[p.profileId]) ||
                        ""
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn green" disabled={busy} type="submit">
                  Save Config
                </button>
                <button
                  type="button"
                  className="btn gray"
                  onClick={refreshConfig}
                >
                  Reload
                </button>
              </div>
            </form>
          </div>

          {/* History */}
          <div className="card">
            <h3>Posts History</h3>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn gray" onClick={() => refreshHistory()}>
                Refresh
              </button>
            </div>
            <div className="scroll">
              <pre className="mono small" style={{ margin: 0 }}>
                {hist ? JSON.stringify(hist, null, 2) : "No history yet."}
              </pre>
            </div>
          </div>
        </div>
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
