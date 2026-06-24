import VendorPanel from "../components/VendorPanel";
import { listVendors } from "@/lib/vendors";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const { vendors, source } = await listVendors();
  return <VendorPanel initial={vendors} source={source} />;
}
