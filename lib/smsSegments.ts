// Оценка числа SMS-сегментов по тексту — GSM-7 (латиница/базовые символы,
// 160 символов на сегмент, 153 при склейке нескольких) против UCS-2
// (кириллица и почти всё остальное, 70/67) — один нестандартный символ
// переводит ВСЁ сообщение на UCS-2, поэтому кириллица обычно вдвое дороже
// по сегментам, чем кажется по числу символов. Не для тарификации (у
// провайдера может отличаться в деталях), а как подсказка в форме.
const GSM7_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM7_SET = new Set(GSM7_CHARS);

export function smsSegments(text: string): { count: number; encoding: "GSM-7" | "UCS-2"; perSegment: number } {
  const isGsm7 = [...text].every((ch) => GSM7_SET.has(ch));
  const single = isGsm7 ? 160 : 70;
  const multi = isGsm7 ? 153 : 67;
  const len = [...text].length;
  const encoding = isGsm7 ? "GSM-7" : "UCS-2";
  if (len === 0) return { count: 0, encoding, perSegment: single };
  if (len <= single) return { count: 1, encoding, perSegment: single };
  return { count: Math.ceil(len / multi), encoding, perSegment: multi };
}
