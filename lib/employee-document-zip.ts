import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { DocumentFiles } from "./document-files";
import { PRE_EMPLOYMENT_DOCUMENTS } from "./offer-documents";

type ArchiveDocument = { type: string; fileId: string | null; fileName: string | null };

/** One input chunk at a time; only ZIP directory metadata survives between files. */
export function documentZip(documents: ArchiveDocument[], files: DocumentFiles, signal?: AbortSignal) {
  const abort = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  async function* chunks() {
    const output: Uint8Array[] = [];
    const zip = new Zip((error, data) => {
      if (error) throw error;
      output.push(data);
    });
    const missing: string[] = [];
    try {
      for (const document of PRE_EMPLOYMENT_DOCUMENTS) {
        requestSignal.throwIfAborted();
        const stored = documents.find(d => d.type === document.type);
        if (!stored?.fileId) { missing.push(document.label); continue; }
        const url = await files.viewUrl(stored.fileId);
        const response = await fetch(url, {
          cache: 'no-store', signal: AbortSignal.any([requestSignal, AbortSignal.timeout(60000)]),
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error('Document File unavailable');
        }
        // Strip paths and control characters; the type prefix keeps filenames unique.
        const name = stored.fileName?.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'document';
        const entry = new ZipPassThrough(`${document.type}-${name}`);
        const reader = response.body.getReader();
        try {
          zip.add(entry);
          yield* output.splice(0);
          while (true) {
            const { done, value } = await reader.read();
            entry.push(value ?? new Uint8Array(), done);
            yield* output.splice(0);
            if (done) break;
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      const manifest = new ZipPassThrough('manifest.txt');
      zip.add(manifest);
      manifest.push(strToU8(missing.length ? `Documents not submitted or without an available file:\n${missing.map(label => `- ${label}`).join('\n')}\n` : 'All seven Pre-employment Documents included.\n'), true);
      zip.end();
      yield* output.splice(0);
    } finally {
      zip.terminate();
    }
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) { abort.abort(); controller.error(error); }
    },
    async cancel() { abort.abort(); await iterator.return(undefined); },
  }, { highWaterMark: 0 });
}
