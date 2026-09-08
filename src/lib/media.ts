import { supabase } from './supabase';
import { encryptBinary, decryptBinary } from './crypto';

const BUCKET = 'cipherline-media';

export async function uploadEncryptedAudio(
  roomId: string,
  messageId: string,
  audioBlob: Blob,
  roomCode: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const encrypted = await encryptBinary(arrayBuffer, roomCode);
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const path = `audio/${roomId}/${messageId}.webm`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, encryptedBlob, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function downloadAndDecryptAudio(
  storagePath: string,
  roomCode: string,
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) throw error ?? new Error('Download failed');

  const encryptedBuffer = await data.arrayBuffer();
  const decrypted = await decryptBinary(encryptedBuffer, roomCode);
  return new Blob([decrypted], { type: 'audio/webm' });
}

export async function uploadImage(
  roomId: string,
  messageId: string,
  imageBlob: Blob,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const path = `images/${roomId}/${messageId}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, imageBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function uploadAvatar(userId: string, imageBlob: Blob): Promise<string> {
  const path = `avatars/${userId}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, imageBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function uploadBackgroundImage(
  ownerId: string,
  imageBlob: Blob,
): Promise<string> {
  const path = `backgrounds/${ownerId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, imageBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function getImageUrl(storagePath: string): Promise<string> {
  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function downloadImage(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !data) throw error ?? new Error('Download failed');
  return data;
}

export async function deleteStorageFile(storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

export function compressImage(file: File, maxSize = 1600, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Compression failed'));
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
