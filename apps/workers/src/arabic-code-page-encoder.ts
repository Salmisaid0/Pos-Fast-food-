import { Buffer } from "node:buffer";

import type { EscPosTextEncoder } from "./escpos-tcp-transport";

export interface ArabicCodePageEncoderOptions {
  fallbackByte?: number;
  newlineByte?: number;
}

const ASCII_MAX = 0x7f;

const ARABIC_CP864_APPROXIMATION = new Map<string, number>([
  ["ء", 0x80],
  ["آ", 0x81],
  ["أ", 0x82],
  ["ؤ", 0x83],
  ["إ", 0x84],
  ["ئ", 0x85],
  ["ا", 0x86],
  ["ب", 0x87],
  ["ة", 0x88],
  ["ت", 0x89],
  ["ث", 0x8a],
  ["ج", 0x8b],
  ["ح", 0x8c],
  ["خ", 0x8d],
  ["د", 0x8e],
  ["ذ", 0x8f],
  ["ر", 0x90],
  ["ز", 0x91],
  ["س", 0x92],
  ["ش", 0x93],
  ["ص", 0x94],
  ["ض", 0x95],
  ["ط", 0x96],
  ["ظ", 0x97],
  ["ع", 0x98],
  ["غ", 0x99],
  ["ف", 0x9a],
  ["ق", 0x9b],
  ["ك", 0x9c],
  ["ل", 0x9d],
  ["م", 0x9e],
  ["ن", 0x9f],
  ["ه", 0xa0],
  ["و", 0xa1],
  ["ى", 0xa2],
  ["ي", 0xa3],
  ["لا", 0xa4],
]);

export function createArabicCodePageTextEncoder(
  options: ArabicCodePageEncoderOptions = {}
): EscPosTextEncoder {
  const fallbackByte = options.fallbackByte ?? 0x3f;
  const newlineByte = options.newlineByte ?? 0x0a;

  return (text: string) => {
    const bytes: number[] = [];
    const normalizedText = normalizeArabicLigatures(text);

    for (let index = 0; index < normalizedText.length; index += 1) {
      const pair = normalizedText.slice(index, index + 2);
      if (ARABIC_CP864_APPROXIMATION.has(pair)) {
        bytes.push(ARABIC_CP864_APPROXIMATION.get(pair) ?? fallbackByte);
        index += 1;
        continue;
      }

      const char = normalizedText[index] ?? "";
      const codePoint = char.codePointAt(0);
      if (char === "\n") {
        bytes.push(newlineByte);
      } else if (codePoint !== undefined && codePoint <= ASCII_MAX) {
        bytes.push(codePoint);
      } else {
        bytes.push(ARABIC_CP864_APPROXIMATION.get(char) ?? fallbackByte);
      }
    }

    return Buffer.from(bytes);
  };
}

function normalizeArabicLigatures(text: string): string {
  return text
    .replaceAll("ﻻ", "لا")
    .replaceAll("ﻷ", "لا")
    .replaceAll("ﻹ", "لا")
    .replaceAll("ﻵ", "لا");
}
