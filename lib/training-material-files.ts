/** One-operation-each boundary to file-storage through the api-gateway; replace with a fake in tests. */
export type MaterialFiles = {
  /** Asks for an upload address for a new Private, Permanent File. */
  requestUpload(file: { filename: string; contentType: string; size: number }): Promise<{ fileId: string; uploadUrl: string }>;
  confirm(fileId: string): Promise<void>;
  remove(fileId: string): Promise<void>;
  viewUrl(fileId: string): Promise<string>;
};

export function gatewayMaterialFiles(): MaterialFiles {
  async function call(path: string, init: RequestInit = {}) {
    const baseUrl = process.env.API_GATEWAY_URL;
    const callerKey = process.env.API_GATEWAY_CALLER_KEY;
    if (!baseUrl || !callerKey) throw new Error("Training materials are not configured");
    return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${callerKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  }
  const id = (fileId: string) => encodeURIComponent(fileId);

  return {
    async requestUpload(file) {
      const response = await call("/files", { method: "POST", body: JSON.stringify({ ...file, visibility: "private", retentionType: "permanent" }) });
      if (!response.ok) throw new Error("File upload could not be requested");
      const body = await response.json();
      if (typeof body.id !== "string" || typeof body.uploadUrl !== "string" || new URL(body.uploadUrl).protocol !== "https:") throw new Error("Invalid upload address");
      return { fileId: body.id, uploadUrl: body.uploadUrl };
    },
    async confirm(fileId) {
      if (!(await call(`/files/${id(fileId)}/confirm`, { method: "POST" })).ok) throw new Error("File upload could not be confirmed");
    },
    async remove(fileId) {
      // file-storage answers 204 for a File that is already deleted, so a retry is harmless.
      if (!(await call(`/files/${id(fileId)}`, { method: "DELETE" })).ok) throw new Error("File could not be deleted");
    },
    async viewUrl(fileId) {
      const response = await call(`/files/${id(fileId)}`);
      if (!response.ok) throw new Error("File unavailable");
      const { url } = await response.json();
      if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("Invalid File address");
      return url;
    },
  };
}
