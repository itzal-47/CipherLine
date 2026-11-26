import type { PollData } from '@/types';

type ServerPollData = { options: Array<{ id: string; votes: string[] }>; allowMultiple: boolean };

export function buildServerPollData(poll: PollData, cryptoVersion: 1 | 2): PollData | ServerPollData {
  if (cryptoVersion === 1) return poll;
  return {
    options: poll.options.map(({ id }) => ({ id, votes: [] })),
    allowMultiple: poll.allowMultiple,
  };
}

export function mergePollData(content: PollData, server: Partial<ServerPollData> | null | undefined): PollData {
  if (!server) return content;
  const serverOptions = new Map((server.options ?? []).map(option => [option.id, option]));
  return {
    question: content.question,
    allowMultiple: server.allowMultiple ?? content.allowMultiple,
    options: content.options.map(option => {
      const current = serverOptions.get(option.id);
      return current ? { ...option, votes: current.votes ?? option.votes } : option;
    }),
  };
}
