import React from "react";
import { getApiBase, getHealth } from "../lib/api";

export default function BackendBadge() {
  const [url, setUrl] = React.useState("");
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    (async function run() {
      const u = await getApiBase();
      setUrl(u);
      try {
        const h = await getHealth();
        setOk(!!(h && h.ok));
      } catch (_e) {
        setOk(false);
      }
    })();
  }, []);

  return (
    <div
      style={{
        padding: 8,
        border: "1px solid #ccc",
        borderRadius: 8,
        margin: "8px 0",
        display: "inline-block",
      }}
    >
      <div>
        <strong>Backend:</strong> {url || "discovering..."}
      </div>
      <div>Status: {ok ? "✅ OK" : "❌ DOWN"}</div>
    </div>
  );
}
