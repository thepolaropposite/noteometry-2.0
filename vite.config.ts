import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function openAiDevApi(): Plugin {
  return {
    name: 'noteometry-openai-dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      const apiKey = env.OPENAI_API_KEY;

      server.middlewares.use('/api/models', async (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET');
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        if (!apiKey) {
          sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
          return;
        }
        const upstream = await fetch('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        res.statusCode = upstream.status;
        res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
        res.end(await upstream.text());
      });

      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        if (!apiKey) {
          sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
          return;
        }
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as {
          model?: string;
          messages?: unknown[];
          temperature?: number;
        };
        if (!Array.isArray(body.messages)) {
          sendJson(res, 400, { error: 'messages must be an array.' });
          return;
        }
        const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: body.model ?? 'gpt-4o',
            messages: body.messages,
            temperature: body.temperature ?? 0.2,
          }),
        });
        res.statusCode = upstream.status;
        res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
        res.end(await upstream.text());
      });

      server.middlewares.use('/api/transcribe', async (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        if (!apiKey) {
          sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
          return;
        }
        const audio = await readBody(req);
        const form = new FormData();
        form.append('model', 'gpt-4o-transcribe');
        form.append('file', new Blob([audio], { type: req.headers['content-type'] ?? 'audio/webm' }), 'noteometry-voice.webm');
        form.append('response_format', 'json');

        const transcriptRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
        });
        const transcriptJson = await transcriptRes.json().catch(() => null) as { text?: string; error?: { message?: string } } | null;
        if (!transcriptRes.ok) {
          sendJson(res, transcriptRes.status, { error: transcriptJson?.error?.message ?? 'Transcription failed.' });
          return;
        }
        const transcript = transcriptJson?.text ?? '';
        const cleanupRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
                content: 'Clean spoken STEM study notes. Preserve equations, variables, units, and uncertainty. Do not invent facts. Return concise sections: Clean Notes, Equations / Values, Follow-ups.',
              },
              { role: 'user', content: transcript },
            ],
          }),
        });
        const cleanupJson = await cleanupRes.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
        if (!cleanupRes.ok) {
          sendJson(res, cleanupRes.status, { transcript, error: cleanupJson?.error?.message ?? 'Transcript cleanup failed.' });
          return;
        }
        sendJson(res, 200, { transcript, notes: cleanupJson?.choices?.[0]?.message?.content ?? transcript });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), openAiDevApi()],
  server: {
    proxy: {
      '/lmstudio': {
        target: 'http://127.0.0.1:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lmstudio/, ''),
      },
    },
  },
})
