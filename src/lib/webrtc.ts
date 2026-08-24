import { supabase } from './supabase';

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'declined'
  | 'no-answer'
  | 'failed';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice' | 'call-start' | 'call-accept' | 'call-decline' | 'call-end' | 'call-timeout';
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

export async function sendSignaling(
  roomId: string,
  from: string,
  to: string,
  type: SignalingMessage['type'],
  payload: any,
) {
  const channel = getSignalingChannel(roomId);
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
