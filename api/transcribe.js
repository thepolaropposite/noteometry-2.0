export const config = {
  api: {
    bodyParser: false,
  },
};

const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CLEANUP_URL = 'https://api.openai.com/v1/chat/completions';

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

  const audio = await readRequest(req);
  if (!audio.length) {
    res.status(400).json({ error: 'No audio payload received.' });
    return;
  }

  const filename = req.headers['x-noteometry-filename'] || 'noteometry-voice.webm';
  const mime = req.headers['content-type'] || 'audio/webm';
  const form = new FormData();
  form.append('model', 'gpt-4o-transcribe');
  form.append('file', new Blob([audio], { type: mime }), String(filename));
  form.append('response_format', 'json');

  const transcriptRes = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const transcriptJson = await transcriptRes.json().catch(() => null);
  if (!transcriptRes.ok) {
    res.status(transcriptRes.status).json({ error: transcriptJson?.error?.message ?? 'Transcription failed.' });
    return;
  }

  const transcript = typeof transcriptJson?.text === 'string' ? transcriptJson.text : '';
  const cleanupRes = await fetch(CLEANUP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.15,
      messages: [
        {
          role: 'system',
          content: [
            'You clean up spoken STEM study notes for Noteometry.',
            'Preserve equations, variables, units, and uncertainty.',
            'Do not invent facts. Mark unclear phrases as [unclear].',
            'Return concise sections: Clean Notes, Equations / Values, Follow-ups.',
          ].join('\n'),
        },
        { role: 'user', content: transcript },
      ],
    }),
  });
  const cleanupJson = await cleanupRes.json().catch(() => null);
  if (!cleanupRes.ok) {
    res.status(cleanupRes.status).json({
      transcript,
      error: cleanupJson?.error?.message ?? 'Transcript cleanup failed.',
    });
    return;
  }

  res.status(200).json({
    transcript,
    notes: cleanupJson?.choices?.[0]?.message?.content ?? transcript,
  });
}
