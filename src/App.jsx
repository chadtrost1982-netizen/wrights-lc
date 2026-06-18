import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Dashboard from "./pages/Dashboard";
import Presets from "./pages/Presets";
import Mods from "./pages/Mods";
import Settings from "./pages/Settings";
import QuoteBuilder from "./pages/QuoteBuilder";
import QuoteList from "./pages/QuoteList";
import QuoteView from "./pages/QuoteView";
import InvoiceTools from "./pages/InvoiceTools";
import {
  beginSignInRedirect,
  consumeSaveNotice,
  getSignedInEmail,
  signOutRedirect,
} from "./utils/oneDriveGraph";

export default function App() {
  const [authState, setAuthState] = useState("checking");
  const [activeEmail, setActiveEmail] = useState("");
  const requireAuth = String(import.meta.env.VITE_REQUIRE_AUTH || "false").toLowerCase() === "true";
  const allowedEmails = useMemo(
    () =>
      String(import.meta.env.VITE_ALLOWED_EMAILS || "")
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    []
  );

  useEffect(() => {
    const notice = consumeSaveNotice();
    if (notice) alert(notice);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!requireAuth) {
        if (!cancelled) setAuthState("authorized");
        return;
      }

      const email = String(await getSignedInEmail()).trim();
      if (!email) {
        await beginSignInRedirect();
        return;
      }

      const lower = email.toLowerCase();
      const allowed = allowedEmails.length === 0 || allowedEmails.includes(lower);
      if (cancelled) return;
      setActiveEmail(email);
      setAuthState(allowed ? "authorized" : "denied");
    };

    run().catch(() => {
      if (!cancelled) setAuthState("denied");
    });

    return () => {
      cancelled = true;
    };
  }, [requireAuth, allowedEmails]);

  if (authState === "checking") {
    return (
      <div className="page">
        <h1 className="brand-title">Wrights L.C.</h1>
        <p>Checking access...</p>
      </div>
    );
  }

  if (authState === "denied") {
    return (
      <div className="page">
        <h1 className="brand-title">Wrights L.C.</h1>
        <p>Access denied for this account.</p>
        <p style={{ opacity: 0.85 }}>Signed in: {activeEmail || "Unknown"}</p>
        <button className="btn-secondary" onClick={() => signOutRedirect()}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <Router>
      <div className="page">
        <h1 className="brand-title">
          <img src="/disposal-logo.png" alt="Disposal Solutions" className="brand-logo" />
          <span>Disposal Solutions</span>
        </h1>
        <nav className="top-nav">
          <Link to="/">Home</Link>
          <Link to="/quote-builder">Create Estimate</Link>
          <Link to="/quotes">Estimates</Link>
          <Link to="/create-invoice">Create Invoice</Link>
          <Link to="/invoice-tools">Invoices</Link>
          <Link to="/settings">Settings</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/home" element={<Dashboard />} />
          <Route path="/presets" element={<Presets />} />
          <Route path="/mods" element={<Mods />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/quote-builder" element={<QuoteBuilder />} />
          <Route path="/quotes" element={<QuoteList />} />
          <Route path="/create-invoice" element={<InvoiceTools pageTitle="Create Invoice" showFolder={false} />} />
          <Route path="/quote-view/:id" element={<QuoteView />} />
          <Route path="/invoice-tools" element={<InvoiceTools pageTitle="Invoices" showCreate={false} />} />
        </Routes>
      </div>
    </Router>
  );
}
