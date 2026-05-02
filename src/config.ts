export const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
};
