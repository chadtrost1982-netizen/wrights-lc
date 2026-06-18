import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <h1 className="dash-title">Wrights L.C. Control Panel</h1>
      <p style={{ textAlign: "center", margin: 0, opacity: 0.8 }}>
        Use the navigation above to jump to estimates, invoices, and settings.
      </p>
    </div>
  );
}
