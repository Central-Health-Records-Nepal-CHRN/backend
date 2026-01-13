import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function structureLabData(ocrText) {
  // Use 1.5-flash for faster, more accurate JSON extraction
  const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite", // Added '-latest'
});

  const prompt = `
  You are a medical laboratory report data extractor.

GOAL:
Extract ALL laboratory test results from the OCR text EXACTLY as written.

STRICT RULES (DO NOT BREAK):
- Do NOT summarize or shorten the data
- Do NOT omit any test result
- Do NOT infer, calculate, or guess values
- Extract EVERY test row that appears in the OCR text
- Preserve numeric values and units as text
- If a value or reference range is missing or unreadable, use null
- Do NOT provide medical interpretation
- Return ONLY valid JSON (no explanations, no markdown)
OUTPUT FORMAT:
  [
    {
      "test_name": string,
      "result": string | null,
      "units": string | null,
      "reference_range": string | null,
    }
  ]
    PROCESSING INSTRUCTIONS:
- Process the OCR text line-by-line
- Treat section headers (e.g., HAEMATOLOGY, BIOCHEMISTRY) as separators, not tests
- After extraction, verify that every test name present in the OCR text appears in the output JSON

OCR TEXT (EXTRACT FROM THIS ONLY):
<<<
    TEXT: ${ocrText}
  `;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        // This forces the model to output valid JSON
        responseMimeType: "application/json",
      },
    });
    const responseText = result.response.text();
    return JSON.parse(responseText);
    
  } catch (error) {
    console.error("Gemini parsing error:", error);
    throw new Error("Failed to structure lab data");
  }
}