// src/AddressAutocomplete.jsx
import { useState } from 'react';
import AddressAutocomplete from './AddressAutocomplete';


// Mock: returns airport codes based on city keywords in the address
const findNearbyAirports = (addressObj) => {
  if (!addressObj || !addressObj.description) return [];
  const desc = addressObj.description.toLowerCase();
  if (desc.includes("boston")) return ["BOS", "PVD", "MHT"];
  if (desc.includes("providence")) return ["PVD", "BOS"];
  if (desc.includes("new york")) return ["JFK", "LGA", "EWR"];
  if (desc.includes("kentucky") || desc.includes("louisville")) return ["SDF", "CVG"];
  // Default airports for unknown locations
  return ["BOS", "JFK", "ORD"];
};

// Mock: returns ground transport cost and duration for a given address to airport code
const estimateGroundTransportCost = (fromAddressObj, toAirportCode) => {
  // In a real app, you'd use distance between the address and the airport and call Uber/Lyft APIs
  // For demo: fixed values based on airport
  const mockDurations = { BOS: 40, PVD: 55, MHT: 60, JFK: 60, LGA: 45, EWR: 70, SDF: 30, CVG: 80, ORD: 40 };
  const mockCosts = { BOS: 45, PVD: 75, MHT: 60, JFK: 80, LGA: 60, EWR: 80, SDF: 40, CVG: 85, ORD: 45 };
  return {
    cost: mockCosts[toAirportCode] || 50,
    duration: mockDurations[toAirportCode] || 45, // in minutes
  };
};

function App() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [searchMode, setSearchMode] = useState('cheapest');
  const [itineraries, setItineraries] = useState([]);

  const fetchFromDuffel = async (origin, destination, date, searchMode) => {
    try {
      // POST to serverless proxy
      const offerRequestResponse = await fetch('/api/duffel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin,
          destination,
          date: date || new Date().toISOString().split('T')[0],
          passengers: [
            { type: 'adult' }
          ],
          cabin_class: 'economy',
        }),
      });

      if (!offerRequestResponse.ok) {
        const errorData = await offerRequestResponse.json();
        console.error('Error fetching offers:', errorData);
        return [];
      }

      const offers = await offerRequestResponse.json();

      if (!offers || offers.length === 0) {
        return [];
      }

      // Filter/select offers based on searchMode
      if (searchMode === 'cheapest') {
        offers.sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
      } else if (searchMode === 'fastest') {
        offers.sort((a, b) => {
          const durationA = a.slices.reduce((sum, slice) => sum + slice.duration, 0);
          const durationB = b.slices.reduce((sum, slice) => sum + slice.duration, 0);
          return durationA - durationB;
        });
      } else if (searchMode === 'balanced') {
        // Simple balanced approach: sort by sum of normalized cost and duration
        const maxCost = Math.max(...offers.map(o => parseFloat(o.total_amount)));
        const maxDuration = Math.max(...offers.map(o => o.slices.reduce((sum, slice) => sum + slice.duration, 0)));
        offers.sort((a, b) => {
          const costA = parseFloat(a.total_amount) / maxCost;
          const costB = parseFloat(b.total_amount) / maxCost;
          const durA = a.slices.reduce((sum, slice) => sum + slice.duration, 0) / maxDuration;
          const durB = b.slices.reduce((sum, slice) => sum + slice.duration, 0) / maxDuration;
          return (costA + durA) - (costB + durB);
        });
      }

      // Map selected offers to itinerary objects
      const mappedItineraries = offers.slice(0, 3).map(offer => {
        const modeCombo = offer.slices.map(slice => slice.segments.map(seg => seg.operating_carrier.name).join(' + ')).join(' + ');
        const totalDurationMins = offer.slices.reduce((sum, slice) => sum + slice.duration, 0);
        const hours = Math.floor(totalDurationMins / 60);
        const minutes = totalDurationMins % 60;
        const totalTime = `${hours}h ${minutes}m`;
        const totalCost = `${offer.total_currency} ${offer.total_amount}`;
        const details = offer.slices.map((slice, i) => {
          return slice.segments.map(segment => {
            const dep = segment.departure;
            const arr = segment.arrival;
            return `${segment.operating_carrier.name} flight from ${dep.airport.iata_code} to ${arr.airport.iata_code}, departs at ${dep.at}, arrives at ${arr.at}`;
          }).join('; ');
        }).join(' | ');
        const bookLink = offer.links.self || `https://duffel.com/bookings/${offer.id}`;

        return {
          modeCombo,
          totalTime,
          totalCost,
          details,
          bookLink,
        };
      });

      return mappedItineraries;
    } catch (error) {
      console.error('Error fetching itineraries from Duffel:', error);
      return [];
    }
  };

  const fetchItineraries = async (searchMode, origin, destination, date) => {
    return await fetchFromDuffel(origin, destination, date, searchMode);
  };

  // True multimodal, address-to-address routing
  const handleGetRoute = async () => {
    if (!origin || !destination) {
      console.warn("Origin or destination not selected.");
      return;
    }

    const originAirports = findNearbyAirports(origin);
    const destinationAirports = findNearbyAirports(destination);

    if (originAirports.length === 0 || destinationAirports.length === 0) {
      console.warn("No airports found for one or both locations.");
      return;
    }

    // Date: today for now (could be user-selected)
    const date = new Date().toISOString().split('T')[0];

    // Collect all possible combinations
    let allItineraries = [];
    for (const oAirport of originAirports) {
      for (const dAirport of destinationAirports) {
        // Leg 1: Estimate from address to origin airport
        const groundToAirport = estimateGroundTransportCost(origin, oAirport);
        // Leg 2: Duffel flight offers
        const duffelItineraries = await fetchItineraries(searchMode, oAirport, dAirport, date);
        // Leg 3: Estimate from destination airport to address
        const groundFromAirport = estimateGroundTransportCost(destination, dAirport);

        // Combine all
        duffelItineraries.forEach(flight => {
          // Parse out the cost and time from flight details
          const flightCostNum = parseFloat(flight.totalCost.replace(/[^0-9.]/g, '')) || 0;
          const flightTimeNum = (() => {
            const m = flight.totalTime.match(/(\d+)h\s*(\d+)m/);
            if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
            return 0;
          })();

          const totalCost = groundToAirport.cost + flightCostNum + groundFromAirport.cost;
          const totalTime = groundToAirport.duration + flightTimeNum + groundFromAirport.duration;

          allItineraries.push({
            ...flight,
            originAirport: oAirport,
            destinationAirport: dAirport,
            groundToAirport,
            groundFromAirport,
            totalCost: `$${totalCost.toFixed(2)}`,
            totalTime: `${Math.floor(totalTime/60)}h ${totalTime%60}m`,
          });
        });
      }
    }

    // Sort according to searchMode
    if (searchMode === 'cheapest') {
      allItineraries.sort((a, b) => parseFloat(a.totalCost.replace(/[^0-9.]/g, '')) - parseFloat(b.totalCost.replace(/[^0-9.]/g, '')));
    } else if (searchMode === 'fastest') {
      allItineraries.sort((a, b) => {
        const aTime = (() => { const m = a.totalTime.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : 0; })();
        const bTime = (() => { const m = b.totalTime.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : 0; })();
        return aTime - bTime;
      });
    } else if (searchMode === 'balanced') {
      // Normalize cost and time, then sum
      const maxCost = Math.max(...allItineraries.map(o => parseFloat(o.totalCost.replace(/[^0-9.]/g, ''))));
      const maxTime = Math.max(...allItineraries.map(o => {
        const m = o.totalTime.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : 0;
      }));
      allItineraries.sort((a, b) => {
        const costA = parseFloat(a.totalCost.replace(/[^0-9.]/g, '')) / maxCost;
        const costB = parseFloat(b.totalCost.replace(/[^0-9.]/g, '')) / maxCost;
        const timeA = (() => { const m = a.totalTime.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : 0; })() / maxTime;
        const timeB = (() => { const m = b.totalTime.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : 0; })() / maxTime;
        return (costA + timeA) - (costB + timeB);
      });
    }

    // Only show top 3 for now
    setItineraries(allItineraries.slice(0, 3));
  };

  return (
    <>
      <div style={{ padding: '2rem', maxWidth: '600px', margin: 'auto' }}>
        <h1>Route Planner</h1>
        <AddressAutocomplete label="Origin Address" onSelect={setOrigin} />
        <AddressAutocomplete label="Destination Address" onSelect={setDestination} />

        <fieldset>
          <legend>Search Mode:</legend>
          <label>
            <input
              type="radio"
              name="searchMode"
              value="cheapest"
              checked={searchMode === 'cheapest'}
              onChange={e => setSearchMode(e.target.value)}
            />
            Find the Cheapest Way
          </label>
          <label>
            <input
              type="radio"
              name="searchMode"
              value="fastest"
              checked={searchMode === 'fastest'}
              onChange={e => setSearchMode(e.target.value)}
            />
            Find the Fastest Way
          </label>
          <label>
            <input
              type="radio"
              name="searchMode"
              value="balanced"
              checked={searchMode === 'balanced'}
              onChange={e => setSearchMode(e.target.value)}
            />
            Find the Cheapest & Fastest Way
          </label>
        </fieldset>

        <button
          onClick={handleGetRoute}
          disabled={!origin || !destination}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
        >
          Search
        </button>

        {itineraries.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '1rem' }}>
              Note: We currently do not support some airlines (e.g., Southwest, Ryanair, Wizz Air). If you don’t see your preferred carrier, please check their official website directly.
            </p>
            <h2>Itineraries:</h2>
            <ul>
              {itineraries.map((itinerary, index) => (
                <li key={index} style={{ marginBottom: '1rem' }}>
                  <p><strong>Mode Combination:</strong> {itinerary.modeCombo}</p>
                  <p><strong>Total Time:</strong> {itinerary.totalTime}</p>
                  <p><strong>Total Cost:</strong> {itinerary.totalCost}</p>
                  <p><strong>Details:</strong> {itinerary.details}</p>
                  <a href={itinerary.bookLink} target="_blank" rel="noopener noreferrer">Book</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '2rem' }}>
        Flights on RyanAir and Southwest are not supported yet. If you know anybody at either of those companies, please introduce us—I’d love to get them on P2P!
      </p>
    </>
  );
}

export default App;