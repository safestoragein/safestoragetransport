// Country grouping for the transport module. Cities arrive as free-text slugs from the booking
// feed (customer_local_city). Anything not listed here is INDIA (the default market); the feed
// starts pushing Dubai orders with city "dubai".
export type Country = "india" | "dubai" | "uk";

const CITY_COUNTRY: Record<string, Country> = {
  dubai: "dubai", "abu dhabi": "dubai", sharjah: "dubai", ajman: "dubai",
  london: "uk", manchester: "uk", birmingham: "uk",
};

export function countryOfCity(citySlug: string | null | undefined): Country {
  return CITY_COUNTRY[String(citySlug ?? "").toLowerCase().trim()] ?? "india";
}

// Geocoding hints per country: the Nominatim country filter, the name appended to address
// candidates, and how far from the city centre a hit may land before it's considered a mismatch.
export const COUNTRY_GEO: Record<Country, { code: string; name: string; maxKmFromCentre: number }> = {
  india: { code: "in", name: "India", maxKmFromCentre: 90 },
  dubai: { code: "ae", name: "UAE", maxKmFromCentre: 80 },
  uk: { code: "gb", name: "UK", maxKmFromCentre: 80 },
};
