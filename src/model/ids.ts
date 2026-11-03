const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short id that is safe as a file name: [a-z0-9-] only. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `${prefix}-${suffix}`;
}

export function isSafeId(id: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(id);
}

/** Asset file names: a safe id plus a known image extension, nothing that can leave assets/. */
export function isAssetName(name: string): boolean {
  return /^[a-z0-9-]{1,64}\.(png|jpg|webp|gif)$/.test(name);
}
