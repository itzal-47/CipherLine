import { describe, expect, it } from 'vitest';
import { buildServerPollData, mergePollData } from './pollData';
import type { PollData } from '@/types';

const poll: PollData = { question: 'Pergunta', options: [{ id: 'a', text: 'Sim', votes: ['p1'] }, { id: 'b', text: 'Não', votes: [] }], allowMultiple: false };

describe('pollData', () => {
  it('omite pergunta e textos em poll_data v2', () => {
    expect(buildServerPollData(poll, 2)).toEqual({ options: [{ id: 'a', votes: [] }, { id: 'b', votes: [] }], allowMultiple: false });
    expect(JSON.stringify(buildServerPollData(poll, 2))).not.toMatch(/question|text/);
  });
  it('devolve o pollData original em v1', () => expect(buildServerPollData(poll, 1)).toBe(poll));
  it('junta votos por id, preserva textos e ignora opções desconhecidas', () => {
    expect(mergePollData(poll, { allowMultiple: true, options: [{ id: 'a', votes: ['p2'] }, { id: 'unknown', votes: ['p3'] }] })).toEqual({ question: 'Pergunta', allowMultiple: true, options: [{ id: 'a', text: 'Sim', votes: ['p2'] }, { id: 'b', text: 'Não', votes: [] }] });
  });
  it('preserva votos quando uma opção não vem do servidor', () => expect(mergePollData(poll, { options: [] }).options[0].votes).toEqual(['p1']));
});
