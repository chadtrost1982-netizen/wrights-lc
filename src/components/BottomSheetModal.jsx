import React, { useState } from "react";
import "./BottomSheet.css";

export default function BottomSheetModal({ item, onAdd, onClose }) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  if (!item) return null;

  const applyMarkup = (cost) => {
    if (!cost || cost === "Ask" || cost === "N/A") return cost;
    const marked = Number(cost) + 150;
    return Math.round(marked / 50) * 50;
  };

  const finalPrice =
    typeof item.cost === "number" ? applyMarkup(item.cost) * qty : item.cost;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header" />

        <h2 className="sheet-title">{item.name}</h2>

        <div className="sheet-row">
          <span>Wholesale:</span>
          <span>
            {typeof item.cost === "number" ? `$${item.cost}` : item.cost}
          </span>
        </div>

        <div className="sheet-row">
          <span>Markup Price:</span>
          <span>
            {typeof item.cost === "number"
              ? `$${applyMarkup(item.cost)}`
              : item.cost}
          </span>
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
          onClick={() => {
            onAdd({
              ...item,
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
