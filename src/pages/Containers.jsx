import { useState } from "react";
import BottomSheetModal from "../components/BottomSheetModal";
import CatalogAccess from "../components/CatalogAccess";
import { useQuoteStore } from "../store/quoteStore";
import { useCatalog } from "../utils/useCatalog";

export default function Containers() {
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const { addToQuote } = useQuoteStore();
  const catalogState = useCatalog();
  const containers = catalogState.catalog?.containers || [];

  return (
    <div className="page">
      <h2 className="page-title">Containers</h2>
      <CatalogAccess
        loading={catalogState.loading}
        error={catalogState.error}
        needsPassword={catalogState.needsPassword}
        onUnlock={catalogState.reload}
      />

      <div className="container-list">
        {containers.map((c) => (
          <div
            key={c.name}
            className="container-card clickable"
            onClick={() => {
              if (!c.purchasable) return;
              setSelectedItem({ ...c, type: "container" });
              setShowModal(true);
            }}
          >
            <h3>{c.name}</h3>
            <p>{c.purchasable ? `$${c.sellPrice}` : c.priceLabel}</p>
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