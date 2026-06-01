import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { appDB } from "../db/appDB";
import jsPDF from "jspdf";
import { formatCurrency } from "../utils/currency";

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function customerFullName(customer) {
  const first = customer?.firstName || "";
  const last = customer?.lastName || "";
  const joined = `${first} ${last}`.trim();
  return joined || customer?.name || "";
}

export default function QuoteView() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    const loadQuote = async () => {
      const q = await appDB.quotes.get(parseInt(id, 10));
      setQuote(q || null);
    };
    loadQuote();
  }, [id]);

  const normalized = useMemo(() => {
    if (!quote) return null;

    const container = quote.container || quote.preset || null;
    const containerPrice = asNumber(
      quote?.totals?.containerPrice ?? container?.finalPrice ?? 0
    );
    const modsTotal = asNumber(
      quote?.totals?.modsTotal ??
        (quote.mods || []).reduce((sum, m) => sum + asNumber(m.finalPrice ?? m.price), 0)
    );
    const delivery = asNumber(quote?.totals?.delivery ?? quote.delivery ?? 0);
    const subtotal = asNumber(
      quote?.totals?.subtotal ?? containerPrice + modsTotal + delivery
    );
    const hst = asNumber(quote?.totals?.hst ?? subtotal * 0.13);
    const finalTotal = asNumber(
      quote?.totals?.finalTotal ?? quote?.totals?.final ?? subtotal + hst
    );

    return {
      ...quote,
      container,
      containerPrice,
      modsTotal,
      delivery,
      subtotal,
      hst,
      finalTotal,
      mods: quote.mods || [],
    };
  }, [quote]);

  const extraTotals = useMemo(() => {
    const totals = normalized?.totals || {};
    const skip = new Set(["containerPrice", "modsTotal", "delivery", "finalTotal", "final"]);
    return Object.entries(totals).filter(([k, v]) => {
      if (skip.has(k)) return false;
      return Number.isFinite(Number(v));
    });
  }, [normalized]);

  const exportPDF = () => {
    if (!normalized) return;

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Wrights L.C. Quote", 14, 20);

    doc.setFontSize(12);
    doc.text(`Date: ${new Date(normalized.date).toLocaleString()}`, 14, 30);

    doc.setFontSize(14);
    doc.text("Customer Information", 14, 45);
    doc.setFontSize(12);
    doc.text(`Name: ${customerFullName(normalized.customer)}`, 14, 55);
    doc.text(`Phone: ${normalized.customer?.phone || ""}`, 14, 62);
    doc.text(`Address: ${normalized.customer?.address || ""}`, 14, 69);
    doc.text(`Distance: ${normalized.customer?.distance || ""} km`, 14, 76);

    doc.setFontSize(14);
    doc.text("Container", 14, 92);
    doc.setFontSize(12);
    doc.text(`Name: ${normalized.container?.name || "N/A"}`, 14, 102);
    doc.text(`Qty: ${normalized.container?.qty || 1}`, 14, 109);
    doc.text(`Price: ${formatCurrency(normalized.containerPrice)}`, 14, 116);

    doc.setFontSize(14);
    doc.text("Modifications", 14, 132);
    doc.setFontSize(12);

    if (normalized.mods.length === 0) {
      doc.text("No modifications selected.", 14, 142);
    } else {
      let y = 142;
      normalized.mods.forEach((m) => {
        const p = asNumber(m.finalPrice ?? m.price);
        doc.text(`${m.name} - ${formatCurrency(p)}`, 14, y);
        y += 7;
      });
    }

    doc.setFontSize(14);
    doc.text("Totals", 14, 180);
    doc.setFontSize(12);
    doc.text(`Container: ${formatCurrency(normalized.containerPrice)}`, 14, 190);
    doc.text(`Mods Total: ${formatCurrency(normalized.modsTotal)}`, 14, 197);
    doc.text(`Delivery: ${formatCurrency(normalized.delivery)}`, 14, 204);
    doc.text(`Subtotal: ${formatCurrency(normalized.subtotal)}`, 14, 211);
    doc.text(`HST (13%): ${formatCurrency(normalized.hst)}`, 14, 218);
    doc.setFontSize(14);
    doc.text(`Final Total: ${formatCurrency(normalized.finalTotal)}`, 14, 231);

    doc.save(`Quote-${customerFullName(normalized.customer) || "Customer"}.pdf`);
  };

  if (!normalized) return <div className="page"><p>Loading quote...</p></div>;

  return (
    <div className="page">
      <h1>Quote Details</h1>

      <h2>Customer</h2>
      <p><strong>Name:</strong> {customerFullName(normalized.customer)}</p>
      <p><strong>Phone:</strong> {normalized.customer?.phone}</p>
      <p><strong>Address:</strong> {normalized.customer?.address}</p>
      <p><strong>Distance:</strong> {normalized.customer?.distance} km</p>

      <h2>Container</h2>
      <p><strong>Name:</strong> {normalized.container?.name || "N/A"}</p>
      <p><strong>Qty:</strong> {normalized.container?.qty || 1}</p>
      <p><strong>Price:</strong> {formatCurrency(normalized.containerPrice)}</p>

      <h2>Modifications</h2>
      {normalized.mods.length === 0 && <p>No modifications selected.</p>}
      {normalized.mods.length > 0 && (
        <ul>
          {normalized.mods.map((m, i) => (
            <li key={`${m.name}-${i}`}>
              {m.name} - {formatCurrency(asNumber(m.finalPrice ?? m.price))}
            </li>
          ))}
        </ul>
      )}

      {normalized.notes && (
        <>
          <h2>Notes</h2>
          <p>{normalized.notes}</p>
        </>
      )}

      <h2>Totals</h2>
      <p><strong>Container:</strong> {formatCurrency(normalized.containerPrice)}</p>
      <p><strong>Mods Total:</strong> {formatCurrency(normalized.modsTotal)}</p>
      <p><strong>Delivery:</strong> {formatCurrency(normalized.delivery)}</p>
      <p><strong>Subtotal:</strong> {formatCurrency(normalized.subtotal)}</p>
      <p><strong>HST (13%):</strong> {formatCurrency(normalized.hst)}</p>
      {extraTotals.map(([key, value]) => (
        <p key={key}>
          <strong>{key}:</strong> {formatCurrency(value)}
        </p>
      ))}
      <h3><strong>Final Total:</strong> {formatCurrency(normalized.finalTotal)}</h3>

      <p style={{ marginTop: "20px", fontSize: "0.9em", opacity: 0.7 }}>
        Created: {new Date(normalized.date).toLocaleString()}
      </p>

      <button onClick={exportPDF} className="btn-primary" style={{ marginTop: "20px" }}>
        Export to PDF
      </button>
    </div>
  );
}
