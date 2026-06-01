import { useState } from "react";
import BottomSheetModal from "../components/BottomSheetModal";
import { useQuoteStore } from "../store/quoteStore";

export default function Presets() {
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [openIndex, setOpenIndex] = useState(null);
  const { addToQuote } = useQuoteStore();

  const applyMarkup = (cost) => {
    if (!cost || cost === "N/A") return cost;
    const marked = Number(cost) + 150;
    return Math.round(marked / 50) * 50;
  };

  const sections = [
    {
      title: "10ft Containers",
      items: [
        { name: "10ft Cutdown Used - Barn Doors or Rollup", cost: 3000, stock: "Mod" },
        { name: "10ft Cutdown One Trip - Barn Doors", cost: 3350, stock: "Mod" },
        { name: "10ft Cutdown One Trip - Rollup", cost: 3550, stock: "Mod" },
        { name: "10ft Factory One Trip (new)", cost: 4300, stock: "Mod" },
      ],
    },
    {
      title: "20ft Containers",
      items: [
        { name: "20ft Wind & Watertight (Rough Grade)", cost: 1400, stock: "Stock" },
        { name: "20ft Midgrade Used (Commercial)", cost: 1700, stock: "Stock" },
        { name: "20ft Handpicked Used (Residential)", cost: 1900, stock: "Stock" },
        { name: "20ft Multi-Trip (Wrinkle Walls)", cost: 2300, stock: "Stock" },
        { name: "20ft One Trip (Beige)", cost: 2400, stock: "Stock" },
        { name: "20ft One Trip (Grey)", cost: 2450, stock: "Stock" },
        { name: "20ft Double Door One Trip", cost: 3400, stock: "Stock" },
        { name: "20ft HC One Trip", cost: 3950, stock: "Limited" },
        { name: "20ft Side Door One Trip", cost: 4900, stock: "Stock" },
        { name: "20ft Full Openside One Trip", cost: 6200, stock: "Limited" },
        { name: "20ft Non-Operating Reefer", cost: "N/A", stock: "Out of Stock" },
        { name: "20ft Used Pre-Tripped Reefer", cost: "N/A", stock: "Out of Stock" },
        { name: "20ft HC One Trip Insulated", cost: 13300, stock: "1 Left" },
      ],
    },
    {
      title: "40ft Standard Containers",
      items: [
        { name: "40ft Std Used Rough Grade", cost: 1950, stock: "Limited" },
        { name: "40ft Std Used Commercial", cost: 2200, stock: "Stock" },
        { name: "40ft Std Used Residential", cost: 2300, stock: "Stock" },
      ],
    },
    {
      title: "40ft High Cube Containers",
      items: [
        { name: "40ft HC Used Rough Grade", cost: 1850, stock: "Stock" },
        { name: "40ft HC Used Commercial", cost: 2200, stock: "Stock" },
        { name: "40ft HC Used Residential", cost: 2400, stock: "Stock" },
        { name: "40ft HC Multi-Trip (Wrinkle Walls)", cost: 3675, stock: "Limited" },
        { name: "40ft HC One Trip (Beige)", cost: 3875, stock: "Stock" },
        { name: "40ft HC Double Door Multi-Trip", cost: 4700, stock: "Stock" },
        { name: "40ft HC Double Door One Trip", cost: 5250, stock: "Limited" },
        { name: "40ft HC Side Door One Trip", cost: 7250, stock: "Stock" },
        { name: "40ft HC Non-Operating Reefer", cost: 5600, stock: "Stock" },
        { name: "40ft HC Pre-Tripped Reefer (CE Certified)", cost: 6600, stock: "Limited" },
      ],
    },
    {
      title: "Specialty Containers",
      items: [
        { name: "Office Containers (Various Builds)", cost: "N/A", stock: "Office Sheet" },
        { name: "20ft CW Flatrack", cost: 6300, stock: "Limited" },
        { name: "40ft IICL Flatrack", cost: 8300, stock: "Limited" },
        { name: "53ft HC Heater (As-Is)", cost: 3900, stock: "Limited" },
        { name: "53ft HC Steel Used", cost: 5100, stock: "Limited" },
      ],
    },
    {
      title: "Certifications",
      items: [
        { name: "Certify & Prefix Used Container", cost: 350, stock: "48 Hours" },
        { name: "Certify One Trip Container", cost: 300, stock: "48 Hours" },
      ],
    },
  ];

  return (
    <div className="page">
      <h2 className="page-title">Container Pricelist</h2>

      <div className="accordion">
        {sections.map((section, index) => (
          <div key={index} className="accordion-section">
            <div
              className="accordion-header"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
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
                      if (typeof item.cost !== "number") return;
                      setSelectedItem({ ...item, type: "container" });
                      setShowModal(true);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="price">
                      {typeof item.cost === "number"
                        ? `$${applyMarkup(item.cost)}`
                        : item.cost}
                    </span>
                    <span className="stock">{item.stock}</span>
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
