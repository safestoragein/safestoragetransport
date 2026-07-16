// PUBLIC customer tracking page — /track/<order uuid>. No login; the UUID is the share token.
import TrackClient from "./TrackClient";

export const dynamic = "force-dynamic";

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrackClient orderId={id} />;
}
