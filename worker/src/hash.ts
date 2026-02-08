export async function messageId(
  phone: string,
  text: string,
  timestamp: string,
  direction: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${phone}|${text}|${timestamp}|${direction}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
