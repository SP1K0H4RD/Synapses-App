import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Use legacy build for maximum compatibility across devices
// @ts-ignore
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

// Manually initialize the worker if possible to bypass some environment restrictions
if (typeof window !== 'undefined' && 'Worker' in window) {
  try {
    // Try without type: module first for broader compatibility, or just use workerSrc
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
  } catch (e) {
    console.warn("Failed to set workerSrc", e);
  }
} else {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const loadingTask = pdfjs.getDocument({ 
      data: arrayBuffer,
      disableFontFace: true,
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
      cMapPacked: true,
      disableRange: true,
      disableStream: true,
      standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-ignore
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      } catch (pageError) {
        console.warn(`Error extracting text from page ${i}:`, pageError);
        continue; 
      }
    }

    return fullText;
  } catch (error) {
    console.error("PDF Extraction Error:", error);
    throw error;
  }
}
