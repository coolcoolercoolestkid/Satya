import { Buffer } from "buffer";

// Anon Aadhaar's compiled build expects Node's Buffer. Imported first, before anything uses it.
const g = globalThis as { Buffer?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
