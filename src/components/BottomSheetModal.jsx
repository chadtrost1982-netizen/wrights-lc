import { useState } from "react";
import "./BottomSheet.css";

export default function BottomSheetModal({ item, onAdd, onClose }) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  if (!item) return null;

  const unit = typeof item.sellPrice === "number" ? item.sellPrice : null;
  const finalPrice = unit == null ? item.priceLabel : unit * qty;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header" />

        <h2 className="sheet-title">{item.name}</h2>

        <div className="sheet-row">
          <span>Price:</span>
          <span>{unit == null ? item.priceLabel : `$${unit}`}</span>
        </div>

        <div className="sheet-row total-row">
          <span>Final Price:</span>
          <span className="final-price">
            {typeof finalPrice === "number" ? `$${finalPrice}` : finalPrice}
          </span>
        </div>

        <div className="qty-row">
          <button onClick={() => qty > 1 && setQty(qty - 1)}>-</button>
          <span>{qty}</span>
          <button onClick={() => setQty(qty + 1)}>+</button>
        </div>

        <textarea
          className="sheet-notes"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button
          className="sheet-add-btn"
          disabled={unit == null}
          onClick={() => {
            onAdd({
              type: item.type,
              name: item.name,
              qty,
              notes,
              finalPrice,
            });
            onClose();
          }}
        >
          ADD TO QUOTE
        </button>

        <button className="sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}