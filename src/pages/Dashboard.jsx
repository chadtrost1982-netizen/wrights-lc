import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <h1 className="dash-title">Wrights L.C. Control Panel</h1>

      <div className="dash-grid">
        <Link to="/quote-builder" className="dash-card">
          <div className="dash-label">Create Estimate</div>
        </Link>

        <Link to="/quotes" className="dash-card">
          <div className="dash-label">Estimates</div>
        </Link>

        <Link to="/settings" className="dash-card">
          <div className="dash-label">Settings</div>
        </Link>

        <Link to="/create-invoice" className="dash-card">
          <div className="dash-label">Create Invoice</div>
        </Link>

        <Link to="/invoice-tools" className="dash-card">
          <div className="dash-label">Invoices</div>
        </Link>
      </div>
    </div>
  );
}
