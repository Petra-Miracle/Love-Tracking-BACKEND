export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
  }
}

// Ringkas pesan error zod menjadi satu string yang mudah dibaca.
export function formatZodError(error) {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
