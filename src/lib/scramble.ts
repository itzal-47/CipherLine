const SCRAMBLE_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~01ΞΛΦΨΩΣΔΓΘΛΞΠΣΦΨΩ';

export function scrambleText(text: string, progress: number): string {
  if (progress >= 1) return text;
  const chars = text.split('');
  const result = chars.map((char, i) => {
    if (char === ' ') return ' ';
    const charProgress = i / chars.length;
    if (charProgress < progress) {
      return char;
    }
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  });
  return result.join('');
}

export function randomScramble(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    if (Math.random() > 0.85) {
      result += ' ';
    } else {
      result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }
  }
  return result;
}
