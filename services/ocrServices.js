import axios from "axios";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

// Reuse worker to avoid initialization overhead
let workerInstance = null;

const getWorker = async () => {
  if (!workerInstance) {
    workerInstance = await createWorker();
    await workerInstance.reinitialize("eng");
  }
  return workerInstance;
};

/* ---------- IMAGE INPUT ---------- */
const getImageBuffer = async (input) => {
  if (Buffer.isBuffer(input)) return input;

  const res = await axios.get(input, {
    responseType: "arraybuffer",
    timeout: 30000, // 30 second timeout
    maxContentLength: 10 * 1024 * 1024, // 10MB max
  });

  return Buffer.from(res.data);
};

/* ---------- PREPROCESS ---------- */
const preprocessImage = async (buffer) => {
  return sharp(buffer)
    .resize(2000, 2000, { // Limit size for faster processing
      fit: 'inside',
      withoutEnlargement: true
    })
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(150)
    .toBuffer();
};

/* ---------- CLEAN OCR TEXT ---------- */
const normalizeText = (text) => {
  return text
    .replace(/[O]/g, "0")
    .replace(/[B]/g, "8")
    .replace(/[|]/g, "1")
    .replace(/\s{2,}/g, " ")
    .trim();
};

/* ---------- MAIN OCR FUNCTION ---------- */
export const extractTextFromImage = async (imageInput) => {
  try {
    console.log("🔍 Starting OCR extraction...");
    
    const buffer = await getImageBuffer(imageInput);
    console.log(`📊 Image buffer size: ${(buffer.length / 1024).toFixed(2)}KB`);
    
    const processed = await preprocessImage(buffer);
    console.log("✅ Image preprocessed");

    const worker = await getWorker();
    
    const {
      data: { text },
    } = await worker.recognize(processed);

    console.log(`✅ Text extracted (${text.length} characters)`);

    return {
      success: true,
      text: normalizeText(text),
    };
  } catch (error) {
    console.error("❌ OCR Error:", error);
    return {
      success: false,
      text: "",
      error: error.message || "OCR failed",
    };
  }
};

// Cleanup worker on app shutdown
export const cleanupOCR = async () => {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
};