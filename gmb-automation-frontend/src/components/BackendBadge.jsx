import React, { useEffect, useState } from "react";
import { getApiBase } from "../lib/api";

export default function BackendBadge() {
  const [base, setBase] = useState("");
  const [ok, setOk] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await getApiBase();
        if (alive) setBase(b);
        const r = await fetch(b + "/health").catch(() => null);
        if (alive) setOk(!!(r && r.ok));
      } catch (_) {
        if (alive) setOk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const txt = ok === null ? "Checking…" : ok ? "Backend OK" : "Backend DOWN";
  return (
    <span className="badge" title={base} style={{ marginLeft: 12 }}>
      {txt}
    </span>
  );
}
