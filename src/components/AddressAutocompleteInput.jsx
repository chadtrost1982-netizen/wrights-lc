import { useEffect, useRef, useState } from "react";
import { searchAddresses } from "../utils/geocode";

export default function AddressAutocompleteInput({
  value,
  onChange,
  placeholder = "Enter address",
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hint, setHint] = useState("");
  const suppressRef = useRef(false);

  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false;
      return undefined;
    }

    const q = value.trim();
    if (q.length < 3) return undefined;

    const t = setTimeout(async () => {
      const data = await searchAddresses(q);
      const ranked = Array.isArray(data.results) ? data.results : [];
      setSuggestions(ranked);
      setIsOpen(ranked.length > 0);
      setHint(ranked.length ? "" : data.error || "");
    }, 1000);

    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="address-autocomplete">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next.trim().length < 3) {
            setSuggestions([]);
            setIsOpen(false);
            setHint("");
          }
          onChange(next);
        }}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        placeholder={placeholder}
      />
      {hint && <p className="address-hint">{hint}</p>}
      {isOpen && suggestions.length > 0 && (
        <div className="address-suggestions">
          {suggestions.map((item) => (
            <button
              key={`${item.lat},${item.lon},${item.label}`}
              type="button"
              className="address-suggestion-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                suppressRef.current = true;
                onChange(item.label, { lat: item.lat, lon: item.lon, label: item.label });
                setSuggestions([]);
                setIsOpen(false);
                setHint("");
              }}
            >
              <span className="address-suggestion-primary">{item.primary || item.label}</span>
              <span className="address-suggestion-secondary">{item.secondary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}