export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const duffelKey = process.env.DUFFEL_API_KEY;
  if (!duffelKey) {
    return res.status(500).json({ error: "Duffel API key not set on server" });
  }

  try {
    const duffelRes = await fetch("https://api.duffel.com/air/offer_requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${duffelKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await duffelRes.json();
    res.status(duffelRes.status).json(data);
  } catch (err) {
    console.error("Duffel proxy error", err);
    res.status(500).json({ error: "Duffel proxy error" });
  }
}