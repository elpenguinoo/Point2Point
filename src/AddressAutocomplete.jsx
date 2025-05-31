import { useState, useEffect, useRef } from 'react';

/**
 * AddressAutocomplete
 * Props:
 *   - label: string (“Origin” or “Destination”)
 *   - onSelect: function({ placeId, description }) → void
 */
export default function AddressAutocomplete({ label, onSelect }) {
  const [input, setInput] = useState('');
  const [predictions, setPredictions] = useState([]);
  const autocompleteServiceRef = useRef(null);

  // 1. Initialize AutocompleteService once window.google.maps.places is available
  useEffect(() => {
    if (!autocompleteServiceRef.current && window.google?.maps?.places) {
      autocompleteServiceRef.current = 
        new window.google.maps.places.AutocompleteService();
    }
  }, []);

  // 2. Whenever `input` changes (and length ≥ 3), fetch predictions
  useEffect(() => {
    if (!input || input.length < 3) {
      setPredictions([]);
      return;
    }
    if (!autocompleteServiceRef.current) {
      // If the Google JS library hasn’t loaded yet, do nothing.
      return;
    }

    // Debounce by 300ms so we don’t call on every single keystroke
    const handler = setTimeout(() => {
      autocompleteServiceRef.current.getPlacePredictions(
        { input: input },
        (preds, status) => {
          if (
            status ===
            window.google.maps.places.PlacesServiceStatus.OK
          ) {
            setPredictions(preds || []);
          } else {
            setPredictions([]);
          }
        }
      );
    }, 300);

    return () => clearTimeout(handler);
  }, [input]);

  // 3. When a user clicks a prediction, notify parent and clear the dropdown
  const handleSelect = (prediction) => {
    setInput(prediction.description);
    setPredictions([]);
    onSelect({
      placeId: prediction.place_id,
      description: prediction.description,
    });
  };

  return (
    <div style={{ position: 'relative', marginTop: '1rem' }}>
      <label style={{ display: 'block', marginBottom: '0.25rem' }}>
        {label}:
      </label>
      <input
        type="text"
        value={input}
        placeholder={`Enter ${label} address`}
        onChange={(e) => setInput(e.target.value)}
        style={{
          width: '100%',
          padding: '0.5rem',
          border: '1px solid #ccc',
          borderRadius: '4px',
        }}
      />

      {/* 4. Render dropdown of predictions */}
      {predictions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            margin: 0,
            padding: '0.25rem 0',
            listStyle: 'none',
          }}
        >
          {predictions.map((p) => (
            <li
              key={p.place_id}
              onClick={() => handleSelect(p)}
              style={{
                padding: '0.5rem',
                cursor: 'pointer',
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {p.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}