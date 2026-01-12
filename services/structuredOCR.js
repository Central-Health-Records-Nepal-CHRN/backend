import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function structureLabData(ocrText) {
  // Use 1.5-flash for faster, more accurate JSON extraction
  const model = genAI.getGenerativeModel({
  model: "gemini-2.5-pro", // Added '-latest'
});

  const prompt = `
    Extract lab test results from the provided OCR text into a structured JSON array.
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