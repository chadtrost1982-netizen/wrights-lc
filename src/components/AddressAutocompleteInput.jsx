import { useEffect, useRef, useState } from "react";
import { searchAddresses } from "../utils/geocode";

export default function AddressAutocompleteInput({
  value,
  onChange,
  placeholder = "Address, town, or postal code",
  resolvedLabel = "",
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
    if (resolvedLabel && value.trim() === resolvedLabel.trim()) return undefined;

    const q = value.trim();
    if (q.length < 3) return undefined;

    const t = setTimeout(async () => {
      const data = await searchAddresses(q);
      const ranked = Array.isArray(data.results) ? data.results : [];
      setSuggestions(ranked);
      setIsOpen(ranked.length > 0);
      setHint(ranked.length ? (data.hint || ranked[0]?.hint || "") : (data.error || ""));
    }, 400);

    return () => clearTimeout(t);
  }, [value, resolvedLabel]);

  const choose = (item) => {
    suppressRef.current = true;
    onChange(item.label, {
      lat: item.lat,
      lon: item.lon,
      label: item.label,
      precision: item.precision || "",
      hint: item.hint || "",
    });
    setSuggestions([]);
    setIsOpen(false);
    setHint(item.hint || "");
  };

  return (
    <div className="address-autocomplete">
      <input
        type="text"
        value={value}
        autoComplete="off"
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
        onBlur={() => setTimeout(() => setIsOpen(false), 250)}
        placeholder={placeholder}
      />
      {hint && <p className="address-hint">{hint}</p>}
      {isOpen && suggestions.length > 0 && (
        <div className="address-suggestions" role="listbox">
          {suggestions.map((item) => (
            <button
              key={`${item.lat},${item.lon},${item.label}`}
              type="button"
              className="address-suggestion-item"
              onPointerDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
              onClick={() => choose(item)}
            >
              <span className="address-suggestion-primary">{item.primary || item.label}</span>
              <span className="address-suggestion-secondary">
                {item.secondary}
                {item.precision && item.precision !== "address" ? " · approximate" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
