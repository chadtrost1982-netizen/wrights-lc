import { useState } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { getRouteByAddress } from "../utils/routing";
import {
  calculateDeliveryAmount,
} from "../utils/delivery";
import InteractiveMap from "../components/InteractiveMap";
import AddressAutocompleteInput from "../components/AddressAutocompleteInput";
import {
  loadEstimateDirectoryHandle,
  loadAutoSaveDirectoryHandle,
  saveAutoSaveDirectoryHandle,
} from "../utils/autoSaveFolder";
import { useEffect } from "react";

export default function Settings() {
  const oneDriveEstimatesPath = String(import.meta.env.VITE_ONEDRIVE_ESTIMATES_PATH || "").trim();
  const oneDriveInvoicesPath = String(import.meta.env.VITE_ONEDRIVE_INVOICES_PATH || "").trim();
  const oneDriveLegacyPath = String(import.meta.env.VITE_ONEDRIVE_TARGET_PATH || "").trim();
  const graphClientId = String(import.meta.env.VITE_AZURE_CLIENT_ID || "").trim();
  const graphMode = Boolean(graphClientId && (oneDriveEstimatesPath || oneDriveInvoicesPath || oneDriveLegacyPath));

  const {
    yardAddress,
    delivery20Rate,
    delivery20Min,
    delivery40Rate,
    delivery40Min,
    rounding,
    hideBreakdown,
    includeInContainer,
    updateSettings,
  } = useSettingsStore();

  const [dest, setDest] = useState("");
  const [distance, setDistance] = useState(null);
  const [coords, setCoords] = useState(null);
  const [travelTime, setTravelTime] = useState(null);
  const [autoSaveFolderName, setAutoSaveFolderName] = useState("");
  const [estimateFolderName, setEstimateFolderName] = useState("");
  const [nextEstimateNumber, setNextEstimateNumber] = useState("");
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState("");

  useEffect(() => {
    // Load current counter values
    const estCounter = localStorage.getItem("wrights_estimate_counter") || "500";
    const invCounter = localStorage.getItem("wrights_invoice_counter") || "491";
    setNextEstimateNumber(estCounter);
    setNextInvoiceNumber(invCounter);
  }, []);

  const saveCounters = () => {
    const estNum = parseInt(nextEstimateNumber, 10);
    const invNum = parseInt(nextInvoiceNumber, 10);
    if (Number.isFinite(estNum) && estNum > 0) {
      localStorage.setItem("wrights_estimate_counter", String(estNum));
    }
    if (Number.isFinite(invNum) && invNum > 0) {
      localStorage.setItem("wrights_invoice_counter", String(invNum));
    }
    alert("Counters updated!");
  };

  useEffect(() => {
    const loadFolder = async () => {
      const [invoiceHandle, estimateHandle] = await Promise.all([
        loadAutoSaveDirectoryHandle(),
        loadEstimateDirectoryHandle(),
      ]);
      setAutoSaveFolderName(invoiceHandle?.name || "");
      setEstimateFolderName(estimateHandle?.name || "");
    };
    loadFolder();
  }, []);

  const selectInvoiceFolder = async () => {
    if (!window.showDirectoryPicker) {
      alert("Your browser does not support folder selection.");
      return;
    }

    try {
      const picked = await window.showDirectoryPicker();
      await saveAutoSaveDirectoryHandle(picked);
      setAutoSaveFolderName(picked.name || "");
    } catch {
      // User canceled or selection failed.
    }
  };

  const handleDistance = async () => {
    const result = await getRouteByAddress(yardAddress, dest);
    const km = result?.distanceKm ?? null;

    setDistance(km);
    setTravelTime(result?.durationMin ?? null);

    if (result?.s && result?.e) {
      setCoords({
        s: { lat: result.s.lat, lon: result.s.lon },
        e: { lat: result.e.lat, lon: result.e.lon },
      });
    } else {
      setCoords(null);
    }
  };

  return (
    <div className="page">
      <h2 className="page-title">Delivery Pricing Settings</h2>

      <div className="settings-card">
        <h3>20ft Delivery</h3>

        <label>Rate per km</label>
        <input
          type="number"
          value={delivery20Rate}
          onChange={(e) =>
            updateSettings({ delivery20Rate: Number(e.target.value) })
          }
        />

        <label>Minimum Charge</label>
        <input
          type="number"
          value={delivery20Min}
          onChange={(e) =>
            updateSettings({ delivery20Min: Number(e.target.value) })
          }
        />
      </div>

      <div className="settings-card">
        <h3>40ft Delivery</h3>

        <label>Rate per km</label>
        <input
          type="number"
          value={delivery40Rate}
          onChange={(e) =>
            updateSettings({ delivery40Rate: Number(e.target.value) })
          }
        />

        <label>Minimum Charge</label>
        <input
          type="number"
          value={delivery40Min}
          onChange={(e) =>
            updateSettings({ delivery40Min: Number(e.target.value) })
          }
        />
      </div>

      <div className="settings-card">
        <h3>Rounding</h3>

        <select
          value={rounding}
          onChange={(e) => updateSettings({ rounding: e.target.value })}
        >
          <option value="50">Round to nearest $50</option>
          <option value="none">No rounding</option>
        </select>
      </div>

      <div className="settings-card">
        <h3>Visibility Options</h3>

        <label className="toggle">
          <input
            type="checkbox"
            checked={hideBreakdown}
            onChange={(e) =>
              updateSettings({ hideBreakdown: e.target.checked })
            }
          />
          Hide delivery breakdown from customer
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={includeInContainer}
            onChange={(e) =>
              updateSettings({ includeInContainer: e.target.checked })
            }
          />
          Include delivery inside container line
        </label>
      </div>

      <div className="settings-card">
        <h3>Document Counters</h3>
        <p style={{ marginBottom: "15px", opacity: 0.8, fontSize: "14px" }}>
          Set the current estimate and invoice numbers. New documents use the next number (for example, entering 505 creates invoice 506).
        </p>

        <label>Current Estimate Number</label>
        <input
          type="number"
          value={nextEstimateNumber}
          onChange={(e) => setNextEstimateNumber(e.target.value)}
          min="500"
        />

        <label>Current Invoice Number</label>
        <input
          type="number"
          value={nextInvoiceNumber}
          onChange={(e) => setNextInvoiceNumber(e.target.value)}
          min="1"
        />

        <button className="btn-primary" onClick={saveCounters}>
          Save Counters
        </button>
      </div>

      <div className="settings-card">
        <h3>Auto-Save Folders (Read-Only)</h3>
        {graphMode ? (
          <>
            <p><strong>OneDrive auto-save active</strong></p>
            <p>
              Invoices path:{" "}
              {oneDriveInvoicesPath || oneDriveLegacyPath || "(not configured)"}
            </p>
            <p>
              Estimates path:{" "}
              {oneDriveEstimatesPath || oneDriveLegacyPath || "(not configured)"}
            </p>
          </>
        ) : (
          <>
            <p>
              {autoSaveFolderName
                ? `Invoices folder: ${autoSaveFolderName}`
                : "Invoices folder not selected."}
            </p>
            <button className="btn-secondary win-btn-secondary" onClick={selectInvoiceFolder}>
              {autoSaveFolderName ? "Change invoice folder" : "Select invoice folder"}
            </button>
            <p>
              {estimateFolderName
                ? `Estimates folder: ${estimateFolderName}`
                : "Estimates folder not selected."}
            </p>
          </>
        )}
      </div>

      <div className="settings-card">
        <h3>Delivery Auto-Calculator</h3>

        <label>Start Address</label>
        <input
          value={yardAddress}
          onChange={(e) => updateSettings({ yardAddress: e.target.value })}
        />

        <label>Destination Address</label>
        <AddressAutocompleteInput
          value={dest}
          onChange={setDest}
          placeholder="Enter customer address"
        />

        <button className="btn-primary" onClick={handleDistance}>
          Calculate Distance
        </button>

        {distance !== null && (
          <div className="calc-results">
            <p><strong>Distance:</strong> {distance} km</p>
            <p>
              <strong>20ft Delivery:</strong> $
              {calculateDeliveryAmount(
                distance,
                delivery20Rate,
                delivery20Min,
                rounding
              )}
            </p>
            <p>
              <strong>40ft Delivery:</strong> $
              {calculateDeliveryAmount(
                distance,
                delivery40Rate,
                delivery40Min,
                rounding
              )}
            </p>

            {travelTime !== null && (
              <p>
                <strong>Travel Time:</strong> {Math.floor(travelTime / 60)}h{" "}
                {travelTime % 60}m
              </p>
            )}
          </div>
        )}

        {coords?.s && coords?.e && (
          <InteractiveMap
            startCoords={[coords.s.lat, coords.s.lon]}
            endCoords={[coords.e.lat, coords.e.lon]}
          />
        )}
      </div>
    </div>
  );
}
