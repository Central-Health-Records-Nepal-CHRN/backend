// services/aiService.js

export const generateMedicationDescription = async (medicationName, dosage) => {
  console.log(`Generating description for medication: ${medicationName}, dosage: ${dosage}`);
  try {
    const prompt = `You are generating patient-friendly medication information.

STRICT RULES:
- Do NOT include introductions like "Here is", "This medication is", "Okay", etc.
- Do NOT mention the medication name again.
- Do NOT include dosage instructions or side effects.
- Output ONLY 2-3 simple sentences.
- Start directly with the explanation.
- No headings. No bullet points. No extra text.

Write the description now:
Medication: ${medicationName}
Dosage: ${dosage}`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-r1:8b", // or mistral, phi3, gemma, etc.
        prompt,
        stream: false, // IMPORTANT: disable streaming to get full response
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    const data = await response.json();
    let cleanText = data.response.trim();
    cleanText = cleanText.replace(/^(sure|okay|here is|here's)\b.*?\.\s*/i, "");

    return cleanText;
  } catch (error) {
    console.error("AI description generation error (Ollama):", error);
    throw error;
  }
};
