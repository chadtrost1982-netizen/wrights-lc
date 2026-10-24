import { useRef, useState } from "react";
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
import { loadDocumentCounters, saveDocumentCounters } from "../utils/documentCounters";
import WheelPresetEditor from "../components/WheelPresetEditor";
import { sharedCounterPath } from "../utils/oneDriveGraph";
import { activeOneDriveFolder } from "../utils/oneDrivePaths";

export default function Settings() {
  const oneDriveEstimatesPath = activeOneDriveFolder("estimate");
  const oneDriveInvoicesPath = activeOneDriveFolder("invoice");
  const graphClientId = String(import.meta.env.VITE_AZURE_CLIENT_ID || "").trim();
  const graphMode = Boolean(graphClientId);

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
  const [destPoint, setDestPoint] = useState(null);
  const destPointRef = useRef(null);
  const [distance, setDistance] = useState(null);
  const [manualKm, setManualKm] = useState("");
  const [routeError, setRouteError] = useState("");
  const [coords, setCoords] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [travelTime, setTravelTime] = useState(null);
  const [autoSaveFolderName, setAutoSaveFolderName] = useState("");
  const [estimateFolderName, setEstimateFolderName] = useState("");
  const [nextEstimateNumber, setNextEstimateNumber] = useState("");
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState("");
  const [counterNote, setCounterNote] = useState("");

  useEffect(() => {
    let active = true;
    loadDocumentCounters().then((counters) => {
      if (!active) return;
      setNextEstimateNumber(String(counters.estimate));
      setNextInvoiceNumber(String(counters.invoice));
      if (counters.error) setCounterNote(counters.error);
      else if (counters.shared) setCounterNote("These numbers are shared across your devices through OneDrive.");
      else setCounterNote("OneDrive sign-in is not configured, so these numbers stay on this device.");
    });
    return () => {
      active = false;
    };
  }, []);

  const saveCounters = async () => {
    const estNum = parseInt(nextEstimateNumber, 10);
    const invNum = parseInt(nextInvoiceNumber, 10);
    try {
      const result = await saveDocumentCounters({ estimate: estNum, invoice: invNum });
      if (!result.ok) {
        alert(result.error || "Could not save counters.");
        if (result.estimate) setNextEstimateNumber(String(result.estimate));
        if (result.invoice) setNextInvoiceNumber(String(result.invoice));
        return;
      }
      setNextEstimateNumber(String(result.estimate));
      setNextInvoiceNumber(String(result.invoice));
      alert(result.shared ? "Counters saved for every device." : "Counters saved on this device.");
    } catch (err) {
      alert(err?.message || "Could not save counters.");
    }
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

  const rememberDest = (point) => {
    destPointRef.current = point;
    setDestPoint(point);
  };

  const handleDistance = async (point = destPointRef.current) => {
    setRouteError("");
    setRouteGeometry(null);
    const end = point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))
      ? { address: point.label || dest || "Pinned location", lat: Number(point.lat), lon: Number(point.lon) }
      : { address: dest };
    const result = await getRouteByAddress({ address: yardAddress }, end);
    const km = result?.distanceKm ?? null;

    setDistance(km);
    setTravelTime(result?.durationMin ?? null);
    setRouteGeometry(result?.geometry || null);

    if (result?.s && result?.e) {
      setCoords({
        s: { lat: result.s.lat, lon: result.s.lon },
        e: { lat: result.e.lat, lon: result.e.lon },
      });
    } else {
      setCoords(null);
    }
    if (!km) {
      setRouteError(result?.error || "Could not calculate a driving route. Enter kilometres manually.");
    }
  };

  const pricedKm = Number(manualKm) > 0 ? Number(manualKm) : distance;

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
          This is the last number already used. The next document is one higher, on every signed-in device. Saved files are not renumbered. Estimate and invoice numbers are separate. New counters start at estimate 511 and invoice 509, because those numbers were already issued. You can raise a number if you already used a higher one, but it cannot go backwards.
        </p>
        {counterNote && <p style={{ marginBottom: "15px" }}>{counterNote}</p>}
        <p style={{ marginBottom: "15px", opacity: 0.8, fontSize: "14px" }}>
          Shared file: {sharedCounterPath()}
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

      <WheelPresetEditor />

      <div className="settings-card">
        <h3>Auto-Save Folders (Read-Only)</h3>
        {graphMode ? (
          <>
            <p><strong>OneDrive auto-save active</strong></p>
            <p>
              Invoices path:{" "}
              {oneDriveInvoicesPath}
            </p>
            <p>
              Estimates path:{" "}
              {oneDriveEstimatesPath}
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
          resolvedLabel={destPoint?.label || ""}
          onChange={(address, picked) => {
            setDest(address);
            const point = picked && Number.isFinite(Number(picked.lat)) && Number.isFinite(Number(picked.lon))
              ? {
                label: address,
                lat: Number(picked.lat),
                lon: Number(picked.lon),
                precision: picked.precision || "",
                hint: picked.hint || "",
              }
              : null;
            rememberDest(point);
            if (!point) setCoords((prev) => (prev ? { ...prev, e: null } : prev));
          }}
          placeholder="Address, town, or postal code"
        />

        <label>Kilometres (optional override)</label>
        <input
          type="number"
          min="0"
          value={manualKm}
          placeholder="Type kilometres if the route fails"
          onChange={(e) => setManualKm(e.target.value)}
        />

        <button className="btn-primary" onClick={handleDistance}>
          Calculate Distance
        </button>

        {routeError && <p style={{ color: "#fca5a5" }}>{routeError}</p>}

        {(pricedKm || distance) && (
          <div className="calc-results">
            <p><strong>Distance:</strong> {pricedKm || distance} km{Number(manualKm) > 0 ? " (entered manually)" : ""}</p>
            <p>
              <strong>20ft Delivery:</strong> $
              {calculateDeliveryAmount(
                pricedKm,
                delivery20Rate,
                delivery20Min,
                rounding
              )}
            </p>
            <p>
              <strong>40ft Delivery:</strong> $
              {calculateDeliveryAmount(
                pricedKm,
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

        <InteractiveMap
          mapId="settings-distance-map"
          height={320}
          geometry={routeGeometry}
          startCoords={coords?.s ? [coords.s.lat, coords.s.lon] : undefined}
          endCoords={
            destPoint
              ? [destPoint.lat, destPoint.lon]
              : coords?.e
                ? [coords.e.lat, coords.e.lon]
                : undefined
          }
          startLabel={yardAddress}
          endLabel={destPoint?.label || dest || "Destination"}
          onEndChange={(lat, lon) => {
            const label = dest.trim() || "Pinned location";
            const point = { label, lat, lon, precision: "pinned", hint: "Distance uses the blue pin." };
            rememberDest(point);
            if (dest.trim() !== label) setDest(label);
            handleDistance(point);
          }}
        />
      </div>
    </div>
  );
}
