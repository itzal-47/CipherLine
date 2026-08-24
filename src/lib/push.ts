import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

async function getServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
  }
  return registrationPromise;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export async function subscribeToPush(participantId: string): Promise<void> {
  if (!VAPID_PUBLIC_KEY) return;

  const reg = await getServiceWorker();
  if (!reg) return;

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch {
      return;
    }
  }

  await supabase.from('push_subscriptions').insert({
    participant_id: participantId,
    subscription: subscription.toJSON() as any,
  });
}

export async function unsubscribeFromPush(participantId: string): Promise<void> {
  const reg = await getServiceWorker();
  if (!reg) return;
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
  }
  await supabase.from('push_subscriptions').delete().eq('participant_id', participantId);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
