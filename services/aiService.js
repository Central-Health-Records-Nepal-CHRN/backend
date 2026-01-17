// services/aiService.js

export const generateMedicationDescription = async (medicationName, dosage) => {
  try {
    const prompt = `Provide a brief, clear description (2-3 sentences) about the medication "${medicationName}" at ${dosage} dosage. Include:
1. What it's used for (primary purpose)
2. How it works (mechanism)
3. Important considerations

Keep it simple and easy to understand for patients. Do not include dosage instructions or side effects.`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-r1:8b', // or mistral, phi3, gemma, etc.
        prompt,
        stream: false, // IMPORTANT: disable streaming to get full response
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();

    return data.response.trim();
  } catch (error) {
    console.error('AI description generation error (Ollama):', error);
    throw error;
  }
};
