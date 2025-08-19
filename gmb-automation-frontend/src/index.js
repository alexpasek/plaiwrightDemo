import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error("UI crashed:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            padding: 16,
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          }}
        >
          <h2>Something went wrong in the UI.</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {String(this.state.err?.stack || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
