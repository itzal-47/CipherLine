import { supabase } from './supabase';

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'declined'
  | 'no-answer'
  | 'failed';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice' | 'call-start' | 'call-accept' | 'call-decline' | 'call-end' | 'call-timeout' | 'call-join' | 'call-leave';
  payload: any;
  from: string;
  to: string;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: import.meta.env.VITE_TURN_URL as string || 'turn:openrelay.metered.ca:80',
    username: import.meta.env.VITE_TURN_USERNAME as string || 'openrelayproject',
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string || 'openrelayproject',
  },
  {
    urls: import.meta.env.VITE_TURN_URL_TLS as string || 'turn:openrelay.metered.ca:443',
    username: import.meta.env.VITE_TURN_USERNAME as string || 'openrelayproject',
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string || 'openrelayproject',
  },
  {
    urls: import.meta.env.VITE_TURN_URL_TCP as string || 'turn:openrelay.metered.ca:443?transport=tcp',
    username: import.meta.env.VITE_TURN_USERNAME as string || 'openrelayproject',
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string || 'openrelayproject',
  },
];

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

export function getSignalingChannel(roomId: string) {
  return supabase.channel(`webrtc-${roomId}`);
}

// Envia um sinal por um canal JÁ inscrito (ver subscribeSignaling). Reusar o
// mesmo canal em vez de criar um novo a cada envio é essencial aqui: uma
// chamada troca dezenas de mensagens de "ice candidate" em poucos segundos,
// e criar um canal novo (não inscrito) a cada uma delas ataca repetidamente
// o mesmo tópico de tempo real, podendo derrubar ou perder mensagens no meio
// da negociação — a causa mais provável de chamadas instáveis/que não conectam.
export async function sendOnChannel(
  channel: ReturnType<typeof supabase.channel>,
  from: string,
  to: string,
  type: SignalingMessage['type'],
  payload: any,
) {
  await channel.send({
    type: 'broadcast',
    event: 'signal',
    payload: { type, payload, from, to } as SignalingMessage,
  });
}

export function subscribeSignaling(
  roomId: string,
  myId: string,
  onMessage: (msg: SignalingMessage) => void,
) {
  const channel = getSignalingChannel(roomId);
  channel.on('broadcast', { event: 'signal' }, (res: any) => {
    const msg = res.payload as SignalingMessage;
    if (msg.to !== myId && msg.to !== 'all') return;
    onMessage(msg);
  });
  channel.subscribe();
  return channel;
}

export async function getUserMediaStream(withVideo: boolean): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: true,
    video: withVideo ? { facingMode: 'user' } : false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function adaptBitrate(sender: RTCRtpSender | undefined, bitrate: number) {
  if (!sender || !('getParameters' in sender)) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = bitrate;
  sender.setParameters(params).catch(() => {});
}
