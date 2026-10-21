import { useState } from "react";
import BottomSheetModal from "../components/BottomSheetModal";
import CatalogAccess from "../components/CatalogAccess";
import { useQuoteStore } from "../store/quoteStore";
import { useCatalog } from "../utils/useCatalog";

export default function Mods() {
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [openIndex, setOpenIndex] = useState(null);
  const { addToQuote } = useQuoteStore();
  const catalogState = useCatalog();
  const sections = catalogState.catalog?.modSections || [];

  return (
    <div className="page">
      <h2 className="page-title">Modifications Pricelist</h2>
      <CatalogAccess
        loading={catalogState.loading}
        error={catalogState.error}
        needsPassword={catalogState.needsPassword}
        onUnlock={catalogState.reload}
      />

      <div className="accordion">
        {sections.map((section, index) => (
          <div key={section.title} className="accordion-section">
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
                {section.items.map((item) => (
                  <div
                    key={item.name}
                    className="accordion-item clickable"
                    onClick={() => {
                      if (!item.purchasable) return;
                      setSelectedItem({ ...item, type: "mod" });
                      setShowModal(true);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="price">
                      {item.purchasable ? `$${item.sellPrice}` : item.priceLabel}
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