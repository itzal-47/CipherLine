import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; count?: number }>,
  calls: [] as string[],
  channels: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

type FakeQuery = {
  select: (...args: unknown[]) => FakeQuery;
  eq: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  not: (...args: unknown[]) => FakeQuery;
  maybeSingle: (...args: unknown[]) => FakeQuery;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

type FakeChannel = {
  name: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

vi.mock('./supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    channel: (...args: unknown[]) => mocks.channel(...args),
    removeChannel: (...args: unknown[]) => mocks.removeChannel(...args),
  },
}));

import { fetchPaste, fetchRoomSnapshot, subscribeRoomEvents } from './roomData';

function makeQuery(table: string) {
  const recordCall = (method: string) => (...args: unknown[]) => { mocks.calls.push(`${table}.${method}:${args.join(',')}`); return query; };
  const query: FakeQuery = {
    select: recordCall('select'), eq: recordCall('eq'), order: recordCall('order'), limit: recordCall('limit'),
    in: recordCall('in'), not: recordCall('not'), maybeSingle: recordCall('maybeSingle'),
    then: (resolve) => Promise.resolve(mocks.results[table] ?? { data: [] }).then(resolve),
  };
  return query;
}

function makeChannel(name: string) {
  const channel: FakeChannel = {
    name,
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return channel;
}

beforeEach(() => {
  mocks.calls = [];
  mocks.channels = [];
  mocks.removed = [];
  mocks.results = {};
  mocks.from.mockImplementation((table: string) => makeQuery(String(table)));
  mocks.channel.mockImplementation((name: string) => {
    const channel = makeChannel(String(name));
    mocks.channels.push(channel);
    return channel;
  });
  mocks.removeChannel.mockImplementation((channel: FakeChannel) => { mocks.removed.push(channel); });
});

describe('roomData', () => {
  it('carrega snapshot em ordem, limita mensagens a 100 e só procura reações/recibos com mensagens', async () => {
    mocks.results.messages = { data: [{ id: 'm1' }] };
    mocks.results.participants = { data: [] };
    mocks.results.reactions = { data: [{ id: 'r1' }] };
    mocks.results.read_receipts = { data: [{ id: 'rr1' }] };

    const snapshot = await fetchRoomSnapshot('room-1');

    expect(snapshot.messages).toEqual([{ id: 'm1' }]);
    expect(snapshot.reactions).toEqual([{ id: 'r1' }]);
    expect(snapshot.receipts).toEqual([{ id: 'rr1' }]);
    expect(mocks.calls.indexOf('messages.select:*')).toBeLessThan(mocks.calls.indexOf('participants.select:id, nickname, last_seen, show_profile, user_id'));
    expect(mocks.calls).toContain('messages.limit:100');
    expect(mocks.calls.indexOf('participants.eq:room_id,room-1')).toBeLessThan(mocks.calls.indexOf('reactions.select:*'));
    expect(mocks.calls).toContain('reactions.in:message_id,m1');
    expect(mocks.calls).toContain('read_receipts.in:message_id,m1');
    expect(mocks.calls.indexOf('reactions.select:*')).toBeLessThan(mocks.calls.indexOf('read_receipts.select:*'));

    mocks.calls = [];
    mocks.results.messages = { data: [] };
    const emptySnapshot = await fetchRoomSnapshot('room-2');
    expect(emptySnapshot.reactions).toEqual([]);
    expect(emptySnapshot.receipts).toEqual([]);
    expect(mocks.calls.some((call) => call.startsWith('reactions.'))).toBe(false);
    expect(mocks.calls.some((call) => call.startsWith('read_receipts.'))).toBe(false);
  });

  it('devolve null quando a sala não tem paste', async () => {
    mocks.results.room_pastes = { data: null };
    await expect(fetchPaste('room-1')).resolves.toBeNull();
  });

  it('cria os cinco canais e unsubscribe remove todos', () => {
    const unsubscribe = subscribeRoomEvents('room-1', {});
    expect(mocks.channel.mock.calls.map(([name]) => name)).toEqual([
      'paste-room-1', 'chat-room-1', 'reactions-room-1', 'receipts-room-1', 'presence-room-1',
    ]);
    unsubscribe();
    expect(mocks.removed).toHaveLength(5);
    expect(mocks.removed).toEqual(mocks.channels);
  });
});
