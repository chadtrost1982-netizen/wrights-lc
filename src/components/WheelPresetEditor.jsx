import { useEffect, useRef, useState } from "react";
import { sharedWheelPresetsPath } from "../utils/oneDriveGraph";
import {
  deleteWheelCustomer,
  deleteWheelWork,
  editWheelCustomer,
  editWheelWork,
  emptyWheelBook,
  visibleCustomers,
  visibleWorks,
} from "../utils/wheelPresetCore";
import { loadSharedWheelBook, saveSharedWheelBook } from "../utils/wheelPresetDrive";

function noteFor(result) {
  if (!result) return "";
  if (result.error) return result.error;
  if (result.shared) return "These are shared across your signed-in devices.";
  return "Saved on this device. They will join OneDrive the next time Microsoft sign-in is available.";
}

export default function WheelPresetEditor() {
  const [book, setBook] = useState(null);
  const bookRef = useRef(null);
  const [note, setNote] = useState("Loading saved wheel prices...");
  const [customerDraft, setCustomerDraft] = useState("");
  const [workDraft, setWorkDraft] = useState("");
  const [rateDraft, setRateDraft] = useState("");

  const apply = async (change) => {
    const current = bookRef.current;
    if (!current) return;
    const next = change(current);
    bookRef.current = next;
    const saved = await saveSharedWheelBook(next);
    bookRef.current = saved.book;
    setBook(saved.book);
    setNote(noteFor(saved));
  };

  useEffect(() => {
    let active = true;
    loadSharedWheelBook().then((result) => {
      if (!active) return;
      bookRef.current = result.book;
      setBook(result.book);
      setNote(noteFor(result));
    }).catch((err) => {
      if (!active) return;
      const fallback = emptyWheelBook();
      bookRef.current = fallback;
      setBook(fallback);
      setNote(err?.message || "Could not load saved wheel prices. Click Sign in again at the top of the page.");
    });
    return () => {
      active = false;
    };
  }, []);

  const customers = book ? visibleCustomers(book) : [];
  const works = book ? visibleWorks(book) : [];

  return (
    <div className="settings-card">
      <h3>Wheel Repair Prices</h3>
      <p style={{ marginBottom: "12px", opacity: 0.8, fontSize: "14px" }}>
        Customer names and work rates are remembered while you type an invoice, and again here if you need to correct one. The shared file is {sharedWheelPresetsPath()}.
      </p>
      {note && <p style={{ marginBottom: "12px" }}>{note}</p>}

      <h4>Customers</h4>
      {book && customers.length === 0 && <p>No saved customers yet.</p>}
      {customers.map((name) => (
        <div className="wheel-preset-row" key={name}>
          <input
            aria-label={`Customer ${name}`}
            defaultValue={name}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (!next || next === name) {
                event.target.value = name;
                return;
              }
              apply((current) => editWheelCustomer(current, name, next));
            }}
          />
          <button type="button" className="danger" onClick={() => apply((current) => deleteWheelCustomer(current, name))}>
            Delete
          </button>
        </div>
      ))}
      <div className="wheel-preset-row">
        <input
          aria-label="New wheel customer"
          placeholder="New customer name"
          value={customerDraft}
          onChange={(event) => setCustomerDraft(event.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const name = customerDraft.trim();
            if (!name) return;
            apply((current) => editWheelCustomer(current, "", name));
            setCustomerDraft("");
          }}
        >
          Add customer
        </button>
      </div>

      <h4>Work and rate</h4>
      {book && works.length === 0 && <p>No saved prices yet.</p>}
      {works.map((item) => (
        <div className="wheel-preset-row" key={item.work}>
          <input
            aria-label={`Work ${item.work}`}
            defaultValue={item.work}
            onBlur={(event) => {
              const next = event.target.value.trim();
              const rateInput = event.target.parentElement?.querySelector("input[type='number']");
              const rate = Number(rateInput?.value);
              if (!next) {
                event.target.value = item.work;
                return;
              }
              if (next === item.work && rate === Number(item.rate)) return;
              apply((current) => editWheelWork(current, item.work, next, rate));
            }}
          />
          <input
            aria-label={`Rate for ${item.work}`}
            type="number"
            min="0"
            step="0.01"
            defaultValue={item.rate}
            onBlur={(event) => {
              const workInput = event.target.parentElement?.querySelector("input[type='text'], input:not([type])");
              const nextWork = String(workInput?.value || item.work).trim();
              const rate = Number(event.target.value);
              if (!nextWork) return;
              if (nextWork === item.work && rate === Number(item.rate)) return;
              apply((current) => editWheelWork(current, item.work, nextWork, rate));
            }}
          />
          <button type="button" className="danger" onClick={() => apply((current) => deleteWheelWork(current, item.work))}>
            Delete
          </button>
        </div>
      ))}
      <div className="wheel-preset-row">
        <input
          aria-label="New wheel work"
          placeholder="Work performed"
          value={workDraft}
          onChange={(event) => setWorkDraft(event.target.value)}
        />
        <input
          aria-label="New wheel rate"
          type="number"
          min="0"
          step="0.01"
          placeholder="Rate"
          value={rateDraft}
          onChange={(event) => setRateDraft(event.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const work = workDraft.trim();
            if (!work) return;
            apply((current) => editWheelWork(current, "", work, Number(rateDraft)));
            setWorkDraft("");
            setRateDraft("");
          }}
        >
          Add price
        </button>
      </div>
    </div>
  );
}
