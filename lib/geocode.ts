// Address -> coordinates. SafeStorage stores free-text addresses (no lat/lng), so we resolve
// them here. Strategy: match a known locality substring (instant, offline); else fall back to
// the city centre. For production-grade pins, set GOOGLE_MAPS_API_KEY and swap in the Google
// Geocoding API behind geocodeAddress() — SafeStorage already keeps a google address per order.

export interface GeoResult {
  lat: number;
  lng: number;
  locality: string | null;
  precise: boolean; // true = matched a locality; false = city-centre fallback
}

export const CITY_CENTER: Record<string, { lat: number; lng: number; label: string }> = {
  bangalore: { lat: 12.97, lng: 77.59, label: "Bangalore" },
  hyderabad: { lat: 17.43, lng: 78.42, label: "Hyderabad" },
  pune: { lat: 18.52, lng: 73.85, label: "Pune" },
  chennai: { lat: 13.08, lng: 80.27, label: "Chennai" },
  mumbai: { lat: 19.08, lng: 72.88, label: "Mumbai" },
  delhi: { lat: 28.61, lng: 77.21, label: "Delhi" },
  coimbatore: { lat: 11.02, lng: 76.96, label: "Coimbatore" },
  ahmedabad: { lat: 23.02, lng: 72.57, label: "Ahmedabad" },
  kolkata: { lat: 22.57, lng: 88.36, label: "Kolkata" },
  noida: { lat: 28.58, lng: 77.32, label: "Noida" },
};

// Approximate SafeStorage warehouse coordinates by city (geocoded from warehouse_full_loc).
export const CITY_WAREHOUSE: Record<string, { lat: number; lng: number; label: string }> = {
  bangalore: { lat: 12.992, lng: 77.751, label: "Immadahalli WH · Whitefield" },
  hyderabad: { lat: 17.541, lng: 78.487, label: "Kompally WH" },
  pune: { lat: 18.561, lng: 73.918, label: "Pune WH" },
  chennai: { lat: 13.083, lng: 80.27, label: "Chennai WH" },
  mumbai: { lat: 19.08, lng: 72.88, label: "Mumbai WH" },
  delhi: { lat: 28.61, lng: 77.21, label: "Delhi WH" },
  coimbatore: { lat: 11.02, lng: 76.96, label: "Coimbatore WH" },
};

const GAZ: Record<string, [number, number]> = {
  // Bangalore
  malur: [12.999, 77.938], devarachikkanahalli: [12.886, 77.616], "btm": [12.916, 77.61],
  marathahalli: [12.956, 77.701], "outer ring road": [12.956, 77.701], peenya: [13.029, 77.519],
  whitefield: [12.969, 77.749], hrbr: [13.024, 77.643], "kalyan nagar": [13.024, 77.643],
  "electronic city": [12.845, 77.66], hilalige: [12.84, 77.66], "cox town": [12.997, 77.617],
  "fraser town": [12.997, 77.617], yelahanka: [13.1, 77.596], doddaballapur: [13.13, 77.58],
  "wilson garden": [12.948, 77.598], lakkasandra: [12.948, 77.598], sarjapur: [12.901, 77.687],
  kadubeesanahalli: [12.942, 77.693], thubarahalli: [12.957, 77.717], munnekolala: [12.957, 77.717],
  halasuru: [12.978, 77.621], ulsoor: [12.978, 77.621], mahadevapura: [12.991, 77.687],
  sonnenahalli: [12.979, 77.7], doddanakundi: [12.979, 77.7], "kr puram": [13.007, 77.7],
  "jp nagar": [12.906, 77.583], "j. p. nagar": [12.906, 77.583], anjanapura: [12.858, 77.563],
  jayanagar: [12.93, 77.583], koramangala: [12.935, 77.626], indiranagar: [12.971, 77.641],
  hebbal: [13.035, 77.597], banashankari: [12.925, 77.546], hsr: [12.911, 77.638],
  bellandur: [12.926, 77.676], "hennur": [13.04, 77.64], rajajinagar: [12.991, 77.552],
  // SE / East Bangalore (Sarjapur Rd & Whitefield corridor) — common in apartment addresses
  sarjapura: [12.86, 77.786], carmelaram: [12.905, 77.703], chikkakannalli: [12.888, 77.69],
  kadugodi: [12.997, 77.76], varthur: [12.94, 77.74], hoodi: [12.992, 77.716],
  kundalahalli: [12.959, 77.716], brookefield: [12.966, 77.717], nagondanahalli: [12.99, 77.73],
  hoskote: [13.07, 77.79], panathur: [12.936, 77.696], harlur: [12.905, 77.655], haralur: [12.9, 77.66],
  gunjur: [12.92, 77.74], "ramamurthy nagar": [13.018, 77.677], kasavanahalli: [12.9, 77.68],
  // Hyderabad
  puppalaguda: [17.412, 78.366], kondapur: [17.4615, 78.364], "mahendra hills": [17.45, 78.53],
  malkajgiri: [17.45, 78.53], secunderabad: [17.44, 78.5], gachibowli: [17.44, 78.348],
  miyapur: [17.495, 78.358], hafeezpet: [17.48, 78.36], ameenpur: [17.52, 78.32],
  gopanpalle: [17.48, 78.3], nallagandla: [17.47, 78.31], kphb: [17.493, 78.391],
  kukatpally: [17.4948, 78.3996], madhapur: [17.448, 78.391], "banjara hills": [17.4156, 78.4347],
  "jubilee hills": [17.431, 78.407], manikonda: [17.404, 78.383], kompally: [17.54, 78.487],
  // Pune
  aundh: [18.558, 73.807], hinjewadi: [18.591, 73.738], kharadi: [18.551, 73.941],
  wakad: [18.598, 73.762], baner: [18.559, 73.776], hadapsar: [18.5, 73.926],
  // Chennai
  nungambakkam: [13.06, 80.243], velachery: [12.979, 80.221], adyar: [13.006, 80.257],
  porur: [13.038, 80.158], tambaram: [12.925, 80.127], omr: [12.89, 80.227],
  // Mumbai
  nahur: [19.156, 72.946], andheri: [19.119, 72.846], thane: [19.218, 72.978],
  powai: [19.117, 72.905], bandra: [19.06, 72.84], borivali: [19.232, 72.857],
  // Delhi NCR
  "greater kailash": [28.541, 77.242], indirapuram: [28.642, 77.371], ghaziabad: [28.669, 77.453],
  noida: [28.535, 77.391], gurgaon: [28.459, 77.026], dwarka: [28.592, 77.046],
  // Coimbatore
  "town and country": [11.024, 76.97], peelamedu: [11.029, 77.027], saravanampatti: [11.079, 77.0],
};

export function geocodeAddress(address: string, citySlug: string): GeoResult {
  const a = (address || "").toLowerCase();
  let best: { key: string; coord: [number, number] } | null = null;
  for (const key in GAZ) {
    if (a.includes(key) && (!best || key.length > best.key.length)) best = { key, coord: GAZ[key] };
  }
  if (best) return { lat: best.coord[0], lng: best.coord[1], locality: best.key, precise: true };
  const c = CITY_CENTER[citySlug] ?? CITY_CENTER.bangalore;
  return { lat: c.lat, lng: c.lng, locality: null, precise: false };
}
