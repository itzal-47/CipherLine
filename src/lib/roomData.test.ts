import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; count?: number }>,
  calls: [] as string[],
  channels: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  from: vi.fn(),
  rpc: vi.fn(),
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
  handlers: Array<{ type: string; filter: unknown; callback: (payload: unknown) => void }>;
  statusCallback?: (status: string) => void;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

vi.mock('./supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    channel: (...args: unknown[]) => mocks.channel(...args),
    removeChannel: (...args: unknown[]) => mocks.removeChannel(...args),
  },
}));

import { fetchPaste, fetchRoomSnapshot, subscribeRoomEvents } from './roomData';

const creds = { roomId: 'room-1', participantId: 'participant-1', secret: 'local-secret' };

function makeQuery(table: string) {
  const recordCall = (method: string) => (...args: unknown[]) => { mocks.calls.push(`${table}.${method}:${args.join(',')}`); return query; };
  const query: FakeQuery = {
    select: recordCall('select'), eq: recordCall('eq'), order: recordCall('order'), limit: recordCall('limit'),
    in: recordCall('in'), not: recordCall('not'), maybeSingle: recordCall('maybeSingle'),
    then: (resolve) => Promise.resolve(mocks.results[table] ?? { data: [] }).then(resolve),
  };
  return query;
}

function makeChannel(name: string): FakeChannel {
  const channel: FakeChannel = {
    name,
    handlers: [],
    on: vi.fn((type: string, filter: unknown, callback: (payload: unknown) => void) => { channel.handlers.push({ type, filter, callback }); return channel; }),
    subscribe: vi.fn((callback?: (status: string) => void) => { channel.statusCallback = callback; return channel; }),
  };
  return channel;
}

function setupMocks() {
  mocks.calls = [];
  mocks.channels = [];
  mocks.removed = [];
  mocks.results = {};
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.channel.mockReset();
  mocks.removeChannel.mockReset();
  mocks.from.mockImplementation((table: string) => makeQuery(String(table)));
  mocks.rpc.mockImplementation(async (name: string) => {
    mocks.calls.push(`rpc:${name}`);
    if (name === 'get_room_snapshot_secure') return { data: { cursor: 0, messages: [], participants: [], reactions: [], receipts: [], paste: null }, error: null };
    if (name === 'get_room_events_secure') return { data: { events: [], cursor: 0, more: false }, error: null };
    return { data: null, error: null };
  });
  mocks.channel.mockImplementation((name: string) => {
    const channel = makeChannel(String(name));
    mocks.channels.push(channel);
    return channel;
  });
  mocks.removeChannel.mockImplementation((channel: FakeChannel) => { mocks.removed.push(channel); });
}

async function flushPromises() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function signalSubscribed() {
  mocks.channels.find((channel) => channel.name.startsWith('room-sync-'))?.statusCallback?.('SUBSCRIBED');
}

beforeEach(() => { setupMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('roomData com leituras seguras', () => {
  it('chama snapshot com credenciais e limite e guarda o cursor para o polling', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { cursor: 90, messages: [{ id: 'm1' }], participants: [], reactions: [], receipts: [], paste: 'ciphertext' }, error: null,
    });
    const snapshot = await fetchRoomSnapshot(creds);
    expect(mocks.rpc).toHaveBeenCalledWith('get_room_snapshot_secure', {
      p_room_id: creds.roomId, p_participant_id: creds.participantId, p_secret: creds.secret, p_limit: 100,
    });
    expect(snapshot).toMatchObject({ messages: [{ id: 'm1' }], paste: 'ciphertext' });

    mocks.rpc.mockResolvedValueOnce({ data: { events: [], cursor: 90, more: false }, error: null });
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, {});
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    const eventCall = mocks.rpc.mock.calls.find(([name]) => name === 'get_room_events_secure');
    expect(eventCall?.[1]).toMatchObject({ p_after: 60, p_room_id: creds.roomId });
    unsubscribe();
  });

  it('despacha cada kind uma vez, ordenado, e usa cursor com sobreposição de 30', async () => {
    await fetchRoomSnapshot(creds);
    const kinds = ['message_insert', 'message_update', 'message_delete', 'reaction_insert', 'reaction_delete', 'receipt_insert', 'participant_insert', 'participant_update', 'participant_delete', 'paste'];
    const rows = kinds.map((kind, index) => ({ id: 101 + index, kind, row: { id: `row-${index}`, message_id: 'm1', nickname: 'P', encrypted_content: 'enc' } }));
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_room_events_secure'
      ? { data: { events: [...rows].reverse(), cursor: 110, more: false }, error: null }
      : { data: null, error: null });
    const handlers = Object.fromEntries(kinds.map((kind) => [
      ({ message_insert: 'onMessageInsert', message_update: 'onMessageUpdate', message_delete: 'onMessageDelete', reaction_insert: 'onReactionInsert', reaction_delete: 'onReactionDelete', receipt_insert: 'onReceiptInsert', participant_insert: 'onParticipantInsert', participant_update: 'onParticipantUpdate', participant_delete: 'onParticipantDelete', paste: 'onPasteChange' } as Record<string, string>)[kind], vi.fn(),
    ]));
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, handlers);
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    expect(mocks.rpc).toHaveBeenCalledWith('get_room_events_secure', expect.objectContaining({ p_after: 0 }));
    kinds.forEach((kind, index) => {
      const handlerName = ({ message_insert: 'onMessageInsert', message_update: 'onMessageUpdate', message_delete: 'onMessageDelete', reaction_insert: 'onReactionInsert', reaction_delete: 'onReactionDelete', receipt_insert: 'onReceiptInsert', participant_insert: 'onParticipantInsert', participant_update: 'onParticipantUpdate', participant_delete: 'onParticipantDelete', paste: 'onPasteChange' } as Record<string, string>)[kind];
      expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
      expect(handlers[handlerName]).toHaveBeenCalledWith(kind === 'paste' ? { new: rows[index].row } : rows[index].row);
    });
    unsubscribe();
  });

  it('deduplica eventos sobrepostos e avança o cursor', async () => {
    await fetchRoomSnapshot(creds);
    const onInsert = vi.fn();
    let poll = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name !== 'get_room_events_secure') return { data: null, error: null };
      poll += 1;
      return { data: { events: [{ id: 1, kind: 'message_insert', row: { id: 'm1' } }], cursor: poll === 1 ? 35 : 40, more: false }, error: null };
    });
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, { onMessageInsert: onInsert });
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    expect(onInsert).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_room_events_secure').at(-1)?.[1]).toMatchObject({ p_after: 5 });
    unsubscribe();
  });

  it('repete enquanto more, até ao máximo de cinco páginas', async () => {
    await fetchRoomSnapshot(creds);
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_room_events_secure'
      ? { data: { events: [], cursor: 2, more: true }, error: null }
      : { data: null, error: null });
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, {});
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_room_events_secure')).toHaveLength(5);
    unsubscribe();
  });

  it('notifica INVALID_SECRET uma vez e pára o polling', async () => {
    await fetchRoomSnapshot(creds);
    const onAuthError = vi.fn();
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_room_events_secure'
      ? { data: null, error: { message: 'INVALID_SECRET' } }
      : { data: null, error: null });
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, { onAuthError });
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30000);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_room_events_secure')).toHaveLength(1);
    unsubscribe();
  });

  it('fetchPaste devolve null quando o RPC não encontra paste', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchPaste(creds)).resolves.toBeNull();
  });

  it('unsubscribe remove o canal e pára o temporizador', async () => {
    await fetchRoomSnapshot(creds);
    vi.useFakeTimers();
    const unsubscribe = subscribeRoomEvents(creds, {});
    signalSubscribed();
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    const callsBeforeUnsubscribe = mocks.rpc.mock.calls.length;
    unsubscribe();
    expect(mocks.removed.map((channel) => channel.name)).toEqual(['room-sync-room-1']);
    await vi.advanceTimersByTimeAsync(30000);
    expect(mocks.rpc.mock.calls).toHaveLength(callsBeforeUnsubscribe);
  });
});

describe('roomData com leituras antigas', () => {
  it('mantém queries diretas e postgres_changes quando SECURE_READS=0', async () => {
    vi.stubEnv('VITE_SECURE_READS', '0');
    vi.resetModules();
    const legacy = await import('./roomData');
    mocks.results.messages = { data: [{ id: 'm1' }] };
    mocks.results.participants = { data: [] };
    await legacy.fetchRoomSnapshot(creds);
    expect(mocks.calls).toContain('messages.select:*');
    expect(mocks.rpc).not.toHaveBeenCalled();
    const unsubscribe = legacy.subscribeRoomEvents(creds, {});
    expect(mocks.channels.map((channel) => channel.name)).toEqual([
      'paste-room-1', 'chat-room-1', 'reactions-room-1', 'receipts-room-1', 'presence-room-1',
    ]);
    expect(mocks.channels.some((channel) => channel.handlers.some((handler) => handler.type === 'postgres_changes'))).toBe(true);
    unsubscribe();
  });
});
