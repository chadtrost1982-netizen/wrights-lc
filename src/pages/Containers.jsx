import { useState } from "react";
import BottomSheetModal from "../components/BottomSheetModal";
import { useQuoteStore } from "../store/quoteStore";

export default function Containers() {
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const { addToQuote } = useQuoteStore();

  const containers = [
    { name: "20ft Used", cost: 3200, type: "container" },
    { name: "20ft New", cost: 5200, type: "container" },
    { name: "40ft Used", cost: 4200, type: "container" },
    { name: "40ft New", cost: 7200, type: "container" },
    { name: "40ft HC Used", cost: 4600, type: "container" },
    { name: "40ft HC New", cost: 7600, type: "container" },
  ];

  const applyMarkup = (cost) => {
    if (!cost || cost === "Ask" || cost === "N/A") return cost;
    const marked = Number(cost) + 150;
    return Math.round(marked / 50) * 50;
  };

  return (
    <div className="page">
      <h2 className="page-title">Containers</h2>

      <div className="container-list">
        {containers.map((c, i) => (
          <div
            key={i}
            className="container-card clickable"
            onClick={() => {
              setSelectedItem({ ...c, type: "container" });
              setShowModal(true);
            }}
          >
            <h3>{c.name}</h3>
            <p>
              {typeof c.cost === "number"
                ? `$${applyMarkup(c.cost)}`
                : c.cost}
            </p>
          </div>
        ))}
      </div>

      {showModal && (
        <BottomSheetModal
          item={selectedItem}
          onAdd={addToQuote}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
