import { sendAssistantMessageSchema, sendVoiceMessageSchema } from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import { parseInput } from '../../common/validate';
import {
  decidePending,
  getConversation,
  handleMessage,
  handleVoiceMessage,
  type AssistantDeps,
} from './assistant.service';

export function assistantRouter(deps: AssistantDeps) {
  const router = Router();

  /** Whether the server has a model configured, so the app can explain instead of failing. */
  router.get('/status', (_req, res) => {
    res.json({
      available: deps.llm !== null,
      voice: deps.llm !== null && deps.transcriber !== null,
    });
  });

  // app.ts parses a larger JSON body for this route only.
  router.post('/voice', async (req, res) => {
    const input = parseInput(sendVoiceMessageSchema, req.body);
    res.json(await handleVoiceMessage(deps, currentUserId(req), input));
  });

  router.post('/messages', async (req, res) => {
    const input = parseInput(sendAssistantMessageSchema, req.body);
    res.json(await handleMessage(deps, currentUserId(req), input));
  });

  router.get('/conversations/latest', async (req, res) => {
    res.json({ conversation: await getConversation(deps.prisma, currentUserId(req), 'latest') });
  });

  router.get('/conversations/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Conversation');
    res.json({ conversation: await getConversation(deps.prisma, currentUserId(req), id) });
  });

  for (const decision of ['confirm', 'decline'] as const) {
    router.post(`/conversations/:id/pending/:pendingId/${decision}`, async (req, res) => {
      const id = parseId(req.params.id, 'Conversation');
      const pendingId = parseId(req.params.pendingId, 'Pending action');
      res.json(await decidePending(deps, currentUserId(req), id, pendingId, decision));
    });
  }

  return router;
}
