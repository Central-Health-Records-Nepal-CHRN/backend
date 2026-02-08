import fetch from "node-fetch";

/**
 * Safely extract JSON array from model output
 */
function extractJsonArray(text) {
  // Remove markdown fences if present
  text = text.replace(/```json|```/gi, "").trim();

  console.log("Inside LLM ",text)



  // Extract first JSON array found
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("No JSON array found in model response");
  }

  return JSON.parse(match[0]);
}

export async function structureLabData(ocrText) {
  const prompt = `
You are a medical laboratory report data extractor.

GOAL:
Extract ALL laboratory test results from the OCR text EXACTLY as written.

IMPORTANT:
- Output MUST be raw JSON only
- Do NOT use markdown, backticks, or explanations

STRICT RULES:
- Do NOT summarize
- Do NOT omit any test
- Do NOT infer or guess
- Preserve numbers and units as text
- If something is missing, use null
- If test_name is missing or unreadable, DO NOT include that test

OUTPUT FORMAT:
[
  {
    "test_name": string,
    "result": string | null,
    "units": string | null,
    "reference_range": string | null
  }
]

OCR TEXT:
<<<
${ocrText.text}
>>>
`;

console.log(prompt)
console.log("OCR TEXT", ocrText)

  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-r1:8b",
        prompt,
        stream: false,
        options: {
          temperature: 0,
          top_p: 0.95
        }
      })
    });

    console.log("Response ", res)

    const data = await res.json();
    console.log(data)

    if (!data?.response) {
      throw new Error("Empty response from Ollama");
    }

    // 1️⃣ Extract JSON safely
    const parsed = extractJsonArray(data.response);

    if (!Array.isArray(parsed)) {
      throw new Error("Model did not return a JSON array");
    }

    // 2️⃣ Filter invalid rows (CRITICAL)
    const validTests = parsed.filter(t =>
      t &&
      typeof t.test_name === "string" &&
      t.test_name.trim().length > 0
    );

    // 3️⃣ Log dropped rows for debugging
    const dropped = parsed.length - validTests.length;
    if (dropped > 0) {
      console.warn(`⚠️ Dropped ${dropped} invalid lab test rows`);
    }

    return validTests;

  } catch (error) {
    console.error("Ollama DeepSeek parsing error:", error);
    throw new Error("Failed to structure lab data using local model");
  }
}
