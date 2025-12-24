import Tesseract from 'tesseract.js';
import axios from 'axios';

/* =========================================
   UTIL: GET IMAGE BUFFER
========================================= */
const getImageBuffer = async (input) => {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  // If input is URL (Cloudinary)
  if (typeof input === 'string') {
    const response = await axios.get(input, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  }

  throw new Error('Invalid image input');
};

/* =========================================
   PARSE LAB TESTS FROM TEXT
========================================= */
const parseLabTests = (text) => {
  const tests = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  /*
    Matches patterns like:
    Hemoglobin 14.5 g/dL 13.5-17.5
    WBC 7200 cells/µL 4500-11000
  */
  const regex =
    /([A-Za-z().\s/%]+)\s+([\d,.]+)\s*([a-zA-Z/%µ]+)?\s*(\(?\d+[\d.,\-–]+\)?)/;

  lines.forEach((line) => {
    const match = line.match(regex);
    if (match) {
      tests.push({
        testName: match[1].trim(),
        value: match[2].replace(/,/g, ''),
        unit: match[3] || '',
        normalRange: match[4] || '',
      });
    }
  });

  return tests;
};

/* =========================================
   MAIN OCR FUNCTION (FREE)
========================================= */
export const extractTestsFromImage = async (imageInput) => {
  try {
    const buffer = await getImageBuffer(imageInput);

    const {
      data: { text },
    } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {}, // disable logs
    });

    const extractedTests = parseLabTests(text);

    const testsWithOrder = extractedTests.map((test, index) => ({
      ...test,
      order_index: index,
    }));

    return {
      success: true,
      tests: testsWithOrder,
      count: testsWithOrder.length,
      raw_text: text,
    };
  } catch (error) {
    console.error('OCR error:', error);
    return {
      success: false,
      tests: [],
      count: 0,
      error: error.message,
    };
  }
};
