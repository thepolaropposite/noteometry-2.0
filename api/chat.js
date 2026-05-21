const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
    return;
  }

  const { model = 'gpt-4o', messages, temperature = 0.2 } = req.body ?? {};
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages must be an array.' });
    return;
  }

  const upstream = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
  res.send(text);
}
