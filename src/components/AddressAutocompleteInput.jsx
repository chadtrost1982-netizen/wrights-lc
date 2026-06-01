import { useEffect, useState } from "react";

function buildPrimaryLabel(item) {
  const a = item?.address || {};
  return (
    a.house_number && a.road
      ? `${a.house_number} ${a.road}`
      : a.road || a.neighbourhood || a.suburb || a.city || item?.name || item?.display_name || ""
  );
}

function buildSecondaryLabel(item) {
  const a = item?.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || "";
  const state = a.state || "Ontario";
  const postcode = a.postcode || "";
  return [city, state, postcode].filter(Boolean).join(", ");
}

function scoreSuggestion(item) {
  const importance = Number(item?.importance || 0);
  const placeRank = Number(item?.place_rank || 0);
  const hasHouseNumber = item?.address?.house_number ? 0.22 : 0;
  const isRoadLike = /road|residential|house|building|address/i.test(item?.class || "") ? 0.12 : 0;
  const postcodeBonus = item?.address?.postcode ? 0.08 : 0;
  return importance + placeRank / 100 + hasHouseNumber + isRoadLike + postcodeBonus;
}

export default function AddressAutocompleteInput({
  value,
  onChange,
  placeholder = "Enter address",
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [suppressNextFetch, setSuppressNextFetch] = useState(false);

  useEffect(() => {
    if (suppressNextFetch) {
      setSuppressNextFetch(false);
      return undefined;
    }

    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return undefined;
    }

    const t = setTimeout(async () => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?format=jsonv2&addressdetails=1&limit=10&countrycodes=ca&dedupe=1&q=${encodeURIComponent(q)}`;
        const res = await fetch(url);
        const data = await res.json();
        const ontarioOnly = (Array.isArray(data) ? data : []).filter((item) => {
          const state = item?.address?.state?.toLowerCase?.() || "";
          const display = item?.display_name?.toLowerCase?.() || "";
          return state.includes("ontario") || display.includes("ontario");
        });

        const ranked = ontarioOnly
          .sort((a, b) => scoreSuggestion(b) - scoreSuggestion(a))
          .slice(0, 7);

        setSuggestions(ranked);
        setIsOpen(ranked.length > 0);
      } catch {
        setSuggestions([]);
        setIsOpen(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="address-autocomplete">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 120)}
        placeholder={placeholder}
      />
      {isOpen && suggestions.length > 0 && (
        <div className="address-suggestions">
          {suggestions.map((item) => (
            <button
              key={item.place_id}
              type="button"
              className="address-suggestion-item"
              onClick={() => {
                setSuppressNextFetch(true);
                onChange(item.display_name);
                setSuggestions([]);
                setIsOpen(false);
              }}
            >
              <span className="address-suggestion-primary">{buildPrimaryLabel(item)}</span>
              <span className="address-suggestion-secondary">{buildSecondaryLabel(item)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
