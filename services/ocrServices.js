import axios from "axios";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

/* ---------- IMAGE INPUT ---------- */
const getImageBuffer = async (input) => {
  if (Buffer.isBuffer(input)) return input;

  const res = await axios.get(input, {
    responseType: "arraybuffer",
  });

  return Buffer.from(res.data);
};

/* ---------- PREPROCESS ---------- */
const preprocessImage = async (buffer) => {
  return sharp(buffer).grayscale().normalize().threshold(150).toBuffer();
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
  const worker = await createWorker();

  try {
    // ✅ Correct initialization sequence
    await worker.reinitialize("eng");

    const buffer = await getImageBuffer(imageInput);
    const processed = await preprocessImage(buffer);

    const {
      data: { text },
    } = await worker.recognize(processed);

    return {
      success: true,
      text: normalizeText(text),
    };
  } catch (error) {
    console.error("OCR Error:", error);
    return {
      success: false,
      error: error.message || "OCR failed",
    };
  } finally {
    await worker.terminate();
  }
};
