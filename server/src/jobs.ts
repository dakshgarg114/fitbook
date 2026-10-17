// Chat messages are processed in the background, one at a time per user, so closing the app or the chat
// doesn't stop the agent. The app polls the stage and refreshes when the job is gone.
// Held in memory: a server restart drops a running job (its message stays, without a reply).
import type { AgentStage } from '../../shared/types.ts';

const running = new Map<number, { stage: AgentStage; startedAt: number }>();

export const jobFor = (userId: number) => running.get(userId) ?? null;

export function startJob(userId: number, work: (setStage: (s: AgentStage) => void) => Promise<void>): boolean {
  if (running.has(userId)) return false;
  running.set(userId, { stage: 'analysing', startedAt: Date.now() });
  const setStage = (stage: AgentStage) => {
    const job = running.get(userId);
    if (job) job.stage = stage;
  };
  work(setStage)
    .catch((err) => console.error('job failed', err))
    .finally(() => running.delete(userId));
  return true;
}
