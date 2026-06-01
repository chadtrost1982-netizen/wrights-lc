import { useState } from "react";
import BottomSheetModal from "../components/BottomSheetModal";
import { useQuoteStore } from "../store/quoteStore";

export default function Mods() {
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const { addToQuote } = useQuoteStore();

  const applyMarkup = (cost) => {
    if (!cost || cost === "Ask" || cost === "N/A") return cost;
    const marked = Number(cost) + 150;
    return Math.round(marked / 50) * 50;
  };

  const sections = [
    {
      title: "Roll‑up Doors",
      items: [
        { name: "6ft Wide", cost: 1550 },
        { name: "8ft Wide", cost: 1750 },
        { name: "10ft Wide", cost: 1950 },
        { name: "Other Custom Sizes", cost: "Ask" },
      ],
    },
    {
      title: "Man Doors",
      items: [
        { name: `36" Steel Slab Non‑Insulated`, cost: 1550 },
        { name: `36" Steel Slab Insulated`, cost: 1650 },
        { name: `36" Steel Slab w/ Window`, cost: 2050 },
        { name: `36" Steel 3‑Piece Frame`, cost: 2250 },
        { name: `36" Freezer Door`, cost: 4400 },
        { name: `Fire‑Rated / Panel / Patio / Custom`, cost: "Ask" },
      ],
    },
    {
      title: "Windows",
      items: [
        { name: `36" x 36" Sliding Window`, cost: 1200 },
        { name: `48" x 36" Sliding Window`, cost: 1300 },
        { name: `48" x 48" Sliding Window`, cost: 1400 },
        { name: `Bars / Cage / Custom`, cost: "Ask" },
      ],
    },
    {
      title: "Side Barn Doors",
      items: [
        { name: "Standard Height", cost: 2500 },
        { name: "High Cube Height", cost: 2800 },
      ],
    },
    {
      title: "Security",
      items: [
        { name: "Lockbox", cost: 150 },
        { name: "Lockbox Combo w/ Lock", cost: 175 },
        { name: "Container Lock", cost: 30 },
        { name: "Deadbolt Add‑on", cost: 200 },
      ],
    },
    {
      title: "Vents",
      items: [
        { name: `12" x 12" Louver Vent (Door)`, cost: 175 },
        { name: `12" x 12" Louver Vent (Side)`, cost: 375 },
        { name: "Custom / Exhaust", cost: "Ask" },
      ],
    },
    {
      title: "Partition Walls",
      items: [
        { name: "Standard Height", cost: 825 },
        { name: "High Cube Height", cost: 975 },
      ],
    },
    {
      title: "Spray Foam",
      items: [
        { name: `1"`, cost: "1.75/sqft" },
        { name: `2"`, cost: "3.50/sqft" },
        { name: `3"`, cost: "5.25/sqft" },
        { name: "Minimum Charge", cost: 1500 },
      ],
    },
    {
      title: "Painting",
      items: [
        { name: "20ft", cost: 850 },
        { name: "20ft HC", cost: 900 },
        { name: "40ft", cost: 1200 },
        { name: "40ft HC", cost: 1300 },
        { name: "45ft HC", cost: 1500 },
        { name: "53ft HC", cost: 1900 },
      ],
    },
    {
      title: "Custom Mods",
      items: [
        { name: "Cutouts", cost: "Ask" },
        { name: "Framing", cost: "Ask" },
        { name: "Electrical", cost: "Ask" },
        { name: "Cladding", cost: "Ask" },
        { name: "Steel Floor", cost: "Ask" },
        { name: "Forklift Pockets", cost: "Ask" },
        { name: "Decals", cost: "Ask" },
      ],
    },
  ];

  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="page">
      <h2 className="page-title">Modifications Pricelist</h2>

      <div className="accordion">
        {sections.map((section, index) => (
          <div key={index} className="accordion-section">
            <div
              className="accordion-header"
              onClick={() =>
                setOpenIndex(openIndex === index ? null : index)
              }
            >
              {section.title}
            </div>

            {openIndex === index && (
              <div className="accordion-content">
                {section.items.map((item, i) => (
                  <div
                    key={i}
                    className="accordion-item clickable"
                    onClick={() => {
                      setSelectedItem({ ...item, type: "mod" });
                      setShowModal(true);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="price">
                      {typeof item.cost === "number"
                        ? `$${applyMarkup(item.cost)}`
                        : item.cost}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
