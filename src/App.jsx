import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import Presets from "./pages/Presets";
import Mods from "./pages/Mods";
import Settings from "./pages/Settings";
import QuoteBuilder from "./pages/QuoteBuilder";
import QuoteList from "./pages/QuoteList";
import QuoteView from "./pages/QuoteView";
import InvoiceTools from "./pages/InvoiceTools";
import { consumeSaveNotice } from "./utils/oneDriveGraph";

export default function App() {
  useEffect(() => {
    const notice = consumeSaveNotice();
    if (notice) alert(notice);
  }, []);

  return (
    <Router>
      <div className="page">
        <h1 className="brand-title">Wrights L.C. Quoting System</h1>
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
