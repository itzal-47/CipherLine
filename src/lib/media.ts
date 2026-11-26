import { supabase } from './supabase';
import type { RoomCrypto, MsgCtx } from './roomCrypto';

const BUCKET = 'cipherline-media';

// ============================================================
// ÁUDIO (já era cifrado)
// ============================================================

export async function uploadEncryptedAudio(
  roomId: string,
  audioBlob: Blob,
  rc: RoomCrypto,
  ctx: MsgCtx,
  _onProgress?: (pct: number) => void,
): Promise<string> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const encrypted = await rc.encryptBinary(arrayBuffer, ctx);
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const path = `audio/${roomId}/${ctx.messageId}.webm`;

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
  rc: RoomCrypto,
  ctx: MsgCtx,
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) throw error ?? new Error('Download failed');

  const encryptedBuffer = await data.arrayBuffer();
  const decrypted = await rc.decryptBinary(encryptedBuffer, ctx);
  return new Blob([decrypted], { type: 'audio/webm' });
}

// ============================================================
// IMAGENS DE MENSAGENS (cifradas a partir do LOTE 7.1)
// ============================================================

export async function uploadEncryptedImage(
  roomId: string,
  imageBlob: Blob,
  rc: RoomCrypto,
  ctx: MsgCtx,
  _onProgress?: (pct: number) => void,
): Promise<string> {
  const arrayBuffer = await imageBlob.arrayBuffer();
  const encrypted = await rc.encryptBinary(arrayBuffer, ctx);
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const path = `images/${roomId}/${ctx.messageId}.enc`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, encryptedBlob, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) throw error;
  return path;
}

/**
 * Baixa uma imagem de mensagem e tenta decifrá-la com a chave da sala.
 *
 * Só salas v1 aceitam imagens legacy em claro.
 */
export async function downloadAndDecryptImage(
  storagePath: string,
  rc: RoomCrypto,
  ctx: MsgCtx,
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) throw error ?? new Error('Download failed');

  const rawBuffer = await data.arrayBuffer();

  try {
    const decrypted = await rc.decryptBinary(rawBuffer, ctx);
    return new Blob([decrypted], { type: 'image/jpeg' });
  } catch {
    if (rc.version === 1) return new Blob([rawBuffer], { type: 'image/jpeg' });
    throw new Error('Falha ao decifrar imagem');
  }
}

// ============================================================
// AVATARES E FUNDOS (não cifrados — não têm roomCode)
// ============================================================

export async function uploadImage(
  roomId: string,
  messageId: string,
  imageBlob: Blob,
  _onProgress?: (pct: number) => void,
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

// Gera um URL assinado (validade de 1 hora) para um ficheiro no bucket privado.
// Retorna null se o ficheiro nao existir ou se houver erro.
export async function getImageUrl(storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600); // 1 hora
    if (error) throw error;
    return data.signedUrl;
  } catch (err) {
    console.warn('[media] Falha ao gerar signed URL:', err);
    return null;
  }
}

// Mantemos um atalho sincrono que retorna vazio, para nao quebrar imports antigos.
// (Nao usar em <img> ou <audio> diretamente, pois nao vai funcionar.)
export function getPublicUrlSync(_storagePath: string): string {
  return '';
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
