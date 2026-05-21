export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
    return;
  }

  const upstream = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
  res.send(text);
}
